"""Image-safe network layer: plain requests for external hosts, image validation."""

import time
from urllib.parse import urlsplit

import requests
from hako2epub.constants import ASSET_BACKOFF, ASSET_MAX_RETRIES, DOMAINS
from hako2epub.net import HEADERS, NetworkError, NetworkManager

IMAGE_ACCEPT = 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8'


def _is_core_host(url: str) -> bool:
    host = urlsplit(url if '://' in url else f'https://{url}').hostname or ''
    return any(host == d or host.endswith('.' + d) for d in DOMAINS)


def _looks_like_image(data: bytes, content_type: str) -> bool:
    if content_type.lower().startswith('image/'):
        return True
    return (
        data.startswith((b'\x89PNG', b'\xff\xd8\xff', b'GIF8'))
        or (data[:4] == b'RIFF' and data[8:12] == b'WEBP')
        or data[4:8] == b'ftyp'
    )


class AssetNetwork(NetworkManager):
    def __init__(self, *args, sleep=time.sleep, **kwargs):
        super().__init__(*args, **kwargs)
        self._sleep = sleep
        self._plain = requests.Session()

    def get_bytes(self, url: str, referer: str | None = None) -> tuple[bytes, str]:
        if _is_core_host(url):
            data, content_type = super().get_bytes(url, referer)
        else:
            data, content_type = self._fetch_plain(url, referer)
        if not _looks_like_image(data, content_type or ''):
            raise NetworkError(f'Not an image: {url} ({content_type}, {len(data)} B)')
        return data, content_type

    def _fetch_plain(self, url: str, referer: str | None) -> tuple[bytes, str]:
        headers = {'User-Agent': HEADERS['User-Agent'], 'Accept': IMAGE_ACCEPT}
        if referer:
            headers['Referer'] = referer
        last: Exception | None = None
        for attempt in range(ASSET_MAX_RETRIES):
            if attempt:
                self._sleep(ASSET_BACKOFF)
            self._throttle(url, self.image_delay)
            try:
                resp = self._plain.get(url, headers=headers, timeout=self.timeout)
                if 200 <= resp.status_code < 300:
                    return resp.content, resp.headers.get('Content-Type', '')
                last = NetworkError(f'HTTP {resp.status_code}')
            except requests.RequestException as exc:
                last = exc
        raise NetworkError(f'Failed to fetch {url}: {last}')
