# hako2epub-web Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Một trang web tự host trên GitHub Pages, điều khiển GitHub Actions trong một repo private để tải light novel từ hako thành EPUB, quản lý thư viện, cập nhật chương mới và theo dõi tiến độ job.

**Architecture:** SPA tĩnh (Vite + React + TS) gọi GitHub REST API bằng PAT của người dùng. Ba workflow (`inspect`, `download`, `update`) trong repo private chạy `hako_worker`, một lớp mỏng bọc lõi Python có sẵn ở `core/hako2epub/android/src/hako2epub`. EPUB lưu trên Releases, thư viện lưu trong `data/ln_info.json` (format `tracker.py`), tiến độ ghi vào nhánh `status/<request_id>`.

**Tech Stack:** Python 3.12, requests, beautifulsoup4, cloudscraper, pytest, responses · Node 22, Vite, React, TypeScript, Tailwind CSS v4 (`@tailwindcss/vite`), TanStack Query v5, Vitest · GitHub Actions, GitHub Pages.

**Spec:** `docs/superpowers/specs/2026-10-08-hako2epub-web-design.md`

## Global Constraints

- Không sửa bất kỳ file nào trong `core/`. Mọi phần thích ứng nằm trong `worker/`.
- Worker import lõi qua `PYTHONPATH` (`core/hako2epub/android/src`), không import `app.py`, `storage.py`, `library.py`.
- Hai repo: `hako2epub-web` (public, Pages) và `hako2epub-library` (private, nhánh mặc định `main`, chứa EPUB và dữ liệu).
- Domain hợp lệ: `ln.hako.vn`, `docln.net`, `docln.sbs`; domain chuẩn `ln.hako.vn`.
- `novel_id` = `<loại>-<số ID>` (vd `truyen-1234`); release tag = `novel-<novel_id>`, đánh dấu pre-release.
- Tên asset: ASCII bỏ dấu (NFKD + `đ→d`), chữ thường, ký tự ngoài `[a-z0-9]` → `-`, gộp `-` liên tiếp, cắt ≤ 80 ký tự, rồi thêm `-` + 8 hex đầu của sha1(filename UTF-8) + `.epub`.
- Ghi `data/ln_info.json` và `data/novels/<id>.json`: optimistic retry tối đa 5 lần, backoff ngẫu nhiên 1–3 giây, retry khi gặp 409 hoặc 422.
- Không dùng `concurrency:` trong workflow. Workflow có `run-name: ${{ inputs.request_id }}`, `timeout-minutes: 300`, `permissions: contents: write`.
- Input workflow: `request_id` (UUID) và `payload` (chuỗi JSON).
- Ghi tiến độ tối đa mỗi 10 giây, cộng thêm ngay khi xong volume, đổi phase hoặc kết thúc; `log` giữ 20 dòng cuối.
- Web poll mỗi 5 giây, dừng khi job kết thúc; báo "chưa thấy run" sau 60 giây.
- Dọn các nhánh `status/*` cũ hơn 24 giờ (do workflow `update` làm).
- Giao diện tiếng Việt, responsive; hash router; `vite.config.ts` có `base: '/hako2epub-web/'`.
- PAT và `owner/repo` lưu trong `localStorage` dưới key `hako2epub.settings`.

## Review Focus

1. **URL dán vào có nhiều dạng**: mirror `docln.net`, có `/` cuối, có `?query`, là link chương (`/truyen/1234-x/c5678-y`) hay link volume. Tất cả phải ra cùng `canonical_url` và `novel_id`, nếu không thư viện sẽ có hai bản của cùng một truyện. → bảng fixture dùng chung `fixtures/ids.json` (Task 3, Task 12).
2. **Chọn vài chương của một volume đã tải** phải nối thêm vào EPUB, không ghi đè EPUB đầy đủ thành EPUB chỉ có vài chương. → `test_selected_chapters_on_tracked_volume_appends` (Task 8).
3. **Bấm "Tải" hai lần** (hai run cùng upload một asset): upload phải thay asset cũ, không lỗi 422 `already_exists`. → `test_upload_asset_replaces_when_already_exists` (Task 4).
4. **Repo library mới tinh, chưa có `data/ln_info.json`**: lần ghi đầu phải tạo file (PUT không có `sha`), lần đọc trả rỗng. → `test_update_json_creates_missing_file` (Task 4), `updateJson creates missing file` (Task 13).
5. **Tên truyện/volume dài, có emoji, ký tự `/:*?`**: tên asset vẫn hợp lệ và ≤ 97 ký tự, tên file khi lưu giữ nguyên tiếng Việt. → các case trong `test_asset_name_*` (Task 3), `downloadEpub uses asset.filename` (Task 17).

---

## File Structure

```
worker/
  pyproject.toml                 # [tool.pytest.ini_options] pythonpath = [".", "../core/hako2epub/android/src"]
  requirements.txt               # requests, beautifulsoup4, cloudscraper
  requirements-dev.txt           # pytest, responses
  hako_worker/
    __init__.py
    __main__.py                  # CLI + tín hiệu huỷ
    ids.py                       # canonical_url, novel_id, asset_name
    github.py                    # GitHubClient (REST)
    gh_library.py                # GitHubLibrary (adapter cho downloader)
    snapshot.py                  # LightNovel -> dict
    progress.py                  # ProgressReporter + StatusBranchSink
    jobs.py                      # run_inspect / run_download / run_update
  tests/
    conftest.py
    fixtures/novel.html, volume_1.html, volume_2.html
    test_ids.py test_github.py test_gh_library.py test_snapshot.py
    test_progress.py test_tracker_parity.py test_jobs.py
fixtures/
  ids.json                       # dùng chung pytest + Vitest
  tracker/*.json                 # dùng chung pytest + Vitest
library-template/
  README.md
  .github/workflows/inspect.yml download.yml update.yml
  data/ln_info.json              # {"ln_list": []}
web/
  package.json vite.config.ts tsconfig*.json index.html
  src/
    main.tsx App.tsx index.css
    router.ts                    # useHashRoute
    settings.ts                  # load/save/clear settings
    ids.ts                       # port của ids.py (canonicalUrl, novelId)
    tracker.ts                   # port 4 hàm của tracker.py
    types.ts                     # LnInfo, Snapshot, Progress, Run, Job
    github/client.ts github/errors.ts
    jobs.ts                      # dispatch, findRun, mergeJob
    download.ts                  # downloadEpub
    novel/source.ts              # NovelSource + ActionsNovelSource
    data/queries.ts              # hooks TanStack Query
    routes/Setup.tsx Library.tsx Novel.tsx Jobs.tsx
    components/JobBadge.tsx ConfirmDialog.tsx
  test/*.test.ts
.github/workflows/pages.yml
docs/superpowers/spikes/2026-10-08-spikes.md
README.md
```

Xoá: `package.json`, `tsconfig.json`, `src/index.ts` ở thư mục gốc (Task 11).

---

### Task 1: Spike #1 — tải release asset private từ trình duyệt

Output là một quyết định, không phải code để giữ lại. Trang thử nghiệm chỉ là đồ dùng một lần.

