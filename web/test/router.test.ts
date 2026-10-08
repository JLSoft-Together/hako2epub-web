import { describe, expect, it } from 'vitest'
import { parseHash } from '../src/router'

describe('parseHash', () => {
  it('empty hash is library', () => {
    expect(parseHash('').name).toBe('library')
    expect(parseHash('#/').name).toBe('library')
  })
  it('parses novel with params', () => {
    const r = parseHash('#/novel?url=https%3A%2F%2Fln.hako.vn%2Ftruyen%2F1-a')
    expect(r.name).toBe('novel')
    expect(r.params.get('url')).toBe('https://ln.hako.vn/truyen/1-a')
  })
  it('parses setup and jobs', () => {
    expect(parseHash('#/setup').name).toBe('setup')
    expect(parseHash('#/jobs').name).toBe('jobs')
  })
  it('unknown route falls back to library', () => {
    expect(parseHash('#/nope').name).toBe('library')
  })
})
