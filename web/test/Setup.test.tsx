import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GitHubError } from '../src/github/errors'
import Setup, { parseRepo } from '../src/routes/Setup'

const fill = (repo: string, token: string) => {
  fireEvent.change(screen.getByLabelText(/Repo thư viện/), { target: { value: repo } })
  fireEvent.change(screen.getByLabelText(/Token/), { target: { value: token } })
  fireEvent.click(screen.getByRole('button', { name: /Kiểm tra/ }))
}

describe('Setup', () => {
  beforeEach(() => {
    localStorage.clear()
    window.location.hash = ''
  })
  afterEach(cleanup)

  it('parseRepo splits and validates', () => {
    expect(parseRepo(' me/lib ')).toEqual({ owner: 'me', repo: 'lib' })
    expect(typeof parseRepo('me')).toBe('string')
    expect(typeof parseRepo('me/li b')).toBe('string')
  })

  it('shows validation errors', () => {
    render(<Setup />)
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
    render(<Setup makeClient={makeClient} />)
    fill('me/lib', 'tok')
    await waitFor(() => expect(screen.getByText('Token sai hoặc hết hạn')).toBeTruthy())
  })

  it('offers library creation when only library is missing', async () => {
    const makeClient = () => ({
      checkSetup: async () => ({ repoOk: true, canPush: true, missingWorkflows: [], hasLibrary: false }),
      updateJson: async () => ({}) as never,
    })
    render(<Setup makeClient={makeClient} />)
    fill('me/lib', 'tok')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Tạo thư viện trống' })).toBeTruthy())
    expect(screen.getByText(/✗ Có thư viện/)).toBeTruthy()
  })

  it('shows auth message from ?reason=auth', () => {
    window.location.hash = '#/setup?reason=auth'
    render(<Setup />)
    expect(screen.getByText('Token sai hoặc hết hạn')).toBeTruthy()
  })
})
