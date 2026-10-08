import { createContext, useContext, useSyncExternalStore } from 'react'
import { MutationCache, QueryCache, QueryClient, useQuery, type UseQueryResult } from '@tanstack/react-query'
import { GitHubError } from '../github/errors'
import type { GitHubClient } from '../github/client'
import { navigate } from '../router'
import { clearSettings } from '../settings'
import { INFO_PATH, snapshotPath, type LnInfo, type Snapshot } from '../types'

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
