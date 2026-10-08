import { describe, expect, it } from 'vitest'
import { buildDownloadPayload, volumeBadge } from '../src/novel/selection'
import type { LnInfo, Snapshot } from '../src/types'

const ch = (name: string) => ({ name, url: '' })
const snap: Snapshot = {
  novel_id: 'truyen-1',
  name: 'N',
  url: 'https://ln.hako.vn/truyen/1-n',
  author: '',
  cover_url: '',
  summary_html: '',
  fetched_at: '',
  volumes: [
    { index: 0, name: 'V1', url: '', cover_url: '', chapters: [ch('a'), ch('b'), ch('c')] },
    { index: 1, name: 'V2', url: '', cover_url: '', chapters: [ch('x')] },
  ],
}

describe('buildDownloadPayload', () => {
  it('keeps names and null for whole volume', () => {
    expect(buildDownloadPayload(snap, { 0: null, 1: [2, 0] })).toEqual({
      url: snap.url,
      volumes: [
        { index: 0, name: 'V1', chapters: null },
        { index: 1, name: 'V2', chapters: [0, 2] },
      ],
    })
  })
  it('drops volumes with empty chapter list', () => {
    expect(buildDownloadPayload(snap, { 0: [], 1: null }).volumes).toEqual([
      { index: 1, name: 'V2', chapters: null },
    ])
  })
})

describe('volumeBadge', () => {
  const info: LnInfo = {
    ln_list: [
      {
        ln_name: 'N',
        ln_url: snap.url,
        num_vol: 1,
        vol_list: [{ vol_name: 'V1', num_chapter: 2, chapter_list: ['a', 'b'] }],
      },
    ],
  }
  it('counts new chapters via tracker.newChapters', () => {
    expect(volumeBadge(info, snap, 0)).toEqual({ tracked: true, newCount: 1 })
  })
  it('untracked volume has no new count', () => {
    expect(volumeBadge(info, snap, 1)).toEqual({ tracked: false, newCount: 0 })
  })
})
