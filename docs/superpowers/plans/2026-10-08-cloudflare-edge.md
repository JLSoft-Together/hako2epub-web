# hako2epub trên Cloudflare — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Đưa web lên một Cloudflare Worker giữ PAT trong secret, đăng nhập bằng mật khẩu chung, và thu gọn web còn luồng dán link → chọn tập → tải → theo dõi → tải EPUB.

**Architecture:** Thư mục mới `edge/` là Worker TypeScript phục vụ `web/dist` qua Static Assets và chỉ chạy code cho `/api/*`: login/logout/session bằng cookie HMAC và proxy allowlist `/api/gh/<suffix>` → `api.github.com/repos/<OWNER>/<REPO>/<suffix>`. Web giữ nguyên React Query/jobs, `GitHubClient` đổi base sang `/api/gh` và không còn token. Worker Python và `library-template/` không đổi.

**Tech Stack:** Cloudflare Workers (wrangler 4, Static Assets, Rate Limiting binding), TypeScript ~6.0, vitest 5, React 19, Vite 8, Tailwind 4.

**Spec:** `docs/superpowers/specs/2026-10-08-cloudflare-edge-design.md`

## Global Constraints

- Node 22 (CI và local).
- Không sửa `worker/`, `core/`, `library-template/`.
- Cookie: tên `session`, giá trị `<exp>.<sig>`, `HttpOnly; Secure; SameSite=Strict; Path=/api; Max-Age=2592000`.
- Rate limit đăng nhập: 5 lần / 60 s theo `CF-Connecting-IP`.
- Mã lỗi JSON của Worker (body `{error: <code>}`): `misconfigured` 500, `bad_request` 400, `bad_password` 401, `login_required` 401, `rate_limited` 429, `bad_origin` 403, `forbidden` 403, `upstream_auth` 502, `not_found` 404.
- Toàn bộ chữ trên UI bằng tiếng Việt; giữ phong cách Tailwind hiện có.
- `vite.config.ts` `base: '/'`.
- Commit theo gitmoji như lịch sử repo, kết thúc bằng `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Nhiều người dùng chung một repo:** trang Tiến trình chỉ hiện job do trình duyệt này tạo, không hiện job của người khác → test trong Task 6.
2. **Phiên hết hạn giữa chừng** (poll job nhận 401): về màn đăng nhập đúng một lần, không lặp redirect, đăng nhập lại thì job đang chạy vẫn hiện → test trong Task 4.
3. **Path traversal qua `%2e%2e`:** URL parser chuẩn hoá `%2e%2e` thành `..` trước khi Worker thấy; `/api/gh/contents/%2e%2e/actions/secrets` phải ra 403 → test trong Task 2.
4. **Body đăng nhập hỏng** (không phải JSON, thiếu `password`, `password` không phải chuỗi): 400 `bad_request`, không phải 500 → test trong Task 3.
5. **Server API không chạy** (`npm run dev` mà quên `wrangler dev`, hoặc mạng lỗi): màn đăng nhập hiện "Không kết nối được máy chủ" thay vì trắng trang → test trong Task 4.

---

## File Structure

```
edge/
  package.json            scripts: dev, deploy, test; devDeps wrangler, vitest, typescript, @cloudflare/workers-types
  tsconfig.json
  wrangler.jsonc
  src/env.ts              Env type, requireEnv()
  src/http.ts             json(), sameOrigin()
  src/session.ts          signSession(), verifySession(), checkPassword(), cookie helpers
  src/proxy.ts            checkSuffix(), isAllowed(), forward()
  src/index.ts            default export { fetch } + handle(req, env, deps)
  test/session.test.ts
  test/proxy.test.ts
  test/index.test.ts
web/src/
  auth.ts                 NEW getSession/login/logout
  assets.ts               NEW findAsset()
  routes/Login.tsx        NEW
  routes/Home.tsx         NEW (thay Novel.tsx)
  routes/Jobs.tsx         sửa
  github/client.ts        sửa
  github/errors.ts        sửa
  data/queries.ts         sửa
  novel/selection.ts      thu gọn
  router.ts, App.tsx      sửa
  XOÁ: routes/Library.tsx, routes/Setup.tsx, routes/Novel.tsx, settings.ts,
       library-actions.ts, components/ConfirmDialog.tsx (nếu không còn import)
