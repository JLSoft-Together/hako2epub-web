import type { GitHubClient } from './github/client'
import type { Asset } from './types'

export async function downloadEpub(client: GitHubClient, asset: Asset, doc: Document = document): Promise<void> {
  const bytes = await client.getFileBytes(asset.path, asset.branch)
  if (!bytes) throw new Error('Không tìm thấy file EPUB trên GitHub')
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/epub+zip' }))
  const a = doc.createElement('a')
  a.href = url
  a.download = asset.filename
  a.style.display = 'none'
  doc.body.appendChild(a)
  try {
    a.click()
  } finally {
    a.remove()
    URL.revokeObjectURL(url)
  }
}
