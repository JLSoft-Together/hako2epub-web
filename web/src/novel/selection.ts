import { findNovel, newChapters } from '../tracker'
import type { DownloadPayload, LnInfo, Snapshot } from '../types'

// volIndex -> null (whole volume) | chapter indexes.
export type Selection = Record<number, number[] | null>

export function buildDownloadPayload(snapshot: Snapshot, sel: Selection): DownloadPayload {
  const volumes: DownloadPayload['volumes'] = []
  for (const vol of snapshot.volumes) {
    if (!(vol.index in sel)) continue
    const chosen = sel[vol.index]
    if (chosen === null) {
      volumes.push({ index: vol.index, name: vol.name, chapters: null })
    } else if (chosen.length > 0) {
      volumes.push({ index: vol.index, name: vol.name, chapters: [...chosen].sort((a, b) => a - b) })
    }
  }
  return { url: snapshot.url, volumes }
}

export function volumeBadge(
  info: LnInfo,
  snapshot: Snapshot,
  volIndex: number,
): { tracked: boolean; newCount: number } {
  const vol = snapshot.volumes.find((v) => v.index === volIndex)
  if (!vol) return { tracked: false, newCount: 0 }
  const novel = findNovel(info, snapshot.url)
  const tracked = !!novel?.vol_list?.some((v) => v.vol_name === vol.name)
  if (!tracked) return { tracked: false, newCount: 0 }
  const newCount = newChapters(info, snapshot.url, vol.name, vol.chapters.map((c) => c.name)).length
  return { tracked, newCount }
}
