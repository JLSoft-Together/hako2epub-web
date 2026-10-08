export type ErrorKind = 'auth' | 'rate_limit' | 'not_found' | 'conflict' | 'other'

export class GitHubError extends Error {
  status: number
  kind: ErrorKind
  resetAt?: Date

  constructor(status: number, kind: ErrorKind, message: string, resetAt?: Date) {
    super(`GitHub API error ${status}: ${message}`)
    this.name = 'GitHubError'
    this.status = status
    this.kind = kind
    this.resetAt = resetAt
  }
}

export function classifyError(status: number, headers: Headers, message: string): GitHubError {
  if (status === 401) return new GitHubError(status, 'auth', message)
  if ((status === 403 || status === 429) && headers.get('x-ratelimit-remaining') === '0') {
    const reset = Number(headers.get('x-ratelimit-reset'))
    return new GitHubError(
      status,
      'rate_limit',
      message,
      Number.isFinite(reset) && reset > 0 ? new Date(reset * 1000) : undefined,
    )
  }
  if (status === 404) return new GitHubError(status, 'not_found', message)
  if (status === 409 || status === 422) return new GitHubError(status, 'conflict', message)
  return new GitHubError(status, 'other', message)
}
