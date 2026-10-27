import type { Env } from './env'
import { HttpError } from './http'

/**
 * 应用内管理员认证。
 *
 * 支持两种服务端存储的凭据，按配置二选一：
 * - ADMIN_ACCESS_KEY_HASH：高熵随机访问密钥的 SHA-256 摘要，适合 Workers Free；
 * - ADMIN_PASSWORD_HASH：人工密码的 PBKDF2-HMAC-SHA256 哈希，适合付费套餐。
 * 会话令牌只把 SHA-256 摘要写入 D1，浏览器通过 HttpOnly Cookie 持有原文。
 * 所有管理 API 默认拒绝：没有有效会话一律 401。
 */

export const SESSION_COOKIE = 'ed_admin_session'
export const CSRF_HEADER = 'X-CSRF-Token'
export const DEFAULT_SESSION_TTL_SECONDS = 43_200
const HASH_PREFIX = 'pbkdf2-sha256'
const ACCESS_KEY_HASH_PREFIX = 'sha256:'
const ACCESS_KEY_HASH_PATTERN = /^sha256:[0-9a-f]{64}$/
const MIN_ITERATIONS = 10_000
const MAX_ITERATIONS = 1_000_000
const SALT_BYTES = 16
const DERIVED_BYTES = 32
const encoder = new TextEncoder()

export interface AdminSession {
  id: string
  csrfToken: string
  expiresAt: number
}

interface PasswordHash {
  iterations: number
  salt: Uint8Array
  derived: Uint8Array
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlDecode(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('INVALID_BASE64URL')
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

function timingSafeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1) difference |= left[index]! ^ right[index]!
  return difference === 0
}

export function safeEqualText(left: string, right: string): boolean {
  return timingSafeEqual(encoder.encode(left), encoder.encode(right))
}

function authNotConfigured(message = '管理员身份验证尚未配置'): never {
  throw new HttpError(503, 'AUTH_NOT_CONFIGURED', message)
}

export function parsePasswordHash(encoded: string | undefined): PasswordHash {
  if (!encoded) authNotConfigured()
  const parts = encoded.trim().split('$')
  if (parts.length !== 4 || parts[0] !== HASH_PREFIX) authNotConfigured('管理员密码哈希格式无效，请重新生成')
  const iterations = Number(parts[1])
  if (!Number.isSafeInteger(iterations) || iterations < MIN_ITERATIONS || iterations > MAX_ITERATIONS) {
    authNotConfigured('管理员密码哈希迭代次数无效，请重新生成')
  }
  let salt: Uint8Array
  let derived: Uint8Array
  try {
    salt = base64UrlDecode(parts[2]!)
    derived = base64UrlDecode(parts[3]!)
  } catch {
    authNotConfigured('管理员密码哈希编码无效，请重新生成')
  }
  if (salt.length < SALT_BYTES || derived.length !== DERIVED_BYTES) authNotConfigured('管理员密码哈希长度无效，请重新生成')
  return { iterations, salt, derived }
}

export async function verifyAdminPassword(password: string, encoded: string | undefined): Promise<boolean> {
  const config = parsePasswordHash(encoded)
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: config.salt, iterations: config.iterations },
    key,
    DERIVED_BYTES * 8,
  )
  return timingSafeEqual(new Uint8Array(bits), config.derived)
}

export function parseAccessKeyHash(encoded: string | undefined): string {
  if (!encoded) authNotConfigured()
  const value = encoded.trim()
  if (!ACCESS_KEY_HASH_PATTERN.test(value)) authNotConfigured('管理员访问密钥摘要格式无效，请重新生成')
  return value.slice(ACCESS_KEY_HASH_PREFIX.length)
}

/**
 * 高熵访问密钥使用快速 SHA-256 验证是安全的：密钥本身由 256 位密码学随机数
 * 生成，离线暴力枚举不可行，因此不需要为低熵人工密码设计的慢哈希。
 */
export async function verifyAdminAccessKey(key: string, encoded: string | undefined): Promise<boolean> {
  const expected = parseAccessKeyHash(encoded)
  const actual = await sha256Hex(key)
  return safeEqualText(actual, expected)
}

export type AdminAuthMode = 'access-key' | 'password'

