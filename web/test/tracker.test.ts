import { describe, expect, it } from 'vitest'
import findNovelCases from '../../fixtures/tracker/find_novel.json'
import newChaptersCases from '../../fixtures/tracker/new_chapters.json'
import removeNovelCases from '../../fixtures/tracker/remove_novel.json'
import removeVolumeCases from '../../fixtures/tracker/remove_volume.json'
import { findNovel, newChapters, removeNovel, removeVolume } from '../src/tracker'

type Case = { name: string; data: any; args: any; expected: any }

describe('tracker shared fixtures', () => {
  for (const c of findNovelCases as Case[]) {
    it(`find_novel: ${c.name}`, () => {
      expect(findNovel(c.data, c.args.ln_url)).toEqual(c.expected)
    })
  }
  for (const c of newChaptersCases as Case[]) {
    it(`new_chapters: ${c.name}`, () => {
      expect(newChapters(c.data, c.args.ln_url, c.args.vol_name, c.args.live)).toEqual(c.expected)
    })
  }
  for (const c of removeVolumeCases as Case[]) {
    it(`remove_volume: ${c.name}`, () => {
      const before = JSON.stringify(c.data)
      expect(removeVolume(c.data, c.args.ln_url, c.args.vol_name)).toEqual(c.expected)
      expect(JSON.stringify(c.data)).toBe(before)
    })
  }
  for (const c of removeNovelCases as Case[]) {
    it(`remove_novel: ${c.name}`, () => {
      const before = JSON.stringify(c.data)
      expect(removeNovel(c.data, c.args.ln_url)).toEqual(c.expected)
      expect(JSON.stringify(c.data)).toBe(before)
    })
  }
})
