"""The three worker jobs: inspect a novel, download volumes, update tracked novels."""

import logging
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Callable

from hako2epub import tracker
from hako2epub.downloader import Cancelled, DownloadError, UpdateCandidate

from .gh_library import INFO_PATH, GitHubLibrary
from .ids import InvalidNovelUrl, canonical_url, novel_id
from .snapshot import snapshot_path, to_snapshot

log = logging.getLogger(__name__)

STATUS_PREFIX = 'status/'
STATUS_MAX_AGE = timedelta(hours=24)


class JobError(Exception):
    """A user-facing failure; the message is shown verbatim in progress.error."""


@dataclass
class Context:
    client: object
    reporter: object
    make_downloader: Callable
    should_cancel: Callable[[], bool]
    now_iso: Callable[[], str]


def _canonical(payload: dict) -> tuple[str, str]:
    try:
        url = canonical_url(payload.get('url') or '')
        return url, novel_id(url)
    except InvalidNovelUrl:
        raise JobError('URL không phải trang truyện hako') from None


def _fresh_info(client) -> dict:
    data, _ = client.get_json(INFO_PATH)
    return data or tracker.empty()


def _write_snapshot(ctx: Context, novel, nid: str) -> None:
    snap = to_snapshot(novel, nid, ctx.now_iso())
    ctx.client.update_json(snapshot_path(nid), lambda _: snap, f'snapshot: {novel.name}')


class _LogForwarder(logging.Handler):
    """Forwards core WARNING+ messages to the reporter and keeps them."""

    def __init__(self, reporter):
        super().__init__(logging.WARNING)
        self.reporter = reporter
        self.messages: list[str] = []

    def emit(self, record):
        message = record.getMessage()
        self.messages.append(message)
        self.reporter.status(message)

    def error_for(self, volume_name: str) -> str:
        for needle in (f'"{volume_name}"', volume_name):
            for message in reversed(self.messages):
                if needle in message:
                    return message
        return 'Không đọc được volume'


@contextmanager
def _capture_core_logs(reporter):
    handler = _LogForwarder(reporter)
    core = logging.getLogger('hako2epub')
    core.addHandler(handler)
    try:
        yield handler
    finally:
        core.removeHandler(handler)


def _on_volume(ctx: Context, library, novel, done: set):
    def record(result):
        library.record_volume(result.novel or novel, result.volume, result.chapter_names)
        done.add(result.volume.name)
        ctx.reporter.volume_done({
            'volume': result.volume.name, 'ok': True,
            'chapters': result.chapters,
            'skipped_chapters': result.skipped_chapters,
            'images': result.images,
            'skipped_images': result.skipped_images,
            'appended': result.appended,
        })
    return record


def _callbacks(ctx: Context, on_volume) -> dict:
    return {
        'progress': ctx.reporter.progress, 'status': ctx.reporter.status,
        'on_volume': on_volume, 'should_cancel': ctx.should_cancel,
    }


def _start(ctx: Context, url: str, nid: str):
    library = GitHubLibrary(ctx.client, nid, url, now_iso=ctx.now_iso)
    downloader = ctx.make_downloader(library)
    ctx.reporter.phase('fetching')
    novel = downloader.fetch_novel(url)
    ctx.reporter.set_novel(novel.name)
    return library, downloader, novel


def _load(ctx: Context, downloader, volumes) -> None:
    for position, volume in enumerate(volumes, 1):
        if ctx.should_cancel():
            raise Cancelled('Stopped while reading volumes')
        ctx.reporter.status(f'Đọc volume {position}/{len(volumes)}: {volume.name}')
        if not volume.loaded:
            downloader.load_chapters(volume)


def run_inspect(ctx: Context, payload: dict) -> None:
    url, nid = _canonical(payload)
    _, downloader, novel = _start(ctx, url, nid)
    _load(ctx, downloader, novel.volumes)
    _write_snapshot(ctx, novel, nid)


def _selected(novel, selections: list[dict]):
    changed = JobError('Danh sách volume đã thay đổi, hãy làm mới')
    picked = []
    for sel in selections:
        index = sel.get('index')
        if not isinstance(index, int) or not 0 <= index < len(novel.volumes):
            raise changed
        volume = novel.volumes[index]
        if volume.name != sel.get('name'):
            raise changed
        picked.append((volume, sel.get('chapters')))
    return picked, changed


