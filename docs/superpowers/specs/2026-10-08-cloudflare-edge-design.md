# hako2epub-web trên Cloudflare — Thiết kế

- **Ngày:** 2026-10-08
- **Trạng thái:** Chờ duyệt
- **Thay thế một phần:** [2026-10-08-hako2epub-web-design.md](2026-10-08-hako2epub-web-design.md)
  (phần giao diện, xác thực, deploy; worker Python và `library-template` giữ nguyên)

## 1. Mục tiêu

Chia sẻ được web cho người khác mà **không ai phải nhập GitHub token**. PAT nằm
trong secret của một Cloudflare Worker; người dùng chỉ nhập một **mật khẩu chung**
do chủ web đặt, được nhớ 30 ngày bằng cookie.

Đồng thời thu gọn web về đúng một luồng:

> dán link truyện → chọn tập → tải → theo dõi tiến trình → tải file EPUB về máy

### Ngoài phạm vi

- Trang Thư viện, danh sách truyện đã theo dõi, "Kiểm tra cập nhật" (`update.yml`), xoá truyện.
- Chọn tải đến từng chương (chỉ chọn theo tập).
- Tài khoản theo từng người, phân quyền, lịch sử ai tải gì.
- Dọn EPUB cũ trong nhánh `files` (để đợt sau).
- Thay đổi worker Python (`worker/`) hoặc 3 workflow trong `library-template/`.

### Tiêu chí thành công

1. Mở link Worker trên một trình duyệt mới → nhập mật khẩu một lần → 30 ngày sau
   vẫn vào thẳng được, không cần token.
2. Dán link hako → thấy danh sách tập → tải 1 tập → thấy tiến trình → bấm tải
   EPUB về máy, file mở được.
3. Không có mật khẩu thì không gọi được bất kỳ API GitHub nào qua Worker.
4. Kể cả khi đã đăng nhập, Worker chỉ cho các request trong allowlist (§3.3) đi qua.

## 2. Kiến trúc

```
Trình duyệt ──► https://hako2epub.<account>.workers.dev
                 ├─ /*        → web/dist (Workers Static Assets, không chạy code)
                 └─ /api/*    → edge Worker (run_worker_first)
                      ├─ POST /api/login    {password} → Set-Cookie session
                      ├─ POST /api/logout   → xoá cookie
                      ├─ GET  /api/session  → {authed: boolean}
                      └─ *    /api/gh/<suffix>
                                → https://api.github.com/repos/<OWNER>/<REPO>/<suffix>
                                  + Authorization: Bearer <GITHUB_TOKEN>
                                                           │
                                       GitHub Actions (inspect/download, không đổi)
```

- Thư mục mới **`edge/`**: Worker TypeScript, `package.json` riêng, `wrangler.jsonc`.
  Tên `edge/` để không nhầm với `worker/` (Python chạy trong Actions).
- Web và API **cùng origin** → không CORS, cookie `SameSite=Strict` dùng được, và
  không còn vấn đề origin dùng chung `<owner>.github.io`.
- Trình duyệt **không biết owner, repo, hay PAT**. Repo library cố định trong biến
  môi trường của Worker.

## 3. Worker `edge/`

### 3.1 Cấu hình

| Tên | Loại | Ý nghĩa |
|---|---|---|
| `GITHUB_TOKEN` | secret | Fine-grained PAT, chỉ repo library: Contents R/W, Actions R/W, Metadata R |
| `ADMIN_PASSWORD` | secret | Mật khẩu chung |
| `SESSION_SECRET` | secret | Khoá HMAC ký cookie (≥ 32 byte ngẫu nhiên) |
| `GITHUB_OWNER` | var | Owner repo library |
| `GITHUB_REPO` | var | Tên repo library (vd `hako2epub-library`) |
| `LOGIN_LIMITER` | binding | Workers Rate Limiting: 5 lần / 60 s, key = `CF-Connecting-IP` |

`wrangler.jsonc`: `main = src/index.ts`, `assets.directory = ../web/dist`,
`assets.not_found_handling = single-page-application`,
`assets.run_worker_first = ["/api/*"]`.

Thiếu một secret bắt buộc → mọi `/api/*` trả `500 {error:"misconfigured"}`
(không bao giờ gọi GitHub với token rỗng).

### 3.2 Phiên đăng nhập

- **Cookie:** `session=<exp>.<sig>`; `exp` = Unix giây, `sig` = base64url
  HMAC-SHA256(`SESSION_SECRET`, `exp`). Thuộc tính:
  `HttpOnly; Secure; SameSite=Strict; Path=/api; Max-Age=2592000` (30 ngày).
