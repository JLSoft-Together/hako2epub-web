import { describe, expect, it, vi } from 'vitest'
import { ActionsNovelSource } from '../src/novel/source'
import type { Snapshot } from '../src/types'

const snap: Snapshot = {
  novel_id: 'truyen-1',
  name: 'N',
  url: 'https://ln.hako.vn/truyen/1-n',
  author: 'A',
  cover_url: '',
  summary_html: '',
  volumes: [],
  fetched_at: '',
}
const mk = (data: Snapshot | null) => {
  const client = { getJson: vi.fn(async () => (data ? { data, sha: 's' } : null)) }
  const start = vi.fn(async () => 'req-1')
  return { client, start, src: new ActionsNovelSource(client as never, start) }
}

describe('ActionsNovelSource', () => {
  it('returns cached snapshot without dispatch', async () => {
    const { src, start, client } = mk(snap)
    const r = await src.getSnapshot('https://docln.net/truyen/1-n')
    expect(r).toEqual({ snapshot: snap })
    expect(start).not.toHaveBeenCalled()
    expect(client.getJson).toHaveBeenCalledWith('data/novels/truyen-1.json')
  })
  it('dispatches inspect on refresh', async () => {
    const { src, start } = mk(snap)
    const r = await src.getSnapshot('https://docln.net/truyen/1-n', { refresh: true })
    expect(start).toHaveBeenCalledWith(
      'inspect',
      { url: 'https://ln.hako.vn/truyen/1-n' },
      'https://ln.hako.vn/truyen/1-n',
    )
    expect(r).toEqual({ snapshot: snap, requestId: 'req-1' })
  })
  it('reuses an active inspect for the same canonical URL instead of dispatching', async () => {
    const client = { getJson: vi.fn(async () => null) }
    const start = vi.fn(async () => 'req-new')
    const findActive = vi.fn((u: string) => (u === 'https://ln.hako.vn/truyen/1-n' ? 'req-old' : undefined))
    const src = new ActionsNovelSource(client as never, start, findActive)
    const r = await src.getSnapshot('https://docln.net/truyen/1-n')
    expect(start).not.toHaveBeenCalled()
    expect(r).toEqual({ snapshot: null, requestId: 'req-old' })
  })
  it('dispatches inspect when no snapshot', async () => {
    const { src, start } = mk(null)
    const r = await src.getSnapshot('https://ln.hako.vn/truyen/1-n')
    expect(start).toHaveBeenCalledWith(
      'inspect',
      { url: 'https://ln.hako.vn/truyen/1-n' },
      'https://ln.hako.vn/truyen/1-n',
    )
    expect(r).toEqual({ snapshot: null, requestId: 'req-1' })
  })
})
