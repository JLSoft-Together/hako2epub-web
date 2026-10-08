# hako2epub-web — Thiết kế

- **Ngày:** 2026-10-08
- **Trạng thái:** Chờ duyệt
- **Nguồn:** `core/hako2epub/` (upstream quantrancse/hako2epub v2.4.0)

## 1. Mục tiêu

Biến tool CLI/Android `hako2epub` thành một trang web **tự host, dùng cá nhân**,
chạy hoàn toàn trên hạ tầng GitHub miễn phí: giao diện trên **GitHub Pages**,
việc tải truyện chạy trên **GitHub Actions**.

### Phạm vi bản đầu

1. **Tải truyện**: dán URL → xem thông tin + danh sách volume → chọn volume → tạo EPUB.
2. **Chọn từng chương**: tải các chương lẻ trong volume (tương đương `-c`).
3. **Thư viện**: liệt kê truyện/volume đã tải, tải file `.epub` về thiết bị, xoá truyện/volume.
4. **Cập nhật**: tìm chương/volume mới của một hoặc tất cả truyện đã tải và nối thêm vào EPUB (tương đương `-u`).
5. **Theo dõi job**: tiến độ theo chương, log rút gọn, huỷ job.

### Ngoài phạm vi

Đọc online; tự cập nhật theo lịch; Cloudflare Worker cho xem trước nhanh; import
`ln_info.json` từ bản desktop; nhiều người dùng / tài khoản.

### Tiêu chí thành công

- Từ điện thoại hoặc máy tính, dán URL truyện hako, chọn volume và nhận được file
  EPUB giống hệt file bản Android tạo ra.
- Không cần máy nào chạy 24/7; không phát tán EPUB công khai.
- Cập nhật truyện đã tải chỉ tải phần chương mới.

## 2. Kiến trúc

### 2.1 Hai repo

| Repo | Quyền | Chứa gì | Chạy gì |
|---|---|---|---|
| `hako2epub-web` (repo này) | Public | SPA, worker Python, mẫu workflow | Deploy GitHub Pages, CI |
| `hako2epub-library` | **Private** | `.github/workflows/`, `data/`, Releases chứa EPUB | Mọi job tải truyện |

Repo library phải private: EPUB là nội dung của nhóm dịch, tool gốc chỉ cho phép
dùng cá nhân, phi thương mại. Pages trên repo private cần gói trả phí nên giao
diện nằm ở repo public; giao diện **không chứa nội dung truyện**.

Workflow chạy trong repo private (không chạy ở repo public dù repo public có phút
Actions không giới hạn), để log và tên truyện không bị công khai, đồng thời tận
dụng `GITHUB_TOKEN` có sẵn. 2.000 phút/tháng của gói Free là đủ cho dùng cá nhân.

### 2.2 Cấu trúc repo này

```
hako2epub-web/
├── core/hako2epub/        # upstream, giữ nguyên (không sửa)
├── web/                   # Vite + React + TypeScript → GitHub Pages
├── worker/                # Python: package hako_worker bọc lõi
├── library-template/      # workflows + README để tạo repo private
├── fixtures/              # fixture JSON dùng chung cho pytest và Vitest
└── .github/workflows/pages.yml
```

`package.json` / `tsconfig.json` / `src/index.ts` ở thư mục gốc hiện đang trống sẽ
bị xoá và thay bằng project trong `web/`.

### 2.3 Luồng chạy

1. Người dùng mở trang Pages và nhập `owner/repo` của library cùng một **fine-grained
   PAT** chỉ cấp quyền cho repo đó (Contents: Read & write, Actions: Read & write,
   Metadata: Read). Thông tin lưu ở `localStorage`.
2. Web sinh `request_id` (UUID) rồi gọi
   `POST /repos/{o}/{r}/actions/workflows/{wf}.yml/dispatches` với input
   `request_id` và `payload`.
3. Workflow checkout `hako2epub-web` **theo một tag cố định** để lấy `worker/` và
   `core/`, rồi chạy `python -m hako_worker <lệnh>`.
4. Worker tải truyện bằng lõi có sẵn, upload EPUB lên Releases, cập nhật `data/`
   và ghi tiến độ.
5. Web poll trạng thái run cùng file tiến độ, sau đó đọc `data/` và tải EPUB về.

## 3. Dữ liệu và lưu trữ

### 3.1 Repo library

```
.github/workflows/{inspect,download,update}.yml
data/
├── ln_info.json            # danh sách đã tải (format tracker.py)
└── novels/<novel_id>.json  # snapshot cache từ inspect/update
```

