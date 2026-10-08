import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GitHubError } from '../src/github/errors'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactElement } from 'react'
import Setup, { parseRepo } from '../src/routes/Setup'

let qc: QueryClient
const renderSetup = (ui: ReactElement) =>
  render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)

const fill = (repo: string, token: string) => {
  fireEvent.change(screen.getByLabelText(/Repo thư viện/), { target: { value: repo } })
  fireEvent.change(screen.getByLabelText(/Token/), { target: { value: token } })
  fireEvent.click(screen.getByRole('button', { name: /Kiểm tra/ }))
}

describe('Setup', () => {
  beforeEach(() => {
    qc = new QueryClient()
    localStorage.clear()
    sessionStorage.clear()
    window.location.hash = ''
  })
  afterEach(cleanup)

  it('parseRepo splits and validates', () => {
    expect(parseRepo(' me/lib ')).toEqual({ owner: 'me', repo: 'lib' })
    expect(typeof parseRepo('me')).toBe('string')
    expect(typeof parseRepo('me/li b')).toBe('string')
  })

  it('shows validation errors', () => {
    renderSetup(<Setup />)
    fill('bad', '  ')
    expect(screen.getByText('Nhập repo dạng owner/repo')).toBeTruthy()
    expect(screen.getByText('Nhập token (PAT)')).toBeTruthy()
  })

  it('shows auth message on 401', async () => {
    const makeClient = () => ({
      checkSetup: async () => {
        throw new GitHubError(401, 'auth', 'bad')
      },
      updateJson: async () => ({}) as never,
    })
    renderSetup(<Setup makeClient={makeClient} />)
    fill('me/lib', 'tok')
    await waitFor(() => expect(screen.getByText('Token sai hoặc hết hạn')).toBeTruthy())
  })

  it('offers library creation when only library is missing', async () => {
    const makeClient = () => ({
      checkSetup: async () => ({ repoOk: true, canPush: true, missingWorkflows: [], hasLibrary: false }),
      updateJson: async () => ({}) as never,
    })
    renderSetup(<Setup makeClient={makeClient} />)
    fill('me/lib', 'tok')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Tạo thư viện trống' })).toBeTruthy())
    expect(screen.getByText(/✗ Có thư viện/)).toBeTruthy()
  })

  it('shows auth message from ?reason=auth', () => {
    window.location.hash = '#/setup?reason=auth'
    renderSetup(<Setup />)
    expect(screen.getByText('Token sai hoặc hết hạn')).toBeTruthy()
  })

  it('keeps saved settings on auth error', async () => {
    const saved = { owner: 'a', repo: 'b', token: 'old' }
    localStorage.setItem('hako2epub.settings', JSON.stringify(saved))
    const makeClient = () => ({
      checkSetup: async () => {
        throw new GitHubError(401, 'auth', 'bad')
      },
      updateJson: async () => ({}) as never,
    })
    renderSetup(<Setup makeClient={makeClient} />)
    fill('me/lib', 'tok')
    await waitFor(() => expect(screen.getByText('Token sai hoặc hết hạn')).toBeTruthy())
    expect(JSON.parse(localStorage.getItem('hako2epub.settings')!)).toEqual(saved)
  })

  it('stores settings in sessionStorage when "remember" is unchecked', async () => {
    const makeClient = () => ({
      checkSetup: async () => ({ repoOk: true, canPush: true, missingWorkflows: [], hasLibrary: true }),
      updateJson: async () => ({}) as never,
    })
    renderSetup(<Setup makeClient={makeClient} />)
    const box = screen.getByLabelText('Ghi nhớ token trên trình duyệt này') as HTMLInputElement
    expect(box.checked).toBe(true)
    fireEvent.click(box)
    fill('me/lib', 'tok')
    await waitFor(() => expect(sessionStorage.getItem('hako2epub.settings')).not.toBeNull())
    expect(localStorage.getItem('hako2epub.settings')).toBeNull()
    sessionStorage.clear()
  })

  it('clears query cache after a successful save', async () => {
    qc.setQueryData(['library'], { ln_list: [{ old: true }] })
    const makeClient = () => ({
      checkSetup: async () => ({ repoOk: true, canPush: true, missingWorkflows: [], hasLibrary: true }),
      updateJson: async () => ({}) as never,
    })
    renderSetup(<Setup makeClient={makeClient} />)
    fill('me/lib', 'tok')
    await waitFor(() => expect(localStorage.getItem('hako2epub.settings')).not.toBeNull())
    expect(qc.getQueryData(['library'])).toBeUndefined()
  })
})
