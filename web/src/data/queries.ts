import { createContext, useContext, useSyncExternalStore } from 'react'
import { MutationCache, QueryCache, QueryClient, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { GitHubError } from '../github/errors'
import type { GitHubClient } from '../github/client'
import { navigate } from '../router'
import { clearSettings } from '../settings'
import {
  isActive,
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
const MAX_RUNS = 20
const PROGRESS_WINDOW_MS = 60 * 60 * 1000
const labels = new Map<string, string>()

export async function fetchJobs(client: GitHubClient, now = Date.now()): Promise<Job[]> {
  const pending = loadPending()
  for (const p of pending) labels.set(p.requestId, p.label)
  const runs = (await client.listDispatchRuns())
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .slice(0, MAX_RUNS)
  const fresh = prunePending(pending, runs, now)
  if (fresh.length !== pending.length) savePending(fresh)

  const progress = await Promise.all(
    runs.map(async (r): Promise<Progress | undefined> => {
      const recent = now - Date.parse(r.created_at) < PROGRESS_WINDOW_MS
      if (r.status === 'completed' && !recent) return undefined
      try {
        return (await client.getJson<Progress>('progress.json', 'status/' + r.display_title))?.data
      } catch {
        return undefined
      }
    }),
  )

  const byId = new Map(pending.map((p) => [p.requestId, p]))
  const fromRuns = runs.map((r, i) => {
    const job = mergeJob(byId.get(r.display_title), r, progress[i], now)
    return job.label ? job : { ...job, label: labels.get(job.requestId) ?? '' }
  })
  const waiting = fresh.map((p) => mergeJob(p, undefined, undefined, now))
  return [...waiting.sort((a, b) => b.dispatchedAt - a.dispatchedAt), ...fromRuns]
}

export function useJobs(): { jobs: Job[]; activeCount: number } {
  const client = useClient()
  const q = useQuery({
    queryKey: ['jobs'],
    queryFn: () => fetchJobs(client),
    refetchInterval: (query) => (query.state.data?.some((j) => isActive(j.phase)) ? POLL_MS : false),
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
