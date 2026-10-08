import { useSyncExternalStore } from 'react'

export type RouteName = 'setup' | 'library' | 'novel' | 'jobs'
export type Route = { name: RouteName; params: URLSearchParams }

const NAMES: readonly RouteName[] = ['setup', 'library', 'novel', 'jobs']

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#/, '')
  const [path = '', query = ''] = raw.split('?', 2)
  const seg = path.replace(/^\/+/, '').replace(/\/+$/, '')
  const name = (NAMES as readonly string[]).includes(seg) ? (seg as RouteName) : 'library'
  return { name, params: new URLSearchParams(query) }
}

function subscribe(cb: () => void): () => void {
  window.addEventListener('hashchange', cb)
  return () => window.removeEventListener('hashchange', cb)
}

const getSnapshot = (): string => window.location.hash

export function useHashRoute(): Route {
  const hash = useSyncExternalStore(subscribe, getSnapshot, () => '')
  return parseHash(hash)
}

export function navigate(path: string): void {
  window.location.hash = '#' + (path.startsWith('/') ? path : '/' + path)
}
