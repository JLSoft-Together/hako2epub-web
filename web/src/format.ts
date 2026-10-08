export const formatMb = (bytes: number): string =>
  `${(bytes / 1024 / 1024).toLocaleString('vi-VN', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MB`

const PROGRESS_PHASES: Record<string, string> = {
  starting: 'Khởi động',
  fetching: 'Đọc thông tin truyện',
  chapters: 'Tải chương',
}

// Worker progress.phase in Vietnamese; unknown phases are shown as-is.
export const phaseLabel = (phase: string): string => PROGRESS_PHASES[phase] ?? phase