EPUB **không commit vào git** mà lưu trong Releases (xem 3.4).

### 3.2 `data/ln_info.json`

Giữ nguyên format của `core/.../tracker.py` (`ln_list → vol_list → chapter_list`)
để tái dùng các hàm `record_volume`, `new_chapters`, `remove_volume` và
`remove_novel`. Mỗi volume record có thêm key `asset`:

```json
{
  "vol_name": "Tập 3",
  "num_chapter": 12,
  "chapter_list": ["Chương 1", "..."],
  "asset": {
    "release_tag": "novel-truyen-1234",
    "asset_id": 987654,
    "name": "tap-3-ten-truyen-1a2b3c4d.epub",
    "filename": "Tập 3 - Tên Truyện.epub",
    "size": 4823011,
    "updated_at": "2026-10-08T10:00:00Z"
  }
}
```

`record_volume()` dựng lại volume record và làm rơi các key lạ, nên worker gắn
`asset` **sau** khi gọi hàm này. Các key thêm vào không ảnh hưởng tool gốc nếu
sau này import file này.

### 3.3 `data/novels/<novel_id>.json`

- `novel_id` = `<loại>-<số ID>` lấy từ đường dẫn (`/truyen/1234-ten-truyen` → `truyen-1234`,
  `/sang-tac/77-abc` → `sang-tac-77`); có tiền tố loại vì số ID có thể trùng giữa các loại.
  ID này giống nhau trên cả ba mirror (`ln.hako.vn`, `docln.net`, `docln.sbs`).
- URL chuẩn (`canonical_url`) = `https://ln.hako.vn/<loại>/<id-slug>`: bỏ query/fragment/
  dấu `/` cuối và mọi đoạn sau (chương, volume). Worker luôn gọi `fetch_novel` với URL
  chuẩn, vì `tracker.find_novel` so khớp `ln_url` nguyên văn.
- Nội dung: `name`, `url` (domain chuẩn), `author`, `cover_url`, `summary_html`,
  `volumes[]` (`name`, `url`, `cover_url`, `chapters[]` gồm `name` + `url`), `fetched_at`.
- Được ghi bởi `inspect` và ghi đè bởi `update`. Web hiển thị cache ngay, kèm nút
  "Làm mới" để chạy lại `inspect`.

### 3.4 Releases

- Mỗi truyện một release, tag `novel-<novel_id>` (đánh dấu là pre-release, không
  có mã nguồn đính kèm).
- Mỗi volume một asset có tên **ASCII** tạo tất định từ `filename`: bỏ dấu
  (NFKD + `đ→d`), chữ thường, ký tự khác `[a-z0-9]` thành `-`, cắt còn tối đa 80
  ký tự, rồi thêm 8 ký tự hex đầu của sha1(`filename`) để chống trùng. Ví dụ:
  `tap-3-ten-truyen-1a2b3c4d.epub`. Lý do: GitHub thay ký tự lạ trong tên asset
  bằng `.`, làm hỏng tên tiếng Việt; còn downloader định danh file theo
  `filename`, không theo thứ tự volume. Tên hiển thị lưu trong `asset.filename` và được trình
  duyệt dùng khi lưu file (`a.download`).
- Append khi update: tải asset cũ → `epub_builder.load_for_append` → thêm chương →
  xoá asset cũ → upload asset mới cùng tên → cập nhật `asset`.

### 3.5 Ghi đồng thời

Không dùng `concurrency:` của Actions: một group chỉ giữ 1 run đang chạy và 1 run
chờ, run thứ ba sẽ thay thế và huỷ run đang chờ, làm mất job.

Mọi thao tác ghi `ln_info.json` (cả worker lẫn web khi xoá) đều theo mẫu
**optimistic retry**:

1. `GET` contents → nhận nội dung + `sha`.
2. Áp thay đổi bằng hàm thuần (`record_volume`, `remove_volume`, ...).
3. `PUT` kèm `sha`. Nếu gặp `409`/`422` (sha cũ) thì quay lại bước 1, tối đa 5 lần
   với backoff ngẫu nhiên 1–3 giây.

Snapshot `novels/<id>.json` dùng cùng cơ chế, nhưng ghi đè toàn bộ (không merge).

### 3.6 Rủi ro: tải asset private từ trình duyệt (Spike #1)

`GET /repos/{o}/{r}/releases/assets/{id}` kèm `Accept: application/octet-stream`
trả về 302 sang domain lưu file; domain đó có thể không gửi header CORS.

