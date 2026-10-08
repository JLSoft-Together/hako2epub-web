import copy
import json
import logging

import pytest

from hako2epub.downloader import Cancelled, DownloadError, VolumeResult
from hako2epub.models import Chapter, LightNovel, Volume
from hako2epub.net import NetworkError

from hako_worker import jobs
from hako_worker.gh_library import INFO_PATH
from hako_worker.jobs import Context, JobError, run_download, run_inspect, run_update
from hako_worker.progress import ProgressReporter
from hako_worker.snapshot import snapshot_path

URL = 'https://ln.hako.vn/truyen/1-truyen'
URL2 = 'https://ln.hako.vn/truyen/2-khac'
NOW = '2026-10-08T12:00:00Z'


def make_novel(url=URL, name='Truyện', volumes=None):
    volumes = volumes or {'Tập 1': ['C1', 'C2', 'C3'], 'Tập 2': ['D1', 'D2']}
    return LightNovel(
        name=name, url=url, author='Tác giả',
        volumes=[Volume(url=f'{url}/v{i}', name=vname)
                 for i, vname in enumerate(volumes)],
    ), volumes


class FakeClient:
    def __init__(self, info=None, branches=None):
        self.json = {INFO_PATH: info} if info is not None else {}
        self.branches = branches or []
        self.deleted = []

    def get_json(self, path, ref='main'):
        if path not in self.json:
            return None, None
        return copy.deepcopy(self.json[path]), 'sha'

    def update_json(self, path, mutate, message, branch='main', retries=5):
        self.json[path] = mutate(copy.deepcopy(self.json.get(path)))
        return self.json[path]

    def list_branches(self, prefix):
        return [b for b in self.branches if b['name'].startswith(prefix)]

    def delete_branch(self, branch):
        self.deleted.append(branch)


class FakeDownloader:
    """Records calls; serves novels from a {url: (novel, chapters)} map."""

    def __init__(self, library, novels, calls, fail=None):
        self.library = library
        self.novels = novels
        self.calls = calls
        self.fail = fail or {}

    def fetch_novel(self, url):
        self.calls.append(('fetch_novel', url))
        if url in self.fail:
            raise self.fail[url]
        return self.novels[url][0]

    def load_chapters(self, volume):
        chapters = self.novels_chapters()[volume.name]
        volume.chapters = [Chapter(name=c, url=f'{volume.url}/{c}') for c in chapters]
        volume.loaded = True
        return volume

    def novels_chapters(self):
        merged = {}
        for _, chapters in self.novels.values():
            merged.update(chapters)
        return merged

    def _result(self, novel, volume, names, appended=False):
        return VolumeResult(volume=volume, novel=novel, path='p', chapters=len(names),
                            chapter_names=names, appended=appended)

    def download_volumes(self, novel, volumes, progress=None, status=None,
                         on_volume=None, should_cancel=None):
        self.calls.append(('download_volumes', [
            (v.name, [c.name for c in v.chapters]) for v in volumes]))
        results = []
        for v in volumes:
            if should_cancel():  # core breaks at a volume boundary
                break
            if v.name in self.fail:
                logging.getLogger('hako2epub.downloader').error(
                    f'Volume "{v.name}" failed: boom')
                continue
            r = self._result(novel, v, [c.name for c in v.chapters])
            on_volume(r)
            results.append(r)
        return results

    def apply_updates(self, candidates, progress=None, status=None,
                      on_volume=None, should_cancel=None):
        self.calls.append(('apply_updates', [
            (c.volume.name, [ch.name for ch in c.new_chapters], c.known_chapters)
            for c in candidates]))
        results = []
        for c in candidates:
            r = self._result(c.novel, c.volume,
                             c.known_chapters + [ch.name for ch in c.new_chapters],
                             appended=True)
            on_volume(r)
            results.append(r)
        return results

    def update_novel(self, novel, info, progress=None, status=None,
                     on_volume=None, should_cancel=None):
        self.calls.append(('update_novel', novel.url, info))
        if novel.url in self.fail:
            raise self.fail[novel.url]
        for v in novel.volumes:
            self.load_chapters(v)
        return []


def make_ctx(client, novels, fail=None, request_id='req1', cancel=None):
    calls = []
    reporter = ProgressReporter(lambda s: None, request_id, 'download',
                                clock=lambda: 0.0, now_iso=lambda: NOW)
    ctx = Context(
        client=client, reporter=reporter,
        make_downloader=lambda lib: FakeDownloader(lib, novels, calls, fail),
        should_cancel=lambda: False, now_iso=lambda: NOW,
    )
    if cancel:
        ctx.should_cancel = lambda: cancel(ctx)
    return ctx, calls


