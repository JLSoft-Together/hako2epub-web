import type { GitHubClient } from '../github/client'
import { canonicalUrl, novelId } from '../ids'
import { snapshotPath, type JobKind, type Snapshot } from '../types'

export { buildDownloadPayload, volumeBadge, type Selection } from './selection'

export interface NovelSource {
  getSnapshot(
    url: string,
    opts?: { refresh?: boolean },
  ): Promise<{ snapshot: Snapshot | null; requestId?: string }>
}

export type StartFn = (kind: JobKind, payload: unknown, label: string) => Promise<string>

// Returns the requestId of a still-active inspect job for this canonical URL, if any.
export type FindActiveInspect = (canonicalUrl: string) => string | undefined

export class ActionsNovelSource implements NovelSource {
  private readonly client: Pick<GitHubClient, 'getJson'>
  private readonly start: StartFn
  private readonly findActive: FindActiveInspect

  constructor(client: Pick<GitHubClient, 'getJson'>, start: StartFn, findActive: FindActiveInspect = () => undefined) {
    this.client = client
    this.start = start
    this.findActive = findActive
  }

  async getSnapshot(
    url: string,
    opts: { refresh?: boolean } = {},
  ): Promise<{ snapshot: Snapshot | null; requestId?: string }> {
    const canonical = canonicalUrl(url)
    const id = novelId(canonical)
    const cached = (await this.client.getJson<Snapshot>(snapshotPath(id)))?.data ?? null
    if (cached && !opts.refresh) return { snapshot: cached }
    // Reuse an inspect still running for this novel (e.g. after leaving and coming back).
    const active = this.findActive(canonical)
    if (active) return { snapshot: cached, requestId: active }
    // The label is always the canonical URL so a running inspect can be found again.
    const requestId = await this.start('inspect', { url: canonical }, canonical)
    return { snapshot: cached, requestId }
  }
}
