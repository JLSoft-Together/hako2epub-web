import base64
import json

import pytest
import responses

from hako_worker.github import GitHubClient, GitHubError

API = 'https://api.github.com'
REPO = 'me/lib'
CONTENTS = f'{API}/repos/{REPO}/contents'


@pytest.fixture
def client():
    return GitHubClient('tok', REPO, sleep=lambda s: None)


def _b64(obj) -> str:
    return base64.b64encode(json.dumps(obj).encode()).decode()


def _put_bodies():
    return [json.loads(c.request.body) for c in responses.calls
            if c.request.method == 'PUT']


@responses.activate
def test_get_json_missing_returns_none(client):
    responses.get(f'{CONTENTS}/data/x.json', status=404, json={'message': 'Not Found'})
    assert client.get_json('data/x.json') == (None, None)


@responses.activate
def test_get_json_returns_data_and_sha(client):
    responses.get(f'{CONTENTS}/data/x.json',
                  json={'content': _b64({'a': 1}), 'sha': 'S1'})
    assert client.get_json('data/x.json', ref='br') == ({'a': 1}, 'S1')
    req = responses.calls[0].request
    assert 'ref=br' in req.url
    assert req.headers['Authorization'] == 'Bearer tok'
    assert req.headers['Accept'] == 'application/vnd.github+json'
    assert req.headers['X-GitHub-Api-Version'] == '2022-11-28'


@responses.activate
def test_put_json_encodes_and_returns_sha(client):
    responses.put(f'{CONTENTS}/p.json', json={'content': {'sha': 'NEW'}})
    assert client.put_json('p.json', {'t': 'é'}, 'msg', 'OLD', branch='b') == 'NEW'
    body = _put_bodies()[0]
    assert body['sha'] == 'OLD' and body['branch'] == 'b' and body['message'] == 'msg'
    assert base64.b64decode(body['content']).decode() == \
        json.dumps({'t': 'é'}, ensure_ascii=False, indent=2)


@responses.activate
def test_update_json_creates_missing_file(client):
    responses.get(f'{CONTENTS}/d.json', status=404, json={})
    responses.put(f'{CONTENTS}/d.json', json={'content': {'sha': 'N'}})
    seen = []

    def mutate(cur):
        seen.append(cur)
        return {'new': True}

    assert client.update_json('d.json', mutate, 'm') == {'new': True}
    assert seen == [None]
    assert 'sha' not in _put_bodies()[0]


@responses.activate
def test_update_json_retries_on_conflict(client):
    responses.get(f'{CONTENTS}/d.json', json={'content': _b64({'n': 1}), 'sha': 'S1'})
    responses.get(f'{CONTENTS}/d.json', json={'content': _b64({'n': 2}), 'sha': 'S2'})
    responses.put(f'{CONTENTS}/d.json', status=409, json={'message': 'conflict'})
    responses.put(f'{CONTENTS}/d.json', json={'content': {'sha': 'N'}})
    seen = []

    def mutate(cur):
        seen.append(cur)
        return {'n': cur['n'] + 10}

    assert client.update_json('d.json', mutate, 'm') == {'n': 12}
    assert seen == [{'n': 1}, {'n': 2}]
    assert [b['sha'] for b in _put_bodies()] == ['S1', 'S2']


@responses.activate
def test_update_json_gives_up_after_retries(client):
    responses.get(f'{CONTENTS}/d.json', json={'content': _b64({}), 'sha': 'S'})
    responses.put(f'{CONTENTS}/d.json', status=409, json={'message': 'conflict'})
    with pytest.raises(GitHubError) as ei:
        client.update_json('d.json', lambda c: {}, 'm')
    assert ei.value.status == 409
    assert len(_put_bodies()) == 5


@responses.activate
def test_put_file_overwrites_existing_and_retries_on_conflict(client):
    responses.post(f'{API}/repos/{REPO}/git/refs', status=422,
                   json={'message': 'Reference already exists'})
    responses.get(f'{API}/repos/{REPO}/git/ref/heads/main', json={'object': {'sha': 'M'}})
    responses.get(f'{CONTENTS}/f/a.epub', json={'sha': 'S1'})
    responses.get(f'{CONTENTS}/f/a.epub', json={'sha': 'S2'})
    responses.put(f'{CONTENTS}/f/a.epub', status=409, json={'message': 'conflict'})
    responses.put(f'{CONTENTS}/f/a.epub',
                  json={'content': {'path': 'f/a.epub', 'sha': 'S3', 'size': 3}})
    out = client.put_file('f/a.epub', b'\x00\x01\x02', 'upload')
    assert out == {'path': 'f/a.epub', 'sha': 'S3', 'size': 3}
    bodies = _put_bodies()
    assert [b['sha'] for b in bodies] == ['S1', 'S2']
    assert all(b['branch'] == 'files' for b in bodies)
    assert base64.b64decode(bodies[0]['content']) == b'\x00\x01\x02'