def tracked_info(url=URL, name='Truyện', vols=None):
    vols = vols or {'Tập 1': ['C1', 'C2']}
    return {'ln_list': [{
        'ln_name': name, 'ln_url': url, 'num_vol': len(vols),
        'vol_list': [{'vol_name': k, 'num_chapter': len(v), 'chapter_list': v}
                     for k, v in vols.items()],
    }]}


def test_inspect_writes_snapshot():
    client = FakeClient()
    ctx, calls = make_ctx(client, {URL: make_novel()})
    run_inspect(ctx, {'url': 'docln.net/truyen/1-truyen/'})
    assert calls[0] == ('fetch_novel', URL)
    snap = client.json[snapshot_path('truyen-1')]
    assert snap['novel_id'] == 'truyen-1'
    assert snap['fetched_at'] == NOW
    assert [c['name'] for c in snap['volumes'][0]['chapters']] == ['C1', 'C2', 'C3']
    assert [c['name'] for c in snap['volumes'][1]['chapters']] == ['D1', 'D2']


def test_download_untracked_volume_uses_download_volumes():
    client = FakeClient()
    ctx, calls = make_ctx(client, {URL: make_novel()})
    run_download(ctx, {'url': URL, 'volumes': [
        {'index': 1, 'name': 'Tập 2', 'chapters': None}]})
    assert ('download_volumes', [('Tập 2', ['D1', 'D2'])]) in calls
    assert not [c for c in calls if c[0] == 'apply_updates']
    info = client.json[INFO_PATH]
    assert info['ln_list'][0]['vol_list'][0]['chapter_list'] == ['D1', 'D2']
    result = ctx.reporter.state['results'][0]
    assert result['volume'] == 'Tập 2' and result['ok'] is True
    assert ctx.reporter.state['volumes'] == {'done': 1, 'total': 1}
    # R9: download does not rewrite the snapshot
    assert snapshot_path('truyen-1') not in client.json


def test_download_subset_of_untracked_volume_keeps_only_selected_chapters():
    client = FakeClient()
    ctx, calls = make_ctx(client, {URL: make_novel()})
    run_download(ctx, {'url': URL, 'volumes': [
        {'index': 0, 'name': 'Tập 1', 'chapters': [0, 2]}]})
    assert ('download_volumes', [('Tập 1', ['C1', 'C3'])]) in calls


def test_download_fresh_selection_uses_volume_order_without_duplicates():
    client = FakeClient()
    ctx, calls = make_ctx(client, {URL: make_novel()})
    run_download(ctx, {'url': URL, 'volumes': [
        {'index': 0, 'name': 'Tập 1', 'chapters': [2, 0, 2]}]})
    assert ('download_volumes', [('Tập 1', ['C1', 'C3'])]) in calls
    vol = client.json[INFO_PATH]['ln_list'][0]['vol_list'][0]
    assert vol['chapter_list'] == ['C1', 'C3']


def test_download_append_selection_uses_volume_order_without_duplicates():
    client = FakeClient(info=tracked_info(vols={'Tập 1': ['C1']}))
    ctx, calls = make_ctx(client, {URL: make_novel()})
    run_download(ctx, {'url': URL, 'volumes': [
        {'index': 0, 'name': 'Tập 1', 'chapters': [2, 1, 2]}]})
    assert ('apply_updates', [('Tập 1', ['C2', 'C3'], ['C1'])]) in calls
    vol = client.json[INFO_PATH]['ln_list'][0]['vol_list'][0]
    assert vol['chapter_list'] == ['C1', 'C2', 'C3']


def test_download_empty_selection_is_skipped():
    client = FakeClient()
    ctx, calls = make_ctx(client, {URL: make_novel()})
    run_download(ctx, {'url': URL, 'volumes': [
        {'index': 0, 'name': 'Tập 1', 'chapters': []},
        {'index': 1, 'name': 'Tập 2', 'chapters': None}]})
    assert [c for c in calls if c[0] == 'download_volumes'] == [
        ('download_volumes', [('Tập 2', ['D1', 'D2'])])]
    assert ctx.reporter.state['volumes'] == {'done': 1, 'total': 1}


