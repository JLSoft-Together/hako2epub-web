export type Settings = { owner: string; repo: string; token: string }

const KEY = 'hako2epub.settings'

type Store = 'localStorage' | 'sessionStorage'

function storage(name: Store): Storage | null {
  try {
    return window[name]
  } catch {
    return null
  }
}

function read(name: Store): Settings | null {
  try {
    const raw = storage(name)?.getItem(KEY)
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

function remove(name: Store): void {
  try {
    storage(name)?.removeItem(KEY)
  } catch {
    // storage blocked: nothing to remove
  }
}

// Session-only settings (token not remembered) win over remembered ones.
export function loadSettings(): Settings | null {
  return read('sessionStorage') ?? read('localStorage')
}

// True when the current settings live in localStorage (or nothing is saved yet).
export function isRemembered(): boolean {
  return read('sessionStorage') === null
}

// remember=false keeps the token only for this tab session (sessionStorage).
// Returns false when the browser refused to store them.
export function saveSettings(s: Settings, remember = true): boolean {
  const target: Store = remember ? 'localStorage' : 'sessionStorage'
  const other: Store = remember ? 'sessionStorage' : 'localStorage'
  let ok = false
  try {
    const store = storage(target)
    if (store) {
      store.setItem(KEY, JSON.stringify(s))
      ok = true
    }
  } catch {
    // storage blocked or full
  }
  if (ok) remove(other)
  return ok
}

export function clearSettings(): void {
  remove('localStorage')
  remove('sessionStorage')
}