.github/workflows/pages.yml → deploy.yml
pages-redirect/index.html  NEW
README.md
```

---

### Task 1: `edge/` scaffold + session

**Files:**
- Create: `edge/package.json`, `edge/tsconfig.json`, `edge/src/env.ts`, `edge/src/http.ts`, `edge/src/session.ts`
- Test: `edge/test/session.test.ts`

**Interfaces:**
- Produces:
  - `type Env = { GITHUB_TOKEN: string; ADMIN_PASSWORD: string; SESSION_SECRET: string; GITHUB_OWNER: string; GITHUB_REPO: string; LOGIN_LIMITER: { limit(o: { key: string }): Promise<{ success: boolean }> } }`
  - `requireEnv(env: Env): boolean` — true khi cả 5 chuỗi khác rỗng.
  - `json(status: number, body: unknown, headers?: HeadersInit): Response` — `Content-Type: application/json`, `Cache-Control: no-store`.
  - `sameOrigin(req: Request): boolean` — `req.headers.get('Origin') === new URL(req.url).origin`.
  - `SESSION_TTL_S = 2592000`
  - `signSession(secret: string, exp: number): Promise<string>` → `"<exp>.<base64url sig>"`
  - `verifySession(secret: string, value: string | null, nowS: number): Promise<boolean>`
  - `readSessionCookie(req: Request): string | null`
  - `sessionCookie(value: string): string` và `clearedCookie(): string` (chuỗi `Set-Cookie`)
  - `checkPassword(secret: string, expected: string, given: string): Promise<boolean>`

- [ ] **Step 1: Scaffold `edge/`**

`package.json` (`"type": "module"`, `"private": true`): scripts `"dev": "wrangler dev"`, `"deploy": "wrangler deploy"`, `"test": "vitest"`, `"typecheck": "tsc --noEmit"`. devDependencies: `wrangler@^4`, `vitest@^5`, `typescript@~6.0.2`, `@cloudflare/workers-types@^4`. `tsconfig.json`: `target ES2022`, `module ESNext`, `moduleResolution Bundler`, `strict`, `types: ["@cloudflare/workers-types"]`, `include: ["src", "test"]`. Chạy `npm install --prefix edge`, commit cả `package-lock.json`. Thêm `edge/node_modules` và `edge/.wrangler` vào `.gitignore`.

- [ ] **Step 2: Write failing tests `edge/test/session.test.ts`**

```ts
const SECRET = 'k'.repeat(32)
it('signs and verifies a fresh session', async () => {
  const v = await signSession(SECRET, 2_000)
  expect(v).toMatch(/^2000\.[A-Za-z0-9_-]+$/)
  expect(await verifySession(SECRET, v, 1_999)).toBe(true)
})
it('rejects expired, tampered, wrong-secret and malformed values', async () => {
  const v = await signSession(SECRET, 2_000)
  expect(await verifySession(SECRET, v, 2_000)).toBe(false)               // exp <= now
  expect(await verifySession(SECRET, v.replace('2000', '9999'), 1)).toBe(false)
  expect(await verifySession('x'.repeat(32), v, 1)).toBe(false)
  for (const bad of [null, '', 'abc', '2000.', '.sig', 'a.b.c', 'NaN.xx'])
    expect(await verifySession(SECRET, bad, 1)).toBe(false)
})
it('reads the session cookie among others', () => {
  const req = new Request('https://x/api/session', { headers: { Cookie: 'a=1; session=123.abc; b=2' } })
  expect(readSessionCookie(req)).toBe('123.abc')
  expect(readSessionCookie(new Request('https://x/'))).toBeNull()
})
it('builds cookie strings', () => {
  expect(sessionCookie('1.s')).toBe('session=1.s; HttpOnly; Secure; SameSite=Strict; Path=/api; Max-Age=2592000')
  expect(clearedCookie()).toBe('session=; HttpOnly; Secure; SameSite=Strict; Path=/api; Max-Age=0')
})
it('checks the password', async () => {
  expect(await checkPassword(SECRET, 'hunter2', 'hunter2')).toBe(true)
  expect(await checkPassword(SECRET, 'hunter2', 'hunter3')).toBe(false)
  expect(await checkPassword(SECRET, 'hunter2', '')).toBe(false)
})
```

- [ ] **Step 3: Run** `npm --prefix edge test -- --run` → FAIL (module not found).

- [ ] **Step 4: Implement `env.ts`, `http.ts`, `session.ts`**

HMAC-SHA256 qua `crypto.subtle.importKey('raw', …, {name:'HMAC', hash:'SHA-256'}, false, ['sign','verify'])`. `verifySession` tách đúng 2 phần, `exp` phải khớp `/^\d+$/`, decode base64url (lỗi → false), dùng `crypto.subtle.verify` (constant-time). `checkPassword`: `mac = sign(secret, expected)` rồi `crypto.subtle.verify(key, mac, encode(given))`.

- [ ] **Step 5: Run** `npm --prefix edge test -- --run` và `npm --prefix edge run typecheck` → PASS.

- [ ] **Step 6: Commit** `✨ feat(edge): scaffold Cloudflare Worker with signed session cookies`

---

### Task 2: Proxy allowlist + forward

**Files:**
- Create: `edge/src/proxy.ts`
- Test: `edge/test/proxy.test.ts`

**Interfaces:**
- Consumes: `Env`, `json` (Task 1).
- Produces:
  - `checkSuffix(suffix: string): boolean`
  - `isAllowed(method: string, suffix: string): boolean`
  - `forward(req: Request, suffix: string, env: Env, fetchImpl: typeof fetch): Promise<Response>`

Allowlist (regex khớp toàn bộ suffix, không gồm query):

| Method | Regex |
|---|---|
| GET | `^contents/[^?#]+$` |
| GET | `^actions/runs$` |
| POST | `^actions/workflows/(inspect\|download)\.yml/dispatches$` |
| POST | `^actions/runs/\d+/cancel$` |

`checkSuffix` false khi: rỗng, chứa `//`, có segment đúng bằng `.` hoặc `..`, hoặc chứa (không phân biệt hoa thường) `%2f`, `%5c`, `\`.

- [ ] **Step 1: Write failing tests**

```ts
it.each([
  ['GET', 'contents/data/ln_info.json'], ['GET', 'contents/epub/a%20b.epub'],
  ['GET', 'actions/runs'], ['POST', 'actions/workflows/inspect.yml/dispatches'],
  ['POST', 'actions/workflows/download.yml/dispatches'], ['POST', 'actions/runs/123/cancel'],
])('allows %s %s', (m, s) => expect(checkSuffix(s) && isAllowed(m, s)).toBe(true))

it.each([
  ['POST', 'actions/workflows/update.yml/dispatches'], ['PUT', 'contents/data/ln_info.json'],
  ['DELETE', 'contents/x'], ['GET', 'actions/secrets'], ['GET', ''], ['GET', 'contents/'],
  ['GET', 'contents/a/../../actions/secrets'], ['GET', 'contents/a%2F..%2Fx'],
  ['GET', 'contents/a%5cx'], ['GET', 'contents//x'], ['POST', 'actions/runs/abc/cancel'],
])('blocks %s %s', (m, s) => expect(checkSuffix(s) && isAllowed(m, s)).toBe(false))

it('forwards to the fixed repo with only safe headers', async () => {
  const fetchMock = vi.fn(async () => new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json', 'Set-Cookie': 'x=1', 'X-RateLimit-Remaining': '9' } }))
  const req = new Request('https://h/api/gh/contents/a.json?ref=files', {
    headers: { Accept: 'application/vnd.github.raw', Cookie: 'session=1.s', 'X-Evil': '1' } })
  const res = await forward(req, 'contents/a.json', ENV, fetchMock)
  const [url, init] = fetchMock.mock.calls[0]
  expect(url).toBe('https://api.github.com/repos/me/lib/contents/a.json?ref=files')
  const h = new Headers(init.headers)
  expect(h.get('Authorization')).toBe('Bearer ghp_secret')
  expect(h.get('Accept')).toBe('application/vnd.github.raw')
  expect(h.get('User-Agent')).toBe('hako2epub-edge')
  expect(h.get('X-GitHub-Api-Version')).toBe('2022-11-28')
  expect(h.has('Cookie')).toBe(false); expect(h.has('X-Evil')).toBe(false)
  expect(res.headers.has('Set-Cookie')).toBe(false)
  expect(res.headers.get('X-RateLimit-Remaining')).toBe('9')
  expect(res.headers.get('Cache-Control')).toBe('no-store')
})
it('passes the POST body through', /* body JSON đọc lại từ init.body bằng new Response(init.body).text() */)
it('maps upstream 401 to 502 upstream_auth', /* status 502, body {error:'upstream_auth'} */)
it('keeps 404 as is', /* status 404 */)
it('streams binary bodies byte-for-byte', /* Uint8Array 0..255 lặp 4096 lần, so sánh arrayBuffer */)
```

`ENV` = `{ GITHUB_TOKEN: 'ghp_secret', ADMIN_PASSWORD: 'pw', SESSION_SECRET: 'k'.repeat(32), GITHUB_OWNER: 'me', GITHUB_REPO: 'lib', LOGIN_LIMITER: { limit: async () => ({ success: true }) } }` — đặt trong `edge/test/helpers.ts`, dùng lại ở Task 3.

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement `proxy.ts`**

Header gửi đi: 4 header cố định + chép `Accept`, `Content-Type` nếu có. Body chỉ khi method không phải GET/HEAD (`req.body`). Response trả về: `new Response(upstream.body, {status, headers})`, chỉ chép `Content-Type`, `Content-Length`, `ETag`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, `Retry-After`, `Link`, thêm `Cache-Control: no-store`.

- [ ] **Step 4: Run** test + typecheck → PASS.

- [ ] **Step 5: Commit** `✨ feat(edge): allowlisted GitHub proxy`

---

### Task 3: Router `index.ts` + wrangler config

**Files:**
- Create: `edge/src/index.ts`, `edge/wrangler.jsonc`
- Test: `edge/test/index.test.ts`

**Interfaces:**
- Consumes: Task 1, Task 2.
- Produces: `handle(req: Request, env: Env, deps?: { fetch?: typeof fetch; nowS?: () => number }): Promise<Response>`; `export default { fetch: (req, env) => handle(req, env) }`.

Thứ tự xử lý trong `handle`:
1. `!requireEnv(env)` → 500 `misconfigured`.
2. Method khác GET/HEAD và `!sameOrigin(req)` → 403 `bad_origin`.
3. `POST /api/login`: limiter (`key = CF-Connecting-IP ?? 'unknown'`) thất bại → 429 `rate_limited`; parse JSON lỗi / `password` không phải chuỗi khác rỗng → 400 `bad_request`; sai → 401 `bad_password`; đúng → 204 + `Set-Cookie: sessionCookie(signSession(secret, nowS()+SESSION_TTL_S))`.
4. `POST /api/logout` → 204 + `clearedCookie()`.
5. `GET /api/session` → 200 `{authed}`.
6. `/api/gh/*`: phiên không hợp lệ → 401 `login_required`; `checkSuffix`/`isAllowed` sai → 403 `forbidden`; còn lại `forward`.
7. Khác → 404 `not_found`.

`suffix` = `url.pathname.slice('/api/gh/'.length)`; query lấy từ `url.search`.

`wrangler.jsonc`:

```jsonc
{
  "name": "hako2epub",
  "main": "src/index.ts",
  "compatibility_date": "2026-09-01",
  "assets": { "directory": "../web/dist", "not_found_handling": "single-page-application", "run_worker_first": ["/api/*"] },
  "vars": { "GITHUB_OWNER": "PNThanggg", "GITHUB_REPO": "hako2epub-library" },
  "ratelimits": [{ "name": "LOGIN_LIMITER", "namespace_id": "1001", "simple": { "limit": 5, "period": 60 } }]
}
```

`edge/.dev.vars.example` với 3 secret giả; thêm `edge/.dev.vars` vào `.gitignore`.

- [ ] **Step 1: Write failing tests** (dùng `ENV` từ `test/helpers.ts`, `ORIGIN = 'https://h'`, helper `post(path, body, headers)` luôn gắn `Origin: ORIGIN` trừ khi ghi đè):
  - `login sets a 30-day cookie`: 204, `Set-Cookie` bắt đầu `session=` và chứa `Max-Age=2592000`.
  - `login rejects wrong password` → 401 `bad_password`.
  - `login rejects malformed bodies`: `'not json'`, `{}`, `{password: 1}`, `{password: ''}` → 400 `bad_request`.
  - `login is rate limited`: limiter trả `{success:false}` → 429; limiter nhận `key` = giá trị `CF-Connecting-IP`.
  - `writes need a matching Origin`: login không Origin → 403; Origin `https://evil` → 403 `bad_origin`.
  - `session reports authed`: không cookie → `{authed:false}`; cookie từ login → `{authed:true}`; cookie hết hạn (`nowS` sau `exp`) → false.
  - `logout clears the cookie`: `Set-Cookie` chứa `Max-Age=0`.
  - `gh needs a session`: GET `/api/gh/contents/a.json` không cookie → 401 `login_required`, fetch mock không được gọi.
  - `gh forbids non-allowlisted calls`: có cookie, `POST /api/gh/actions/workflows/update.yml/dispatches` → 403 `forbidden`.
  - `gh normalised traversal is forbidden`: `GET https://h/api/gh/contents/%2e%2e/actions/secrets` → 403, fetch không được gọi.
  - `gh forwards allowed calls`: có cookie, `GET /api/gh/actions/runs?event=workflow_dispatch&per_page=50` → fetch mock gọi `https://api.github.com/repos/me/lib/actions/runs?event=workflow_dispatch&per_page=50`.
  - `misconfigured`: `GITHUB_TOKEN: ''` → 500 `misconfigured` cho mọi `/api/*`.
  - `unknown api path` → 404 `not_found`.

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement `index.ts`, viết `wrangler.jsonc`, `.dev.vars.example`.**
- [ ] **Step 4: Run** `npm --prefix edge test -- --run`, `npm --prefix edge run typecheck`, và `npx --prefix edge wrangler deploy --dry-run --outdir /tmp/edge-dry` (chạy trong `edge/`, cần `web/dist` tồn tại: `npm --prefix web run build` trước) → tất cả PASS.
- [ ] **Step 5: Commit** `✨ feat(edge): login/session routes and wrangler config`

---

### Task 4: Web — client qua `/api/gh`, đăng nhập, bỏ Settings

**Files:**
- Create: `web/src/auth.ts`, `web/src/routes/Login.tsx`, `web/test/auth.test.ts`, `web/test/Login.test.tsx`
- Modify: `web/src/github/client.ts`, `web/src/github/errors.ts`, `web/src/data/queries.ts`, `web/src/router.ts`, `web/src/App.tsx`, `web/src/jobs.ts` (`dispatchError`), `web/vite.config.ts`, `web/test/client.test.ts`, `web/test/router.test.ts`, `web/test/fetchJobs.test.ts`
- Delete: `web/src/settings.ts`, `web/src/routes/Setup.tsx`, `web/test/settings.test.ts`, `web/test/Setup.test.tsx`

**Interfaces:**
- Produces:
  - `new GitHubClient(opts?: ClientOptions)`; URL = `` `/api/gh/${suffix}` ``; không còn `updateJson`, `deleteFile`, `checkSetup`.
  - `ErrorKind = 'login_required' | 'upstream_auth' | 'rate_limit' | 'not_found' | 'conflict' | 'other'`. `classifyError(status, headers, message)`: 401 → `login_required`; 502 và `message` chứa `"upstream_auth"` → `upstream_auth`; còn lại như cũ.
  - `auth.ts`: `getSession(fetchImpl?): Promise<boolean>`; `login(password: string, fetchImpl?): Promise<'ok' | 'bad_password' | 'rate_limited' | 'error'>`; `logout(fetchImpl?): Promise<void>`. Tất cả dùng `credentials: 'same-origin'`; POST gửi `Content-Type: application/json`.
  - `RouteName = 'login' | 'home' | 'jobs'`; hash không khớp → `home`.
  - Query key `['session']` (giá trị `boolean`).

- [ ] **Step 1: Sửa/viết test trước**
  - `client.test.ts`: bỏ `s` khỏi `setup` (`new GitHubClient({ fetch, sleep })`); thêm `it('calls /api/gh without Authorization')`: `getJson('data/a.json', 'files')` → URL `/api/gh/contents/data/a.json?ref=files`, `hdr(call,'Authorization')` undefined. Đổi test 401 → kind `login_required`; thêm 502 body `{"error":"upstream_auth"}` → `upstream_auth`; 502 body khác → `other`. Xoá test của `updateJson`, `deleteFile`, `checkSetup`.
  - `router.test.ts`: `#/login` → login, `#/jobs` → jobs, `#/`, `#/library`, `#/setup` → home, giữ params `#/?url=x`.
  - `fetchJobs.test.ts`: chỗ kiểm tra rethrow `auth` đổi thành `login_required`.
  - `auth.test.ts`: `getSession` đọc `{authed:true}`; `login` map 204→`ok`, 401→`bad_password`, 429→`rate_limited`, 500→`error`, fetch reject → `error`; request login có `method: 'POST'`, body `{"password":"pw"}`.
  - `Login.test.tsx`: nhập mật khẩu + submit → gọi `login('pw')`, `ok` → hash thành `#/`; `bad_password` → hiện "Sai mật khẩu"; `rate_limited` → "Thử lại sau 1 phút"; `error` → "Không kết nối được máy chủ". (Login nhận prop `doLogin = login` để test.)
  - `App`/`queries`: `it('login_required redirects once and marks session false')`: gọi `handleError(new GitHubError(401,'login_required','x'), qc)` hai lần → `qc.getQueryData(['session'])` là `false`, hash `#/login`, `setLastError` không bị gọi. `it('upstream_auth shows the server-token banner')` → banner "Token GitHub trên server đã hết hạn, báo chủ web".
- [ ] **Step 2: Run** `npm --prefix web test -- --run` → FAIL ở các test mới/đổi.
- [ ] **Step 3: Implement**
  - `client.ts`, `errors.ts` theo Interfaces; bỏ `Settings`.
  - `handleError`: `login_required` → `qc.setQueryData(['session'], false)`, `navigate('/login')` chỉ khi hash hiện tại chưa phải `#/login`; `upstream_auth` → `setLastError(...)`. Bỏ `clearSettings`.
  - `fetchJobs`: rethrow khi kind `login_required`, `upstream_auth` hoặc `rate_limit`.
  - `dispatchError`: 403 kind `other` → `'Máy chủ từ chối thao tác này'`.
  - `App.tsx`: `useQuery({ queryKey: ['session'], queryFn: () => getSession(), retry: false })`; đang tải → không render gì; `false` hoặc lỗi và route ≠ login → `navigate('/login')`; client = `useMemo(() => new GitHubClient(), [])`. Header: "hako2epub" (`#/`), "Tiến trình" + `JobBadge` (`#/jobs`), nút "Đăng xuất" (`logout()` → `setQueryData(['session'], false)` → `navigate('/login')`). Route `home` tạm render `Novel` hiện có cho tới Task 5 (sửa Novel chỉ đủ để biên dịch: bỏ `useLibrary`/`volumeBadge` nếu chúng phụ thuộc phần đã xoá).
  - `Login.tsx`: form một ô `type="password"`, nút "Đăng nhập"; `ok` → `qc.setQueryData(['session'], true)`, `navigate('/')`.
  - `vite.config.ts`: `base: '/'`, `server: { proxy: { '/api': 'http://localhost:8787' } }`.
  - Xoá các file trong mục Delete; `Jobs.tsx` bỏ `loadSettings` (link run trỏ `run.html_url` sẵn có).
- [ ] **Step 4: Run** `npm --prefix web test -- --run`, `npm --prefix web run build`, `npm --prefix web run lint` → PASS.
- [ ] **Step 5: Commit** `♻️ refactor(web): talk to the edge proxy and log in with a password`

---

### Task 5: Web — trang chính chọn tập

**Files:**
- Create: `web/src/routes/Home.tsx`, `web/test/Home.test.tsx`
- Modify: `web/src/novel/selection.ts`, `web/test/selection.test.ts`, `web/src/App.tsx`, `web/src/data/queries.ts`
- Delete: `web/src/routes/Novel.tsx`, `web/test/Novel.test.tsx`, `web/src/routes/Library.tsx`, `web/test/Library.test.tsx`, `web/src/library-actions.ts`, `web/test/library-actions.test.ts`, `web/src/components/ConfirmDialog.tsx` (nếu không còn import)

**Interfaces:**
- Consumes: `useClient`, `useStartJob`, `useJobs`, `useSnapshot`, `ActionsNovelSource`, `activeInspectId`, `canonicalUrl`, `novelId`, `InvalidNovelUrl` (đều có sẵn).
- Produces:
  - `selection.ts`: `type Selection = Set<number>` (index tập được chọn); `buildDownloadPayload(snapshot: Snapshot, sel: Selection): DownloadPayload` — mỗi tập được chọn theo thứ tự `snapshot.volumes` → `{index, name, chapters: null}`. Xoá `volumeBadge`.
  - `queries.ts`: `useLibrary` đổi tên `useLnInfo` (cùng query key `['library']`), dùng ở Task 6.

- [ ] **Step 1: Write failing tests**
  - `selection.test.ts`: chọn `{0,2}` trên snapshot 3 tập → `volumes` = `[{index:0,name:'T1',chapters:null},{index:2,name:'T3',chapters:null}]`, `url` = `snapshot.url`; chọn rỗng → `volumes: []`.
  - `Home.test.tsx` (mock client như `Novel.test.tsx` cũ đang làm):
    - `shows volumes of a cached snapshot, all checked`: snapshot có sẵn → mọi checkbox tập đều checked; nút "Tải 3 tập" bật.
    - `toggle all`: bấm "Bỏ chọn" → nút Tải bị vô hiệu và hiện "Tải 0 tập"; bấm "Chọn tất cả" → checked lại.
    - `starts an inspect when there is no snapshot`: `getJson` trả null → `startJob('inspect', {url}, canonical)` được gọi, hiện "Đang đọc thông tin truyện…".
    - `download dispatches whole volumes and goes to jobs`: bỏ chọn tập 2, bấm Tải → `startJob('download', {url, volumes:[{index:0,…,chapters:null},{index:2,…,chapters:null}]}, snapshot.name)`, hash thành `#/jobs`.
    - `invalid url`: dán `https://example.com` → hiện `INVALID_URL`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement `Home.tsx`**

Dựng từ `Novel.tsx`: giữ phần ô link, `?url=` trong hash, `ActionsNovelSource`, trạng thái chờ inspect, nút "Làm mới", thông tin truyện (bìa, tên, tác giả, tóm tắt). Thay `VolumeRow` bằng một danh sách checkbox (`aria-label` = tên tập, kèm "N chương"). Selection mặc định = mọi index mỗi khi `snapshot.fetched_at` đổi. Nút "Tải N tập" (`N = sel.size`, disabled khi 0 hoặc đang gửi). App: route `home` → `<Home />`.

- [ ] **Step 4: Run** test + build + lint → PASS.
- [ ] **Step 5: Commit** `♻️ refactor(web): single page to pick volumes and download`

---

### Task 6: Web — tiến trình chỉ của mình + nút tải EPUB

**Files:**
- Create: `web/src/assets.ts`, `web/test/assets.test.ts`
- Modify: `web/src/data/queries.ts` (`fetchJobs`), `web/src/routes/Jobs.tsx`, `web/test/fetchJobs.test.ts`, test Jobs (tạo `web/test/Jobs.test.tsx`)

**Interfaces:**
- Consumes: `useLnInfo` (Task 5), `downloadEpub(client, asset)` (có sẵn), `loadPending`, `loadLabels` (có sẵn).
- Produces: `findAsset(info: LnInfo, novelName: string, volumeName: string): Asset | undefined` — tìm `ln_list` có `ln_name === novelName`, rồi `vol_list` có `vol_name === volumeName`, trả `asset`.

- [ ] **Step 1: Write failing tests**
  - `fetchJobs.test.ts` → `it('only keeps runs started from this browser')`: 3 run `display_title` `a`,`b`,`c`; pending có `a`, labels có `b` → kết quả chỉ gồm `a`,`b`; không gọi `getJson` cho `c`.
  - `assets.test.ts`: tìm thấy đúng asset; sai tên truyện / tên tập / tập chưa có asset → `undefined`.
  - `Jobs.test.tsx`: job `download` phase `done`, `label` = `'Truyện A'`, results `[{volume:'T1',ok:true,…},{volume:'T2',ok:false,error:'x'}]`, ln_info có asset cho T1 → có đúng một nút "Tải EPUB T1"; bấm → `downloadEpub` được gọi với asset đó. T2 hiện lỗi `x`. Job chưa xong → không có nút tải.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement**

`fetchJobs`: sau khi lấy `runs`, `mine = new Set([...loadPending().map(p => p.requestId), ...Object.keys(loadLabels(now))])`, lọc `runs` theo `mine.has(r.display_title)` trước khi đọc progress. `Jobs.tsx`: với job `download` ở phase `done`, tên truyện = `job.label || job.progress?.novel`; với mỗi result `ok: true`, `findAsset` → nút "Tải EPUB {volume}" (dùng `useMutation` + `downloadEpub`, báo lỗi qua thông báo sẵn có trong `JobRow`). Bỏ mọi link/nút liên quan Thư viện/Cập nhật.

- [ ] **Step 4: Run** test + build + lint → PASS.
- [ ] **Step 5: Commit** `✨ feat(web): per-browser job list with EPUB download buttons`

---

### Task 7: CI deploy, redirect Pages, README

**Files:**
- Create: `.github/workflows/deploy.yml` (từ `pages.yml`), `pages-redirect/index.html`
- Delete: `.github/workflows/pages.yml`
- Modify: `README.md`

- [ ] **Step 1: `deploy.yml`**

Job `test`: giữ các bước hiện có + `npm ci --prefix edge`, `npm --prefix edge test -- --run`, `npm --prefix edge run typecheck`, `npm --prefix web run lint`. Thêm `edge/package-lock.json` vào `cache-dependency-path`.

Job `deploy` (`if: github.event_name == 'push' && github.ref == 'refs/heads/main'`, `needs: test`, `concurrency: deploy`): checkout → setup-node 22 → `npm ci --prefix web` → `npm --prefix web run build` → `npm ci --prefix edge` → `cloudflare/wrangler-action@v3` với `apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}`, `accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}`, `workingDirectory: edge`, `command: deploy`.

Job `pages-redirect` (cùng điều kiện, `needs: test`, permissions `pages: write`, `id-token: write`): upload `pages-redirect/` thay vì `web/dist`.

- [ ] **Step 2: `pages-redirect/index.html`**

Trang tối giản tiếng Việt: `<meta http-equiv="refresh" content="0; url=${EDGE_URL}">` + link bấm tay. `EDGE_URL` điền ở Task 8 sau lần deploy đầu; tới lúc đó dùng `https://hako2epub.<subdomain>.workers.dev/` và đánh dấu `<!-- EDGE_URL -->` để Task 8 thay.

- [ ] **Step 3: README**

Thay mục "Cài đặt" bước 1, 4, 5 và toàn bộ "Bảo mật token" bằng:
1. Cloudflare: `npx --prefix edge wrangler login`; tạo API token (template *Edit Cloudflare Workers*), lưu vào repo secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.
2. Sửa `vars` trong `edge/wrangler.jsonc` nếu repo library khác `PNThanggg/hako2epub-library`.
3. Đặt secret Worker (trong `edge/`): `wrangler secret put GITHUB_TOKEN`, `ADMIN_PASSWORD`, `SESSION_SECRET` (gợi ý `openssl rand -base64 48`).
4. Đổi mật khẩu = đặt lại `ADMIN_PASSWORD`; đăng xuất mọi thiết bị = đặt lại `SESSION_SECRET`.
5. Phát triển: `npm --prefix edge run dev` (cổng 8787, đọc `edge/.dev.vars`) + `npm --prefix web run dev`.

- [ ] **Step 4: Verify** `actionlint .github/workflows/deploy.yml` nếu có sẵn, nếu không thì `python3 -c "import yaml,sys;yaml.safe_load(open('.github/workflows/deploy.yml'))"` → không lỗi.
- [ ] **Step 5: Commit** `👷 ci: deploy to Cloudflare Workers and redirect GitHub Pages`

---

### Task 8: Deploy thật + smoke test (cần người dùng)

Không viết code; mỗi bước cần tài khoản của người dùng.

- [ ] **Step 1:** Người dùng chạy `! npx --prefix edge wrangler login` rồi `! npx --prefix edge wrangler whoami` → thấy account id.
- [ ] **Step 2:** Người dùng tạo fine-grained PAT mới (chỉ repo library; Contents R/W, Actions R/W, Metadata R) và tự chạy 3 lệnh `wrangler secret put` trong `edge/` (secret không đi qua chat).
- [ ] **Step 3:** Build web rồi `npx --prefix edge wrangler deploy` (trong `edge/`) → ghi lại URL `*.workers.dev`; thay `EDGE_URL` trong `pages-redirect/index.html`, commit `🔧 chore: point Pages redirect at the Worker URL`.
- [ ] **Step 4:** Người dùng thêm `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` vào GitHub repo secrets; push `main` → workflow `deploy` xanh cả 3 job.
- [ ] **Step 5:** Smoke test theo §1 spec trên URL thật:
  1. `curl -s <URL>/api/gh/contents/data/ln_info.json` → 401 `login_required`.
  2. Trình duyệt mới → màn đăng nhập → đúng mật khẩu → vào trang chính; đóng mở lại trình duyệt vẫn đăng nhập.
  3. Dán một link truyện ngắn → thấy danh sách tập → tải 1 tập → `#/jobs` hiện tiến trình → bấm "Tải EPUB" → file mở được.
  4. `https://pnthanggg.github.io/hako2epub-web/` chuyển sang URL Worker.
- [ ] **Step 6:** Thu hồi PAT cũ từng lưu trong trình duyệt (GitHub → Settings → Developer settings) vì nó không còn dùng.