def test_download_only_empty_selections_fails_in_vietnamese():
    ctx, calls = make_ctx(FakeClient(), {URL: make_novel()})
    with pytest.raises(JobError, match='Chưa chọn chương nào để tải'):
        run_download(ctx, {'url': URL, 'volumes': [
            {'index': 0, 'name': 'Tập 1', 'chapters': []}]})
    assert not [c for c in calls if c[0] == 'download_volumes']


def test_download_cancel_between_volumes_raises_cancelled():
    client = FakeClient()
    ctx, _ = make_ctx(client, {URL: make_novel()},
                      cancel=lambda c: c.reporter.state['volumes']['done'] >= 1)
    with pytest.raises(Cancelled):
        run_download(ctx, {'url': URL, 'volumes': [
            {'index': 0, 'name': 'Tập 1', 'chapters': None},
            {'index': 1, 'name': 'Tập 2', 'chapters': None}]})
    results = ctx.reporter.state['results']
    assert [r['volume'] for r in results] == ['Tập 1']


def test_update_cancel_after_update_novel_raises_cancelled():
    client = FakeClient(info=tracked_info())
    ctx, calls = make_ctx(client, {URL: make_novel()}, cancel=lambda c: True)
    with pytest.raises(Cancelled):
        run_update(ctx, {'url': URL})
    assert [c[0] for c in calls] == ['fetch_novel', 'update_novel']
    assert snapshot_path('truyen-1') not in client.json


def test_selected_chapters_on_tracked_volume_appends():
    client = FakeClient(info=tracked_info())
    ctx, calls = make_ctx(client, {URL: make_novel()})
    run_download(ctx, {'url': URL, 'volumes': [
        {'index': 0, 'name': 'Tập 1', 'chapters': [1, 2]}]})
    assert ('apply_updates', [('Tập 1', ['C3'], ['C1', 'C2'])]) in calls
    assert not [c for c in calls if c[0] == 'download_volumes']
    vol = client.json[INFO_PATH]['ln_list'][0]['vol_list'][0]
    assert vol['chapter_list'] == ['C1', 'C2', 'C3']


def test_download_skips_append_with_no_new_chapters():
    client = FakeClient(info=tracked_info())
    ctx, calls = make_ctx(client, {URL: make_novel()})
    run_download(ctx, {'url': URL, 'volumes': [
        {'index': 0, 'name': 'Tập 1', 'chapters': [0, 1]}]})
    assert not [c for c in calls if c[0] in ('apply_updates', 'download_volumes')]


def test_download_reports_failed_volume_from_log():
    client = FakeClient()
    ctx, _ = make_ctx(client, {URL: make_novel()}, fail={'Tập 2': None})
    run_download(ctx, {'url': URL, 'volumes': [
        {'index': 0, 'name': 'Tập 1', 'chapters': None},
        {'index': 1, 'name': 'Tập 2', 'chapters': None}]})
    results = ctx.reporter.state['results']
    assert results[0]['ok'] is True
    assert results[1] == {'volume': 'Tập 2', 'ok': False,
                          'error': 'Volume "Tập 2" failed: boom'}
    assert 'Volume "Tập 2" failed: boom' in ctx.reporter.state['log']


def test_download_rejects_changed_volume_list():
    ctx, _ = make_ctx(FakeClient(), {URL: make_novel()})
    with pytest.raises(JobError, match='Danh sách volume đã thay đổi, hãy làm mới'):
        run_download(ctx, {'url': URL, 'volumes': [
            {'index': 0, 'name': 'Tập 2', 'chapters': None}]})


def test_download_invalid_url_fails_with_vietnamese_message():
    ctx, calls = make_ctx(FakeClient(), {})
    with pytest.raises(JobError, match='URL không phải trang truyện hako'):
        run_download(ctx, {'url': 'https://example.com/x', 'volumes': []})
    assert calls == []


def test_update_all_continues_after_one_novel_fails():
    info = tracked_info()
    info['ln_list'] += tracked_info(URL2, 'Khác', {'Tập 2': ['D1']})['ln_list']
    client = FakeClient(info=info)
    ctx, calls = make_ctx(client, {URL: make_novel(), URL2: make_novel(URL2, 'Khác')},
                          fail={URL: NetworkError('down')})
    run_update(ctx, {})
    assert [c[1] for c in calls if c[0] == 'fetch_novel'] == [URL, URL2]
    assert [c[1] for c in calls if c[0] == 'update_novel'] == [URL2]
    assert ctx.reporter.state['results'][0] == {
        'novel': 'Truyện', 'ok': False, 'error': 'down'}
    assert snapshot_path('truyen-2') in client.json
    assert snapshot_path('truyen-1') not in client.json