**Files:**
- Create: `docs/superpowers/spikes/2026-10-08-spikes.md`

- [ ] **Step 1: Chuẩn bị** — tạo repo private thử `hako2epub-spike`, tạo release `spike` và upload một file `test.epub` bất kỳ (`gh release create spike test.epub -R <owner>/hako2epub-spike`). Tạo fine-grained PAT cho repo đó (Contents R/W).
- [ ] **Step 2: Chạy thử** — tạo `scratch/spike.html` (không commit) với `fetch('https://api.github.com/repos/<o>/hako2epub-spike/releases/assets/<id>', {headers: {Authorization: 'Bearer <PAT>', Accept: 'application/octet-stream'}})`, đọc `.blob()` và in `blob.size`. Mở bằng `npx serve scratch` (origin khác github.com), xem Console.
  Kết quả mong đợi: hoặc in đúng kích thước file (PASS), hoặc lỗi CORS ở redirect (FAIL).
- [ ] **Step 3: Nếu FAIL, thử phương án dự phòng** — commit `test.epub` lên nhánh `files`, gọi `GET /repos/<o>/hako2epub-spike/contents/test.epub?ref=files` với `Accept: application/vnd.github.raw`, kiểm tra `blob.size`.
- [ ] **Step 4: Ghi quyết định** vào `docs/superpowers/spikes/2026-10-08-spikes.md` theo mẫu: `## Spike 1` / `Kết quả: PASS|FAIL` / `Quyết định: releases|files-branch` / lỗi Console nếu có. Nếu chọn `files-branch`, thêm dòng "Task 4/5/17 dùng biến thể files-branch".
- [ ] **Step 5: Commit**
```bash
git add docs/superpowers/spikes/2026-10-08-spikes.md
git commit -m "📝 docs: record spike 1 (private asset download)"
```

> **Biến thể files-branch** (chỉ áp dụng khi Spike 1 FAIL): trong Task 4, thay `upload_asset/download_asset/delete_asset` bằng `put_file(path, bytes, branch='files')`, `get_file_bytes(path, ref='files')`, `delete_file(path, branch='files')`; `asset` trong `ln_info` trở thành `{"branch": "files", "path": "<novel_id>/<asset_name>", "sha", "filename", "size", "updated_at"}`. Interface của `GitHubLibrary` (Task 5) và chữ ký `downloadEpub` (Task 17) giữ nguyên.

### Task 2: Spike #2 — Cloudflare trên runner GitHub

**Files:**
- Modify: `docs/superpowers/spikes/2026-10-08-spikes.md`

- [ ] **Step 1: Workflow thử** — trong `hako2epub-spike`, thêm `.github/workflows/probe.yml` (`workflow_dispatch`, input `url`). Workflow checkout `hako2epub-web`, chạy `pip install requests beautifulsoup4 cloudscraper` rồi chạy:
```bash
PYTHONPATH=core/hako2epub/android/src python -c "
import sys; from hako2epub.downloader import LightNovelDownloader
d = LightNovelDownloader(output_dir='out'); n = d.fetch_novel(sys.argv[1])
print(n.name, len(n.volumes)); v = n.volumes[-1]; d.load_chapters(v); v.chapters = v.chapters[:3]
print([r.path for r in d.download_volumes(n, [v])])" "$URL"
```
  (Nếu repo `hako2epub-web` chưa được push, upload `core/hako2epub/android/src` thẳng vào repo spike.)
- [ ] **Step 2: Chạy 3 lần** với 3 truyện khác nhau: `gh workflow run probe.yml -R <o>/hako2epub-spike -f url=<url>`, sau đó `gh run watch`.
  Mong đợi: in tên truyện cùng một đường dẫn `.epub` (PASS), hoặc `NetworkError ... HTTP 403` ở cả 3 mirror (FAIL).
- [ ] **Step 3: Ghi quyết định** vào file spike: `## Spike 2` / `Kết quả: PASS (n/3)|FAIL` / `Quyết định: cloudscraper|cần Playwright`. Nếu cần Playwright, thêm Task 9b (bên dưới) vào phạm vi.
- [ ] **Step 4: Commit**
```bash
git add docs/superpowers/spikes/2026-10-08-spikes.md
git commit -m "📝 docs: record spike 2 (cloudflare on runners)"
```

---

### Task 3: Worker scaffold + `ids.py`

**Files:**
- Create: `worker/pyproject.toml`, `worker/requirements.txt`, `worker/requirements-dev.txt`, `worker/hako_worker/__init__.py`, `worker/hako_worker/ids.py`, `worker/tests/conftest.py`, `fixtures/ids.json`
- Test: `worker/tests/test_ids.py`

**Interfaces:**
- Produces:
  - `class InvalidNovelUrl(ValueError)`
  - `canonical_url(url: str) -> str` — `https://ln.hako.vn/<kind>/<id-slug>`; ném `InvalidNovelUrl` nếu host ngoài 3 domain hoặc đoạn thứ 2 không bắt đầu bằng chữ số.
  - `novel_id(url: str) -> str` — `"<kind>-<digits>"`, tính trên `canonical_url(url)`.
  - `asset_name(filename: str) -> str` — theo Global Constraints.
  - `fixtures/ids.json`: `[{"input": str, "canonical": str | null, "novel_id": str | null}]` (`null` = phải ném lỗi).

- [ ] **Step 1: Viết fixture và test lỗi.** `fixtures/ids.json` có tối thiểu các case:
  - `https://ln.hako.vn/truyen/1234-ten-truyen` → `https://ln.hako.vn/truyen/1234-ten-truyen` / `truyen-1234`
  - `https://docln.net/truyen/1234-ten-truyen/` → như trên
  - `docln.sbs/truyen/1234-ten-truyen?foo=1#bar` (không có scheme) → như trên
  - `https://ln.hako.vn/truyen/1234-ten-truyen/c5678-chuong-1` → như trên
  - `https://ln.hako.vn/truyen/1234-ten-truyen/t999-tap-1` → như trên
  - `http://ln.hako.vn/sang-tac/77-abc` → `https://ln.hako.vn/sang-tac/77-abc` / `sang-tac-77`
  - `https://example.com/truyen/1-a` → `null`
  - `https://ln.hako.vn/thao-luan/3437-bi-ddos` → `canonical` hợp lệ theo luật (ID số) — ghi đúng kết quả mà luật sinh ra (`thao-luan-3437`); worker sẽ báo lỗi ở bước parse ("không có danh sách volume").
  - `https://ln.hako.vn/` → `null`

