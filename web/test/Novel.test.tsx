import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ClientContext } from '../src/data/queries'
import type { Job } from '../src/jobs'
import Novel from '../src/routes/Novel'
import type { Snapshot } from '../src/types'

const U1 = 'https://ln.hako.vn/truyen/1-mot'
const U2 = 'https://ln.hako.vn/truyen/2-hai'
const snap = (id: string, name: string, url: string, fetched_at = '2026-10-08T00:00:00Z'): Snapshot => ({
  novel_id: id,
  name,
  url,
  author: 'A',
  cover_url: '',
  summary_html: '',
  volumes: [{ index: 0, name: 'Tập 1', url: url + '/v1', cover_url: '', chapters: [{ name: 'C1', url: 'c1' }] }],
  fetched_at,
})
const SNAPS: Record<string, Snapshot> = {
  'data/novels/truyen-1.json': snap('truyen-1', 'Truyện Một', U1),
  'data/novels/truyen-2.json': snap('truyen-2', 'Truyện Hai', U2),
}

let qc: QueryClient
const mkClient = (snaps: Record<string, Snapshot | undefined> = SNAPS) => ({
  getJson: vi.fn(async (path: string) => (snaps[path] ? { data: snaps[path], sha: 's' } : null)),
  listDispatchRuns: vi.fn(async () => []),
  dispatch: vi.fn(async () => undefined),
})
const renderNovel = (client: ReturnType<typeof mkClient>) =>
  render(
    <QueryClientProvider client={qc}>
      <ClientContext.Provider value={client as never}>
        <Novel />
      </ClientContext.Provider>
    </QueryClientProvider>,
  )
const go = (url: string) =>
  act(() => {
    window.location.hash = '#/novel?url=' + encodeURIComponent(url)
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  })

describe('Novel', () => {
  beforeEach(() => {
    qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    localStorage.clear()
    window.location.hash = ''
  })
  afterEach(cleanup)

  it('reloads when ?url= changes while mounted', async () => {
    window.location.hash = '#/novel?url=' + encodeURIComponent(U1)
    renderNovel(mkClient())
    await waitFor(() => expect(screen.getByText('Truyện Một')).toBeTruthy())
    go(U2)
    await waitFor(() => expect(screen.getByText('Truyện Hai')).toBeTruthy())
    expect((screen.getByLabelText('URL truyện') as HTMLInputElement).value).toBe(U2)
  })

  it('resets the selection when the snapshot fetched_at changes', async () => {
    window.location.hash = '#/novel?url=' + encodeURIComponent(U1)
    renderNovel(mkClient())
    await waitFor(() => expect(screen.getByText('Truyện Một')).toBeTruthy())
    const all = screen.getByLabelText('Chọn tất cả') as HTMLInputElement
    fireEvent.click(all)
    expect(all.checked).toBe(true)
    act(() => {
      qc.setQueryData(['snapshot', 'truyen-1'], snap('truyen-1', 'Truyện Một', U1, '2026-10-09T00:00:00Z'))
    })
    await waitFor(() => expect((screen.getByLabelText('Chọn tất cả') as HTMLInputElement).checked).toBe(false))
  })

  it('shows the author with its label when known', async () => {
    window.location.hash = '#/novel?url=' + encodeURIComponent(U1)
    renderNovel(mkClient())
    await waitFor(() => expect(screen.getByText('Tác giả: A')).toBeTruthy())
  })

  it('hides the author line when the worker could not find one', async () => {
    window.location.hash = '#/novel?url=' + encodeURIComponent(U1)
    renderNovel(mkClient({ 'data/novels/truyen-1.json': { ...snap('truyen-1', 'Truyện Một', U1), author: '' } }))
    await waitFor(() => expect(screen.getByText('Truyện Một')).toBeTruthy())
    expect(screen.queryByText(/Tác giả:/)).toBeNull()
  })

  it('reuses a running inspect for the same novel instead of dispatching again', async () => {
    const running: Job = { requestId: 'old', kind: 'inspect', label: U1, dispatchedAt: Date.now(), phase: 'running' }
    qc.setQueryData(['jobs'], [running])
    const client = mkClient({})
    window.location.hash = '#/novel?url=' + encodeURIComponent('docln.net/truyen/1-mot')
    renderNovel(client)
    await waitFor(() => expect(screen.getByText('Đang đọc truyện…')).toBeTruthy())
    expect(client.dispatch).not.toHaveBeenCalled()
  })
})