@responses.activate
def test_put_file_creates_branch_once(client):
    responses.get(f'{API}/repos/{REPO}/git/ref/heads/main', json={'object': {'sha': 'M'}})
    responses.post(f'{API}/repos/{REPO}/git/refs', json={})
    responses.get(f'{CONTENTS}/a', status=404, json={})
    responses.get(f'{CONTENTS}/b', status=404, json={})
    responses.put(f'{CONTENTS}/a', json={'content': {'path': 'a', 'sha': '1', 'size': 1}})
    responses.put(f'{CONTENTS}/b', json={'content': {'path': 'b', 'sha': '2', 'size': 1}})
    client.put_file('a', b'x', 'm')
    client.put_file('b', b'y', 'm')
    posts = [c for c in responses.calls
             if c.request.method == 'POST' and c.request.url.endswith('/git/refs')]
    assert len(posts) == 1
    assert json.loads(posts[0].request.body) == {'ref': 'refs/heads/files', 'sha': 'M'}
    assert 'sha' not in _put_bodies()[0]


@responses.activate
def test_get_file_bytes_raw_and_missing(client):
    responses.get(f'{CONTENTS}/f.epub', body=b'\x00raw')
    responses.get(f'{CONTENTS}/gone.epub', status=404, json={})
    assert client.get_file_bytes('f.epub') == b'\x00raw'
    req = responses.calls[0].request
    assert req.headers['Accept'] == 'application/vnd.github.raw'
    assert 'ref=files' in req.url
    assert client.get_file_bytes('gone.epub') is None


@responses.activate
def test_delete_file_missing_is_noop(client):
    responses.get(f'{CONTENTS}/gone', status=404, json={})
    client.delete_file('gone', 'rm')
    responses.get(f'{CONTENTS}/raced', json={'sha': 'S'})
    responses.delete(f'{CONTENTS}/raced', status=404, json={})
    client.delete_file('raced', 'rm')


@responses.activate
def test_delete_file_sends_sha(client):
    responses.get(f'{CONTENTS}/f', json={'sha': 'S'})
    responses.delete(f'{CONTENTS}/f', json={})
    client.delete_file('f', 'rm')
    body = json.loads(responses.calls[1].request.body)
    assert body == {'message': 'rm', 'sha': 'S', 'branch': 'files'}
    assert responses.calls[0].request.headers['Accept'] == 'application/vnd.github.object'


@responses.activate
def test_put_file_sha_lookup_uses_object_accept(client):
    responses.get(f'{API}/repos/{REPO}/git/ref/heads/main', json={'object': {'sha': 'M'}})
    responses.post(f'{API}/repos/{REPO}/git/refs', json={})
    responses.get(f'{CONTENTS}/a', json={'sha': 'S'})
    responses.put(f'{CONTENTS}/a', json={'content': {'path': 'a', 'sha': '1', 'size': 1}})
    client.put_file('a', b'x', 'm')
    get = [c for c in responses.calls if c.request.url.startswith(f'{CONTENTS}/a')][0]
    assert get.request.headers['Accept'] == 'application/vnd.github.object'


@responses.activate
def test_paths_are_url_quoted(client):
    responses.get(f'{CONTENTS}/data/t%20%C4%91.json', status=404, json={})
    assert client.get_json('data/t đ.json') == (None, None)


@responses.activate
def test_get_json_decodes_vietnamese_utf8(client):
    data = {'title': 'Đại Chúa Tể - Tiếng Việt'}
    raw = json.dumps(data, ensure_ascii=False).encode('utf-8')
    responses.get(f'{CONTENTS}/v.json',
                  json={'content': base64.b64encode(raw).decode(), 'sha': 'S'})
    assert client.get_json('v.json') == (data, 'S')


