import { describe, expect, it, vi } from 'vitest'
import { deleteNovel, deleteVolume } from '../src/library-actions'
import type { Asset, LnInfo, LnNovel } from '../src/types'

const mk = (n: string): Asset => ({ branch: 'files', path: `epub/${n}.epub`, sha: 's', filename: `${n}.epub`, size: 1, updated_at: '' })
const novel: LnNovel = {
  ln_name: 'Truyện',
  ln_url: 'https://ln.hako.vn/truyen/1-a',
  num_vol: 2,
  vol_list: [
    { vol_name: 'V1', num_chapter: 1, chapter_list: ['c'], asset: mk('v1') },
    { vol_name: 'V2', num_chapter: 1, chapter_list: ['c'], asset: mk('v2') },
  ],
}

function fakeClient(info: LnInfo) {
  const calls: string[] = []
  const client = {
    deleteFile: vi.fn(async (p: string) => {
      calls.push('delete ' + p)
    }),
    updateJson: vi.fn(async (_p: string, mutate: (c: LnInfo | null) => LnInfo, msg: string) => {
      calls.push('update ' + msg)
      return mutate(info)
    }),
  }
  return { client: client as any, calls }
}

describe('library actions', () => {
  it('deleteVolume tolerates already-deleted file', async () => {
    // client.deleteFile resolves (404 is a no-op inside the client)
    const { client } = fakeClient({ ln_list: [novel] })
    const out = await deleteVolume(client, novel, 'V1')
    expect(out.ln_list[0].vol_list.map((v) => v.vol_name)).toEqual(['V2'])
    expect(client.deleteFile).toHaveBeenCalledWith('epub/v1.epub', 'delete: v1.epub', 'files')
  })

  it('deleteVolume removes novel when last volume goes', async () => {
    const one = { ...novel, num_vol: 1, vol_list: [novel.vol_list[0]] }
    const { client } = fakeClient({ ln_list: [one] })
    expect((await deleteVolume(client, one, 'V1')).ln_list).toEqual([])
  })

  it('deleteVolume volume without asset only updates ln_info', async () => {
    const n = { ...novel, vol_list: [{ ...novel.vol_list[0], asset: undefined }, novel.vol_list[1]] }
    const { client, calls } = fakeClient({ ln_list: [n] })
    await deleteVolume(client, n, 'V1')
    expect(client.deleteFile).not.toHaveBeenCalled()
    expect(calls).toEqual(['update library: remove Truyện / V1'])
  })

  it('deleteNovel deletes every file then updates ln_info', async () => {
    const { client, calls } = fakeClient({ ln_list: [novel] })
    const out = await deleteNovel(client, novel)
    expect(calls).toEqual(['delete epub/v1.epub', 'delete epub/v2.epub', 'update library: remove Truyện'])
    expect(out.ln_list).toEqual([])
  })
})
