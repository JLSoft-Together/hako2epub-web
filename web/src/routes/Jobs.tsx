import { useState } from 'react'
import { useCancelJob, useJobs } from '../data/queries'
import { phaseLabel } from '../format'
import { loadSettings } from '../settings'
import type { Job, JobPhase } from '../jobs'
import type { JobKind, ProgressResult } from '../types'

const PHASE_LABEL: Record<JobPhase, string> = {
  dispatching: 'Đang gửi',
  queued: 'Đang chờ',
  running: 'Đang chạy',
  done: 'Xong',
  failed: 'Lỗi',
  cancelled: 'Đã huỷ',
  lost: 'Chưa thấy job sau 60 giây',
}
const KIND_LABEL: Record<JobKind, string> = { inspect: 'Đọc truyện', download: 'Tải', update: 'Cập nhật' }

function Bar({ label, done, total }: { label: string; done: number; total: number }) {
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0
  return (
    <div className="text-xs">
      <div className="flex justify-between">
        <span>{label}</span>
        <span>
          {done}/{total}
        </span>
      </div>
      <div className="h-2 rounded bg-gray-200">
        <div className="h-2 rounded bg-blue-600" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function resultName(r: ProgressResult): string {
  return 'volume' in r ? r.volume : r.novel
}

function JobRow({ job }: { job: Job }) {
  const cancel = useCancelJob()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const p = job.progress
  const settings = loadSettings()
  // Inspect labels are the canonical URL; show the novel name once the worker knows it.
  const title = job.kind === 'inspect' ? p?.novel || job.label : job.label || p?.novel
  const canCancel = job.run !== undefined && (job.phase === 'queued' || job.phase === 'running')

  const onCancel = async () => {
    setBusy(true)
    setErr(null)
    try {
      await cancel(job)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="space-y-2 rounded border border-gray-200 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="font-medium">{KIND_LABEL[job.kind]}</div>
          {title && <div className="truncate text-sm text-gray-600">{title}</div>}
        </div>
        <span className="shrink-0 text-sm">{PHASE_LABEL[job.phase]}</span>
      </div>

      {job.phase === 'lost' && settings && (
        <a
          className="text-sm text-blue-700 underline"
          href={`https://github.com/${settings.owner}/${settings.repo}/actions`}
          target="_blank"
          rel="noreferrer"
        >
          Xem log trên GitHub
        </a>
      )}

      {p && (
        <div className="space-y-1">
          {p.phase && <div className="text-xs text-gray-600">{phaseLabel(p.phase)}</div>}
          {p.chapters.total > 0 && <Bar label="Chương" done={p.chapters.done} total={p.chapters.total} />}
          {p.volumes.total > 0 && <Bar label="Tập" done={p.volumes.done} total={p.volumes.total} />}
          {p.results.length > 0 && (
            <ul className="text-sm">
              {p.results.map((r, i) => (
                <li key={i} className={r.ok ? '' : 'text-red-700'}>
                  {r.ok ? '✓' : '✗'} {resultName(r)}
                  {!r.ok && `: ${r.error}`}
                </li>
              ))}
            </ul>
          )}
          {p.error && <div className="text-sm text-red-700">{p.error}</div>}
          {p.log.length > 0 && (
            <details>
              <summary className="cursor-pointer text-xs text-gray-600">Log</summary>
              <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap text-xs">
                {p.log.slice(-20).join('\n')}
              </pre>
            </details>
          )}
        </div>
      )}

      <div className="flex items-center gap-3">
        {canCancel && (
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="rounded border border-red-600 px-2 py-1 text-sm text-red-700 disabled:opacity-50"
          >
            Huỷ
          </button>
        )}
        {job.run && (
          <a
            className="text-sm text-blue-700 underline"
            href={job.run.html_url}
            target="_blank"
            rel="noreferrer"
          >
            Xem log trên GitHub
          </a>
        )}
      </div>
      {err && <div className="text-sm text-red-700">{err}</div>}
    </li>
  )
}

export default function Jobs() {
  const { jobs } = useJobs()
  return (
    <main className="mx-auto max-w-2xl space-y-3 p-4">
      <h1 className="text-xl font-semibold">Tác vụ</h1>
      {jobs.length === 0 ? (
        <p className="text-gray-600">Chưa có tác vụ nào</p>
      ) : (
        <ul className="space-y-3">
          {jobs.map((j) => (
            <JobRow key={j.requestId || j.run?.id} job={j} />
          ))}
        </ul>
      )}
    </main>
  )
}