```python
# worker/tests/test_ids.py
CASES = json.loads((ROOT / 'fixtures/ids.json').read_text(encoding='utf-8'))

@pytest.mark.parametrize('case', CASES, ids=lambda c: c['input'])
def test_canonical_and_id(case):
    if case['canonical'] is None:
        with pytest.raises(InvalidNovelUrl):
            canonical_url(case['input'])
    else:
        assert canonical_url(case['input']) == case['canonical']
        assert novel_id(case['input']) == case['novel_id']

def test_asset_name_vietnamese():
    name = asset_name('Tập 3 - Đại Ma Vương.epub')
    assert name.startswith('tap-3-dai-ma-vuong-') and name.endswith('.epub')
    assert re.fullmatch(r'[a-z0-9-]+\.epub', name)

def test_asset_name_long_and_symbols_is_bounded():
    name = asset_name('Tập 1: "Hỏi/Đáp"? 😀 ' + 'x' * 300 + '.epub')
    assert re.fullmatch(r'[a-z0-9-]+-[0-9a-f]{8}\.epub', name)
    assert len(name) <= 80 + 1 + 8 + 5

def test_asset_name_distinguishes_similar_names():
    assert asset_name('Tập 1 - A.epub') != asset_name('Tap 1 - A.epub')
```
  `conftest.py` định nghĩa `ROOT = Path(__file__).resolve().parents[2]`.
- [ ] **Step 2: Chạy test, xác nhận FAIL** — `cd worker && pip install -r requirements.txt -r requirements-dev.txt && pytest tests/test_ids.py -v` → FAIL (`ModuleNotFoundError: hako_worker.ids`).
- [ ] **Step 3: Cài đặt `ids.py`.** Phần thân `asset_name` (một chi tiết không suy ra được từ signature): bỏ đuôi `.epub` trước khi slug; slug rỗng thì dùng `volume`.
- [ ] **Step 4: Chạy test, xác nhận PASS** — `pytest tests/test_ids.py -v` → toàn bộ PASS.
- [ ] **Step 5: Commit**
```bash
git add worker fixtures/ids.json
git commit -m "✨ feat(worker): add url canonicalisation and asset naming"
```

### Task 4: `GitHubClient`

**Files:**
- Create: `worker/hako_worker/github.py`
- Test: `worker/tests/test_github.py`

**Interfaces:**
- Produces:
```python
class GitHubError(Exception): status: int
class GitHubClient:
    def __init__(self, token: str, repo: str, api: str = 'https://api.github.com',
                 session: requests.Session | None = None, sleep=time.sleep): ...
    def get_json(self, path: str, ref: str = 'main') -> tuple[dict | None, str | None]  # (data, sha); 404 -> (None, None)
    def put_json(self, path: str, data: dict, message: str, sha: str | None, branch: str = 'main') -> str  # new sha
    def update_json(self, path: str, mutate: Callable[[dict | None], dict], message: str,
                    branch: str = 'main', retries: int = 5) -> dict
    def ensure_release(self, tag: str, name: str) -> dict          # tạo pre-release nếu chưa có
    def upload_asset(self, release: dict, name: str, label: str, data: bytes) -> dict  # thay asset trùng tên
    def download_asset(self, asset_id: int) -> bytes
    def delete_asset(self, asset_id: int) -> None
    def create_branch(self, branch: str, from_branch: str = 'main') -> None  # 422 "already exists" bỏ qua
    def delete_branch(self, branch: str) -> None
    def list_branches(self, prefix: str) -> list[dict]             # [{"name", "commit_date"}]
```
  JSON được ghi `ensure_ascii=False, indent=2`, base64 UTF-8. Header: `Authorization: Bearer`, `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28`. Upload dùng `https://uploads.github.com/repos/{repo}/releases/{id}/assets?name=&label=` với `Content-Type: application/epub+zip`.

- [ ] **Step 1: Viết test lỗi** (dùng `responses`, `sleep=lambda s: None`):
  - `test_get_json_missing_returns_none` — 404 → `(None, None)`.
  - `test_update_json_creates_missing_file` — GET 404; PUT body không có key `sha`; `mutate(None)` được gọi; trả về kết quả của mutate.
  - `test_update_json_retries_on_conflict` — PUT lần 1 → 409, GET lần 2 trả về dữ liệu mới; `mutate` được gọi 2 lần, lần 2 nhận dữ liệu mới; PUT lần 2 → 200.
  - `test_update_json_gives_up_after_retries` — PUT luôn 409 → `GitHubError` sau đúng 5 lần PUT.
  - `test_upload_asset_replaces_when_already_exists` — release có sẵn asset trùng `name` → DELETE asset cũ rồi POST upload; và trường hợp POST trả 422 `already_exists` (run khác vừa upload) → refetch release, xoá asset trùng, POST lại một lần nữa và thành công.
  - `test_ensure_release_creates_prerelease` — GET `/releases/tags/novel-truyen-1` 404 → POST với `prerelease: true`.
  - `test_create_branch_ignores_existing` — POST `/git/refs` 422 "Reference already exists" không ném lỗi.
  - `test_non_2xx_raises_with_status` — 401 → `GitHubError` có `status == 401`.
- [ ] **Step 2: Chạy, xác nhận FAIL** — `pytest tests/test_github.py -v` → FAIL (import error).
- [ ] **Step 3: Cài đặt `github.py`.** Backoff của `update_json`: `sleep(random.uniform(1, 3))` giữa các lần thử; retry khi gặp 409 và 422.
- [ ] **Step 4: Chạy, xác nhận PASS** — `pytest tests/test_github.py -v` → PASS.
- [ ] **Step 5: Commit**
```bash
git add worker/hako_worker/github.py worker/tests/test_github.py
git commit -m "✨ feat(worker): add GitHub REST client with optimistic json updates"
```

### Task 5: `GitHubLibrary`

**Files:**
- Create: `worker/hako_worker/gh_library.py`
- Test: `worker/tests/test_gh_library.py`

**Interfaces:**
- Consumes: `GitHubClient` (Task 4), `asset_name` (Task 3).
- Produces:
```python
INFO_PATH = 'data/ln_info.json'
class GitHubLibrary:
    def __init__(self, client: GitHubClient, novel_id: str, novel_url: str): ...
    saved: dict[str, dict]   # filename -> asset record vừa upload
    def save_epub(self, novel_name: str, src_path) -> str        # trả về browser_download_url
    def read_epub(self, novel_name: str, filename: str) -> bytes | None
    def record_volume(self, novel, volume, chapter_names: list[str]) -> dict  # ghi ln_info, trả data mới
```
  Asset record: `{"release_tag", "asset_id", "name", "filename", "size", "updated_at"}`; `filename = Path(src_path).name`. `read_epub` tìm trong `ln_info` (novel có `ln_url == novel_url`) volume nào có `asset.filename == filename`; không có thì trả `None`. `record_volume` gọi `update_json(INFO_PATH, ...)` với mutate = `tracker.record_volume(data or tracker.empty(), ...)` rồi gắn `asset = self.saved[epub_filename(volume.name, novel.name)]` vào volume record tương ứng (nếu có). Commit message: `library: <novel.name> / <volume.name>`.

- [ ] **Step 1: Viết test lỗi** (dùng một `FakeClient` trong memory, cài cùng các method của `GitHubClient` mà class này dùng):
  - `test_save_epub_uploads_with_ascii_name_and_vietnamese_label` — `saved['Tập 1 - Truyện.epub']['name'] == asset_name('Tập 1 - Truyện.epub')`; label = filename; release tag `novel-truyen-1`.
  - `test_read_epub_returns_bytes_for_tracked_asset` và `test_read_epub_returns_none_when_untracked`.
  - `test_record_volume_attaches_asset_and_keeps_other_novels` — `ln_info` có sẵn truyện khác; sau khi ghi, truyện khác còn nguyên, volume mới có `asset` và `chapter_list` đúng.
  - `test_record_volume_on_empty_repo` — `get_json` trả `(None, None)` → tạo `{"ln_list": [ ... ]}`.
