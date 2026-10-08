"""Throttled progress reporting to a per-request git status branch."""

import logging
import time
from datetime import datetime, timezone
from typing import Callable

log = logging.getLogger(__name__)

LOG_LINES = 20


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


class ProgressReporter:
    def __init__(self, sink: Callable[[dict], None], request_id: str, kind: str,
                 clock=time.monotonic, now_iso=_utc_now_iso,
                 interval: float = 10.0):
        self._sink = sink
        self._clock = clock
        self._now_iso = now_iso
        self._interval = interval
        self._last_flush: float | None = None
        self.state: dict = {
            'request_id': request_id,
            'kind': kind,
            'state': 'running',
            'phase': 'starting',
            'novel': '',
            'volumes': {'done': 0, 'total': 0},
            'chapters': {'done': 0, 'total': 0},
            'log': [],
            'results': [],
            'error': None,
            'updated_at': now_iso(),
        }

    def set_novel(self, name: str) -> None:
        self.state['novel'] = name

    def set_volume_total(self, n: int) -> None:
        self.state['volumes']['total'] = n

    def phase(self, name: str) -> None:
        self.state['phase'] = name
        self._flush()

    def status(self, message: str) -> None:
        lines = self.state['log']
        lines.append(message)
        del lines[:-LOG_LINES]
        self._flush_throttled()

    def progress(self, done: int, total: int) -> None:
        self.state['chapters'] = {'done': done, 'total': total}
        self._flush_throttled()

    def volume_done(self, result_summary: dict) -> None:
        self.state['results'].append(result_summary)
        self.state['volumes']['done'] += 1
        self._flush()

    def finish(self, state: str, error: str | None = None) -> None:
        self.state['state'] = state
        self.state['error'] = error
        self._flush()

    def _flush_throttled(self) -> None:
        now = self._clock()
        if self._last_flush is None or now - self._last_flush >= self._interval:
            self._flush()

    def _flush(self) -> None:
        self._last_flush = self._clock()
        self.state['updated_at'] = self._now_iso()
        try:
            self._sink(self.state)
        except Exception as exc:  # progress must never break the job
            log.warning('failed to write progress: %s', exc)


class StatusBranchSink:
    def __init__(self, client, request_id: str):
        self._client = client
        self._branch = f'status/{request_id}'
        self._created = False
        self._sha: str | None = None

    def __call__(self, state: dict) -> None:
        if not self._created:
            self._client.create_branch(self._branch)
            self._created = True
        self._sha = self._client.put_json(
            'progress.json', state, 'progress', self._sha, branch=self._branch)
