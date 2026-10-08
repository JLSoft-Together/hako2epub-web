import { beforeEach, describe, expect, it } from 'vitest'
import { clearSettings, loadSettings, saveSettings } from '../src/settings'

const s = { owner: 'me', repo: 'lib', token: 'ghp_x' }

describe('settings', () => {
  beforeEach(() => localStorage.clear())
  it('returns null when empty', () => {
    expect(loadSettings()).toBeNull()
  })
  it('round-trips', () => {
    saveSettings(s)
    expect(loadSettings()).toEqual(s)
    expect(localStorage.getItem('hako2epub.settings')).not.toBeNull()
  })
  it('returns null on corrupt JSON', () => {
    localStorage.setItem('hako2epub.settings', '{bad')
    expect(loadSettings()).toBeNull()
  })
  it('clears', () => {
    saveSettings(s)
    clearSettings()
    expect(loadSettings()).toBeNull()
  })
})
