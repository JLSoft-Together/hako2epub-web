export type JobKind = 'inspect' | 'download' | 'update'

export type Asset = {
  branch: string
  path: string
  sha: string
  filename: string
  size: number
  updated_at: string
}
export type LnVolume = { vol_name: string; num_chapter: number; chapter_list: string[]; asset?: Asset }
export type LnNovel = { ln_name: string; ln_url: string; num_vol: number; vol_list: LnVolume[] }
export type LnInfo = { ln_list: LnNovel[] }

export type Snapshot = {
  novel_id: string
  name: string
  url: string
  author: string
  cover_url: string
  summary_html: string
  volumes: {
    index: number
    name: string
    url: string
    cover_url: string
    chapters: { name: string; url: string }[]
  }[]
  fetched_at: string
}

export type ProgressResult =
  | {
      volume: string
      ok: true
      chapters: number
      skipped_chapters: number
      images: number
      skipped_images: number
      appended: boolean
    }
  | { volume: string; ok: false; error: string }
  | { novel: string; ok: false; error: string }

export type Progress = {
  request_id: string
  kind: JobKind
  state: 'running' | 'done' | 'failed' | 'cancelled'
  phase: string
  novel: string
  volumes: { done: number; total: number }
  chapters: { done: number; total: number }
  log: string[]
  results: ProgressResult[]
  error: string | null
  updated_at: string
}

// chapters: null = whole volume; [] = skip.
export type DownloadPayload = {
  url: string
  volumes: { index: number; name: string; chapters: number[] | null }[]
}

export const INFO_PATH = 'data/ln_info.json'
export const snapshotPath = (id: string) => `data/novels/${id}.json`