- [ ] **Step 2: Chạy, xác nhận FAIL** — `pytest tests/test_gh_library.py -v`.
- [ ] **Step 3: Cài đặt `gh_library.py`.**
- [ ] **Step 4: Chạy, xác nhận PASS.**
- [ ] **Step 5: Commit** — `git commit -m "✨ feat(worker): add GitHubLibrary adapter for the downloader"`.

### Task 6: `snapshot.py`

**Files:**
- Create: `worker/hako_worker/snapshot.py`, `worker/tests/fixtures/novel.html`, `volume_1.html`, `volume_2.html`
- Test: `worker/tests/test_snapshot.py`

**Interfaces:**
- Consumes: `hako2epub.parser.NovelParser`, `hako2epub.models`.
- Produces:
```python
def snapshot_path(novel_id: str) -> str          # 'data/novels/<id>.json'
def to_snapshot(novel: LightNovel, novel_id: str, now: str) -> dict
```
  Schema (khớp `Snapshot` trong `web/src/types.ts`): `{"novel_id", "name", "url", "author", "cover_url", "summary_html", "volumes": [{"index", "name", "url", "cover_url", "chapters": [{"name", "url"}]}], "fetched_at"}`. `cover_url` của truyện = `cover_url` của volume đầu tiên có cover (lõi không parse cover cấp truyện).

- [ ] **Step 1: Tạo fixture HTML** tối giản, dùng đúng các selector mà `parser.py` đọc: `span.series-name`, `div.series-information > div.info-item > a`, `div.summary-content`, `section.volume-list` (mỗi section có `span.sect-title` và `div.volume-cover a[href]`), trang volume có `div.series-cover div.img-in-ratio[style="background-image: url('…')"]` và `ul.list-chapters li a`. 2 volume, mỗi volume 2 chương.
- [ ] **Step 2: Viết test lỗi** — fake network trả HTML theo URL, chạy `NovelParser(fake).parse_novel(...)` + `load_chapters` cho từng volume, rồi `to_snapshot(...)`:
  - `test_snapshot_shape` — 2 volume, `volumes[1]["index"] == 1`, chapter URL đã chuẩn hoá về `https://ln.hako.vn/...`, `fetched_at == now`.
  - `test_snapshot_cover_from_first_volume_with_cover`.
  - `test_snapshot_path` — `snapshot_path('truyen-1') == 'data/novels/truyen-1.json'`.
- [ ] **Step 3: Chạy, xác nhận FAIL.**
- [ ] **Step 4: Cài đặt.**
- [ ] **Step 5: Chạy, xác nhận PASS, rồi commit** — `git commit -m "✨ feat(worker): add novel snapshot serialisation"`.

### Task 7: `progress.py`

**Files:**
- Create: `worker/hako_worker/progress.py`
- Test: `worker/tests/test_progress.py`

**Interfaces:**
- Consumes: `GitHubClient.create_branch`, `get_json`, `put_json` (Task 4).
- Produces:
```python
class ProgressReporter:
    def __init__(self, sink: Callable[[dict], None], request_id: str, kind: str,
                 clock=time.monotonic, now_iso=..., interval: float = 10.0): ...
    state: dict            # schema progress.json trong spec 4.5 (volumes: {done,total})
    def set_novel(self, name: str) -> None
    def phase(self, name: str) -> None                     # luôn flush
    def status(self, message: str) -> None                 # nối log (giữ 20), flush theo throttle
    def progress(self, done: int, total: int) -> None      # cập nhật chapters, flush theo throttle
    def volume_done(self, result_summary: dict) -> None    # results.append, volumes.done += 1, luôn flush
    def set_volume_total(self, n: int) -> None
    def finish(self, state: str, error: str | None = None) -> None  # 'done'|'failed'|'cancelled', luôn flush
class StatusBranchSink:
    def __init__(self, client: GitHubClient, request_id: str): ...  # branch = f'status/{request_id}'
    def __call__(self, state: dict) -> None   # lần đầu create_branch; put_json('progress.json', ...) với sha nhớ lại
```
  Lỗi khi ghi tiến độ chỉ được log `warning`, không làm hỏng job.

- [ ] **Step 1: Viết test lỗi:**
  - `test_status_is_throttled` — clock giả: 3 lần `status` trong 5 giây → sink được gọi 1 lần (lần đầu); tới giây 11 → lần 2.
  - `test_phase_volume_done_and_finish_always_flush`.
  - `test_log_keeps_last_20_lines`.
  - `test_sink_error_does_not_raise` — sink ném `GitHubError` → `status()` không ném.
  - `test_status_branch_sink_creates_branch_once_and_reuses_sha` (FakeClient).
- [ ] **Step 2: Chạy, xác nhận FAIL. Step 3: Cài đặt. Step 4: Chạy, xác nhận PASS.**
- [ ] **Step 5: Commit** — `git commit -m "✨ feat(worker): add throttled progress reporting to status branches"`.

### Task 8: `jobs.py` + CLI

**Files:**
- Create: `worker/hako_worker/jobs.py`, `worker/hako_worker/__main__.py`
- Test: `worker/tests/test_jobs.py`

**Interfaces:**
- Consumes: Task 3–7; `hako2epub.downloader.LightNovelDownloader`, `UpdateCandidate`, `Cancelled`, `DownloadError`; `hako2epub.tracker`.
- Produces:
```python
class JobError(Exception)                       # message tiếng Việt cho progress.error
@dataclass
class Context:
    client: GitHubClient; reporter: ProgressReporter
    make_downloader: Callable[[GitHubLibrary], LightNovelDownloader]
    should_cancel: Callable[[], bool]; now_iso: Callable[[], str]
def run_inspect(ctx: Context, payload: dict) -> None
def run_download(ctx: Context, payload: dict) -> None
def run_update(ctx: Context, payload: dict) -> None
def main(argv: list[str] | None = None) -> int   # trong __main__.py
```
  Hành vi:
  - Mọi lệnh đều chuẩn hoá URL bằng `canonical_url`; `InvalidNovelUrl` → `JobError("URL không phải trang truyện hako")`.
  - `run_inspect`: `fetch_novel` → `load_chapters` cho mọi volume (gọi `reporter.status` mỗi volume) → `update_json(snapshot_path, lambda _: to_snapshot(...))`.
  - `run_download`: với mỗi `{"index","name","chapters"}`, kiểm tra `novel.volumes[index].name == name`, sai thì `JobError("Danh sách volume đã thay đổi, hãy làm mới")`. Chia volume thành:
    - nhóm **fresh** (chưa theo dõi hoặc `chapters is None`): sau `load_chapters`, nếu `chapters` khác null thì giữ `volume.chapters` theo chỉ số → `download_volumes`;
    - nhóm **append** (đã theo dõi và có `chapters`): `UpdateCandidate(new_chapters = các chương đã chọn có tên chưa nằm trong stored_chapters, known_chapters = stored_chapters)`, bỏ qua nếu rỗng → `apply_updates`.
    `on_volume` = `library.record_volume(...)` + `reporter.volume_done(...)`. Cuối cùng ghi lại snapshot.
  - `run_update`: `payload.get("url")` hoặc mọi `ln_url` trong `ln_info`; với từng truyện: `GitHubLibrary` riêng → `update_novel(novel, info, ...)` → ghi snapshot; lỗi của một truyện được ghi vào `results` rồi đi tiếp. Cuối cùng xoá các nhánh `status/*` có `commit_date` cũ hơn 24 giờ (trừ nhánh của chính job này).
  - `main`: đọc env `GITHUB_TOKEN`, `GITHUB_REPOSITORY`, `REQUEST_ID`, `PAYLOAD`; argv[0] ∈ {inspect, download, update}. Cài handler `SIGINT`/`SIGTERM` đặt cờ huỷ. Kết thúc: thành công → `finish('done')`, trả về 0; `Cancelled` → `finish('cancelled')`, trả về 1; `JobError`/`DownloadError`/`NetworkError` → `finish('failed', message)`, trả về 1. `NetworkError` được dịch thành "Bị Cloudflare chặn hoặc mất kết nối ở cả 3 mirror: <chi tiết>".

