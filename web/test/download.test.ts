import { describe, expect, it, vi } from 'vitest'
import { downloadEpub } from '../src/download'
import type { Asset } from '../src/types'

const asset: Asset = {
  branch: 'files',
  path: 'epub/1/a.epub',
  sha: 's',
  filename: 'Tập 1 - Truyện.epub',
  size: 10,
  updated_at: '',
}

describe('downloadEpub', () => {
  it('uses asset.filename', async () => {
    const client = { getFileBytes: vi.fn().mockResolvedValue(new Blob(['x'])) } as any
    const anchors: HTMLAnchorElement[] = []
    const realCreate = document.createElement.bind(document)
    const doc = {
      createElement: (t: string) => {
        const el = realCreate(t) as HTMLAnchorElement
        el.click = vi.fn()
        anchors.push(el)
        return el
      },
      body: document.body,
    } as unknown as Document
    URL.createObjectURL = vi.fn(() => 'blob:x')
    URL.revokeObjectURL = vi.fn()
    await downloadEpub(client, asset, doc)
    expect(client.getFileBytes).toHaveBeenCalledWith('epub/1/a.epub', 'files')
    expect(anchors[0].download).toBe('Tập 1 - Truyện.epub')
    expect(anchors[0].click).toHaveBeenCalled()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:x')
  })

  it('throws Vietnamese error when file missing', async () => {
    const client = { getFileBytes: vi.fn().mockResolvedValue(null) } as any
    await expect(downloadEpub(client, asset)).rejects.toThrow('Không tìm thấy file EPUB trên GitHub')
  })
})