- **Nếu spike thành công:** dùng Releases như trên.
- **Nếu thất bại:** lưu EPUB dạng file trên nhánh orphan `files` (đường dẫn
  `<novel_id>/<tên asset ASCII>`) và đọc qua Contents API với
  `Accept: application/vnd.github.raw` (giới hạn 100MB mỗi file). `asset` khi đó
  ghi `{ "branch": "files", "path": ..., "sha": ... }`. `GitHubLibrary` cách ly
  khác biệt này, nên lõi và UI không đổi.

## 4. Worker

### 4.1 Cấu trúc

```
worker/
├── pyproject.toml          # requests, beautifulsoup4, cloudscraper; dev: pytest, responses
└── hako_worker/
    ├── __main__.py         # argparse: inspect | download | update
    ├── github.py           # client Contents / Releases / Git refs (requests + GITHUB_TOKEN)
    ├── gh_library.py       # GitHubLibrary: cùng interface với core library.Library
    ├── snapshot.py         # LightNovel → dict snapshot; novel_id từ URL
    └── progress.py         # ProgressReporter
```

Lõi được import từ `core/hako2epub/android/src` qua `PYTHONPATH`, dùng các module
`downloader`, `parser`, `net`, `epub_builder`, `tracker`, `text`, `models`.
**Không** import `app.py`, `storage.py` hay `library.py` vì chúng phụ thuộc
toga/Android.

### 4.2 `GitHubLibrary`

`LightNovelDownloader` chỉ gọi hai method của `library`
(`downloader.py:297`, `downloader.py:420`); cả hai được định danh bằng
`(novel_name, filename)`, trong đó `filename = epub_filename(vol, novel)` là tên
tiếng Việt:

| Method | Hành vi |
|---|---|
| `save_epub(novel_name, staged_path) -> str` | đảm bảo có release `novel-<id>`, upload (thay thế nếu trùng tên) asset, ghi lại thông tin asset vừa upload vào `self.saved[filename]`, trả về URL asset |
| `read_epub(novel_name, filename) -> bytes \| None` | tìm `asset` có `filename` khớp trong `ln_info` của truyện hiện tại → tải bytes; không có thì trả `None` (downloader sẽ tự build lại) |

Mỗi job tạo một `GitHubLibrary` cho đúng một truyện (biết `novel_id`), nên
`novel_name` chỉ dùng để kiểm tra khớp.

**Việc ghi `ln_info.json` nằm ngoài downloader** (trước đây do `app.py` đảm nhận).
Worker làm việc này trong callback `on_volume(result)`:
`tracker.record_volume(data, novel, volume, result.chapter_names)` → gắn
`asset = library.saved[filename]` → ghi bằng optimistic retry (3.5). Thao tác xoá
volume/truyện do web làm, không qua worker.

Không sửa `core/`; mọi chỗ cần thích ứng đều nằm trong `worker/`.

### 4.3 Lệnh và input workflow

Mỗi workflow nhận 2 input kiểu chuỗi: `request_id` và `payload` (JSON).

| Lệnh / workflow | `payload` | Việc làm |
|---|---|---|
| `inspect` | `{"url"}` | `fetch_novel` + `load_chapters` mọi volume → ghi snapshot |
| `download` | `{"url", "volumes": [{"index", "name", "chapters": [chapterIdx] \| null}]}` | volume chưa theo dõi hoặc `chapters = null` → `download_volumes` (build mới); volume đã theo dõi và có `chapters` → `UpdateCandidate` với các chương chưa có → `apply_updates` (append, không ghi đè EPUB cũ) |
| `update` | `{"url"?}` (trống = tất cả) | `find_updates` + `apply_updates` → ghi lại snapshot; dọn nhánh `status/*` cũ hơn 24 giờ |

Chỉ số volume/chương tính theo snapshot. Worker fetch lại trang truyện; nếu
`novel.volumes[index].name != name` thì job dừng với lỗi "Danh sách volume đã
thay đổi, hãy làm mới" thay vì tải nhầm.

### 4.4 Workflow mẫu (`library-template/.github/workflows/*.yml`)

- `on: workflow_dispatch` với 2 input như trên; `run-name: ${{ inputs.request_id }}`.
- `permissions: contents: write`.
- Các bước: `actions/setup-python@v5` (3.12, cache pip) → `actions/checkout`
  repo `hako2epub-web` tại `ref: <tag>` → `pip install ./worker` →
  `python -m hako_worker <lệnh>`.
- Biến môi trường: `GITHUB_TOKEN`, `GITHUB_REPOSITORY`, `REQUEST_ID`, `PAYLOAD`.
- `timeout-minutes: 300`.

