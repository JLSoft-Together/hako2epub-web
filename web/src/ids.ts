// Port of worker/hako_worker/ids.py; must agree on fixtures/ids.json.
const DOMAINS = ['ln.hako.vn', 'docln.net', 'docln.sbs']
const CANONICAL_DOMAIN = 'ln.hako.vn'

export class InvalidNovelUrl extends Error {}

function parse(url: string): { kind: string; slug: string; digits: string } {
  let raw = url.trim()
  if (!raw.includes('://')) raw = `https://${raw}`
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw new InvalidNovelUrl(`Domain không được hỗ trợ: ${JSON.stringify(url)}`)
  }
  const host = parsed.hostname.toLowerCase()
  if (!DOMAINS.includes(host)) {
    throw new InvalidNovelUrl(`Domain không được hỗ trợ: ${host || JSON.stringify(url)}`)
  }
  const segments = parsed.pathname.split('/').filter(Boolean)
  if (segments.length < 2 || !/^[a-z][a-z0-9-]*$/.test(segments[0])) {
    throw new InvalidNovelUrl(`URL không phải trang truyện: ${JSON.stringify(url)}`)
  }
  const [kind, slug] = segments
  const m = /^\d+/.exec(slug)
  if (!m) throw new InvalidNovelUrl(`URL không có ID truyện: ${JSON.stringify(url)}`)
  return { kind, slug, digits: m[0] }
}

export function canonicalUrl(url: string): string {
  const { kind, slug } = parse(url)
  return `https://${CANONICAL_DOMAIN}/${kind}/${slug}`
}

export function novelId(url: string): string {
  const { kind, digits } = parse(canonicalUrl(url))
  return `${kind}-${digits}`
}
