"""Serialise a parsed LightNovel into the cached JSON snapshot."""

from hako2epub.models import LightNovel


def snapshot_path(novel_id: str) -> str:
    return f'data/novels/{novel_id}.json'


def to_snapshot(novel: LightNovel, novel_id: str, now: str) -> dict:
    volumes = [
        {
            'index': index,
            'name': volume.name,
            'url': volume.url,
            'cover_url': volume.cover_img,
            'chapters': [
                {'name': chapter.name, 'url': chapter.url}
                for chapter in volume.chapters
            ],
        }
        for index, volume in enumerate(novel.volumes)
    ]
    # The core does not parse a novel-level cover; use the first volume's.
    cover_url = next((v['cover_url'] for v in volumes if v['cover_url']), '')
    return {
        'novel_id': novel_id,
        'name': novel.name,
        'url': novel.url,
        'author': novel.author,
        'cover_url': cover_url,
        'summary_html': novel.summary,
        'volumes': volumes,
        'fetched_at': now,
    }
