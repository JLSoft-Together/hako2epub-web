import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ClientContext } from '../src/data/queries'
import Library from '../src/routes/Library'
import { INFO_PATH } from '../src/types'

const URL = 'https://ln.hako.vn/truyen/1-mot'

describe('Library', () => {
  afterEach(cleanup)

  it('links each novel title to its Novel screen', async () => {
    const info = { ln_list: [{ ln_name: 'Truyện Một', ln_url: URL, num_vol: 0, vol_list: [] }] }
    const client = {
      getJson: vi.fn(async (path: string) => (path === INFO_PATH ? { data: info, sha: 's' } : null)),
    }
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={qc}>
        <ClientContext.Provider value={client as never}>
          <Library />
        </ClientContext.Provider>
      </QueryClientProvider>,
    )
    const link = await waitFor(() => screen.getByRole('link', { name: 'Truyện Một' }))
    expect(link.getAttribute('href')).toBe(`#/novel?url=${encodeURIComponent(URL)}`)
  })
})