- [ ] **Step 1: Viết test lỗi** (FakeDownloader ghi lại các lần gọi, FakeClient trong memory, novel dựng tay từ `models`):
  - `test_inspect_writes_snapshot`.
  - `test_download_untracked_volume_uses_download_volumes`.
  - `test_download_subset_of_untracked_volume_keeps_only_selected_chapters`.
  - `test_selected_chapters_on_tracked_volume_appends` — `ln_info` đã có volume với `["C1","C2"]`, payload chọn chương 1 và 2 (`C2`, `C3`) → `apply_updates` được gọi với `new_chapters == [C3]`, `download_volumes` không được gọi.
  - `test_download_rejects_changed_volume_list` → `JobError` có message "Danh sách volume đã thay đổi, hãy làm mới".
  - `test_download_invalid_url_fails_with_vietnamese_message`.
  - `test_update_all_continues_after_one_novel_fails` — 2 truyện, truyện 1 ném `NetworkError` → truyện 2 vẫn được update, `results` có lỗi của truyện 1.
  - `test_update_prunes_old_status_branches`.
  - `test_main_maps_cancelled_to_cancelled_state` (patch `run_download` ném `Cancelled`).
- [ ] **Step 2: Chạy, xác nhận FAIL. Step 3: Cài đặt. Step 4: Chạy toàn bộ `pytest -v`, xác nhận PASS.**
- [ ] **Step 5: Commit** — `git commit -m "✨ feat(worker): add inspect/download/update jobs and CLI"`.

### Task 9: Tracker parity fixtures

**Files:**
- Create: `fixtures/tracker/find_novel.json`, `new_chapters.json`, `remove_volume.json`, `remove_novel.json`
- Test: `worker/tests/test_tracker_parity.py`

**Interfaces:**
- Produces: mỗi file là `[{"name": str, "data": LnInfo, "args": {...}, "expected": any}]`. Args theo từng hàm:
  - `find_novel`: `{"ln_url"}` → entry hoặc `null`
  - `new_chapters`: `{"ln_url", "vol_name", "live": [names]}` → `[names]`
  - `remove_volume`: `{"ln_url", "vol_name"}` → LnInfo
  - `remove_novel`: `{"ln_url"}` → LnInfo

  Task 13 (TS) đọc lại đúng các file này.

- [ ] **Step 1: Viết fixture** — mỗi hàm ≥ 3 case, bắt buộc có: truyện không tồn tại; xoá volume cuối cùng thì truyện cũng biến mất (theo `remove_volume`); `chapter_list` chứa chuỗi rỗng (bị bỏ qua); volume có key `asset` (phải được giữ nguyên khi xoá volume khác).
- [ ] **Step 2: Viết test** — gọi `hako2epub.tracker.<fn>`; với `new_chapters`, bọc `live` thành `Chapter(name=n)` rồi so sánh danh sách tên.
- [ ] **Step 3: Chạy `pytest tests/test_tracker_parity.py -v`** → PASS. Nếu FAIL thì fixture sai (lõi là chuẩn); sửa fixture.
- [ ] **Step 4: Commit** — `git commit -m "✅ test: add shared tracker parity fixtures"`.

### Task 9b (chỉ khi Spike 2 FAIL): `PlaywrightNetwork`

**Files:** Create `worker/hako_worker/browser_net.py`; Modify `worker/hako_worker/jobs.py` (`make_downloader` nhận `payload.get("mode")`), các workflow (thêm bước `pip install playwright && playwright install --with-deps chromium`).

**Interfaces:** `class PlaywrightNetwork` có `get(url, stream=False, referer=None, delay=None, max_retries=None, backoff=None)` trả về object có `.status_code`, `.text`, `.content`, `.headers`; `get_bytes(url, referer=None) -> tuple[bytes, str]`. Port từ `_playwright_worker_loop` ở `core/hako2epub/hako2epub.py:116`. Test: `test_playwright_network_matches_interface` (kiểm tra signature bằng `inspect`), cùng một lần chạy `probe.yml` thật với `mode=slow`.

### Task 10: Library template workflows

**Files:**
- Create: `library-template/.github/workflows/inspect.yml`, `download.yml`, `update.yml`, `library-template/data/ln_info.json`, `library-template/README.md`

**Interfaces:**
- Consumes: `python -m hako_worker <cmd>` (Task 8).
- Produces: workflow filenames `inspect.yml`, `download.yml`, `update.yml` (web Task 15 dispatch theo đúng các tên này).

Mỗi workflow:
```yaml
name: <cmd>
run-name: ${{ inputs.request_id }}
on:
  workflow_dispatch:
    inputs:
      request_id: { required: true, type: string }
      payload: { required: true, type: string }
permissions: { contents: write }
jobs:
  run:
    runs-on: ubuntu-latest
    timeout-minutes: 300
    steps:
      - uses: actions/checkout@v4
        with: { repository: <OWNER>/hako2epub-web, ref: <TAG>, path: app }
      - uses: actions/setup-python@v5
        with: { python-version: '3.12', cache: pip, cache-dependency-path: app/worker/requirements.txt }
      - run: pip install -r app/worker/requirements.txt
      - run: python -m hako_worker <cmd>
        env:
          PYTHONPATH: app/worker:app/core/hako2epub/android/src
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          REQUEST_ID: ${{ inputs.request_id }}
          PAYLOAD: ${{ inputs.payload }}
```

