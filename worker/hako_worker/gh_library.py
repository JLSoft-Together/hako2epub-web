"""Library adapter: stores EPUBs on the `files` branch and tracks them in ln_info.json."""

from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

from hako2epub import tracker
from hako2epub.text import epub_filename

from .ids import asset_name

INFO_PATH = 'data/ln_info.json'
FILES_BRANCH = 'files'
MAX_EPUB_BYTES = 70 * 1024 * 1024


class EpubTooLarge(Exception):
    pass


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


class GitHubLibrary:
    def __init__(
        self,
        client,
        novel_id: str,
        novel_url: str,
        now_iso: Callable[[], str] = _utc_now_iso,
        max_bytes: int = MAX_EPUB_BYTES,
    ):
        self.client = client
        self.novel_id = novel_id
        self.novel_url = novel_url
        self.now_iso = now_iso
        self.max_bytes = max_bytes
        self.saved: dict[str, dict] = {}

    def save_epub(self, novel_name: str, src_path) -> str:
        data = Path(src_path).read_bytes()
        filename = Path(src_path).name
        if len(data) > self.max_bytes:
            size_mb = len(data) / (1024 * 1024)
            limit_mb = self.max_bytes / (1024 * 1024)
            raise EpubTooLarge(
                f'EPUB quá lớn để lưu qua GitHub API: {filename} '
                f'({size_mb:.1f} MB > {limit_mb:g} MB)'
            )
        path = f'{self.novel_id}/{asset_name(filename)}'
        rec = self.client.put_file(
            path, data, message=f'epub: {filename}', branch=FILES_BRANCH
        )
        self.saved[filename] = {
            'branch': FILES_BRANCH,
            'path': path,
            'sha': rec['sha'],
            'filename': filename,
            'size': rec['size'],
            'updated_at': self.now_iso(),
        }
        return path

    def read_epub(self, novel_name: str, filename: str) -> bytes | None:
        data, _ = self.client.get_json(INFO_PATH)
        for entry in tracker.novels(data or {}):
            if entry.get('ln_url') != self.novel_url:
                continue
            for vol in entry.get('vol_list', []):
                asset = vol.get('asset')
                if asset and asset.get('filename') == filename:
                    return self.client.get_file_bytes(
                        asset['path'], ref=asset.get('branch', FILES_BRANCH)
                    )
        return None

    def record_volume(self, novel, volume, chapter_names: list[str]) -> dict:
        asset = self.saved.get(epub_filename(volume.name, novel.name))

        def mutate(data):
            new = tracker.record_volume(
                data or tracker.empty(), novel, volume, chapter_names
            )
            if asset:
                for entry in new['ln_list']:
                    if entry.get('ln_url') != novel.url:
                        continue
                    for vol in entry['vol_list']:
                        if vol.get('vol_name') == volume.name:
                            vol['asset'] = dict(asset)
            return new

        return self.client.update_json(
            INFO_PATH, mutate, f'library: {novel.name} / {volume.name}'
        )
