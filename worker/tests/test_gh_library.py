from types import SimpleNamespace

import pytest

from hako_worker.gh_library import INFO_PATH, EpubTooLarge, GitHubLibrary
from hako_worker.ids import asset_name

NOVEL_URL = 'https://ln.hako.vn/truyen/1-truyen'
NOVEL = SimpleNamespace(name='Truyện', url=NOVEL_URL)
VOLUME = SimpleNamespace(name='Tập 1')
FILENAME = 'Tập 1 - Truyện.epub'


class FakeClient:
    def __init__(self, info=None):
        self.files = {}
        self.json = {INFO_PATH: info} if info is not None else {}
        self.puts = []
        self.commits = []

    def get_json(self, path, ref='main'):
        if path not in self.json:
            return None, None
        return self.json[path], 'sha'

    def update_json(self, path, mutate, message, branch='main', retries=5):
        new = mutate(self.json.get(path))
        self.json[path] = new
        self.commits.append(message)
        return new

    def put_file(self, path, data, message, branch='files', retries=5):
        self.files[(branch, path)] = data
        self.puts.append((path, message, branch))
        return {'path': path, 'sha': 'abc', 'size': len(data)}

    def get_file_bytes(self, path, ref='files'):
        return self.files.get((ref, path))


def make(client=None, **kw):
    return GitHubLibrary(
        client or FakeClient(), 'truyen-1', NOVEL_URL,
        now_iso=lambda: '2026-01-01T00:00:00Z', **kw,
    )


def test_save_epub_writes_ascii_path_and_vietnamese_filename(tmp_path):
    src = tmp_path / FILENAME
    src.write_bytes(b'epub-data')
    client = FakeClient()
    lib = make(client)
    path = lib.save_epub('Truyện', src)
    assert path == 'truyen-1/' + asset_name(FILENAME)
    assert client.files[('files', path)] == b'epub-data'
    assert client.puts[0][1] == f'epub: {FILENAME}'
    assert lib.saved[FILENAME] == {
        'branch': 'files', 'path': path, 'sha': 'abc',
        'filename': FILENAME, 'size': 9,
        'updated_at': '2026-01-01T00:00:00Z',
    }


def test_save_epub_rejects_oversized_file(tmp_path):
    src = tmp_path / FILENAME
    src.write_bytes(b'x' * 11)
    lib = make(max_bytes=10)
    with pytest.raises(EpubTooLarge) as e:
        lib.save_epub('Truyện', src)
    assert FILENAME in str(e.value)
    assert lib.saved == {}


def test_read_epub_returns_bytes_for_tracked_asset():
    info = {'ln_list': [{
        'ln_name': 'Truyện', 'ln_url': NOVEL_URL, 'num_vol': 1,
        'vol_list': [{'vol_name': 'Tập 1', 'asset': {
            'branch': 'files', 'path': 'truyen-1/a.epub', 'filename': FILENAME}}],
    }]}
    client = FakeClient(info)
    client.files[('files', 'truyen-1/a.epub')] = b'data'
    assert make(client).read_epub('Truyện', FILENAME) == b'data'


def test_read_epub_returns_none_when_untracked():
    assert make(FakeClient()).read_epub('Truyện', FILENAME) is None
    client = FakeClient({'ln_list': [{'ln_url': NOVEL_URL, 'vol_list': []}]})
    assert make(client).read_epub('Truyện', FILENAME) is None


def test_record_volume_attaches_asset_and_keeps_other_novels(tmp_path):
    other = {'ln_name': 'Other', 'ln_url': 'https://ln.hako.vn/truyen/2-x',
             'num_vol': 0, 'vol_list': []}
    client = FakeClient({'ln_list': [other]})
    lib = make(client)
    src = tmp_path / FILENAME
    src.write_bytes(b'z')
    lib.save_epub('Truyện', src)
    data = lib.record_volume(NOVEL, VOLUME, ['c1', 'c2'])
    assert data['ln_list'][0] == other
    vol = data['ln_list'][1]['vol_list'][0]
    assert vol['chapter_list'] == ['c1', 'c2']
    assert vol['asset'] == lib.saved[FILENAME]
    assert client.json[INFO_PATH] == data
    assert client.commits == ['library: Truyện / Tập 1']


def test_record_volume_on_empty_repo():
    data = make(FakeClient()).record_volume(NOVEL, VOLUME, ['c1'])
    assert len(data['ln_list']) == 1
    assert 'asset' not in data['ln_list'][0]['vol_list'][0]
