"""URL canonicalisation and release-asset naming."""

import hashlib
import re
import unicodedata
from urllib.parse import urlsplit

from hako2epub.constants import DOMAINS

CANONICAL_DOMAIN = 'ln.hako.vn'
_MAX_SLUG = 80


class InvalidNovelUrl(ValueError):
    pass


def _parse(url: str) -> tuple[str, str, str]:
    raw = url.strip()
    if '://' not in raw:
        raw = 'https://' + raw
    parts = urlsplit(raw)
    host = (parts.hostname or '').lower()
    if host not in DOMAINS:
        raise InvalidNovelUrl(f'Domain không được hỗ trợ: {host or url!r}')
    segments = [s for s in parts.path.split('/') if s]
    if len(segments) < 2 or not re.fullmatch(r'[a-z][a-z0-9-]*', segments[0]):
        raise InvalidNovelUrl(f'URL không phải trang truyện: {url!r}')
    kind, slug = segments[0], segments[1]
    m = re.match(r'\d+', slug)
    if not m:
        raise InvalidNovelUrl(f'URL không có ID truyện: {url!r}')
    return kind, slug, m.group(0)


def canonical_url(url: str) -> str:
    kind, slug, _ = _parse(url)
    return f'https://{CANONICAL_DOMAIN}/{kind}/{slug}'


def novel_id(url: str) -> str:
    kind, _, digits = _parse(canonical_url(url))
    return f'{kind}-{digits}'


def asset_name(filename: str) -> str:
    stem = filename[:-5] if filename.lower().endswith('.epub') else filename
    digest = hashlib.sha1(filename.encode('utf-8')).hexdigest()[:8]
    text = stem.replace('đ', 'd').replace('Đ', 'D')
    text = unicodedata.normalize('NFKD', text)
    text = text.encode('ascii', 'ignore').decode('ascii').lower()
    slug = re.sub(r'[^a-z0-9]+', '-', text).strip('-')[:_MAX_SLUG].strip('-')
    return f'{slug or "volume"}-{digest}.epub'
