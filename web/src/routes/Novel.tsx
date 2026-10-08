import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useClient, useJobs, useLibrary, useSnapshot, useStartJob } from '../data/queries'
import { phaseLabel } from '../format'
import { canonicalUrl, InvalidNovelUrl, novelId } from '../ids'
import { activeInspectId } from '../jobs'
import { navigate, useHashRoute } from '../router'
import { buildDownloadPayload, volumeBadge, type Selection } from '../novel/selection'
import { ActionsNovelSource } from '../novel/source'
import type { Snapshot } from '../types'

const INVALID_URL = 'URL không thuộc ln.hako.vn / docln.net / docln.sbs'

function VolumeRow({
  snapshot,
  volIndex,
  sel,
  setSel,
  tracked,
  newCount,
}: {
  snapshot: Snapshot
  volIndex: number
  sel: Selection
  setSel: (f: (s: Selection) => Selection) => void
  tracked: boolean
  newCount: number
}) {
  const [open, setOpen] = useState(false)
  const vol = snapshot.volumes.find((v) => v.index === volIndex)!
  const cur = sel[volIndex]
  const total = vol.chapters.length
  const count = cur === null ? total : (cur?.length ?? 0)
  const all = cur === null || (total > 0 && count === total)
  const checkRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (checkRef.current) checkRef.current.indeterminate = !all && count > 0
  }, [all, count])

  const toggleVolume = () =>
    setSel((s) => {
      const next = { ...s }
      if (all) delete next[volIndex]
      else next[volIndex] = null
      return next
    })

  const toggleChapter = (i: number) =>
    setSel((s) => {
      const now = s[volIndex]
      const set = new Set(now === null ? vol.chapters.map((_, k) => k) : (now ?? []))
      if (set.has(i)) set.delete(i)
      else set.add(i)
      const next = { ...s }
      if (set.size === 0) delete next[volIndex]
      else if (set.size === total) next[volIndex] = null
      else next[volIndex] = [...set].sort((a, b) => a - b)
      return next
    })

  const chosen = new Set(cur === null ? vol.chapters.map((_, k) => k) : (cur ?? []))

  return (
    <li className="rounded border border-gray-200 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <input ref={checkRef} type="checkbox" checked={all} onChange={toggleVolume} aria-label={vol.name} />
        <span className="font-medium">{vol.name}</span>
        <span className="text-xs text-gray-500">
          {count}/{total} chương
        </span>
        {tracked && <span className="rounded bg-green-100 px-2 text-xs text-green-800">Đã tải</span>}
        {newCount > 0 && (
          <span className="rounded bg-amber-100 px-2 text-xs text-amber-800">+{newCount} chương mới</span>
        )}
        <button type="button" className="ml-auto text-sm underline" onClick={() => setOpen((o) => !o)}>
          {open ? 'Thu gọn' : 'Chọn chương'}
        </button>
      </div>
      {open && (
        <ul className="mt-2 max-h-80 overflow-auto text-sm">
          {vol.chapters.map((c, i) => (
            <li key={i}>
              <label className="flex items-center gap-2 py-0.5">
                <input type="checkbox" checked={chosen.has(i)} onChange={() => toggleChapter(i)} />
                {c.name}
              </label>
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

export default function Novel() {
  const route = useHashRoute()
  const client = useClient()
  const qc = useQueryClient()
  const startJob = useStartJob()
  const library = useLibrary()
  const { jobs } = useJobs()

  const [input, setInput] = useState(route.params.get('url') ?? '')
  const [id, setId] = useState<string | null>(null)
  const [requestId, setRequestId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [sel, setSel] = useState<Selection>({})
  const [downloading, setDownloading] = useState(false)

  const snapQuery = useSnapshot(id)
  const snapshot = snapQuery.data ?? null
  const jobsRef = useRef(jobs)
  useEffect(() => {
    jobsRef.current = jobs
  }, [jobs])
  const source = useMemo(
    () => new ActionsNovelSource(client, startJob, (url) => activeInspectId(jobsRef.current, url)),
    [client, startJob],
  )

  const load = async (raw: string, refresh: boolean) => {
    setError(null)
    setRequestId(null)
    let canonical: string
    try {
      canonical = canonicalUrl(raw)
    } catch (e) {
      setError(e instanceof InvalidNovelUrl ? INVALID_URL : String(e))
      return
    }
    const nid = novelId(canonical)
    if (nid !== id) setSel({})
    setId(nid)
    setBusy(true)
    try {
      const r = await source.getSnapshot(canonical, { refresh })
      setRequestId(r.requestId ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  // Load on mount and whenever ?url= changes while this screen stays mounted.
  const urlParam = route.params.get('url')
  const loadedParam = useRef<string | null>(null)
  useEffect(() => {
    if (!urlParam || urlParam === loadedParam.current) return
    loadedParam.current = urlParam
    setInput(urlParam)
    void load(urlParam, false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlParam])

  // A new snapshot may renumber or rename volumes: drop the old selection.
  const fetchedAt = snapshot?.fetched_at
  useEffect(() => {
    setSel({})
  }, [fetchedAt])

  const job = requestId ? jobs.find((j) => j.requestId === requestId) : undefined
  const phase = job?.phase
  useEffect(() => {
    if (phase === 'done' && id) {
      void qc.invalidateQueries({ queryKey: ['snapshot', id] })
      setRequestId(null)
    }
  }, [phase, id, qc])

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    void load(input, false)
  }

  const inspecting = !!requestId && (!job || job.phase === 'dispatching' || job.phase === 'queued' || job.phase === 'running')
  const failed = job?.phase === 'failed'
  const selectedCount = Object.keys(sel).length
  const allSelected = !!snapshot && snapshot.volumes.length > 0 && snapshot.volumes.every((v) => sel[v.index] === null)

  const toggleAll = () => {
    if (!snapshot) return
    if (allSelected) setSel({})
    else setSel(Object.fromEntries(snapshot.volumes.map((v) => [v.index, null])))
  }

  const onDownload = async () => {
    if (!snapshot) return
    const payload = buildDownloadPayload(snapshot, sel)
    if (payload.volumes.length === 0) return
    setDownloading(true)
    setError(null)
    try {
      await startJob('download', payload, snapshot.name)
      navigate('/jobs')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setDownloading(false)
    }
  }

  return (
    <div className="space-y-4 p-4">
      <h1 className="text-xl font-semibold">Truyện</h1>
      <form onSubmit={onSubmit} className="flex gap-2">
        <input
          className="flex-1 rounded border border-gray-300 px-2 py-1"
          placeholder="https://ln.hako.vn/truyen/..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          aria-label="URL truyện"
        />
        <button type="submit" disabled={busy || !input.trim()} className="rounded bg-blue-600 px-3 py-1 text-white disabled:opacity-50">
          Mở
        </button>
      </form>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      {inspecting && (
        <div className="rounded border border-gray-200 p-3 text-sm">
          <p>Đang đọc truyện…</p>
          {job?.progress && (
            <p className="text-xs text-gray-600">
              {phaseLabel(job.progress.phase)} {job.progress.chapters.done}/{job.progress.chapters.total}
            </p>
          )}
        </div>
      )}
      {failed && (
        <div className="space-y-2 rounded border border-red-200 p-3 text-sm">
          <p className="text-red-600">{job?.progress?.error ?? 'Đọc truyện thất bại'}</p>
          <button type="button" className="rounded border px-3 py-1" onClick={() => void load(input, true)}>
            Thử lại
          </button>
        </div>
      )}

      {snapshot && (
        <>
          <div className="flex gap-3">
            {snapshot.cover_url && (
              <img
                src={snapshot.cover_url}
                alt=""
                loading="lazy"
                referrerPolicy="no-referrer"
                className="h-32 w-24 rounded object-cover"
              />
            )}
            <div className="space-y-1">
              <h2 className="text-lg font-semibold">{snapshot.name}</h2>
              {snapshot.author && (
                <p className="text-sm text-gray-600">Tác giả: {snapshot.author}</p>
              )}
              <p className="text-xs text-gray-500">
                Dữ liệu lúc {new Date(snapshot.fetched_at).toLocaleString('vi-VN')}
              </p>
              <button
                type="button"
                className="rounded border px-3 py-1 text-sm disabled:opacity-50"
                disabled={busy || inspecting}
                onClick={() => void load(input || snapshot.url, true)}
              >
                Làm mới
              </button>
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={allSelected} onChange={toggleAll} />
            Chọn tất cả
          </label>
          <ul className="space-y-2">
            {snapshot.volumes.map((v) => {
              const badge = library.data ? volumeBadge(library.data, snapshot, v.index) : { tracked: false, newCount: 0 }
              return (
                <VolumeRow
                  key={v.index}
                  snapshot={snapshot}
                  volIndex={v.index}
                  sel={sel}
                  setSel={(f) => setSel(f)}
                  {...badge}
                />
              )
            })}
          </ul>
          <button
            type="button"
            className="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50"
            disabled={selectedCount === 0 || downloading}
            onClick={() => void onDownload()}
          >
            Tải
          </button>
        </>
      )}
    </div>
  )
}
