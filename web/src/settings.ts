export type Settings = { owner: string; repo: string; token: string }

const KEY = 'hako2epub.settings'

export function loadSettings(): Settings | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const v = JSON.parse(raw) as Partial<Settings> | null
    if (
      v &&
      typeof v.owner === 'string' &&
      typeof v.repo === 'string' &&
      typeof v.token === 'string'
    ) {
      return { owner: v.owner, repo: v.repo, token: v.token }
    }
    return null
  } catch {
    return null
  }
}

export function saveSettings(s: Settings): void {
  localStorage.setItem(KEY, JSON.stringify(s))
}

export function clearSettings(): void {
  localStorage.removeItem(KEY)
}
