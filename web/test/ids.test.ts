import { describe, expect, it } from 'vitest'
import fixtures from '../../fixtures/ids.json'
import { canonicalUrl, InvalidNovelUrl, novelId } from '../src/ids'

describe('ids shared fixtures', () => {
  for (const f of fixtures as { input: string; canonical: string | null; novel_id: string | null }[]) {
    it(f.input, () => {
      if (f.canonical === null) {
        expect(() => canonicalUrl(f.input)).toThrow(InvalidNovelUrl)
        expect(() => novelId(f.input)).toThrow(InvalidNovelUrl)
      } else {
        expect(canonicalUrl(f.input)).toBe(f.canonical)
        expect(novelId(f.input)).toBe(f.novel_id)
      }
    })
  }
})