- **Hợp lệ** khi: đúng định dạng, `sig` khớp (so sánh constant-time qua
  `crypto.subtle.verify`), `exp > now`. Không lưu trạng thái trên server; đổi
  `SESSION_SECRET` = đăng xuất mọi thiết bị.
- **`POST /api/login`** body `{password: string}`:
  1. `LOGIN_LIMITER.limit({key: ip})` bị từ chối → `429 {error:"rate_limited"}`.
  2. So sánh mật khẩu constant-time (HMAC cả hai vế rồi so) → sai: `401 {error:"bad_password"}`.
  3. Đúng → `204` + `Set-Cookie`.
- **`POST /api/logout`** → `204` + cookie `Max-Age=0`.
- **`GET /api/session`** → `200 {authed: boolean}`; không bao giờ trả 401.
- **CSRF:** mọi request có method khác GET/HEAD tới `/api/*` phải có header
  `Origin` trùng origin của request URL; sai/thiếu → `403 {error:"bad_origin"}`.
  Áp dụng cả `/api/login`.

### 3.3 Proxy `/api/gh/<suffix>`

Bước xử lý theo thứ tự:

1. Không có phiên hợp lệ → `401 {error:"login_required"}`.
2. **Kiểm tra suffix:** lấy phần `pathname` sau `/api/gh/`. Trả `403 {error:"forbidden"}`
   nếu suffix rỗng, chứa `//`, chứa một đoạn đúng bằng `.` hoặc `..`, hoặc chứa
   `%2F`, `%2f`, `%5C`, `%5c`, `\` (chặn path traversal sau khi GitHub tự decode).
3. **Allowlist** (khớp toàn bộ suffix, không khớp → `403 {error:"forbidden"}`):

   | Method | Suffix (regex) | Dùng cho |
   |---|---|---|
   | GET | `^contents/[^?#]+$` | snapshot, `progress.json` trên `status/<id>`, `ln_info.json`, file EPUB |
   | GET | `^actions/runs$` | theo dõi run |
   | POST | `^actions/workflows/(inspect\|download)\.yml/dispatches$` | inspect, tải |
   | POST | `^actions/runs/\d+/cancel$` | huỷ |

   Query string được giữ nguyên khi chuyển tiếp (`?ref=…`, `?event=…&per_page=…`).
4. **Chuyển tiếp** tới `https://api.github.com/repos/${OWNER}/${REPO}/${suffix}${search}`:
   - Header gửi đi: `Authorization: Bearer ${GITHUB_TOKEN}`, `User-Agent: hako2epub-edge`,
     `X-GitHub-Api-Version: 2022-11-28`, và từ request gốc chỉ chép `Accept`, `Content-Type`.
     Không chép `Cookie` hay header nào khác.
   - Body: chuyển tiếp nguyên cho POST.
5. **Response:**
   - GitHub trả `401` → Worker trả `502 {error:"upstream_auth"}` (PAT server hết hạn /
     bị thu hồi — để web không nhầm với chưa đăng nhập).
   - Còn lại: trả nguyên status + body (stream, không buffer — EPUB có thể vài chục MB),
     chỉ chép header `Content-Type`, `Content-Length`, `ETag`, `X-RateLimit-Remaining`,
     `X-RateLimit-Reset`, `Retry-After`, `Link`; thêm `Cache-Control: no-store`.

### 3.4 Cấu trúc mã

```
edge/
  package.json        wrangler, vitest, typescript, @cloudflare/workers-types
  wrangler.jsonc
  tsconfig.json
  src/index.ts        router: /api/login|logout|session|gh/*, 404 JSON cho /api/* khác
  src/session.ts      sign/verify cookie, so mật khẩu
  src/proxy.ts        normalize + allowlist + forward
  src/http.ts         json(), checkOrigin(), env validation
  test/*.test.ts      gọi worker.fetch(request, env) với fetch GitHub giả
```

## 4. Web

### 4.1 Màn hình

1. **Đăng nhập** (`#/login`): một ô mật khẩu + nút. Khi app mở, `GET /api/session`;
   `authed=false` → hiện màn này; đúng mật khẩu → về `#/`. Thông báo theo lỗi:
   `bad_password` "Sai mật khẩu", `rate_limited` "Thử lại sau 1 phút".
2. **Trang chính** (`#/`, thay `Novel`): ô dán link →
   - có snapshot trong repo → hiện ngay thông tin truyện + danh sách tập;
   - chưa có → dispatch `inspect`, hiện trạng thái chờ (logic sẵn có trong
     `ActionsNovelSource`), xong thì hiện danh sách;
   - nút "Làm mới" chạy lại inspect.
   Danh sách tập là **checkbox, mặc định chọn hết**, có "Chọn tất cả / Bỏ chọn".
   Bấm **Tải** → dispatch `download` với `volumes: [{index, name, chapters: null}]`
   cho các tập được chọn → chuyển sang `#/jobs`.
3. **Tiến trình** (`#/jobs`): job của trình duyệt này (cơ chế `jobs.ts`/`tracker.ts`
   hiện có): phase, số tập/chương, log, huỷ. Job `download` xong → với mỗi tập
   `ok: true` trong `results`, tìm `asset` của tập đó trong `ln_info.json` và hiện
   **nút tải EPUB** (dùng `downloadEpub` sẵn có).

Header: "hako2epub" (về `#/`), "Tiến trình" + `JobBadge`, "Đăng xuất".

### 4.2 Thay đổi mã

- **`GitHubClient`:** constructor không nhận `Settings`; URL = `/api/gh/${suffix}`;
  bỏ header `Authorization`; giữ `cache: 'no-store'`. Giữ `getJson`, `dispatch`,
  `listDispatchRuns`, `cancelRun`, `getFileBytes`. Bỏ `updateJson`, `deleteFile`, `checkSetup`.
- **Lỗi** (`github/errors.ts`): thêm kind `login_required` (401 từ Worker) và
  `upstream_auth` (502 với `error:"upstream_auth"`). `handleError`:
  `login_required` → `navigate('/login')`; `upstream_auth` → banner
  "Token GitHub trên server đã hết hạn, báo chủ web". Các kind khác giữ nguyên.
- **`auth.ts` mới:** `getSession()`, `login(password)`, `logout()` gọi `/api/*`
  với `credentials: 'same-origin'`.
- **Xoá:** `routes/Library.tsx`, `routes/Setup.tsx`, `settings.ts`,
  `library-actions.ts`, `components/ConfirmDialog.tsx` nếu không còn dùng, phần chọn chương
  trong `novel/selection.ts`, kind `update` trong `jobs.ts`; các test tương ứng.
- **`vite.config`:** `base: '/'`. Dev: `server.proxy['/api'] = 'http://localhost:8787'`
  (chạy `wrangler dev` trong `edge/` song song).

## 5. Deploy

- `.github/workflows/pages.yml` → đổi tên `deploy.yml`:
  - job `test`: như cũ + `npm ci --prefix edge && npm --prefix edge test -- --run`.
  - job `deploy` (push lên `main`): build web, rồi `cloudflare/wrangler-action@v3`
    với `workingDirectory: edge`, `command: deploy`. Secret repo cần có:
    `CLOUDFLARE_API_TOKEN` (quyền *Workers Scripts: Edit*), `CLOUDFLARE_ACCOUNT_ID`.
- Secret của Worker đặt một lần bằng tay:
  `wrangler secret put GITHUB_TOKEN|ADMIN_PASSWORD|SESSION_SECRET`.
- GitHub Pages: deploy lần cuối một `index.html` redirect (`<meta http-equiv="refresh">`)
  sang URL Worker, rồi tắt Pages workflow. Lần deploy đó **không** chứa bundle cũ.
- README: thay phần Cài đặt / Bảo mật token bằng các bước Cloudflare ở trên.

## 6. Kiểm thử

**Worker** (vitest, môi trường Node, `fetch` GitHub được mock, `LOGIN_LIMITER` giả):

- Session: ký → verify OK; sai chữ ký, sửa `exp`, hết hạn, sai định dạng → không hợp lệ.
- Login: đúng mật khẩu → 204 + cookie đủ thuộc tính; sai → 401; limiter từ chối → 429;
  thiếu `Origin` → 403.
- Proxy: chưa đăng nhập → 401; mỗi dòng allowlist → chuyển đúng URL/method/header,
  không lộ `Cookie`; bị chặn: `update.yml` dispatch, PUT/DELETE contents, `actions/secrets`,
  `../`, `%2F`, `//`, suffix rỗng; GitHub 401 → 502 `upstream_auth`; 404 giữ nguyên;
  body EPUB được stream nguyên byte.
- Thiếu secret → 500 `misconfigured`.

**Web** (vitest + jsdom, như hiện có): client gọi đúng `/api/gh/...` không có
`Authorization`; 401/502 map đúng kind và điều hướng/banner; màn đăng nhập; trang
chính chọn/bỏ chọn tập và tạo payload `chapters: null`; màn tiến trình hiện nút tải
EPUB khi job xong.

**Thủ công sau deploy:** chạy đúng 4 tiêu chí thành công ở §1 trên link thật.
