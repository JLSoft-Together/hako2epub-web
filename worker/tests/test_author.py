from hako_worker.author import extract_author

# Trimmed from https://ln.hako.vn/truyen/28753-… (2026-10): status is the only info-item.
CURRENT_LAYOUT = '''
<div class="series-information mb-0 flex flex-col">
  <div class="series-gernes"><a class="series-gerne-item" href="https://ln.hako.vn/the-loai/action">Action</a></div>
  <div class="info-item">
    <span class="info-name">Tình trạng:</span>
    <span class="info-value"> <a href="https://ln.hako.vn/truyen-dang-tien-hanh">Đang tiến hành</a> </span>
  </div>
</div>
'''

OLD_LAYOUT = '''
<div class="series-information">
  <div class="info-item">
    <span class="info-name">Tác giả:</span>
    <span class="info-value"><a href="/tac-gia/kamachi-kazuma">Kamachi  Kazuma</a></span>
  </div>
  <div class="info-item">
    <span class="info-name">Họa sĩ:</span>
    <span class="info-value"><a href="/hoa-si/x">Artist</a></span>
  </div>
  <div class="info-item">
    <span class="info-name">Tình trạng:</span>
    <span class="info-value"><a href="/truyen-da-hoan-thanh">Đã hoàn thành</a></span>
  </div>
</div>
'''


def test_status_is_never_taken_as_author():
    assert extract_author(CURRENT_LAYOUT) == ''


def test_author_found_by_label_and_whitespace_normalised():
    assert extract_author(OLD_LAYOUT) == 'Kamachi Kazuma'


def test_author_label_without_link_uses_text():
    html = '<div class="info-item"><span class="info-name">Tác giả:</span><span class="info-value">Ẩn danh</span></div>'
    assert extract_author(html) == 'Ẩn danh'


def test_empty_or_missing_html():
    assert extract_author('') == ''
    assert extract_author(None) == ''