def test_update_single_url_passes_fresh_info():
    info = tracked_info()
    client = FakeClient(info=info)
    ctx, calls = make_ctx(client, {URL: make_novel()})
    run_update(ctx, {'url': 'ln.hako.vn/truyen/1-truyen'})
    assert ('update_novel', URL, info) in calls


def test_update_cancelled_propagates():
    client = FakeClient(info=tracked_info())
    ctx, _ = make_ctx(client, {URL: make_novel()}, fail={URL: Cancelled('x')})
    with pytest.raises(Cancelled):
        run_update(ctx, {})


def test_update_prunes_old_status_branches():
    client = FakeClient(info=tracked_info(), branches=[
        {'name': 'status/old', 'commit_date': '2026-10-07T11:59:59Z'},
        {'name': 'status/fresh', 'commit_date': '2026-10-07T12:00:01Z'},
        {'name': 'status/req1', 'commit_date': '2026-10-01T00:00:00Z'},
    ])
    ctx, _ = make_ctx(client, {URL: make_novel()})
    run_update(ctx, {})
    assert client.deleted == ['status/old']


def test_main_maps_cancelled_to_cancelled_state(monkeypatch):
    from hako_worker import __main__ as cli

    states = []
    monkeypatch.setattr(cli, 'GitHubClient', lambda token, repo: FakeClient())
    monkeypatch.setattr(cli, 'StatusBranchSink',
                        lambda client, rid: lambda s: states.append(dict(s)))

    def boom(ctx, payload):
        assert payload == {'url': URL}
        raise Cancelled('stop')

    monkeypatch.setattr(cli.jobs, 'run_download', boom)
    monkeypatch.setenv('GITHUB_TOKEN', 't')
    monkeypatch.setenv('GITHUB_REPOSITORY', 'o/r')
    monkeypatch.setenv('REQUEST_ID', 'r1')
    monkeypatch.setenv('PAYLOAD', json.dumps({'url': URL}))
    assert cli.main(['download']) == 1
    assert states[-1]['state'] == 'cancelled'


@pytest.mark.parametrize('exc, message', [
    (JobError('Danh sách volume đã thay đổi, hãy làm mới'),
     'Danh sách volume đã thay đổi, hãy làm mới'),
    (DownloadError('x'), 'x'),
    (NetworkError('dead'),
     'Bị Cloudflare chặn hoặc mất kết nối ở cả 3 mirror: dead'),
])
def test_main_maps_errors_to_failed(monkeypatch, exc, message):
    from hako_worker import __main__ as cli

    states = []
    monkeypatch.setattr(cli, 'GitHubClient', lambda token, repo: FakeClient())
    monkeypatch.setattr(cli, 'StatusBranchSink',
                        lambda client, rid: lambda s: states.append(dict(s)))

    def boom(ctx, payload):
        raise exc

    monkeypatch.setattr(cli.jobs, 'run_inspect', boom)
    monkeypatch.setenv('GITHUB_TOKEN', 't')
    monkeypatch.setenv('GITHUB_REPOSITORY', 'o/r')
    monkeypatch.setenv('REQUEST_ID', 'r1')
    monkeypatch.setenv('PAYLOAD', '{}')
    assert cli.main(['inspect']) == 1
    assert states[-1]['state'] == 'failed'
    assert states[-1]['error'] == message


def test_main_success_and_unknown_command(monkeypatch, capsys):
    from hako_worker import __main__ as cli

    states = []
    monkeypatch.setattr(cli, 'GitHubClient', lambda token, repo: FakeClient())
    monkeypatch.setattr(cli, 'StatusBranchSink',
                        lambda client, rid: lambda s: states.append(dict(s)))
    monkeypatch.setattr(cli.jobs, 'run_update', lambda ctx, payload: None)
    monkeypatch.setenv('GITHUB_TOKEN', 't')
    monkeypatch.setenv('GITHUB_REPOSITORY', 'o/r')
    monkeypatch.setenv('REQUEST_ID', 'r1')
    monkeypatch.delenv('PAYLOAD', raising=False)
    assert cli.main(['update']) == 0
    assert states[-1]['state'] == 'done'
    assert cli.main(['bogus']) == 2
    assert 'usage' in capsys.readouterr().err.lower()
