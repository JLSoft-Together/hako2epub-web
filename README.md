# hako2epub-web

Giao diện web tự host cho công cụ [hako2epub](core/hako2epub) (upstream của
quantrancse, giấy phép MIT). Tải light novel từ ln.hako.vn / docln.net /
docln.sbs thành EPUB để đọc offline cá nhân. Toàn bộ chạy trên tài khoản GitHub
của bạn: không có server riêng.

## Lưu ý bản quyền

- Chỉ dùng cho mục đích cá nhân, phi thương mại.
- Giữ repo library **PRIVATE**, không chia sẻ lại file EPUB.
- Hãy ủng hộ nhóm dịch và Hako (đọc trực tiếp, đóng góp khi có thể).

## Kiến trúc

```
GitHub Pages (SPA, web/)
   │  GitHub API + fine-grained PAT
   ▼
Repo library (private): workflow inspect / download / update
   │  chạy worker/ (Python, bọc core/hako2epub/android/src)
   ▼
- nhánh `files`: các file EPUB
- nhánh `main`: data/ln_info.json + data/novels/*.json
- nhánh `status/<request_id>`: tiến độ job (progress.json)
```

EPUB lưu thành file trên nhánh `files` thay vì Releases, vì trình duyệt không
tải được asset release của repo private (không có CORS). Xem
[spike](docs/superpowers/spikes/2026-10-08-spikes.md).

## Yêu cầu

- Python ≥ 3.12 (worker; CI chạy 3.12)
- Node 22 (web)
- Tài khoản GitHub có GitHub Pages và Actions

## Cài đặt

1. Push repo này lên GitHub (public). Settings → Pages → Source: **GitHub
   Actions**. Workflow `.github/workflows/pages.yml` tự deploy khi push lên
   `main` tại `https://<owner>.github.io/hako2epub-web/`.
2. Tạo git tag cho phiên bản worker, ví dụ `git tag v0.1.0 && git push origin v0.1.0`.
3. Tạo repo **private** `hako2epub-library` từ thư mục `library-template/`
   (xem [library-template/README.md](library-template/README.md)), thay
   `<OWNER>` và `<TAG>` trong 3 workflow.
4. Tạo fine-grained PAT chỉ cho repo library: Contents Read & write, Actions
   Read & write, Metadata Read.
5. Mở trang web → "Cài đặt" → nhập `owner/hako2epub-library` và PAT.

Nhánh `files` được worker tạo tự động từ `main` ở lần tải đầu tiên (không phải
nhánh orphan), nên nó mang theo lịch sử của `main` lúc tạo.

### Bảo mật token

Mặc định PAT được lưu trong `localStorage` của origin
`https://<owner>.github.io`. Origin này **dùng chung cho mọi trang GitHub Pages
dưới cùng tài khoản**: bất kỳ project Pages nào khác của bạn có chạy JavaScript
bên thứ ba đều đọc được token. Nên:

- dùng custom domain riêng cho hako2epub-web, hoặc không có trang Pages nào
  khác dưới tài khoản này;
- bỏ chọn "Ghi nhớ token trên trình duyệt này" ở màn Cài đặt để token chỉ nằm
  trong `sessionStorage` (mất khi đóng tab);
- giữ PAT ở phạm vi tối thiểu (chỉ repo library) và có hạn dùng.

## Kiểm tra cập nhật hoạt động thế nào

"Kiểm tra cập nhật" tải chương mới của các tập đã tải và các tập mới ra sau tập
cuối cùng đã tải. Các tập cũ hơn mà bạn chưa từng chọn tải (bỏ qua có chủ ý) sẽ
**không** được tải; muốn có chúng thì chọn tải từ màn hình Truyện.

## Phát triển

```bash
python3 -m venv .venv
.venv/bin/pip install -r worker/requirements.txt -r worker/requirements-dev.txt
.venv/bin/pytest -c worker/pyproject.toml --rootdir worker   # hoặc: cd worker && pytest

npm --prefix web ci
npm --prefix web run dev
npm --prefix web test -- --run
npm --prefix web run build
```

## Giới hạn đã biết

- EPUB lớn hơn khoảng 70 MB bị từ chối (giới hạn của Contents API). Mức trần
  này mới chỉ được kiểm chứng thực tế tới khoảng 9 MB; file lớn hơn có thể lỗi
  sớm hơn (worker báo lỗi rõ ràng).
- Repo private có 2 000 phút Actions/tháng.
- Nhánh `files` phình dần theo mỗi lần cập nhật (có thể squash về sau).
- Trường tác giả lấy từ parser upstream, đôi khi hiển thị tình trạng truyện
  thay vì tên tác giả.
- iOS Safari có thể mở EPUB thay vì lưu file.

## Smoke test

- [ ] Cài đặt: nhập repo + PAT, kết nối thành công
- [ ] Tải 1 volume, EPUB xuất hiện trong Thư viện
- [ ] Tải 3 chương lẻ
- [ ] Kiểm tra cập nhật cho một truyện
- [ ] Huỷ một job đang chạy
- [ ] Xoá một volume
- [ ] Mở EPUB trong trình đọc (Apple Books / Moon+ Reader)

## Smoke test log

(chưa chạy)
