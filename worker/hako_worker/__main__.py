"""CLI entry point: python -m hako_worker inspect|download|update."""

import json
import logging
import os
import signal
import sys
import tempfile
import threading
from datetime import datetime, timezone

from hako2epub.downloader import Cancelled, DownloadError, LightNovelDownloader
from hako2epub.net import NetworkError, NetworkManager

from . import jobs
from .gh_library import EpubTooLarge
from .github import GitHubClient
from .progress import ProgressReporter, StatusBranchSink

log = logging.getLogger('hako_worker')

USAGE = 'usage: python -m hako_worker {inspect|download|update}'


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


COMMANDS = {'inspect': 'run_inspect', 'download': 'run_download', 'update': 'run_update'}


def _run(command: str, ctx: jobs.Context, payload: dict) -> tuple[str, str | None]:
    try:
        getattr(jobs, COMMANDS[command])(ctx, payload)
    except Cancelled:
        return 'cancelled', None
    except NetworkError as exc:
        return 'failed', f'Bị Cloudflare chặn hoặc mất kết nối ở cả 3 mirror: {exc}'
    except (jobs.JobError, DownloadError, EpubTooLarge) as exc:
        return 'failed', str(exc)
    except Exception as exc:  # never leave the status branch "running"
        log.exception('job crashed')
        return 'failed', str(exc) or type(exc).__name__
    return 'done', None


def main(argv: list[str] | None = None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    if len(argv) != 1 or argv[0] not in COMMANDS:
        print(USAGE, file=sys.stderr)
        return 2
    command = argv[0]
    logging.basicConfig(level=logging.INFO, format='%(levelname)s %(name)s: %(message)s')

    client = GitHubClient(os.environ['GITHUB_TOKEN'], os.environ['GITHUB_REPOSITORY'])
    request_id = os.environ['REQUEST_ID']
    payload = json.loads(os.environ.get('PAYLOAD') or '{}')
    reporter = ProgressReporter(StatusBranchSink(client, request_id), request_id, command)

    cancel = threading.Event()
    previous = {sig: signal.signal(sig, lambda *_: cancel.set())
                for sig in (signal.SIGINT, signal.SIGTERM)}
    try:
        with tempfile.TemporaryDirectory(prefix='hako-') as tmp:
            network: list[NetworkManager] = []

            def make_downloader(library):
                if not network:
                    network.append(NetworkManager())
                return LightNovelDownloader(
                    output_dir=tmp, network=network[0], library=library)

            ctx = jobs.Context(
                client=client, reporter=reporter, make_downloader=make_downloader,
                should_cancel=cancel.is_set, now_iso=_utc_now_iso,
            )
            state, error = _run(command, ctx, payload)
    finally:
        for sig, handler in previous.items():
            signal.signal(sig, handler)

    reporter.finish(state, error)
    return 0 if state == 'done' else 1


if __name__ == '__main__':
    sys.exit(main())