- [ ] **Step 1: Viết 3 workflow + `data/ln_info.json` (`{"ln_list": []}`)** — `<OWNER>`/`<TAG>` để dạng chữ cho người dùng thay, và ghi rõ trong README.
- [ ] **Step 2: Kiểm tra cú pháp** — `npx --yes @action-validator/cli library-template/.github/workflows/*.yml` → không lỗi (hoặc dùng `actionlint` nếu đã cài).
- [ ] **Step 3: Viết `library-template/README.md`** — các bước tạo repo private, thay `<OWNER>`/`<TAG>`, tạo PAT (Contents R/W, Actions R/W, Metadata R).
- [ ] **Step 4: Chạy end-to-end** — push `hako2epub-web` lên GitHub, tạo tag `v0.1.0`, tạo repo library thật theo README rồi chạy:
```bash
gh workflow run inspect.yml -R <o>/hako2epub-library -f request_id=$(uuidgen) -f payload='{"url":"<url>"}'
gh workflow run download.yml -R <o>/hako2epub-library -f request_id=$(uuidgen) -f payload='{"url":"<url>","volumes":[{"index":0,"name":"<tên>","chapters":[0,1]}]}'
```
  Mong đợi: `data/novels/<id>.json` xuất hiện; release `novel-<id>` có 1 asset; `ln_info.json` có volume với `asset`; nhánh `status/<uuid>` có `progress.json` với `"state": "done"`.
- [ ] **Step 5: Commit** — `git commit -m "👷 ci: add library repo workflow templates"`.

---

### Task 11: Web scaffold + CI Pages

**Files:**
- Delete: `package.json`, `tsconfig.json`, `src/index.ts`
- Create: `web/` (từ `npm create vite@latest web -- --template react-ts`), `web/src/router.ts`, `web/src/settings.ts`, `.github/workflows/pages.yml`
- Modify: `.gitignore` (thêm `web/node_modules`, `web/dist`, `__pycache__/`, `.pytest_cache/`)
- Test: `web/test/router.test.ts`, `web/test/settings.test.ts`

**Interfaces:**
- Produces:
```ts
// router.ts
export type Route = { name: 'setup' | 'library' | 'novel' | 'jobs'; params: URLSearchParams }
export function parseHash(hash: string): Route        // '' | '#/' -> library; '#/novel?url=x' -> novel
export function useHashRoute(): Route
export function navigate(path: string): void           // vd navigate('/novel?url=...')
// settings.ts
export type Settings = { owner: string; repo: string; token: string }
export function loadSettings(): Settings | null       // key 'hako2epub.settings'
export function saveSettings(s: Settings): void
export function clearSettings(): void
```

- [ ] **Step 1: Scaffold** — tạo Vite react-ts, cài `@tanstack/react-query tailwindcss @tailwindcss/vite`, cài dev `vitest jsdom @testing-library/react`. Đặt `base: '/hako2epub-web/'` và `test: { environment: 'jsdom' }` trong `vite.config.ts`; `index.css` = `@import "tailwindcss";`; `<html lang="vi">`.
- [ ] **Step 2: Viết test lỗi** — `parseHash('')` là library; `parseHash('#/novel?url=https%3A%2F%2Fln.hako.vn%2Ftruyen%2F1-a')` có `params.get('url')` đúng; route lạ → library. Settings: round-trip qua `localStorage`; `loadSettings` trả `null` khi JSON hỏng.
- [ ] **Step 3: Chạy `npm --prefix web test -- --run`** → FAIL.
- [ ] **Step 4: Cài đặt** `router.ts`, `settings.ts`; `App.tsx` render route tương ứng (tạm thời là component placeholder) và chuyển sang `setup` khi `loadSettings()` là null.
- [ ] **Step 5: Chạy test → PASS; `npm --prefix web run build`** → sinh `web/dist`.
- [ ] **Step 6: `.github/workflows/pages.yml`** — trigger `push` lên `main` và `pull_request`. Job `test`: setup Python 3.12 → `pip install -r worker/requirements.txt -r worker/requirements-dev.txt` → `cd worker && pytest`; setup Node 22 → `npm ci --prefix web` → `npm --prefix web test -- --run` → `npm --prefix web run build`. Job `deploy` (chỉ khi push lên `main`, `needs: test`): `actions/upload-pages-artifact` (`web/dist`) → `actions/deploy-pages`, `permissions: pages: write, id-token: write`.
- [ ] **Step 7: Commit** — `git commit -m "🎉 feat(web): scaffold vite app, hash router and pages ci"`.

### Task 12: `ids.ts` + `types.ts`

**Files:**
- Create: `web/src/ids.ts`, `web/src/types.ts`
- Test: `web/test/ids.test.ts`

**Interfaces:**
- Produces:
```ts
export class InvalidNovelUrl extends Error {}
export function canonicalUrl(url: string): string
export function novelId(url: string): string
// types.ts
export type Asset = { release_tag: string; asset_id: number; name: string; filename: string; size: number; updated_at: string }
export type LnVolume = { vol_name: string; num_chapter: number; chapter_list: string[]; asset?: Asset }
export type LnNovel = { ln_name: string; ln_url: string; num_vol: number; vol_list: LnVolume[] }
export type LnInfo = { ln_list: LnNovel[] }
export type Snapshot = { novel_id: string; name: string; url: string; author: string; cover_url: string; summary_html: string;
  volumes: { index: number; name: string; url: string; cover_url: string; chapters: { name: string; url: string }[] }[]; fetched_at: string }
export type Progress = { request_id: string; kind: JobKind; state: 'running'|'done'|'failed'|'cancelled'; phase: string; novel: string;
  volumes: { done: number; total: number }; chapters: { done: number; total: number }; log: string[]; results: unknown[]; error: string | null; updated_at: string }
export type JobKind = 'inspect' | 'download' | 'update'
export const INFO_PATH = 'data/ln_info.json'
export const snapshotPath = (id: string) => `data/novels/${id}.json`
```

- [ ] **Step 1: Test lỗi** — chạy toàn bộ `fixtures/ids.json` (import JSON qua `../../fixtures/ids.json`): `canonical === null` → phải ném `InvalidNovelUrl`.
- [ ] **Step 2: Chạy → FAIL. Step 3: Cài đặt `ids.ts` (dùng `URL`, thêm `https://` nếu thiếu scheme). Step 4: Chạy → PASS.**
- [ ] **Step 5: Commit** — `git commit -m "✨ feat(web): port url canonicalisation with shared fixtures"`.

### Task 13: GitHub client (TS)

**Files:**
- Create: `web/src/github/errors.ts`, `web/src/github/client.ts`
- Test: `web/test/client.test.ts`

