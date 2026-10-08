import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { fetchJobs, hasNewlyDone, jobsRefetchInterval, pollJobs } from '../src/data/queries'
import { GitHubError } from '../src/github/errors'
import type { Run } from '../src/github/client'
import { loadLabels, loadPending, prunePending, savePending, startJob } from '../src/jobs'

const NOW = 1_700_000_000_000
const mkRun = (id: number, over: Partial<Run> = {}): Run => ({
  id,
  display_title: `req-${id}`,
  status: 'in_progress',
  conclusion: null,
  html_url: `https://github.com/o/r/actions/runs/${id}`,
  created_at: new Date(NOW - id * 1000).toISOString(),
  path: '.github/workflows/download.yml',
  ...over,
})
const progressBody = { request_id: 'x', state: 'running' }
function fakeClient(runs: () => Promise<Run[]> | Run[], getJson = vi.fn().mockResolvedValue({ data: progressBody, sha: 's' })) {
  return {
    listDispatchRuns: vi.fn(async () => runs()),
    getJson,
    dispatch: vi.fn().mockResolvedValue(undefined),
  }
}
const pend = (id: string, age = 1000) => ({ requestId: id, kind: 'download' as const, label: 'L-' + id, dispatchedAt: NOW - age })

beforeEach(() => localStorage.clear())

describe('prunePending', () => {
  it('drops entries whose run was seen', () => {
    const out = prunePending([pend('req-1'), pend('zzz')], [mkRun(1)], NOW)
    expect(out.map((p) => p.requestId)).toEqual(['zzz'])
  })
  it('expires after 24h', () => {
    const out = prunePending([pend('a', 24 * 3600_000), pend('b', 24 * 3600_000 - 1)], [], NOW)
    expect(out.map((p) => p.requestId)).toEqual(['b'])
  })
})

describe('fetchJobs', () => {
  it('keeps a job dispatched while listDispatchRuns is in flight', async () => {
    let release!: (r: Run[]) => void
    const client = fakeClient(() => new Promise<Run[]>((r) => (release = r)))
    savePending([pend('old')])
    const p = fetchJobs(client as never, NOW)
    await startJob(client as never, 'update', {}, 'new one')
    release([])
    const jobs = await p
    const ids = loadPending().map((x) => x.requestId)
    expect(ids).toHaveLength(2)
    expect(ids).toContain('old')
    expect(jobs).toHaveLength(2)
  })

  it('does not erase a concurrent entry when dropping a seen one', async () => {
    let release!: (r: Run[]) => void
    const client = fakeClient(() => new Promise<Run[]>((r) => (release = r)))
    savePending([pend('req-1')])
    const p = fetchJobs(client as never, NOW)
    await startJob(client as never, 'update', {}, 'n')
    release([mkRun(1)])
    await p
    const ids = loadPending().map((x) => x.requestId)
    expect(ids).toHaveLength(1)
    expect(ids).not.toContain('req-1')
  })

  it('caps to 20 most recent runs, newest first', async () => {
    const runs = Array.from({ length: 30 }, (_, i) => mkRun(i + 1))
    const jobs = await fetchJobs(fakeClient(() => runs) as never, NOW)
    expect(jobs).toHaveLength(20)
    expect(jobs[0]?.run?.id).toBe(1)
  })

  it('lists foreign runs without pending', async () => {
    const jobs = await fetchJobs(fakeClient(() => [mkRun(3)]) as never, NOW)
    expect(jobs[0]).toMatchObject({ requestId: 'req-3', kind: 'download', phase: 'running' })
  })

  it('lost -> running when the run appears late', async () => {
    savePending([pend('req-5', 120_000)])
    const first = await fetchJobs(fakeClient(() => []) as never, NOW)
    expect(first[0]?.phase).toBe('lost')
    expect(jobsRefetchInterval(first)).toBe(15000)
    expect(loadPending()).toHaveLength(1)
    const second = await fetchJobs(fakeClient(() => [mkRun(5)]) as never, NOW, first)
    expect(second[0]).toMatchObject({ phase: 'running', label: 'L-req-5' })
    expect(loadPending()).toHaveLength(0)
  })

  it('polls 5s when active, off when idle', () => {
    expect(jobsRefetchInterval(undefined)).toBe(false)
    expect(jobsRefetchInterval([])).toBe(false)
  })

  it('does not refetch progress for runs already final', async () => {
    const done = mkRun(1, { status: 'completed', conclusion: 'success' })
    const client = fakeClient(() => [done])
    const first = await fetchJobs(client as never, NOW)
    expect(client.getJson).toHaveBeenCalledTimes(1)
    await fetchJobs(client as never, NOW + 5000, first)
    expect(client.getJson).toHaveBeenCalledTimes(1)
  })

  it('does one final fetch when a run completes', async () => {
    const client = fakeClient(() => [mkRun(1)])
    const first = await fetchJobs(client as never, NOW)
    const client2 = fakeClient(() => [mkRun(1, { status: 'completed', conclusion: 'success' })], client.getJson)
    await fetchJobs(client2 as never, NOW + 5000, first)
    expect(client.getJson).toHaveBeenCalledTimes(2)
  })

  it('skips progress for runs completed over an hour ago', async () => {
    const old = mkRun(1, { status: 'completed', conclusion: 'success', created_at: new Date(NOW - 2 * 3600_000).toISOString() })
    const client = fakeClient(() => [old])
    await fetchJobs(client as never, NOW)
    expect(client.getJson).not.toHaveBeenCalled()
  })

  it('rethrows auth and rate_limit from progress, swallows others', async () => {
    const auth = new GitHubError(401, 'auth', 'x')
    const getJson = vi.fn().mockRejectedValue(auth)
    await expect(fetchJobs(fakeClient(() => [mkRun(1)], getJson) as never, NOW)).rejects.toBe(auth)
    const other = vi.fn().mockRejectedValue(new Error('net'))
    const jobs = await fetchJobs(fakeClient(() => [mkRun(1)], other) as never, NOW)
    expect(jobs[0]?.progress).toBeUndefined()
  })

  it('labels persist across reload via localStorage', async () => {
    const client = fakeClient(() => [])
    const id = await startJob(client as never, 'update', {}, 'Saved')
    savePending([])
    expect(loadLabels()[id]).toBe('Saved')
    const jobs = await fetchJobs(fakeClient(() => [mkRun(1, { display_title: id })]) as never, Date.now())
    expect(jobs[0]?.label).toBe('Saved')
  })
})

describe('pollJobs', () => {
  it('invalidates library and snapshots when a job turns done', async () => {
    const qc = new QueryClient()
    const spy = vi.spyOn(qc, 'invalidateQueries')
    let run = mkRun(1)
    const client = fakeClient(() => [run])
    qc.setQueryData(['jobs'], await pollJobs(client as never, qc, NOW))
    expect(spy).not.toHaveBeenCalled()
    run = mkRun(1, { status: 'completed', conclusion: 'success' })
    qc.setQueryData(['jobs'], await pollJobs(client as never, qc, NOW))
    const keys = spy.mock.calls.map((c) => c[0]?.queryKey)
    expect(keys).toEqual([['library'], ['snapshot']])
    spy.mockClear()
    await pollJobs(client as never, qc, NOW) // already done: no repeat
    expect(spy).not.toHaveBeenCalled()
  })
  it('hasNewlyDone ignores the first load', () => {
    const done = [{ requestId: 'a', phase: 'done' }] as never
    expect(hasNewlyDone(undefined, done)).toBe(false)
    expect(hasNewlyDone([{ requestId: 'a', phase: 'running' }] as never, done)).toBe(true)
  })
})
