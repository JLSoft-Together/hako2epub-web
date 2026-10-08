import { beforeEach, describe, expect, it } from 'vitest'
import { clearSettings, isRemembered, loadSettings, saveSettings } from '../src/settings'

const s = { owner: 'me', repo: 'lib', token: 'ghp_x' }
const KEY = 'hako2epub.settings'

describe('settings', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
  })
  it('returns null when empty', () => {
    expect(loadSettings()).toBeNull()
  })
  it('round-trips', () => {
    expect(saveSettings(s)).toBe(true)
    expect(loadSettings()).toEqual(s)
    expect(localStorage.getItem(KEY)).not.toBeNull()
    expect(sessionStorage.getItem(KEY)).toBeNull()
    expect(isRemembered()).toBe(true)
  })
  it('returns null on corrupt JSON', () => {
    localStorage.setItem(KEY, '{bad')
    expect(loadSettings()).toBeNull()
  })
  it('clears', () => {
    saveSettings(s)
    clearSettings()
    expect(loadSettings()).toBeNull()
  })
  it('remember=false stores in sessionStorage and drops the remembered copy', () => {
    saveSettings({ ...s, token: 'old' })
    saveSettings(s, false)
    expect(localStorage.getItem(KEY)).toBeNull()
    expect(JSON.parse(sessionStorage.getItem(KEY)!)).toEqual(s)
    expect(loadSettings()).toEqual(s)
    expect(isRemembered()).toBe(false)
  })
  it('prefers sessionStorage over localStorage', () => {
    localStorage.setItem(KEY, JSON.stringify({ ...s, token: 'local' }))
    sessionStorage.setItem(KEY, JSON.stringify({ ...s, token: 'session' }))
    expect(loadSettings()?.token).toBe('session')
  })
  it('remember=true removes the session copy', () => {
    saveSettings(s, false)
    saveSettings(s, true)
    expect(sessionStorage.getItem(KEY)).toBeNull()
    expect(localStorage.getItem(KEY)).not.toBeNull()
  })
  it('clear removes both copies', () => {
    localStorage.setItem(KEY, JSON.stringify(s))
    sessionStorage.setItem(KEY, JSON.stringify(s))
    clearSettings()
    expect(localStorage.getItem(KEY)).toBeNull()
    expect(sessionStorage.getItem(KEY)).toBeNull()
  })
})