### 4.5 Tiến độ

- Lúc khởi động, worker tạo nhánh `status/<request_id>` từ `main`, rồi ghi
  `progress.json` qua Contents API:
  - tối đa mỗi 10 giây một lần, cộng thêm một lần ngay khi chuyển volume, chuyển
    phase hoặc kết thúc;
  - nối với các callback `progress`/`status`/`on_volume` có sẵn của downloader.

```json
{
  "request_id": "…", "kind": "download", "state": "running",
  "phase": "chapters", "novel": "Tên truyện",
  "volumes": { "done": 1, "total": 5 },
  "chapters": { "done": 17, "total": 40 },
  "log": ["…20 dòng cuối…"],
  "results": [{ "volume": "Tập 1", "ok": true, "chapters": 12, "skipped_chapters": 0, "images": 30, "skipped_images": 1 }],
  "error": null,
  "updated_at": "…"
}
```

- `state` có các giá trị: `running`, `done`, `failed` hoặc `cancelled`. Khi bị huỷ,
  runner gửi SIGINT; worker bắt tín hiệu, cho `should_cancel` trả về `True` và cố
  ghi `cancelled`. Nếu không kịp ghi, web suy ra trạng thái huỷ từ `conclusion`
  của run.
- Mỗi request một nhánh, để tránh các commit của Contents API giẫm lên nhau.

### 4.6 Huỷ và lỗi

- **Huỷ:** web gọi `POST /actions/runs/{id}/cancel`. Volume nào đã xong thì đã
  được upload và ghi `ln_info` (qua `on_volume`) nên vẫn còn; volume đang dở bị bỏ.
- **Lỗi một phần:** run `success`; `results` liệt kê volume lỗi kèm lý do (lấy từ
  `failures` của downloader).
- **Lỗi toàn bộ:** run `failure`; `progress.error` chứa thông báo tiếng Việt dễ
  hiểu, ví dụ "Bị Cloudflare chặn ở cả 3 mirror", "URL không phải trang truyện".

### 4.7 Rủi ro: Cloudflare chặn IP runner (Spike #2)

Lõi Android chỉ dùng `cloudscraper` với throttle 2 giây và tự đổi qua mirror.
Runner chạy trên IP datacenter Azure nên dễ bị chặn hơn IP nhà mạng.

- **Spike:** chạy `inspect` và `download` một volume nhỏ trên runner thật.
- **Nếu bị chặn:** port fetcher Playwright từ `core/hako2epub/hako2epub.py`
  (chế độ "slow") thành một class cùng interface `NetworkManager` (`get`,
  `get_bytes`), bật bằng `payload.mode = "slow"`; workflow chạy thêm bước
  `playwright install --with-deps chromium`.

## 5. Web

### 5.1 Công nghệ

Vite + React + TypeScript, Tailwind CSS, TanStack Query, hash router. Gọi GitHub
bằng `fetch` trực tiếp (không dùng Octokit). Giao diện tiếng Việt, responsive cho
điện thoại. `vite.config.ts` đặt `base: '/hako2epub-web/'`.

### 5.2 Màn hình

| Route | Nội dung |
|---|---|
| `#/setup` | Nhập `owner/repo` + PAT. Kiểm tra repo truy cập được, PAT đủ quyền, đủ 3 workflow, có `data/ln_info.json` (nếu chưa có thì tạo `{"ln_list": []}`). |
| `#/` Thư viện | Truyện từ `ln_info.json`, ảnh bìa lấy từ snapshot; mở rộng ra volume với nút **Tải EPUB** và **Xoá**; nút **Xoá truyện**; nút "Kiểm tra cập nhật" cho từng truyện và cho tất cả. |
| `#/novel?url=` | Ô dán URL. Có cache thì hiện ngay (ghi rõ thời điểm lấy dữ liệu), không có thì dispatch `inspect` và chờ. Volume có checkbox; mở rộng ra để chọn chương. Badge *Đã tải* / *+N chương mới*. Nút **Tải**. |
| `#/jobs` | Job đang chạy và gần đây: thanh tiến độ theo chương, log rút gọn, **Huỷ**, link log GitHub. Header luôn có chỉ báo số job đang chạy. |

### 5.3 Module

```
web/src/
├── github/      # client: repos, contents (get/put/delete), releases/assets,
│                #   actions (dispatch, list runs, get run, cancel), git refs
├── data/        # hook TanStack Query: library, snapshot, jobs (polling 5s, dừng khi xong)
├── novel/       # NovelSource interface + ActionsNovelSource
├── tracker.ts   # port: findNovel, newChapters, removeVolume, removeNovel
├── jobs.ts      # dispatch + tìm run theo display_title == request_id + gộp progress
├── download.ts  # tải asset → Blob → a.download = asset.filename
└── routes/      # Setup, Library, Novel, Jobs
```

