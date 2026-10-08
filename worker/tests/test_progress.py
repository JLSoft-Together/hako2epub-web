import logging

from hako_worker.progress import ProgressReporter, StatusBranchSink


class Clock:
    def __init__(self):
        self.t = 0.0

    def __call__(self):
        return self.t


def make(sink=None, clock=None):
    calls = []
    clock = clock or Clock()
    reporter = ProgressReporter(
        sink if sink is not None else (lambda s: calls.append(dict(s))),
        'req1', 'download', clock=clock, now_iso=lambda: '2026-01-01T00:00:00Z',
    )
    return reporter, calls, clock


def test_initial_state():
    reporter, _, _ = make()
    assert reporter.state == {
        'request_id': 'req1', 'kind': 'download', 'state': 'running',
        'phase': 'starting', 'novel': '',
        'volumes': {'done': 0, 'total': 0}, 'chapters': {'done': 0, 'total': 0},
        'log': [], 'results': [], 'error': None,
        'updated_at': '2026-01-01T00:00:00Z',
    }


def test_status_is_throttled():
    reporter, calls, clock = make()
    for _ in range(3):
        reporter.status('x')
        clock.t += 1.5
    assert len(calls) == 1
    clock.t = 11.0
    reporter.status('y')
    assert len(calls) == 2


def test_progress_throttled_and_updates_chapters():
    reporter, calls, clock = make()
    reporter.progress(1, 10)
    reporter.progress(2, 10)
    assert len(calls) == 1
    assert reporter.state['chapters'] == {'done': 2, 'total': 10}


def test_phase_volume_done_and_finish_always_flush():
    reporter, calls, _ = make()
    reporter.set_novel('N')
    reporter.set_volume_total(2)
    reporter.phase('downloading')
    reporter.volume_done({'name': 'v1'})
    reporter.finish('failed', 'boom')
    assert len(calls) == 3
    assert reporter.state['phase'] == 'downloading'
    assert reporter.state['novel'] == 'N'
    assert reporter.state['volumes'] == {'done': 1, 'total': 2}
    assert reporter.state['results'] == [{'name': 'v1'}]
    assert reporter.state['state'] == 'failed'
    assert reporter.state['error'] == 'boom'


def test_log_keeps_last_20_lines():
    reporter, _, _ = make()
    for i in range(25):
        reporter.status(f'line {i}')
    assert reporter.state['log'] == [f'line {i}' for i in range(5, 25)]


def test_sink_error_does_not_raise(caplog):
    def bad(_):
        raise RuntimeError('nope')

    reporter, _, _ = make(sink=bad)
    with caplog.at_level(logging.WARNING):
        reporter.status('a')
        reporter.phase('b')
        reporter.finish('done')
    assert reporter.state['state'] == 'done'
    assert any(r.levelno == logging.WARNING for r in caplog.records)


class FakeClient:
    def __init__(self):
        self.created = []
        self.puts = []

    def create_branch(self, branch, from_branch='main'):
        self.created.append(branch)

    def get_json(self, path, ref='main'):
        return None, None

    def put_json(self, path, data, message, sha, branch='main'):
        self.puts.append((path, data, sha, branch))
        return f'sha{len(self.puts)}'


def test_status_branch_sink_creates_branch_once_and_reuses_sha():
    client = FakeClient()
    sink = StatusBranchSink(client, 'req1')
    sink({'a': 1})
    sink({'a': 2})
    assert client.created == ['status/req1']
    assert [p[2] for p in client.puts] == [None, 'sha1']
    assert client.puts[1][0] == 'progress.json'
    assert client.puts[1][3] == 'status/req1'
