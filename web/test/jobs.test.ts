import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Run } from '../src/github/client'
import { GitHubError } from '../src/github/errors'
import {
  activeInspectId,
  kindFromPath,
  loadPending,
  mergeJob,
  startJob,
  type Job,
  type PendingJob,
} from '../src/jobs'
import type { Progress } from '../src/types'

const NOW = 1_000_000_000_000
const pending = (ageMs: number): PendingJob => ({
  requestId: 'r1',
  kind: 'download',
  label: 'X',
  dispatchedAt: NOW - ageMs,
})
const run = (status: string, conclusion: string | null = null): Run => ({
  id: 7,
  display_title: 'r1',
  status,
  conclusion,
  html_url: 'https://github.com/o/r/actions/runs/7',
  created_at: new Date(NOW - 1000).toISOString(),
  path: '.github/workflows/download.yml',
})
const progress = (state: Progress['state']): Progress => ({
  request_id: 'r1',
  kind: 'download',
  state,
  phase: '',
  novel: '',
  volumes: { done: 0, total: 0 },
  chapters: { done: 0, total: 0 },
  log: [],
  results: [],
  error: null,
  updated_at: '',
})

describe('mergeJob', () => {
  it('no run, < 60s -> dispatching', () => {
    expect(mergeJob(pending(59_999), undefined, undefined, NOW).phase).toBe('dispatching')
  })
  it('no run, >= 60s -> lost', () => {
    expect(mergeJob(pending(60_000), undefined, undefined, NOW).phase).toBe('lost')
  })
  it('queued', () => {
    expect(mergeJob(pending(5000), run('queued'), undefined, NOW).phase).toBe('queued')
  })
  it('in_progress -> running', () => {
    expect(mergeJob(pending(5000), run('in_progress'), undefined, NOW).phase).toBe('running')
  })
  it('in_progress with progress cancelled stays running', () => {
    expect(mergeJob(undefined, run('in_progress'), progress('cancelled'), NOW).phase).toBe('running')
  })
  it('completed cancelled', () => {
    expect(mergeJob(undefined, run('completed', 'cancelled'), undefined, NOW).phase).toBe('cancelled')
  })
  it('completed success -> done', () => {
    expect(mergeJob(undefined, run('completed', 'success'), progress('done'), NOW).phase).toBe('done')
    expect(mergeJob(undefined, run('completed', 'success'), undefined, NOW).phase).toBe('done')
  })
  it('completed success with progress failed -> failed', () => {
    expect(mergeJob(undefined, run('completed', 'success'), progress('failed'), NOW).phase).toBe('failed')
  })
  it('completed other -> failed', () => {
    expect(mergeJob(undefined, run('completed', 'failure'), undefined, NOW).phase).toBe('failed')
    expect(mergeJob(undefined, run('completed', 'timed_out'), undefined, NOW).phase).toBe('failed')
  })
  it('derives identity from run when no pending', () => {
    const j = mergeJob(undefined, run('queued'), undefined, NOW)
    expect(j.requestId).toBe('r1')
    expect(j.kind).toBe('download')
  })
})

describe('activeInspectId', () => {
  const U = 'https://ln.hako.vn/truyen/1-n'
  const job = (over: Partial<Job>): Job => ({
    requestId: 'r',
    kind: 'inspect',
    label: U,
    dispatchedAt: 0,
    phase: 'running',
    ...over,
  })
  it('finds a non-terminal inspect with the same canonical URL', () => {
    expect(activeInspectId([job({ requestId: 'a', phase: 'queued' })], U)).toBe('a')
    expect(activeInspectId([job({ requestId: 'b', phase: 'dispatching' })], U)).toBe('b')
  })
  it('ignores finished jobs, other kinds and other URLs', () => {
    expect(activeInspectId([job({ phase: 'done' }), job({ phase: 'failed' })], U)).toBeUndefined()
    expect(activeInspectId([job({ kind: 'download' })], U)).toBeUndefined()
    expect(activeInspectId([job({ label: U + 'x' })], U)).toBeUndefined()
  })
})

describe('kindFromPath', () => {
  it('maps workflow paths', () => {
    expect(kindFromPath('.github/workflows/download.yml')).toBe('download')
    expect(kindFromPath('.github/workflows/inspect.yml')).toBe('inspect')
    expect(kindFromPath('.github/workflows/update.yml@refs/heads/main')).toBe('update')
  })
})

describe('startJob', () => {
  beforeEach(() => localStorage.clear())
  it('stores pending and dispatches with uuid', async () => {
    const dispatch = vi.fn().mockResolvedValue(undefined)
    const id = await startJob({ dispatch } as never, 'update', { a: 1 }, 'Cập nhật')
    expect(id).toMatch(/^[0-9a-f-]{36}$/)
    expect(dispatch).toHaveBeenCalledWith('update.yml', id, { a: 1 })
    const stored = JSON.parse(localStorage.getItem('hako2epub.pending') as string)
    expect(stored).toHaveLength(1)
    expect(stored[0]).toMatchObject({ requestId: id, kind: 'update', label: 'Cập nhật' })
    expect(loadPending()).toHaveLength(1)
  })
  it('removes pending when dispatch fails', async () => {
    const dispatch = vi.fn().mockRejectedValue(new Error('boom'))
    await expect(startJob({ dispatch } as never, 'inspect', {}, 'x')).rejects.toThrow('boom')
    expect(loadPending()).toHaveLength(0)
  })
  it('maps a 404 dispatch to a missing-workflow message', async () => {
    const dispatch = vi.fn().mockRejectedValue(new GitHubError(404, 'not_found', '{"message":"Not Found"}'))
    await expect(startJob({ dispatch } as never, 'download', {}, 'x')).rejects.toThrow(
      'Repo library thiếu workflow download.yml — xem hướng dẫn cài đặt',
    )
  })
  it('maps a 403 dispatch to a permission message', async () => {
    const dispatch = vi.fn().mockRejectedValue(new GitHubError(403, 'other', '{"message":"Resource not accessible"}'))
    await expect(startJob({ dispatch } as never, 'update', {}, 'x')).rejects.toThrow(
      'Token không có quyền chạy workflow (cần Actions: Read and write)',
    )
  })
  it('keeps rate-limit errors as GitHubError', async () => {
    const err = new GitHubError(403, 'rate_limit', 'limit')
    const dispatch = vi.fn().mockRejectedValue(err)
    await expect(startJob({ dispatch } as never, 'update', {}, 'x')).rejects.toBe(err)
  })
})
