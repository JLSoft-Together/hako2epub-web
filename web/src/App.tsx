import { useEffect, useMemo, useState } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import JobBadge from './components/JobBadge'
import { ClientContext, createQueryClient, useLastError } from './data/queries'
import { GitHubClient } from './github/client'
import Jobs from './routes/Jobs'
import Library from './routes/Library'
import Novel from './routes/Novel'
import Setup from './routes/Setup'
import { navigate, useHashRoute } from './router'
import { loadSettings } from './settings'

function Banner() {
  const { message, dismiss } = useLastError()
  if (!message) return null
  return (
    <div
      role="alert"
      className="flex items-start justify-between gap-3 bg-amber-100 px-4 py-2 text-sm text-amber-900"
    >
      <span>{message}</span>
      <button type="button" onClick={dismiss} aria-label="Đóng" className="font-bold">
        ×
      </button>
    </div>
  )
}

export default function App() {
  const route = useHashRoute()
  const [queryClient] = useState(createQueryClient)
  // Settings change only via Setup (save then navigate) or an auth error (clear then navigate),
  // both of which change the hash, so re-reading on route change keeps the client fresh.
  const hash = route.name + '?' + route.params.toString()
  const settings = useMemo(() => loadSettings(), [hash]) // eslint-disable-line react-hooks/exhaustive-deps
  const client = useMemo(() => (settings ? new GitHubClient(settings) : null), [settings])
  const needsSetup = route.name !== 'setup' && settings === null

  useEffect(() => {
    if (needsSetup) navigate('/setup')
  }, [needsSetup])

  let page = null
  if (!needsSetup) {
    switch (route.name) {
      case 'setup':
        page = <Setup />
        break
      case 'novel':
        page = <Novel />
        break
      case 'jobs':
        page = <Jobs />
        break
      default:
        page = <Library />
    }
  }

  return (
    <QueryClientProvider client={queryClient}>
      <ClientContext.Provider value={client}>
        <Banner />
        {page && route.name !== 'setup' && (
          <header className="flex items-center justify-between border-b border-gray-200 px-4 py-2">
            <a href="#/" className="font-semibold">
              hako2epub
            </a>
            <nav className="flex items-center gap-3 text-sm">
              <a href="#/novel" className="text-blue-700 underline">
                Thêm truyện
              </a>
              <a href="#/setup" className="text-blue-700 underline">
                Cài đặt
              </a>
              <JobBadge />
            </nav>
          </header>
        )}
        {page}
      </ClientContext.Provider>
    </QueryClientProvider>
  )
}