@responses.activate
def test_update_json_retries_on_422(client):
    responses.get(f'{CONTENTS}/d.json', json={'content': _b64({}), 'sha': 'S'})
    responses.put(f'{CONTENTS}/d.json', status=422, json={'message': 'sha mismatch'})
    responses.put(f'{CONTENTS}/d.json', json={'content': {'sha': 'N'}})
    assert client.update_json('d.json', lambda c: {'ok': 1}, 'm') == {'ok': 1}
    assert len(_put_bodies()) == 2


@responses.activate
def test_create_branch_ignores_existing(client):
    responses.get(f'{API}/repos/{REPO}/git/ref/heads/main', json={'object': {'sha': 'M'}})
    responses.post(f'{API}/repos/{REPO}/git/refs', status=422,
                   json={'message': 'Reference already exists'})
    client.create_branch('status/x')


@responses.activate
def test_create_branch_other_422_raises(client):
    responses.get(f'{API}/repos/{REPO}/git/ref/heads/main', json={'object': {'sha': 'M'}})
    responses.post(f'{API}/repos/{REPO}/git/refs', status=422,
                   json={'message': 'Validation Failed'})
    with pytest.raises(GitHubError):
        client.create_branch('status/x')


@responses.activate
def test_delete_branch_missing_is_noop(client):
    responses.delete(f'{API}/repos/{REPO}/git/refs/heads/status/x', status=422, json={})
    client.delete_branch('status/x')
    responses.delete(f'{API}/repos/{REPO}/git/refs/heads/status/y', status=404, json={})
    client.delete_branch('status/y')


@responses.activate
def test_list_branches(client):
    responses.get(f'{API}/repos/{REPO}/git/matching-refs/heads/status/',
                  json=[{'ref': 'refs/heads/status/abc', 'object': {'sha': 'C1'}}])
    responses.get(f'{API}/repos/{REPO}/commits/C1',
                  json={'commit': {'committer': {'date': '2026-01-02T03:04:05Z'}}})
    assert client.list_branches('status/') == [
        {'name': 'status/abc', 'commit_date': '2026-01-02T03:04:05Z'}]


@responses.activate
def test_non_2xx_raises_with_status(client):
    responses.get(f'{CONTENTS}/d.json', status=401, json={'message': 'Bad credentials'})
    with pytest.raises(GitHubError) as ei:
        client.get_json('d.json')
    assert ei.value.status == 401
    assert 'Bad credentials' in str(ei.value)


@responses.activate
def test_get_json_large_file_falls_back_to_raw(client):
    big = {'ln_list': ['x' * 10]}
    responses.get(f'{CONTENTS}/d.json',
                  json={'content': '', 'encoding': 'none', 'sha': 'BIG'})
    responses.get(f'{CONTENTS}/d.json', body=json.dumps(big).encode())
    assert client.get_json('d.json', ref='main') == (big, 'BIG')
    raw_req = responses.calls[1].request
    assert raw_req.headers['Accept'] == 'application/vnd.github.raw'
    assert 'ref=main' in raw_req.url


@responses.activate
def test_request_retries_5xx_then_succeeds():
    sleeps = []
    client = GitHubClient('tok', REPO, sleep=sleeps.append)
    responses.get(f'{CONTENTS}/d.json', status=502, body='bad gateway')
    responses.get(f'{CONTENTS}/d.json', json={'content': _b64({'a': 1}), 'sha': 'S'})
    assert client.get_json('d.json') == ({'a': 1}, 'S')
    assert len(responses.calls) == 2
    assert len(sleeps) == 1 and 1 <= sleeps[0] <= 3


@responses.activate
def test_request_retries_connection_error_up_to_three_attempts():
    import requests as rq
    sleeps = []
    client = GitHubClient('tok', REPO, sleep=sleeps.append)
    for _ in range(3):
        responses.get(f'{CONTENTS}/d.json', body=rq.ConnectionError('reset'))
    with pytest.raises(rq.ConnectionError):
        client.get_json('d.json')
    assert len(responses.calls) == 3
    assert len(sleeps) == 2


@responses.activate
def test_request_gives_up_after_three_5xx(client):
    for _ in range(3):
        responses.get(f'{CONTENTS}/d.json', status=503, body='unavailable')
    with pytest.raises(GitHubError) as ei:
        client.get_json('d.json')
    assert ei.value.status == 503
    assert len(responses.calls) == 3