def run_download(ctx: Context, payload: dict) -> None:
    url, nid = _canonical(payload)
    library, downloader, novel = _start(ctx, url, nid)
    picked, changed = _selected(novel, payload.get('volumes') or [])
    picked = [(volume, chapters) for volume, chapters in picked if chapters != []]
    if not picked:
        raise JobError('Chưa chọn chương nào để tải')
    _load(ctx, downloader, [volume for volume, _ in picked])

    entry = tracker.find_novel(_fresh_info(ctx.client), url)
    fresh, append = [], []
    for volume, chapters in picked:
        if chapters is not None and any(
                not 0 <= i < len(volume.chapters) for i in chapters):
            raise changed
        # Volume order, no duplicates, whatever order the payload used.
        chosen = None if chapters is None else [
            volume.chapters[i] for i in sorted(set(chapters))]
        if chapters is None or tracker.find_volume(entry, volume.name) is None:
            if chosen is not None:
                volume.chapters = chosen
            fresh.append(volume)
            continue
        known = tracker.stored_chapters(entry, volume.name)
        known_set = set(known)
        new = [chapter for chapter in chosen if chapter.name not in known_set]
        if new:
            append.append(UpdateCandidate(novel, volume, new, known))

    requested = [v.name for v in fresh] + [c.volume.name for c in append]
    ctx.reporter.set_volume_total(len(requested))
    ctx.reporter.phase('chapters')
    done: set = set()
    callbacks = _callbacks(ctx, _on_volume(ctx, library, novel, done))
    batches = []
    if fresh:
        batches.append(lambda: downloader.download_volumes(novel, fresh, **callbacks))
    if append:
        batches.append(lambda: downloader.apply_updates(append, **callbacks))
    error = None
    with _capture_core_logs(ctx.reporter) as logs:
        for run in batches:
            try:
                run()
            except DownloadError as exc:  # every volume of the batch failed
                error = exc
            # Core stops at a volume boundary without raising.
            if ctx.should_cancel():
                raise Cancelled('Stopped between volumes')
        for name in requested:
            if name not in done:
                ctx.reporter.volume_done(
                    {'volume': name, 'ok': False, 'error': logs.error_for(name)})
    if error is not None and not done:
        raise error


def _update_one(ctx: Context, url: str, nid: str) -> None:
    library, downloader, novel = _start(ctx, url, nid)
    info = _fresh_info(ctx.client)
    ctx.reporter.phase('chapters')
    done: set = set()
    on_volume = _on_volume(ctx, library, novel, done)

    def counted(result):
        # The number of volumes with new chapters is only known inside
        # update_novel, so the total grows as volumes complete.
        ctx.reporter.set_volume_total(ctx.reporter.state['volumes']['total'] + 1)
        on_volume(result)

    with _capture_core_logs(ctx.reporter):
        downloader.update_novel(novel, info, **_callbacks(ctx, counted))
    if ctx.should_cancel():
        raise Cancelled('Stopped between volumes')
    _write_snapshot(ctx, novel, nid)


def _prune_status_branches(ctx: Context) -> None:
    own = STATUS_PREFIX + ctx.reporter.state['request_id']
    now = datetime.fromisoformat(ctx.now_iso().replace('Z', '+00:00'))
    try:
        for branch in ctx.client.list_branches(STATUS_PREFIX):
            when = datetime.fromisoformat(branch['commit_date'].replace('Z', '+00:00'))
            if branch['name'] != own and now - when > STATUS_MAX_AGE:
                ctx.client.delete_branch(branch['name'])
    except Exception as exc:  # housekeeping must not fail the update
        log.warning('status branch pruning failed: %s', exc)


def run_update(ctx: Context, payload: dict) -> None:
    if payload.get('url'):
        url, nid = _canonical(payload)
        _update_one(ctx, url, nid)
    else:
        for entry in tracker.novels(_fresh_info(ctx.client)):
            name = entry.get('ln_name') or entry.get('ln_url', '')
            try:
                url, nid = _canonical({'url': entry.get('ln_url')})
                _update_one(ctx, url, nid)
            except Cancelled:
                raise
            except Exception as exc:
                ctx.reporter.state['results'].append(
                    {'novel': name, 'ok': False, 'error': str(exc)})
                ctx.reporter.status(f'{name}: {exc}')
    _prune_status_branches(ctx)
