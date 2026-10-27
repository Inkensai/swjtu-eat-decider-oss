import {
  adminAuthMode,
  authenticate,
  clearedSessionCookie,
  cookieSecure,
  createAdminSession,
  destroyAdminSession,
  readAdminSession,
  requireCsrf,
  requireSameOrigin,
  sessionCookie,
  sessionTtlSeconds,
  sha256Hex,
  verifyAdminAccessKey,
  verifyAdminPassword,
} from './auth'
import type { Env } from './env'
import { HttpError, json } from './http'
import { readJson, validateAdminLogin } from './validation'

const DEFAULT_MAX_ATTEMPTS = 5
const DEFAULT_WINDOW_SECONDS = 900
const THROTTLE_RETENTION_MS = 86_400_000

interface ThrottleConfig {
  maxAttempts: number
  windowSeconds: number
}

interface ThrottleRow {
  window_start: number
  failures: number
  locked_until: number
}

function boundedInteger(raw: string | undefined, fallback: number, min: number, max: number): number {
  const value = Number(raw)
  return Number.isSafeInteger(value) && value >= min && value <= max ? value : fallback
}

function throttleConfig(env: Env): ThrottleConfig {
  return {
    maxAttempts: boundedInteger(env.ADMIN_LOGIN_MAX_ATTEMPTS, DEFAULT_MAX_ATTEMPTS, 3, 100),
    windowSeconds: boundedInteger(env.ADMIN_LOGIN_WINDOW_SECONDS, DEFAULT_WINDOW_SECONDS, 60, 86_400),
  }
}

async function loginScope(request: Request): Promise<string> {
  const address = request.headers.get('CF-Connecting-IP')?.trim()
    || request.headers.get('X-Real-IP')?.trim()
    || 'unknown'
  return `ip:${await sha256Hex(address)}`
}

function tooManyAttempts(retryAfterSeconds: number): HttpError {
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60))
  return new HttpError(
    429,
    'TOO_MANY_ATTEMPTS',
    `登录尝试过于频繁，请 ${minutes} 分钟后重试`,
    { retryAfterSeconds },
    { 'Retry-After': String(retryAfterSeconds) },
  )
}

async function lockedSeconds(env: Env, scope: string): Promise<number> {
  const row = await env.DB.prepare('SELECT locked_until FROM admin_login_attempts WHERE scope = ?')
    .bind(scope)
    .first<{ locked_until: number }>()
  if (!row) return 0
  const remaining = row.locked_until - Date.now()
  return remaining > 0 ? Math.ceil(remaining / 1000) : 0
}

async function recordLoginFailure(env: Env, scope: string, config: ThrottleConfig): Promise<number> {
  const now = Date.now()
  const windowMs = config.windowSeconds * 1000
  const row = await env.DB.prepare('SELECT window_start, failures, locked_until FROM admin_login_attempts WHERE scope = ?')
    .bind(scope)
    .first<ThrottleRow>()
  const withinWindow = row !== null && now - row.window_start < windowMs
  const windowStart = withinWindow ? row.window_start : now
  const failures = (withinWindow ? row.failures : 0) + 1
  const lockedUntil = failures >= config.maxAttempts ? now + windowMs : 0
  await env.DB.prepare(
    'INSERT INTO admin_login_attempts (scope, window_start, failures, locked_until) VALUES (?, ?, ?, ?) '
      + 'ON CONFLICT(scope) DO UPDATE SET window_start = excluded.window_start, failures = excluded.failures, locked_until = excluded.locked_until',
  ).bind(scope, windowStart, failures, lockedUntil).run()
  return lockedUntil > now ? Math.ceil((lockedUntil - now) / 1000) : 0
}

async function sessionStatus(request: Request, env: Env): Promise<Response> {
  const session = await readAdminSession(request, env)
  if (!session) return json({ authenticated: false }, 200, { 'Set-Cookie': clearedSessionCookie(cookieSecure(request)) })
  return json({
    authenticated: true,
    csrfToken: session.csrfToken,
    expiresAt: new Date(session.expiresAt).toISOString(),
  })
}

async function login(request: Request, env: Env): Promise<Response> {
  // 配置错误应在限流计数之前暴露为明确的 503，而不是把缺少密钥当作密码错误。
  const mode = adminAuthMode(env)
  const config = throttleConfig(env)
  const scope = await loginScope(request)
  const locked = await lockedSeconds(env, scope)
  if (locked > 0) throw tooManyAttempts(locked)

  const input = validateAdminLogin(await readJson(request))
  const verified = mode === 'access-key'
    ? await verifyAdminAccessKey(input.password, env.ADMIN_ACCESS_KEY_HASH)
    : await verifyAdminPassword(input.password, env.ADMIN_PASSWORD_HASH)
  if (!verified) {
    const retryAfter = await recordLoginFailure(env, scope, config)
    if (retryAfter > 0) throw tooManyAttempts(retryAfter)
    throw new HttpError(401, 'INVALID_CREDENTIALS', '管理员密码或访问密钥不正确')
  }

  await env.DB.prepare('DELETE FROM admin_login_attempts WHERE scope = ?').bind(scope).run()
  await env.DB.prepare('DELETE FROM admin_login_attempts WHERE window_start < ? AND locked_until <= ?')
    .bind(Date.now() - THROTTLE_RETENTION_MS, Date.now())
    .run()
  const session = await createAdminSession(env)
  return json({
    authenticated: true,
    csrfToken: session.csrfToken,
    expiresAt: new Date(session.expiresAt).toISOString(),
  }, 200, { 'Set-Cookie': sessionCookie(session.token, sessionTtlSeconds(env), cookieSecure(request)) })
}

async function logout(request: Request, env: Env): Promise<Response> {
  const session = await authenticate(request, env)
  requireCsrf(request, session)
  await destroyAdminSession(env, session)
  return new Response(null, {
    status: 204,
    headers: { 'Cache-Control': 'no-store', 'Set-Cookie': clearedSessionCookie(cookieSecure(request)) },
  })
}

/** 处理 /api/admin/session：登录状态、登录与退出。 */
export async function handleAdminSession(request: Request, env: Env): Promise<Response> {
  if (request.method === 'GET') return sessionStatus(request, env)
  requireSameOrigin(request)
  if (request.method === 'POST') return login(request, env)
  if (request.method === 'DELETE') return logout(request, env)
  throw new HttpError(405, 'METHOD_NOT_ALLOWED', '不支持的管理会话操作', undefined, { Allow: 'GET, POST, DELETE' })
}
