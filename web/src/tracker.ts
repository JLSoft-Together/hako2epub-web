import type { LnInfo, LnNovel } from './types'

export function findNovel(data: LnInfo, lnUrl: string): LnNovel | null {
  return (data.ln_list ?? []).find((n) => n.ln_url === lnUrl) ?? null
}

function storedChapters(novel: LnNovel | null, volName: string): Set<string> {
  const vol = novel?.vol_list?.find((v) => v.vol_name === volName)
  return new Set((vol?.chapter_list ?? []).filter((n) => n))
}

export function newChapters(data: LnInfo, lnUrl: string, volName: string, live: string[]): string[] {
  const already = storedChapters(findNovel(data, lnUrl), volName)
  return live.filter((name) => !already.has(name))
}

export function removeVolume(data: LnInfo, lnUrl: string, volName: string): LnInfo {
  const ln_list: LnNovel[] = []
  for (const entry of data.ln_list ?? []) {
    if (entry.ln_url !== lnUrl) {
      ln_list.push(entry)
      continue
    }
    const vol_list = (entry.vol_list ?? []).filter((v) => v.vol_name !== volName)
    if (vol_list.length > 0) ln_list.push({ ...entry, num_vol: vol_list.length, vol_list })
  }
  return { ln_list }
}

export function removeNovel(data: LnInfo, lnUrl: string): LnInfo {
  return { ln_list: (data.ln_list ?? []).filter((n) => n.ln_url !== lnUrl) }
}
