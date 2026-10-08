"""Minimal GitHub REST client used by the worker (contents, refs, commits)."""

import base64
import json
import random
import time
from typing import Callable
from urllib.parse import quote

import requests

RAW_ACCEPT = 'application/vnd.github.raw'
OBJECT_ACCEPT = 'application/vnd.github.object'


def _q(value: str) -> str:
    return quote(value, safe='/')


def _contents(path: str) -> str:
    return f'contents/{_q(path)}'


class GitHubError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(f'GitHub API error {status}: {message}')
        self.status = status


class GitHubClient:
    def __init__(self, token: str, repo: str, api: str = 'https://api.github.com',
                 session: requests.Session | None = None, sleep=time.sleep):
        self._repo = repo
        self._api = api.rstrip('/')
        self._session = session or requests.Session()
        self._sleep = sleep
        self._headers = {
            'Authorization': f'Bearer {token}',
            'Accept': 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
        }
        self._ensured_branches: set[str] = set()

    # -- plumbing -----------------------------------------------------------

    def _url(self, suffix: str) -> str:
        return f'{self._api}/repos/{self._repo}/{suffix}'

    def _request(self, method: str, suffix: str, ok_status: tuple[int, ...] = (),
                 headers: dict | None = None, **kwargs) -> requests.Response:
        merged = {**self._headers, **(headers or {})}
        resp = self._session.request(method, self._url(suffix), headers=merged,
                                     timeout=60, **kwargs)
        if resp.status_code >= 300 and resp.status_code not in ok_status:
            raise GitHubError(resp.status_code, resp.text)
        return resp

    @staticmethod
    def _encode_json(data: dict) -> bytes:
        return json.dumps(data, ensure_ascii=False, indent=2).encode('utf-8')

    def _sha_of(self, path: str, ref: str) -> str | None:
        # object media type: documented for 1-100 MB files, omits the blob for small ones
        resp = self._request('GET', _contents(path), ok_status=(404,),
                             headers={'Accept': OBJECT_ACCEPT}, params={'ref': ref})
        if resp.status_code == 404:
            return None
        return resp.json()['sha']

    def _put_contents(self, path: str, raw: bytes, message: str, sha: str | None,
                      branch: str) -> requests.Response:
        body = {
            'message': message,
            'content': base64.b64encode(raw).decode('ascii'),
            'branch': branch,
        }
        if sha:
            body['sha'] = sha
        return self._request('PUT', _contents(path), ok_status=(409, 422),
                             json=body)

    # -- json files ---------------------------------------------------------

    def get_json(self, path: str, ref: str = 'main') -> tuple[dict | None, str | None]:
        resp = self._request('GET', _contents(path), ok_status=(404,),
                             params={'ref': ref})
        if resp.status_code == 404:
            return None, None
        payload = resp.json()
        raw = base64.b64decode(payload['content'])
        return json.loads(raw.decode('utf-8')), payload['sha']

    def put_json(self, path: str, data: dict, message: str, sha: str | None,
                 branch: str = 'main') -> str:
        resp = self._put_contents(path, self._encode_json(data), message, sha, branch)
        if resp.status_code >= 300:
            raise GitHubError(resp.status_code, resp.text)
        return resp.json()['content']['sha']

    def update_json(self, path: str, mutate: Callable[[dict | None], dict],
                    message: str, branch: str = 'main', retries: int = 5) -> dict:
        """Read-modify-write with optimistic concurrency (retry on sha conflict)."""
        for attempt in range(retries):
            current, sha = self.get_json(path, ref=branch)
            new = mutate(current)
            resp = self._put_contents(path, self._encode_json(new), message, sha, branch)
            if resp.status_code < 300:
                return new
            if attempt == retries - 1:
                raise GitHubError(resp.status_code, resp.text)
            self._sleep(random.uniform(1, 3))
        raise AssertionError('unreachable')  # retries < 1

    # -- binary files -------------------------------------------------------

    def put_file(self, path: str, data: bytes, message: str, branch: str = 'files',
                 retries: int = 5) -> dict:
        if branch not in self._ensured_branches:
            self.create_branch(branch, from_branch='main')
            self._ensured_branches.add(branch)
        for attempt in range(retries):
            sha = self._sha_of(path, branch)
            resp = self._put_contents(path, data, message, sha, branch)
            if resp.status_code < 300:
                content = resp.json()['content']
                return {'path': content['path'], 'sha': content['sha'],
                        'size': content['size']}
            if attempt == retries - 1:
                raise GitHubError(resp.status_code, resp.text)
            self._sleep(random.uniform(1, 3))
        raise AssertionError('unreachable')  # retries < 1

    def get_file_bytes(self, path: str, ref: str = 'files') -> bytes | None:
        resp = self._request('GET', _contents(path), ok_status=(404,),
                             headers={'Accept': RAW_ACCEPT}, params={'ref': ref})
        if resp.status_code == 404:
            return None
        return resp.content

    def delete_file(self, path: str, message: str, branch: str = 'files') -> None:
        sha = self._sha_of(path, branch)
        if sha is None:
            return
        self._request('DELETE', _contents(path), ok_status=(404,),
                      json={'message': message, 'sha': sha, 'branch': branch})

    # -- branches -----------------------------------------------------------

    def create_branch(self, branch: str, from_branch: str = 'main') -> None:
        ref = self._request('GET', f'git/ref/heads/{_q(from_branch)}').json()
        resp = self._request('POST', 'git/refs', ok_status=(422,),
                             json={'ref': f'refs/heads/{branch}',
                                   'sha': ref['object']['sha']})
        if resp.status_code == 422 and 'already exists' not in resp.text.lower():
            raise GitHubError(resp.status_code, resp.text)

    def delete_branch(self, branch: str) -> None:
        self._request('DELETE', f'git/refs/heads/{_q(branch)}', ok_status=(404, 422))

    def list_branches(self, prefix: str) -> list[dict]:
        refs = self._request('GET', f'git/matching-refs/heads/{_q(prefix)}').json()
        result = []
        for ref in refs:
            commit = self._request('GET', f'commits/{ref["object"]["sha"]}').json()
            result.append({
                'name': ref['ref'].removeprefix('refs/heads/'),
                'commit_date': commit['commit']['committer']['date'],
            })
        return result