**Interfaces:**
- Consumes: `Settings` (Task 11).
- Produces:
```ts
export type ErrorKind = 'auth' | 'rate_limit' | 'not_found' | 'conflict' | 'other'
export class GitHubError extends Error { status: number; kind: ErrorKind; resetAt?: Date }
export type Run = { id: number; display_title: string; status: 'queued'|'in_progress'|'completed'|string;
  conclusion: 'success'|'failure'|'cancelled'|null|string; html_url: string; created_at: string; path: string }
export class GitHubClient {
  constructor(s: Settings, fetchImpl?: typeof fetch)
  getJson<T>(path: string, ref?: string): Promise<{ data: T; sha: string } | null>
  updateJson<T>(path: string, mutate: (cur: T | null) => T, message: string, retries?: number): Promise<T>
  dispatch(workflow: 'inspect.yml'|'download.yml'|'update.yml', requestId: string, payload: unknown): Promise<void>
  listDispatchRuns(): Promise<Run[]>            // per_page=50, event=workflow_dispatch
  cancelRun(id: number): Promise<void>
  downloadAsset(assetId: number): Promise<Blob>
  deleteAsset(assetId: number): Promise<void>
  deleteReleaseByTag(tag: string): Promise<void> // xoá release, rồi xoá ref tags/<tag>
  checkSetup(): Promise<{ repoOk: boolean; canPush: boolean; missingWorkflows: string[]; hasLibrary: boolean }>
}
```
  Phân loại lỗi: 401 → `auth`; 403/429 có `x-ratelimit-remaining: 0` → `rate_limit` (`resetAt` = `x-ratelimit-reset` × 1000); 404 → `not_found`; 409/422 → `conflict`. JSON đọc/ghi qua base64 UTF-8 (`TextEncoder` + `btoa` theo từng chunk). `updateJson` dùng cùng thuật toán retry với Python (5 lần, chờ 1–3 giây; cho phép inject hàm `sleep` vào constructor để test).

- [ ] **Step 1: Test lỗi** (fetch giả lập):
  - `classifies 401 as auth`, `classifies rate limit with resetAt`.
  - `getJson returns null on 404`.
  - `updateJson creates missing file` (PUT không có `sha`).
  - `updateJson retries on 409 with fresh data`.
  - `getJson decodes Vietnamese UTF-8` (`"Tập 1"` round-trip).
  - `dispatch posts inputs as strings` — body `{ref:'main', inputs:{request_id, payload: JSON.stringify(payload)}}`.
  - `checkSetup reports missing workflows`.
- [ ] **Step 2: Chạy → FAIL. Step 3: Cài đặt. Step 4: Chạy → PASS.**
- [ ] **Step 5: Commit** — `git commit -m "✨ feat(web): add GitHub REST client with error classification"`.

### Task 14: `tracker.ts` + màn hình Setup + data hooks

**Files:**
- Create: `web/src/tracker.ts`, `web/src/data/queries.ts`, `web/src/routes/Setup.tsx`
- Test: `web/test/tracker.test.ts`

**Interfaces:**
- Consumes: `GitHubClient` (Task 13), fixture tracker (Task 9).
- Produces:
```ts
export function findNovel(data: LnInfo, lnUrl: string): LnNovel | null
export function newChapters(data: LnInfo, lnUrl: string, volName: string, live: string[]): string[]
export function removeVolume(data: LnInfo, lnUrl: string, volName: string): LnInfo
export function removeNovel(data: LnInfo, lnUrl: string): LnInfo
// queries.ts
export const ClientContext: React.Context<GitHubClient | null>
export function useClient(): GitHubClient
export function useLibrary(): UseQueryResult<LnInfo>           // ['library'], null -> {ln_list: []}
export function useSnapshot(novelId: string | null): UseQueryResult<Snapshot | null>  // ['snapshot', id]
```
  Một handler lỗi chung ở `QueryClient` (`queryCache.onError` và `mutationCache.onError`):
  - `GitHubError.kind === 'auth'` → `clearSettings()` + `navigate('/setup?reason=auth')`;
  - `rate_limit` → banner "Hết lượt gọi GitHub API, thử lại lúc <HH:mm của resetAt>";
  - `conflict` (đã hết số lần retry) → banner "Dữ liệu vừa bị thay đổi ở nơi khác, đã tải lại" + `invalidateQueries(['library'])`.
  Banner hiển thị trong `App.tsx`, lấy nội dung từ state `lastError` của `queries.ts`.

- [ ] **Step 1: Test lỗi** — với mỗi file trong `fixtures/tracker/*.json`, mỗi case: `expect(fn(case.data, ...args)).toEqual(case.expected)`.
- [ ] **Step 2: Chạy → FAIL. Step 3: Cài đặt `tracker.ts`. Step 4: Chạy → PASS.**
- [ ] **Step 5: Cài đặt `Setup.tsx`** — form `owner/repo` + PAT (input type password) → `checkSetup()` → hiển thị từng mục ✓/✗; nếu chỉ thiếu `data/ln_info.json` thì có nút "Tạo thư viện trống" (`updateJson('data/ln_info.json', c => c ?? {ln_list: []}, 'init library')`); lưu settings và `navigate('/')` khi hợp lệ. `?reason=auth` hiển thị "Token sai hoặc hết hạn".
- [ ] **Step 6: Kiểm tra thủ công** với repo library thật ở Task 10: `npm --prefix web run dev` → nhập token sai → báo lỗi; nhập token đúng → vào trang Thư viện.
- [ ] **Step 7: Commit** — `git commit -m "✨ feat(web): add tracker port, data hooks and setup screen"`.

### Task 15: Jobs — dispatch, theo dõi, huỷ

**Files:**
- Create: `web/src/jobs.ts`, `web/src/routes/Jobs.tsx`, `web/src/components/JobBadge.tsx`
- Modify: `web/src/data/queries.ts`
- Test: `web/test/jobs.test.ts`

**Interfaces:**
- Consumes: `GitHubClient`, `Run`, `Progress`.
- Produces:
```ts
export type JobPhase = 'dispatching' | 'queued' | 'running' | 'done' | 'failed' | 'cancelled' | 'lost'
export type PendingJob = { requestId: string; kind: JobKind; label: string; dispatchedAt: number }
export type Job = { requestId: string; kind: JobKind; label: string; dispatchedAt: number; run?: Run; progress?: Progress; phase: JobPhase }
export function startJob(client: GitHubClient, kind: JobKind, payload: unknown, label: string): Promise<string> // requestId; lưu pending
export function mergeJob(pending: PendingJob | undefined, run: Run | undefined, progress: Progress | undefined, now: number): Job
export function kindFromPath(path: string): JobKind   // '.github/workflows/download.yml' -> 'download'
// queries.ts
export function useJobs(): { jobs: Job[]; activeCount: number }  // refetchInterval 5000 khi có job chưa kết thúc
export function useCancelJob(): (job: Job) => Promise<void>
```
  Pending jobs lưu trong `localStorage['hako2epub.pending']` dưới dạng `[{requestId, kind, label, dispatchedAt}]`; xoá khi đã thấy run tương ứng. Progress đọc bằng `getJson<Progress>('progress.json', 'status/' + requestId)`, chỉ cho các run chưa kết thúc hoặc kết thúc trong vòng 1 giờ.
  Bảng `mergeJob`:
  - không có run, `now - dispatchedAt < 60s` → `dispatching`; ≥ 60s → `lost`
  - `run.status === 'queued'` → `queued`
  - `in_progress` → `running`
  - `completed` + `cancelled` → `cancelled`
  - `completed` + `success` → `progress?.state === 'failed' ? 'failed' : 'done'`
  - `completed` + khác → `failed`

