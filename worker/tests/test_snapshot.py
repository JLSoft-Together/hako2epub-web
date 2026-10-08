from types import SimpleNamespace

from hako2epub.parser import NovelParser

from conftest import ROOT
from hako_worker.snapshot import snapshot_path, to_snapshot

FIX = ROOT / 'worker' / 'tests' / 'fixtures'
NOVEL = 'https://ln.hako.vn/truyen/1-truyen-1'
PAGES = {
    NOVEL: 'novel.html',
    NOVEL + '/t1': 'volume_1.html',
    NOVEL + '/t2': 'volume_2.html',
}


class FakeNetwork:
    def get(self, url):
        return SimpleNamespace(text=(FIX / PAGES[url]).read_text('utf-8'))


def _parse():
    parser = NovelParser(FakeNetwork())
    novel = parser.parse_novel(NOVEL)
    for volume in novel.volumes:
        parser.load_chapters(volume)
    return novel


def test_snapshot_shape():
    snap = to_snapshot(_parse(), 'truyen-1', '2026-01-01T00:00:00Z')
    assert snap['novel_id'] == 'truyen-1'
    assert snap['name'] == 'Truyen Mot'
    assert snap['url'] == NOVEL
    assert snap['author'] == 'Tac Gia A'
    assert 'Tom tat.' in snap['summary_html']
    assert snap['fetched_at'] == '2026-01-01T00:00:00Z'
    assert len(snap['volumes']) == 2
    assert snap['volumes'][1]['index'] == 1
    assert snap['volumes'][1]['name'] == 'Tap 2'
    assert snap['volumes'][0]['chapters'][0] == {
        'name': 'Chuong 1',
        'url': 'https://ln.hako.vn/truyen/1-truyen-1/t1/c1',
    }
    assert len(snap['volumes'][1]['chapters']) == 2


def test_snapshot_cover_from_first_volume_with_cover():
    snap = to_snapshot(_parse(), 'truyen-1', 'now')
    assert snap['volumes'][0]['cover_url'] == 'https://img.example/v1.jpg'
    assert snap['volumes'][1]['cover_url'] == ''
    assert snap['cover_url'] == 'https://img.example/v1.jpg'

    novel = _parse()
    novel.volumes[0].cover_img = ''
    novel.volumes[1].cover_img = 'https://img.example/v2.jpg'
    assert to_snapshot(novel, 'truyen-1', 'now')['cover_url'] == 'https://img.example/v2.jpg'

    novel.volumes[1].cover_img = ''
    assert to_snapshot(novel, 'truyen-1', 'now')['cover_url'] == ''


def test_snapshot_path():
    assert snapshot_path('truyen-1') == 'data/novels/truyen-1.json'
