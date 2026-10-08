export const formatMb = (bytes: number): string =>
  `${(bytes / 1024 / 1024).toLocaleString('vi-VN', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MB`
