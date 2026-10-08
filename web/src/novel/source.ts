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

export class ActionsNovelSource implements NovelSource {
  private readonly client: Pick<GitHubClient, 'getJson'>
  private readonly start: StartFn

  constructor(client: Pick<GitHubClient, 'getJson'>, start: StartFn) {
    this.client = client
    this.start = start
  }

  async getSnapshot(
    url: string,
    opts: { refresh?: boolean } = {},
  ): Promise<{ snapshot: Snapshot | null; requestId?: string }> {
    const canonical = canonicalUrl(url)
    const id = novelId(canonical)
    const cached = (await this.client.getJson<Snapshot>(snapshotPath(id)))?.data ?? null
    if (cached && !opts.refresh) return { snapshot: cached }
    const requestId = await this.start('inspect', { url: canonical }, cached?.name ?? canonical)
    return { snapshot: cached, requestId }
  }
}
