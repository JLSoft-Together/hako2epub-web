import { createContext, useContext, useSyncExternalStore } from 'react'
import { MutationCache, QueryCache, QueryClient, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { GitHubError } from '../github/errors'
import type { GitHubClient } from '../github/client'
import { navigate } from '../router'
import { clearSettings } from '../settings'
import {
  isActive,
  loadLabels,
  loadPending,
  mergeJob,
  prunePending,
  savePending,
  startJob,
  type Job,
} from '../jobs'
import { INFO_PATH, snapshotPath, type JobKind, type LnInfo, type Progress, type Snapshot } from '../types'

export const ClientContext = createContext<GitHubClient | null>(null)

export function useClient(): GitHubClient {
  const c = useContext(ClientContext)
  if (!c) throw new Error('useClient must be used inside ClientContext.Provider')
  return c
}

// ---- last-error banner store ----
let lastError: string | null = null
const listeners = new Set<() => void>()

export function setLastError(msg: string | null): void {
  lastError = msg
  listeners.forEach((l) => l())
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function useLastError(): { message: string | null; dismiss: () => void } {
  const message = useSyncExternalStore(subscribe, () => lastError, () => null)
  return { message, dismiss: () => setLastError(null) }
}

const pad = (n: number) => String(n).padStart(2, '0')

export function handleError(error: unknown, qc: QueryClient): void {
  if (!(error instanceof GitHubError)) return
  switch (error.kind) {
    case 'auth':
      try {
        clearSettings()
      } catch {
        // storage blocked: still send the user to setup
      }
      navigate('/setup?reason=auth')
      break
    case 'rate_limit': {
      const t = error.resetAt
      setLastError(
        t
          ? `Hết lượt gọi GitHub API, thử lại lúc ${pad(t.getHours())}:${pad(t.getMinutes())}`
          : 'Hết lượt gọi GitHub API, thử lại sau',
      )
      break
    }
    case 'conflict':
      setLastError('Dữ liệu vừa bị thay đổi ở nơi khác, đã tải lại')
      void qc.invalidateQueries({ queryKey: ['library'] })
      break
  }
}

export function createQueryClient(): QueryClient {
  const qc: QueryClient = new QueryClient({
    queryCache: new QueryCache({ onError: (e) => handleError(e, qc) }),
    mutationCache: new MutationCache({ onError: (e) => handleError(e, qc) }),
    defaultOptions: {
      queries: {
        retry: (count, e) => !(e instanceof GitHubError) && count < 2,
        refetchOnWindowFocus: false,
      },
    },
  })
  return qc
}

export function useLibrary(): UseQueryResult<LnInfo> {
  const client = useClient()
  return useQuery({
    queryKey: ['library'],
    queryFn: async () => (await client.getJson<LnInfo>(INFO_PATH))?.data ?? { ln_list: [] },
  })
}

export function useSnapshot(novelId: string | null): UseQueryResult<Snapshot | null> {
  const client = useClient()
  return useQuery({
    queryKey: ['snapshot', novelId],
    enabled: novelId !== null,
    queryFn: async () => (await client.getJson<Snapshot>(snapshotPath(novelId as string)))?.data ?? null,
  })
}

// ---- jobs ----
const POLL_MS = 5000
const LOST_POLL_MS = 15000
const MAX_RUNS = 20
const PROGRESS_WINDOW_MS = 60 * 60 * 1000

export async function fetchJobs(
  client: GitHubClient,
  now = Date.now(),
  prev: Job[] = [],
): Promise<Job[]> {
  const runs = (await client.listDispatchRuns())
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .slice(0, MAX_RUNS)

  // Read pending only after the await so jobs dispatched meanwhile are seen.
  const pending = loadPending()
  const keep = prunePending(pending, runs, now)
  const kept = new Set(keep.map((p) => p.requestId))
  const dropped = new Set(pending.filter((p) => !kept.has(p.requestId)).map((p) => p.requestId))
  if (dropped.size > 0) {
    // Fresh read-modify-write: never overwrite entries added since our snapshot.
    savePending(loadPending().filter((p) => !dropped.has(p.requestId)))
  }

  const prevByRun = new Map<number, Job>()
  for (const j of prev) if (j.run) prevByRun.set(j.run.id, j)

  const progress = await Promise.all(
    runs.map(async (r): Promise<Progress | undefined> => {
      if (r.status === 'completed') {
        // Already fetched once after completion: it is final, reuse it.
        const old = prevByRun.get(r.id)
        if (old?.run?.status === 'completed') return old.progress
        if (now - Date.parse(r.created_at) >= PROGRESS_WINDOW_MS) return undefined
      }
      try {
        return (await client.getJson<Progress>('progress.json', 'status/' + r.display_title))?.data
      } catch (e) {
        if (e instanceof GitHubError && (e.kind === 'auth' || e.kind === 'rate_limit')) throw e
        return undefined
      }
    }),
  )

  const labels = loadLabels(now)
  const byId = new Map(pending.map((p) => [p.requestId, p]))
  const withLabel = (j: Job): Job => (j.label ? j : { ...j, label: labels[j.requestId] ?? '' })
  const fromRuns = runs.map((r, i) =>
    withLabel(mergeJob(byId.get(r.display_title), r, progress[i], now)),
  )
  const seen = new Set(runs.map((r) => r.display_title))
  const waiting = pending
    .filter((p) => !seen.has(p.requestId) && kept.has(p.requestId))
    .map((p) => withLabel(mergeJob(p, undefined, undefined, now)))
    .sort((a, b) => b.dispatchedAt - a.dispatchedAt)
  return [...waiting, ...fromRuns]
}

export function jobsRefetchInterval(jobs: Job[] | undefined): number | false {
  if (!jobs) return false
  if (jobs.some((j) => isActive(j.phase))) return POLL_MS
  // A lost job may still show up late; keep a slow poll while it is unmatched.
  if (jobs.some((j) => j.phase === 'lost')) return LOST_POLL_MS
  return false
}

export function useJobs(): { jobs: Job[]; activeCount: number } {
  const client = useClient()
  const qc = useQueryClient()
  const q = useQuery({
    queryKey: ['jobs'],
    queryFn: () => fetchJobs(client, Date.now(), qc.getQueryData<Job[]>(['jobs'])),
    refetchInterval: (query) => jobsRefetchInterval(query.state.data),
  })
  const jobs = q.data ?? []
  return { jobs, activeCount: jobs.filter((j) => isActive(j.phase)).length }
}

export function useCancelJob(): (job: Job) => Promise<void> {
  const client = useClient()
  const qc = useQueryClient()
  return async (job) => {
    if (!job.run) return
    await client.cancelRun(job.run.id)
    await qc.invalidateQueries({ queryKey: ['jobs'] })
  }
}

export function useStartJob(): (kind: JobKind, payload: unknown, label: string) => Promise<string> {
  const client = useClient()
  const qc = useQueryClient()
  return async (kind, payload, label) => {
    const id = await startJob(client, kind, payload, label)
    await qc.invalidateQueries({ queryKey: ['jobs'] })
    return id
  }
}