/** 按配置选择唯一启用的认证方式；同时配置时访问密钥优先，避免误用高开销路径。 */
export function adminAuthMode(env: Env): AdminAuthMode {
  if (env.ADMIN_ACCESS_KEY_HASH) {
    parseAccessKeyHash(env.ADMIN_ACCESS_KEY_HASH)
    return 'access-key'
  }
  if (env.ADMIN_PASSWORD_HASH) {
    parsePasswordHash(env.ADMIN_PASSWORD_HASH)
    return 'password'
  }
  return authNotConfigured()
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)))
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function randomToken(bytes = 32): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(bytes)))
}

export function sessionTtlSeconds(env: Env): number {
  const value = Number(env.ADMIN_SESSION_TTL_SECONDS)
  return Number.isSafeInteger(value) && value >= 300 && value <= 604_800 ? value : DEFAULT_SESSION_TTL_SECONDS
}

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('Cookie')
  if (!header) return null
  for (const part of header.split(';')) {
    const separator = part.indexOf('=')
    if (separator < 0) continue
    if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim()
  }
  return null
}

export function sessionCookie(token: string, maxAgeSeconds: number, secure = true): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly${secure ? '; Secure' : ''}; SameSite=Lax; Max-Age=${maxAgeSeconds}`
}

export function clearedSessionCookie(secure = true): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly${secure ? '; Secure' : ''}; SameSite=Lax; Max-Age=0`
}

/**
 * 生产（HTTPS）始终 Secure。仅当本地开发直接通过 http://127.0.0.1 或
 * http://localhost 访问时省略 Secure，否则浏览器不会保存会话 Cookie。
 */
export function cookieSecure(request: Request): boolean {
  const url = new URL(request.url)
  if (url.protocol !== 'http:') return true
  return !['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname)
}

export async function createAdminSession(env: Env): Promise<{ token: string; csrfToken: string; expiresAt: number }> {
  const token = randomToken()
  const csrfToken = randomToken()
  const now = Date.now()
  const expiresAt = now + sessionTtlSeconds(env) * 1000
  await env.DB.prepare('DELETE FROM admin_sessions WHERE expires_at <= ?').bind(now).run()
  await env.DB.prepare(
    'INSERT INTO admin_sessions (id, token_hash, csrf_token, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
  ).bind(crypto.randomUUID(), await sha256Hex(token), csrfToken, now, expiresAt).run()
  return { token, csrfToken, expiresAt }
}

export async function readAdminSession(request: Request, env: Env): Promise<AdminSession | null> {
  const token = readCookie(request, SESSION_COOKIE)
  if (!token || token.length < 32 || token.length > 128) return null
  const row = await env.DB.prepare('SELECT id, csrf_token, expires_at FROM admin_sessions WHERE token_hash = ?')
    .bind(await sha256Hex(token))
    .first<{ id: string; csrf_token: string; expires_at: number }>()
  if (!row) return null
  const now = Date.now()
  if (row.expires_at <= now) {
    await env.DB.prepare('DELETE FROM admin_sessions WHERE id = ?').bind(row.id).run()
    return null
  }
  return { id: row.id, csrfToken: row.csrf_token, expiresAt: row.expires_at }
}

export async function authenticate(request: Request, env: Env): Promise<AdminSession> {
  const session = await readAdminSession(request, env)
  if (!session) throw new HttpError(401, 'UNAUTHORIZED', '请先登录管理员账号')
  return session
}

/** 所有写请求必须同时携带会话 Cookie 与同一会话的 CSRF 头。 */
export function requireCsrf(request: Request, session: AdminSession): void {
  const token = request.headers.get(CSRF_HEADER)
  if (!token || token.length > 128 || !safeEqualText(token, session.csrfToken)) {
    throw new HttpError(403, 'CSRF_FAILED', '请求校验失败，请刷新页面后重试')
  }
}

export function requireSameOrigin(request: Request): void {
  if (request.headers.get('Origin') !== new URL(request.url).origin) {
    throw new HttpError(403, 'ORIGIN_REJECTED', '管理请求仅允许同源来源')
  }
}

export async function destroyAdminSession(env: Env, session: AdminSession): Promise<void> {
  await env.DB.prepare('DELETE FROM admin_sessions WHERE id = ?').bind(session.id).run()
}
