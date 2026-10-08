import { useState } from 'react'
import { GitHubClient, GitHubError } from '../github/client'
import { navigate, useHashRoute } from '../router'
import { clearSettings, loadSettings, saveSettings, type Settings } from '../settings'
import { INFO_PATH } from '../types'

type Check = Awaited<ReturnType<GitHubClient['checkSetup']>>

export type SetupProps = {
  makeClient?: (s: Settings) => Pick<GitHubClient, 'checkSetup' | 'updateJson'>
}

const NAME_RE = /^[A-Za-z0-9_.-]+$/
const AUTH_MSG = 'Token sai hoặc hết hạn'
const STORAGE_MSG = 'Không lưu được cài đặt trên trình duyệt này'

export function parseRepo(input: string): { owner: string; repo: string } | string {
  const parts = input.trim().split('/')
  if (parts.length !== 2 || !parts[0] || !parts[1]) return 'Nhập repo dạng owner/repo'
  if (!NAME_RE.test(parts[0]) || !NAME_RE.test(parts[1])) {
    return 'Owner/repo chỉ gồm chữ, số, dấu gạch ngang, gạch dưới và dấu chấm'
  }
  return { owner: parts[0], repo: parts[1] }
}

export default function Setup({ makeClient = (s) => new GitHubClient(s) }: SetupProps) {
  const route = useHashRoute()
  const saved = loadSettings()
  const [repoInput, setRepoInput] = useState(saved ? `${saved.owner}/${saved.repo}` : '')
  const [token, setToken] = useState('')
  const [repoErr, setRepoErr] = useState<string | null>(null)
  const [tokenErr, setTokenErr] = useState<string | null>(null)
  const [authErr, setAuthErr] = useState(route.params.get('reason') === 'auth')
  const [formErr, setFormErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [check, setCheck] = useState<Check | null>(null)
  const [pending, setPending] = useState<Settings | null>(null)

  const persist = (s: Settings): boolean => {
    try {
      saveSettings(s)
      return true
    } catch {
      setFormErr(STORAGE_MSG)
      return false
    }
  }

  const validate = (): Settings | null => {
    const parsed = parseRepo(repoInput)
    const t = token.trim()
    setRepoErr(typeof parsed === 'string' ? parsed : null)
    setTokenErr(t ? null : 'Nhập token (PAT)')
    if (typeof parsed === 'string' || !t) return null
    return { ...parsed, token: t }
  }

  const fail = (e: unknown) => {
    if (e instanceof GitHubError && e.kind === 'auth') {
      try {
        clearSettings()
      } catch {
        setFormErr(STORAGE_MSG)
      }
      setAuthErr(true)
    } else {
      setFormErr(e instanceof Error ? e.message : String(e))
    }
  }

  const onSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault()
    setFormErr(null)
    setAuthErr(false)
    setCheck(null)
    const s = validate()
    if (!s) return
    setBusy(true)
    try {
      const result = await makeClient(s).checkSetup()
      setCheck(result)
      setPending(s)
      if (result.repoOk && result.canPush && result.missingWorkflows.length === 0 && result.hasLibrary) {
        if (persist(s)) navigate('/')
      }
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
    }
  }

  const createLibrary = async () => {
    if (!pending) return
    setFormErr(null)
    setBusy(true)
    try {
      await makeClient(pending).updateJson(INFO_PATH, (c) => c ?? { ln_list: [] }, 'init library')
      if (persist(pending)) navigate('/')
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
    }
  }

  const items = check
    ? [
        { ok: check.repoOk, label: 'Truy cập được repo' },
        { ok: check.canPush, label: 'Token có quyền ghi' },
        {
          ok: check.missingWorkflows.length === 0,
          label:
            check.missingWorkflows.length === 0
              ? 'Đủ 3 workflow'
              : `Đủ 3 workflow (thiếu: ${check.missingWorkflows.join(', ')})`,
        },
        { ok: check.hasLibrary, label: 'Có thư viện (data/ln_info.json)' },
      ]
    : []
  const onlyLibraryMissing =
    check !== null &&
    check.repoOk &&
    check.canPush &&
    check.missingWorkflows.length === 0 &&
    !check.hasLibrary

  const input = 'w-full rounded border border-gray-300 px-3 py-2 text-base'
  const err = 'mt-1 text-sm text-red-600'

  return (
    <main className="mx-auto max-w-md p-4">
      <h1 className="mb-4 text-xl font-bold">Cài đặt</h1>
      {authErr && (
        <p role="alert" className="mb-3 rounded bg-red-100 px-3 py-2 text-red-800">
          {AUTH_MSG}
        </p>
      )}
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <div>
          <label htmlFor="repo" className="mb-1 block text-sm font-medium">
            Repo thư viện (owner/repo)
          </label>
          <input
            id="repo"
            className={input}
            value={repoInput}
            onChange={(e) => setRepoInput(e.target.value)}
            autoCapitalize="none"
            autoCorrect="off"
            placeholder="ten-ban/hako-library"
          />
          {repoErr && <p className={err}>{repoErr}</p>}
        </div>
        <div>
          <label htmlFor="token" className="mb-1 block text-sm font-medium">
            Token (PAT)
          </label>
          <input
            id="token"
            type="password"
            className={input}
            value={token}
            onChange={(e) => setToken(e.target.value)}
            autoComplete="off"
          />
          {tokenErr && <p className={err}>{tokenErr}</p>}
        </div>
        <button
          type="submit"
          disabled={busy}
          className="rounded bg-blue-600 px-4 py-2 font-medium text-white disabled:opacity-50"
        >
          {busy ? 'Đang kiểm tra…' : 'Kiểm tra và lưu'}
        </button>
      </form>
      {formErr && <p className={err}>{formErr}</p>}
      {check && (
        <ul className="mt-4 space-y-1">
          {items.map((i) => (
            <li key={i.label} className={i.ok ? 'text-green-700' : 'text-red-700'}>
              {i.ok ? '✓' : '✗'} {i.label}
            </li>
          ))}
        </ul>
      )}
      {onlyLibraryMissing && (
        <button
          type="button"
          onClick={createLibrary}
          disabled={busy}
          className="mt-4 rounded bg-green-600 px-4 py-2 font-medium text-white disabled:opacity-50"
        >
          Tạo thư viện trống
        </button>
      )}
    </main>
  )
}
