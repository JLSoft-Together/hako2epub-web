import { expect, it } from 'vitest'
import { formatMb, phaseLabel } from '../src/format'

it('formatMb always shows one decimal', () => {
  expect(formatMb(8 * 1024 * 1024)).toBe('8,0 MB')
  expect(formatMb(9.34 * 1024 * 1024)).toBe('9,3 MB')
})

it('phaseLabel maps worker phases and passes unknown ones through', () => {
  expect(phaseLabel('starting')).toBe('Khởi động')
  expect(phaseLabel('fetching')).toBe('Đọc thông tin truyện')
  expect(phaseLabel('chapters')).toBe('Tải chương')
  expect(phaseLabel('other')).toBe('other')
})
