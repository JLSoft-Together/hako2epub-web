import { expect, it } from 'vitest'
import { formatMb } from '../src/format'

it('formatMb always shows one decimal', () => {
  expect(formatMb(8 * 1024 * 1024)).toBe('8,0 MB')
  expect(formatMb(9.34 * 1024 * 1024)).toBe('9,3 MB')
})
