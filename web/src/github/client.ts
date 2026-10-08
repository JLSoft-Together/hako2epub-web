import type { Settings } from '../settings'
import { INFO_PATH, type LnInfo } from '../types'
import { classifyError } from './errors'

export { GitHubError, type ErrorKind } from './errors'

export type Run = {
  id: number
  display_title: string
  status: 'queued' | 'in_progress' | 'completed' | string
  conclusion: 'success' | 'failure' | 'cancelled' | null | string
  html_url: string
  created_at: string
  path: string
}

export type Workflow = 'inspect.yml' | 'download.yml' | 'update.yml'
export const WORKFLOWS: Workflow[] = ['inspect.yml', 'download.yml', 'update.yml']

export type ClientOptions = {
  fetch?: typeof fetch
  sleep?: (ms: number) => Promise<void>
}

const API = 'https://api.github.com'
const RAW_ACCEPT = 'application/vnd.github.raw'
const OBJECT_ACCEPT = 'application/vnd.github.object'

const encPath = (p: string) => p.split('/').map(encodeURIComponent).join('/')
const contents = (p: string) => `contents/${encPath(p)}`
const refQuery = (ref: string) => `?ref=${encodeURIComponent(ref)}`

function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(bin)
}

function fromBase64(b64: string): string {
  const bin = atob(b64.replace(/\s/g, ''))
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))
}

type ReqOpts = { headers?: Record<string, string>; body?: unknown; ok?: number[] }

export class GitHubClient {
  private readonly s: Settings
  private readonly fetchImpl: typeof fetch
  private readonly sleep: (ms: number) => Promise<void>

  constructor(s: Settings, opts: ClientOptions = {}) {
    this.s = s
    this.fetchImpl = opts.fetch ?? ((...a) => fetch(...a))
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
  }

  private url(suffix: string): string {
    return `${API}/repos/${this.s.owner}/${this.s.repo}${suffix ? '/' + suffix : ''}`
  }

  // Throws GitHubError for any status >= 300 not listed in `ok`.
  private async request(method: string, suffix: string, o: ReqOpts = {}): Promise<Response> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.s.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...o.headers,
    }
    const init: RequestInit = { method, headers }
    if (o.body !== undefined) init.body = JSON.stringify(o.body)
    const resp = await this.fetchImpl(this.url(suffix), init)
    if (resp.status >= 300 && !o.ok?.includes(resp.status)) {
      throw classifyError(resp.status, resp.headers, await resp.text().catch(() => ''))
    }
    return resp
  }

  async getJson<T>(path: string, ref = 'main'): Promise<{ data: T; sha: string } | null> {
    const resp = await this.request('GET', contents(path) + refQuery(ref), { ok: [404] })
    if (resp.status === 404) return null
    const payload = (await resp.json()) as { content: string; sha: string }
    return { data: JSON.parse(fromBase64(payload.content)) as T, sha: payload.sha }
  }

  async updateJson<T>(
    path: string,
    mutate: (cur: T | null) => T,
    message: string,
    retries = 5,
  ): Promise<T> {
    for (let attempt = 0; attempt < retries; attempt++) {
      const cur = await this.getJson<T>(path)
      const next = mutate(cur ? cur.data : null)
      const body: Record<string, string> = {
        message,
        content: toBase64(JSON.stringify(next, null, 2)),
        branch: 'main',
      }
      if (cur) body.sha = cur.sha
      const resp = await this.request('PUT', contents(path), { body, ok: [409, 422] })
      if (resp.status < 300) return next
      if (attempt === retries - 1) {
        throw classifyError(resp.status, resp.headers, await resp.text().catch(() => ''))
      }
      await this.sleep(1000 + Math.random() * 2000)
    }
    throw new Error('updateJson: retries must be >= 1')
  }

  async dispatch(workflow: Workflow, requestId: string, payload: unknown): Promise<void> {
    await this.request('POST', `actions/workflows/${workflow}/dispatches`, {
      body: { ref: 'main', inputs: { request_id: requestId, payload: JSON.stringify(payload) } },
    })
  }

  async listDispatchRuns(): Promise<Run[]> {
    const resp = await this.request('GET', 'actions/runs?event=workflow_dispatch&per_page=50')
    const { workflow_runs } = (await resp.json()) as { workflow_runs: Run[] }
    return workflow_runs.map((r) => ({
      id: r.id,
      display_title: r.display_title,
      status: r.status,
      conclusion: r.conclusion,
      html_url: r.html_url,
      created_at: r.created_at,
      path: r.path,
    }))
  }

  async cancelRun(id: number): Promise<void> {
    await this.request('POST', `actions/runs/${id}/cancel`)
  }

  async getFileBytes(path: string, ref = 'files'): Promise<Blob | null> {
    const resp = await this.request('GET', contents(path) + refQuery(ref), {
      headers: { Accept: RAW_ACCEPT },
      ok: [404],
    })
    if (resp.status === 404) return null
    return await resp.blob()
  }

  async deleteFile(path: string, message: string, branch = 'files'): Promise<void> {
    const look = await this.request('GET', contents(path) + refQuery(branch), {
      headers: { Accept: OBJECT_ACCEPT },
      ok: [404],
    })
    if (look.status === 404) return
    const { sha } = (await look.json()) as { sha: string }
    await this.request('DELETE', contents(path), { body: { message, sha, branch }, ok: [404] })
  }

  async checkSetup(): Promise<{
    repoOk: boolean
    canPush: boolean
    missingWorkflows: string[]
    hasLibrary: boolean
  }> {
    const repo = await this.request('GET', '', { ok: [404] })
    if (repo.status === 404) {
      return { repoOk: false, canPush: false, missingWorkflows: [...WORKFLOWS], hasLibrary: false }
    }
    const info = (await repo.json()) as { permissions?: { push?: boolean } }
    const wf = await this.request('GET', 'actions/workflows?per_page=100')
    const { workflows } = (await wf.json()) as { workflows: { path: string }[] }
    const missingWorkflows = WORKFLOWS.filter(
      (name) => !workflows.some((w) => w.path.endsWith(`/${name}`) || w.path === name),
    )
    const library = await this.getJson<LnInfo>(INFO_PATH)
    return {
      repoOk: true,
      canPush: info.permissions?.push === true,
      missingWorkflows,
      hasLibrary: library !== null,
    }
  }
}
