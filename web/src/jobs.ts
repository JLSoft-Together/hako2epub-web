import type { GitHubClient, Run, Workflow } from './github/client'
import type { JobKind, Progress } from './types'

export type JobPhase = 'dispatching' | 'queued' | 'running' | 'done' | 'failed' | 'cancelled' | 'lost'
export type PendingJob = { requestId: string; kind: JobKind; label: string; dispatchedAt: number }
export type Job = {
  requestId: string
  kind: JobKind
  label: string
  dispatchedAt: number
  run?: Run
  progress?: Progress
  phase: JobPhase
}

const KEY = 'hako2epub.pending'
export const LOST_AFTER_MS = 60_000
export const PENDING_TTL_MS = 24 * 60 * 60 * 1000
const KINDS: readonly JobKind[] = ['inspect', 'download', 'update']

export function loadPending(): PendingJob[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const v = JSON.parse(raw) as unknown
    if (!Array.isArray(v)) return []
    return v.filter(
      (p): p is PendingJob =>
        !!p &&
        typeof p.requestId === 'string' &&
        KINDS.includes(p.kind) &&
        typeof p.label === 'string' &&
        typeof p.dispatchedAt === 'number',
    )
  } catch {
    return []
  }
}

export function savePending(list: PendingJob[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list))
  } catch {
    // storage blocked: pending tracking is best-effort
  }
}

// Drops entries whose run has been seen and entries older than 24 h.
export function prunePending(list: PendingJob[], runs: Run[], now: number): PendingJob[] {
  const seen = new Set(runs.map((r) => r.display_title))
  return list.filter((p) => !seen.has(p.requestId) && now - p.dispatchedAt < PENDING_TTL_MS)
}

export function kindFromPath(path: string): JobKind {
  const m = /([^/]+)\.yml/.exec(path)
  const name = m?.[1]
  return (KINDS as readonly string[]).includes(name ?? '') ? (name as JobKind) : 'update'
}

export async function startJob(
  client: GitHubClient,
  kind: JobKind,
  payload: unknown,
  label: string,
): Promise<string> {
  const requestId = crypto.randomUUID()
  const job: PendingJob = { requestId, kind, label, dispatchedAt: Date.now() }
  savePending([...loadPending(), job])
  try {
    await client.dispatch(`${kind}.yml` as Workflow, requestId, payload)
  } catch (e) {
    savePending(loadPending().filter((p) => p.requestId !== requestId))
    throw e
  }
  return requestId
}

function phaseOf(
  pending: PendingJob | undefined,
  run: Run | undefined,
  progress: Progress | undefined,
  now: number,
): JobPhase {
  if (!run) return pending && now - pending.dispatchedAt >= LOST_AFTER_MS ? 'lost' : 'dispatching'
  if (run.status === 'queued') return 'queued'
  if (run.status !== 'completed') return 'running'
  if (run.conclusion === 'cancelled') return 'cancelled'
  if (run.conclusion === 'success') return progress?.state === 'failed' ? 'failed' : 'done'
  return 'failed'
}

export function mergeJob(
  pending: PendingJob | undefined,
  run: Run | undefined,
  progress: Progress | undefined,
  now: number,
): Job {
  const requestId = pending?.requestId ?? run?.display_title ?? progress?.request_id ?? ''
  const kind = pending?.kind ?? (run ? kindFromPath(run.path) : (progress?.kind ?? 'update'))
  const dispatchedAt = pending?.dispatchedAt ?? (run ? Date.parse(run.created_at) : now)
  return {
    requestId,
    kind,
    label: pending?.label ?? '',
    dispatchedAt,
    run,
    progress,
    phase: phaseOf(pending, run, progress, now),
  }
}

export const isActive = (p: JobPhase): boolean => p === 'dispatching' || p === 'queued' || p === 'running'