- `NovelSource.getSnapshot(url, {refresh})`: bản đầu dùng `ActionsNovelSource`
  (đọc cache, nếu không có thì dispatch `inspect`). Sau này có thể thêm
  `WorkerNovelSource` mà không phải sửa UI.
- Danh sách job gần đây lấy từ `GET /actions/runs?event=workflow_dispatch`, ghép
  với `progress.json` trên nhánh `status/<request_id>`. Không cần lưu job riêng.

### 5.4 Xoá

Luôn hỏi xác nhận trước khi xoá. Thứ tự: xoá asset → cập nhật `ln_info.json`
(optimistic retry, dùng `removeVolume`/`removeNovel`) → khi truyện không còn
volume nào thì xoá luôn release.

## 6. Xử lý lỗi (web)

| Tình huống | Hành vi |
|---|---|
| `401` | Xoá token, chuyển về `#/setup` với thông báo "Token sai hoặc hết hạn". |
| `403` rate limit (`x-ratelimit-remaining: 0`) | Thông báo kèm thời điểm reset. |
| `404` workflow | "Repo library thiếu workflow X" → link hướng dẫn setup. |
| Dispatch xong 60 giây chưa thấy run | Cảnh báo + link trang Actions. |
| Run `failure` | Hiện `progress.error` + link log. |
| Run `cancelled` | Hiện "Đã huỷ" kèm các volume đã xong. |
| URL ngoài 3 domain hako | Báo lỗi ngay ở client, không dispatch. |
| Xung đột ghi (`409`) | Tự retry (3.5); hết số lần thì báo lỗi và tải lại dữ liệu. |

## 7. Kiểm thử

### 7.1 Spike (làm đầu tiên, có thể làm thay đổi thiết kế)

1. Tải release asset của repo private bằng `fetch()` từ một trang trên Pages → quyết định Releases hay nhánh `files` (3.6).
2. `inspect` và `download` một volume trên runner thật → quyết định có cần Playwright không (4.7).

### 7.2 Tự động

- **Worker (pytest):**
  - `GitHubLibrary` với HTTP giả lập bằng `responses`: upload/thay asset, retry
    khi gặp 409, tạo release lần đầu.
  - `snapshot` từ HTML fixture (trang truyện và trang volume đã lưu).
  - Hàm tính `novel_id`.
  - Throttle của `ProgressReporter`.
  - Ánh xạ chỉ số trong payload và phát hiện danh sách volume đã đổi.
  - Không test lại lõi upstream.
- **Web (Vitest):**
  - `tracker.ts` chạy trên `fixtures/tracker/*.json`; đúng bộ fixture này cũng
    được pytest kiểm với `tracker.py`, đảm bảo hai bên cho kết quả giống hệt.
  - Client GitHub với `fetch` giả lập: phân loại lỗi 401/403/404/409.
  - `jobs.ts`: khớp run theo `request_id`, gộp trạng thái run + progress.
- **CI (`.github/workflows/pages.yml`):** pytest + Vitest + `vite build` → deploy
  Pages khi push lên `main`.

### 7.3 Smoke test thủ công (ghi trong README)

Setup → tải 1 volume → tải 3 chương lẻ → kiểm tra cập nhật → huỷ một job đang
chạy → xoá volume → mở EPUB trong một trình đọc (Apple Books / Moon+ Reader).

## 8. Hướng dẫn cài đặt (nội dung README)

1. Fork hoặc dùng `hako2epub-web`, bật Pages (source: GitHub Actions).
2. Tạo repo **private** `hako2epub-library`, copy `library-template/` vào và đặt
   `ref:` trong các workflow trỏ tới tag release của `hako2epub-web`.
3. Tạo fine-grained PAT chỉ cho repo library (Contents R/W, Actions R/W).
4. Mở trang Pages → `#/setup` → nhập `owner/hako2epub-library` + PAT.

## 9. Thứ tự triển khai đề xuất

1. Spike #1, Spike #2.
2. Worker: `github.py`, `gh_library.py`, `snapshot.py`, `progress.py`, CLI + test.
3. `library-template` workflows; chạy thử end-to-end bằng `gh workflow run`.
4. Web: setup + client GitHub → Thư viện → Novel/inspect → Jobs → Xoá.
5. CI Pages, README, smoke test.
