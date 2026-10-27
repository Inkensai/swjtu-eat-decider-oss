export class ApiError extends Error {
  readonly status: number
  readonly code?: string

  constructor(message: string, status: number, code?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

export interface ApiOptions {
  /** 同一管理员会话的 CSRF 令牌；仅写请求需要。 */
  csrf?: string
}

export async function api<T>(path: string, init: RequestInit = {}, options: ApiOptions = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body) headers.set('Content-Type', 'application/json')
  const method = (init.method ?? 'GET').toUpperCase()
  if (options.csrf && method !== 'GET' && method !== 'HEAD') headers.set('X-CSRF-Token', options.csrf)
  let response: Response
  try {
    response = await fetch(`/api${path}`, { ...init, headers, credentials: 'same-origin', redirect: 'error' })
  } catch {
    throw new ApiError('暂时无法连接服务。请检查网络；管理登录过期时，请重新登录。', 0)
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: { code?: string; message?: string } } | null
    const fallback = response.status === 401
      ? '登录已过期，请重新输入管理员密码或访问密钥。'
      : response.status === 403
        ? '请求被拒绝，请刷新页面后重试。'
        : `请求失败（${response.status}），请稍后重试。`
    throw new ApiError(body?.error?.message || fallback, response.status, body?.error?.code)
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}
