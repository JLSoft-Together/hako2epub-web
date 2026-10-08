import type { GitHubClient } from './github/client'
import { removeNovel, removeVolume } from './tracker'
import { INFO_PATH, type Asset, type LnInfo, type LnNovel } from './types'

const empty = (): LnInfo => ({ ln_list: [] })

const deleteAssetFile = (client: GitHubClient, asset: Asset) =>
  client.deleteFile(asset.path, `delete: ${asset.filename}`, asset.branch)

export async function deleteVolume(client: GitHubClient, novel: LnNovel, volName: string): Promise<LnInfo> {
  const asset = novel.vol_list.find((v) => v.vol_name === volName)?.asset
  if (asset) await deleteAssetFile(client, asset)
  return client.updateJson<LnInfo>(
    INFO_PATH,
    (cur) => removeVolume(cur ?? empty(), novel.ln_url, volName),
    `library: remove ${novel.ln_name} / ${volName}`,
  )
}

export async function deleteNovel(client: GitHubClient, novel: LnNovel): Promise<LnInfo> {
  for (const v of novel.vol_list) if (v.asset) await deleteAssetFile(client, v.asset)
  return client.updateJson<LnInfo>(
    INFO_PATH,
    (cur) => removeNovel(cur ?? empty(), novel.ln_url),
    `library: remove ${novel.ln_name}`,
  )
}