- [ ] **Step 1: Test lỗi** — mỗi dòng trong bảng `mergeJob` là một test; thêm `kindFromPath`; `startJob stores pending and dispatches with uuid`.
- [ ] **Step 2: Chạy → FAIL. Step 3: Cài đặt `jobs.ts` + hooks. Step 4: Chạy → PASS.**
- [ ] **Step 5: Cài đặt `Jobs.tsx` và `JobBadge.tsx`** — danh sách job (mới nhất trước), thanh tiến độ `chapters.done/total` và `volumes.done/total`, 20 dòng log thu gọn (`<details>`), `progress.error`, nút **Huỷ** khi đang `queued`/`running` (`cancelRun`), link `run.html_url`; phase `lost` hiển thị "Chưa thấy job sau 60 giây" kèm link `https://github.com/<o>/<r>/actions`. `JobBadge` trên header hiện `activeCount`.
- [ ] **Step 6: Kiểm tra thủ công** — dispatch `update` từ console dev, thấy job chuyển `dispatching → queued → running → done`; huỷ một job đang chạy → `cancelled`.
- [ ] **Step 7: Commit** — `git commit -m "✨ feat(web): add job dispatch, polling and cancellation"`.

### Task 16: Màn hình Novel (inspect + chọn + tải)

**Files:**
- Create: `web/src/novel/source.ts`, `web/src/routes/Novel.tsx`
- Test: `web/test/source.test.ts`, `web/test/selection.test.ts`

**Interfaces:**
- Consumes: `canonicalUrl`, `novelId`, `useSnapshot`, `startJob`, `newChapters`, `findNovel`.
- Produces:
```ts
export interface NovelSource { getSnapshot(url: string, opts?: { refresh?: boolean }): Promise<{ snapshot: Snapshot | null; requestId?: string }> }
export class ActionsNovelSource implements NovelSource   // có cache và !refresh -> trả snapshot; ngược lại startJob('inspect') -> trả requestId
export type Selection = Record<number, number[] | null>  // volIndex -> null (cả volume) | chỉ số chương
export function buildDownloadPayload(snapshot: Snapshot, sel: Selection): { url: string; volumes: { index: number; name: string; chapters: number[] | null }[] }
export function volumeBadge(info: LnInfo, snapshot: Snapshot, volIndex: number): { tracked: boolean; newCount: number }
```

- [ ] **Step 1: Test lỗi:**
  - `returns cached snapshot without dispatch`.
  - `dispatches inspect on refresh`.
  - `buildDownloadPayload keeps names and null for whole volume`.
  - `buildDownloadPayload drops volumes with empty chapter list`.
  - `volumeBadge counts new chapters via tracker.newChapters`.
- [ ] **Step 2: Chạy → FAIL. Step 3: Cài đặt. Step 4: Chạy → PASS.**
- [ ] **Step 5: Cài đặt `Novel.tsx`:**
  - Ô dán URL; URL không hợp lệ → hiện lỗi "URL không thuộc ln.hako.vn / docln.net / docln.sbs" ngay, không dispatch.
  - Có snapshot → hiện bìa, tên, tác giả, "Dữ liệu lúc <fetched_at>" và nút **Làm mới**.
  - Đang inspect → hiện tiến độ của job đó (dùng `useJobs`), job xong thì `invalidateQueries(['snapshot', id])`.
  - Danh sách volume có checkbox, badge *Đã tải* / *+N chương mới*; mở rộng để chọn chương.
  - Nút **Tải** → `startJob('download', buildDownloadPayload(...), '<tên truyện>')` → `navigate('/jobs')`.
- [ ] **Step 6: Kiểm tra thủ công** với một truyện thật: chọn 2 chương lẻ của một volume → job xong → badge cập nhật.
- [ ] **Step 7: Commit** — `git commit -m "✨ feat(web): add novel inspect and download selection screen"`.

### Task 17: Màn hình Thư viện (tải EPUB, xoá, cập nhật)

**Files:**
- Create: `web/src/download.ts`, `web/src/routes/Library.tsx`, `web/src/components/ConfirmDialog.tsx`
- Test: `web/test/download.test.ts`, `web/test/library-actions.test.ts`

**Interfaces:**
- Consumes: `GitHubClient`, `useLibrary`, `useSnapshot`, `removeVolume`, `removeNovel`, `startJob`.
- Produces:
```ts
export function downloadEpub(client: GitHubClient, asset: Asset, doc?: Document): Promise<void>   // blob -> <a download=asset.filename>
export function deleteVolume(client: GitHubClient, novel: LnNovel, volName: string): Promise<LnInfo>
export function deleteNovel(client: GitHubClient, novel: LnNovel): Promise<LnInfo>
```
  Thứ tự `deleteVolume`: `deleteAsset(asset_id)` (bỏ qua `not_found`) → `updateJson(INFO_PATH, removeVolume)` → nếu truyện không còn trong kết quả thì `deleteReleaseByTag(asset.release_tag)`. `deleteNovel`: xoá mọi asset → `removeNovel` → xoá release.

- [ ] **Step 1: Test lỗi:**
  - `downloadEpub uses asset.filename` — anchor được tạo có `download === 'Tập 1 - Truyện.epub'`, `URL.revokeObjectURL` được gọi.
  - `deleteVolume tolerates already-deleted asset`.
  - `deleteVolume removes release when last volume goes`.
  - `deleteNovel deletes every asset then release`.
- [ ] **Step 2: Chạy → FAIL. Step 3: Cài đặt. Step 4: Chạy → PASS.**
- [ ] **Step 5: Cài đặt `Library.tsx`:**
  - Mỗi truyện là một card (bìa lấy từ `useSnapshot(novelId(ln_url))`, tên, số volume), mở rộng ra danh sách volume với kích thước file.
  - Nút **Tải EPUB**, **Xoá** (qua `ConfirmDialog` "Xoá vĩnh viễn <tên>?"), **Xoá truyện**, **Kiểm tra cập nhật** (`startJob('update', {url})`). Đầu trang có nút "Cập nhật tất cả" (`startJob('update', {})`).
  - Thư viện rỗng → hiện link sang `#/novel`.
- [ ] **Step 6: Kiểm tra thủ công** — tải EPUB trên điện thoại (Safari/Chrome Android) mở được trong trình đọc; xoá 1 volume → biến mất khỏi thư viện và khỏi Releases.
- [ ] **Step 7: Commit** — `git commit -m "✨ feat(web): add library screen with download and delete"`.

### Task 18: README + smoke test

**Files:**
- Create: `README.md`

- [ ] **Step 1: Viết `README.md`** gồm: giới thiệu và lưu ý bản quyền (chỉ dùng cá nhân, giữ repo library private); kiến trúc một đoạn; cài đặt theo spec §8 (link `library-template/README.md`); phát triển (`cd worker && pytest`, `npm --prefix web run dev`); checklist smoke test theo spec §7.3.
- [ ] **Step 2: Chạy smoke test đầy đủ** trên bản đã deploy lên Pages theo checklist; ghi kết quả (ngày, PASS/FAIL từng bước) cuối README trong mục `## Smoke test log`.
- [ ] **Step 3: Commit** — `git commit -m "📝 docs: add README with setup and smoke test"`.
