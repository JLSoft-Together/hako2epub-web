import pytest
import responses
from hako2epub.net import NetworkError, NetworkManager

from hako_worker.net import AssetNetwork

PNG = b'\x89PNG\r\n\x1a\n' + b'0' * 32
URL = 'https://i.imgur.com/50rC5sY.png'


def make(sleeps=None):
    sleeps = [] if sleeps is None else sleeps
    return AssetNetwork(image_delay=0, sleep=sleeps.append), sleeps


@responses.activate
def test_imgur_fetched_with_plain_session_and_image_accept():
    responses.add(responses.GET, URL, body=PNG, content_type='image/png')
    net, _ = make()
    data, ctype = net.get_bytes(URL, referer='https://ln.hako.vn')
    assert data == PNG and ctype == 'image/png'
    req = responses.calls[0].request
    assert req.headers['Accept'].startswith('image/avif,image/webp')
    assert req.headers['Referer'] == 'https://ln.hako.vn'


@responses.activate
def test_html_response_is_rejected():
    responses.add(responses.GET, URL, body=b'<html></html>', content_type='text/html')
    net, _ = make()
    with pytest.raises(NetworkError, match='Not an image'):
        net.get_bytes(URL)


@responses.activate
def test_magic_bytes_accepted_without_content_type():
    responses.add(responses.GET, URL, body=PNG, content_type='application/octet-stream')
    net, _ = make()
    assert net.get_bytes(URL)[0] == PNG


@responses.activate
def test_retries_then_succeeds():
    responses.add(responses.GET, URL, status=503)
    responses.add(responses.GET, URL, body=PNG, content_type='image/png')
    net, sleeps = make()
    assert net.get_bytes(URL)[0] == PNG
    assert len(sleeps) == 1


@responses.activate
def test_gives_up_after_asset_max_retries():
    from hako2epub.constants import ASSET_MAX_RETRIES
    responses.add(responses.GET, URL, status=500)
    net, _ = make()
    with pytest.raises(NetworkError):
        net.get_bytes(URL)
    assert len(responses.calls) == ASSET_MAX_RETRIES


def test_hako_host_delegates_to_core(monkeypatch):
    calls = []

    def fake(self, url, referer=None):
        calls.append(url)
        return b'<html>', 'text/html'

    monkeypatch.setattr(NetworkManager, 'get_bytes', fake)
    net, _ = make()
    with pytest.raises(NetworkError, match='Not an image'):
        net.get_bytes('https://i.docln.net/a.jpg')
    assert calls == ['https://i.docln.net/a.jpg']
