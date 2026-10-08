import { describe, expect, it, vi } from 'vitest'
import { GitHubClient } from '../src/github/client'
import { GitHubError } from '../src/github/errors'

const s = { owner: 'me', repo: 'lib', token: 'ghp_x' }
const b64 = (text: string) => {
  const bytes = new TextEncoder().encode(text)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers })

type Call = { url: string; init: RequestInit }
function setup(handler: (call: Call, n: number) => Response) {
  const calls: Call[] = []
  const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(url), init: init ?? {} }
    calls.push(call)
    return handler(call, calls.length)
  })
  const sleep = vi.fn(async (_ms: number) => {})
  const client = new GitHubClient(s, { fetch: fetchMock as unknown as typeof fetch, sleep })
  return { client, calls, sleep }
}
const hdr = (c: Call, k: string) => (c.init.headers as Record<string, string>)[k]

describe('GitHubClient', () => {
  it('classifies 401 as auth', async () => {
    const { client } = setup(() => json(401, { message: 'Bad credentials' }))
    const err = await client.getJson('a.json').catch((e) => e)
    expect(err).toBeInstanceOf(GitHubError)
    expect(err.kind).toBe('auth')
    expect(err.status).toBe(401)
  })

  it('classifies rate limit with resetAt', async () => {
    const { client } = setup(() =>
      json(403, { message: 'rate' }, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1700000000' }),
    )
    const err = await client.getJson('a.json').catch((e) => e)
    expect(err.kind).toBe('rate_limit')
    expect(err.resetAt.getTime()).toBe(1700000000 * 1000)
  })

  it('classifies other 403 as other', async () => {
    const { client } = setup(() => json(403, { message: 'nope' }))
    const err = await client.getJson('a.json').catch((e) => e)
    expect(err.kind).toBe('other')
  })

  it('sends auth headers and encodes path/ref', async () => {
    const { client, calls } = setup(() => json(404, {}))
    await client.getJson('data/a b/ln.json', 'files')
    expect(calls[0].url).toBe(
      'https://api.github.com/repos/me/lib/contents/data/a%20b/ln.json?ref=files',
    )
    expect(hdr(calls[0], 'Authorization')).toBe('Bearer ghp_x')
    expect(hdr(calls[0], 'Accept')).toBe('application/vnd.github+json')
    expect(hdr(calls[0], 'X-GitHub-Api-Version')).toBe('2022-11-28')
  })

  it('getJson returns null on 404', async () => {
    const { client } = setup(() => json(404, { message: 'Not Found' }))
    expect(await client.getJson('x.json')).toBeNull()
  })

  it('getJson decodes Vietnamese UTF-8', async () => {
    const { client } = setup(() =>
      json(200, { content: b64(JSON.stringify({ name: 'Tập 1' })), sha: 'abc' }),
    )
    expect(await client.getJson<{ name: string }>('x.json')).toEqual({
      data: { name: 'Tập 1' },
      sha: 'abc',
    })
  })

  it('getJson decodes base64 containing newlines', async () => {
    const raw = b64(JSON.stringify({ a: 1 }))
    const { client } = setup(() => json(200, { content: raw.slice(0, 4) + '\n' + raw.slice(4), sha: 's' }))
    expect((await client.getJson('x.json'))?.data).toEqual({ a: 1 })
  })

  it('updateJson creates missing file', async () => {
    const { client, calls } = setup((c) =>
      c.init.method === 'PUT' ? json(201, { content: { sha: 'n' } }) : json(404, {}),
    )
    const out = await client.updateJson<{ name: string }>('x.json', () => ({ name: 'Tập 1' }), 'msg')
    expect(out).toEqual({ name: 'Tập 1' })
    const put = calls[1]
    expect(put.init.method).toBe('PUT')
    const body = JSON.parse(put.init.body as string)
    expect('sha' in body).toBe(false)
    expect(body.branch).toBe('main')
    expect(body.message).toBe('msg')
    const decoded = new TextDecoder().decode(Uint8Array.from(atob(body.content), (ch) => ch.charCodeAt(0)))
    expect(decoded).toBe(JSON.stringify({ name: 'Tập 1' }, null, 2))
  })

  it('updateJson retries on 409 with fresh data', async () => {
    let gets = 0
    let puts = 0
    const { client, calls, sleep } = setup((c) => {
      if (c.init.method === 'PUT') {
        puts++
        return puts === 1 ? json(409, { message: 'conflict' }) : json(200, { content: { sha: 'n' } })
      }
      gets++
      return json(200, { content: b64(JSON.stringify({ n: gets })), sha: `sha${gets}` })
    })
    const out = await client.updateJson<{ n: number }>('x.json', (cur) => ({ n: (cur?.n ?? 0) + 10 }), 'm')
    expect(out).toEqual({ n: 12 })
    expect(sleep).toHaveBeenCalledTimes(1)
    const ms = sleep.mock.calls[0][0]
    expect(ms).toBeGreaterThanOrEqual(1000)
    expect(ms).toBeLessThanOrEqual(3000)
    expect(JSON.parse(calls[3].init.body as string).sha).toBe('sha2')
  })

  it('updateJson gives up after 5 attempts with conflict', async () => {
    const { client, calls, sleep } = setup((c) =>
      c.init.method === 'PUT' ? json(422, {}) : json(404, {}),
    )
    const err = await client.updateJson('x.json', () => ({}), 'm').catch((e) => e)
    expect(err.kind).toBe('conflict')
    expect(calls.filter((c) => c.init.method === 'PUT')).toHaveLength(5)
    expect(sleep).toHaveBeenCalledTimes(4)
  })

  it('dispatch posts inputs as strings', async () => {
    const { client, calls } = setup(() => new Response(null, { status: 204 }))
    await client.dispatch('download.yml', 'req1', { url: 'u', volumes: [] })
    expect(calls[0].url).toBe(
      'https://api.github.com/repos/me/lib/actions/workflows/download.yml/dispatches',
    )
    expect(calls[0].init.method).toBe('POST')
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      ref: 'main',
      inputs: { request_id: 'req1', payload: JSON.stringify({ url: 'u', volumes: [] }) },
    })
  })

  it('listDispatchRuns maps runs', async () => {
    const { client, calls } = setup(() =>
      json(200, {
        workflow_runs: [
          { id: 1, display_title: 't', status: 'completed', conclusion: 'success', html_url: 'h', created_at: 'c', path: '.github/workflows/x.yml', extra: 1 },
        ],
      }),
    )
    const runs = await client.listDispatchRuns()
    expect(calls[0].url).toContain('/actions/runs?event=workflow_dispatch&per_page=50')
    expect(runs).toEqual([
      { id: 1, display_title: 't', status: 'completed', conclusion: 'success', html_url: 'h', created_at: 'c', path: '.github/workflows/x.yml' },
    ])
  })

  it('cancelRun posts to cancel', async () => {
    const { client, calls } = setup(() => new Response(null, { status: 202 }))
    await client.cancelRun(7)
    expect(calls[0].url).toBe('https://api.github.com/repos/me/lib/actions/runs/7/cancel')
    expect(calls[0].init.method).toBe('POST')
  })

  it('getFileBytes returns blob with raw accept and null on 404', async () => {
    let n = 0
    const { client, calls } = setup(() =>
      ++n === 1 ? new Response(new Uint8Array([1, 2, 3])) : json(404, {}),
    )
    const blob = await client.getFileBytes('books/a.epub')
    expect(blob).toBeInstanceOf(Blob)
    expect(blob!.size).toBe(3)
    expect(hdr(calls[0], 'Accept')).toBe('application/vnd.github.raw')
    expect(calls[0].url).toContain('/contents/books/a.epub?ref=files')
    expect(await client.getFileBytes('books/a.epub')).toBeNull()
  })

  it('deleteFile deletes with sha', async () => {
    const { client, calls } = setup((c) =>
      c.init.method === 'DELETE' ? json(200, {}) : json(200, { sha: 'zz' }),
    )
    await client.deleteFile('books/a.epub', 'rm')
    expect(hdr(calls[0], 'Accept')).toBe('application/vnd.github.object')
    expect(calls[1].init.method).toBe('DELETE')
    expect(JSON.parse(calls[1].init.body as string)).toEqual({ message: 'rm', sha: 'zz', branch: 'files' })
  })

  it('deleteFile is a no-op when missing', async () => {
    const { client, calls } = setup(() => json(404, {}))
    await client.deleteFile('books/a.epub', 'rm')
    expect(calls).toHaveLength(1)
    const again = setup((c) => (c.init.method === 'DELETE' ? json(404, {}) : json(200, { sha: 'zz' })))
    await again.client.deleteFile('books/a.epub', 'rm')
    expect(again.calls).toHaveLength(2)
  })

  it('checkSetup reports missing workflows', async () => {
    const { client } = setup((c) => {
      if (c.url.endsWith('/repos/me/lib')) return json(200, { permissions: { push: true } })
      if (c.url.includes('/actions/workflows'))
        return json(200, { workflows: [{ path: '.github/workflows/inspect.yml' }, { path: '.github/workflows/download.yml' }] })
      return json(404, {})
    })
    expect(await client.checkSetup()).toEqual({
      repoOk: true,
      canPush: true,
      missingWorkflows: ['update.yml'],
      hasLibrary: false,
    })
  })

  it('checkSetup reports repo missing and propagates auth errors', async () => {
    const missing = setup(() => json(404, {}))
    expect(await missing.client.checkSetup()).toEqual({
      repoOk: false,
      canPush: false,
      missingWorkflows: ['inspect.yml', 'download.yml', 'update.yml'],
      hasLibrary: false,
    })
    const bad = setup(() => json(401, {}))
    expect((await bad.client.checkSetup().catch((e) => e)).kind).toBe('auth')
  })
})
