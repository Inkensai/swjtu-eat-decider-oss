import { describe, expect, it } from 'vitest'
import {
  CSRF_HEADER,
  SESSION_COOKIE,
  adminAuthMode,
  authenticate,
  clearedSessionCookie,
  cookieSecure,
  parseAccessKeyHash,
  parsePasswordHash,
  randomToken,
  readCookie,
  requireCsrf,
  requireSameOrigin,
  safeEqualText,
  sessionCookie,
  sessionTtlSeconds,
  verifyAdminAccessKey,
  verifyAdminPassword,
  type AdminSession,
} from '../server/auth'
import type { Env } from '../server/env'
import { TEST_ADMIN_KEY, TEST_ADMIN_PASSWORD, accessKeyHash, passwordHash } from './support'

const session: AdminSession = { id: 'session-id', csrfToken: 'csrf-token-value', expiresAt: Date.now() + 60_000 }

describe('管理员密码哈希', () => {
  it('接受正确密码并拒绝错误密码', async () => {
    const encoded = passwordHash()
    await expect(verifyAdminPassword(TEST_ADMIN_PASSWORD, encoded)).resolves.toBe(true)
    await expect(verifyAdminPassword(`${TEST_ADMIN_PASSWORD}!`, encoded)).resolves.toBe(false)
    await expect(verifyAdminPassword('', encoded)).resolves.toBe(false)
    await expect(verifyAdminPassword('测试密码 with emoji 🍜', passwordHash('测试密码 with emoji 🍜'))).resolves.toBe(true)
  })

  it('缺乏配置或格式错误时返回明确的 503，而不是把配置当作密码错误', async () => {
    const invalid = [
      undefined,
      '',
      'plain-text',
      `bcrypt$10000$c2FsdA$aGFzaA`,
      `pbkdf2-sha256$999$c2FsdHNhbHRzYWx0c2FsdA$aGFzaA`,
      `pbkdf2-sha256$10000$***$aGFzaA`,
      `pbkdf2-sha256$10000$${Buffer.alloc(16).toString('base64url')}$aGFzaA`,
    ]
    for (const value of invalid) {
      expect(() => parsePasswordHash(value)).toThrowError(expect.objectContaining({ status: 503, code: 'AUTH_NOT_CONFIGURED' }))
      await expect(verifyAdminPassword(TEST_ADMIN_PASSWORD, value)).rejects.toMatchObject({ status: 503 })
    }
  })

  it('哈希携带迭代次数，可与脚本生成的格式互换', () => {
    const encoded = passwordHash(TEST_ADMIN_PASSWORD, 12_345)
    expect(encoded).toMatch(/^pbkdf2-sha256\$12345\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/)
    expect(parsePasswordHash(encoded).iterations).toBe(12_345)
  })
})

describe('管理员访问密钥（Workers Free 兼容）', () => {
  it('接受正确密钥并拒绝错误密钥', async () => {
    const encoded = accessKeyHash()
    await expect(verifyAdminAccessKey(TEST_ADMIN_KEY, encoded)).resolves.toBe(true)
    await expect(verifyAdminAccessKey(`${TEST_ADMIN_KEY}x`, encoded)).resolves.toBe(false)
    await expect(verifyAdminAccessKey('', encoded)).resolves.toBe(false)
  })

  it('摘要格式必须为 sha256: 加 64 位小写十六进制', () => {
    const encoded = accessKeyHash()
    expect(encoded).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(parseAccessKeyHash(encoded)).toHaveLength(64)
    for (const value of [undefined, '', 'sha256:', TEST_ADMIN_KEY, encoded.toUpperCase(), `sha256:${'a'.repeat(63)}`]) {
      expect(() => parseAccessKeyHash(value)).toThrowError(expect.objectContaining({ status: 503, code: 'AUTH_NOT_CONFIGURED' }))
    }
  })

  it('按配置选择认证方式，同时配置时访问密钥优先', () => {
    expect(() => adminAuthMode({} as Env)).toThrowError(expect.objectContaining({ status: 503 }))
    expect(adminAuthMode({ ADMIN_ACCESS_KEY_HASH: accessKeyHash() } as Env)).toBe('access-key')
    expect(adminAuthMode({ ADMIN_PASSWORD_HASH: passwordHash() } as Env)).toBe('password')
    expect(adminAuthMode({ ADMIN_ACCESS_KEY_HASH: accessKeyHash(), ADMIN_PASSWORD_HASH: passwordHash() } as Env)).toBe('access-key')
    expect(() => adminAuthMode({ ADMIN_ACCESS_KEY_HASH: 'invalid' } as Env)).toThrowError(expect.objectContaining({ status: 503 }))
  })
})

describe('会话 Cookie 与 CSRF', () => {
  it('Cookie 始终带 Secure、HttpOnly、SameSite 与 Path', () => {
    for (const header of [sessionCookie('token', 3600), clearedSessionCookie()]) {
      expect(header).toContain(`${SESSION_COOKIE}=`)
      expect(header).toContain('Path=/')
      expect(header).toContain('HttpOnly')
      expect(header).toContain('Secure')
      expect(header).toContain('SameSite=Lax')
    }
    expect(sessionCookie('token', 3600)).toContain('Max-Age=3600')
    expect(clearedSessionCookie()).toContain('Max-Age=0')
  })

  it('仅本地回环 HTTP 开发可省略 Secure，生产与其他 HTTP 来源仍强制 Secure', () => {
    expect(cookieSecure(new Request('https://eat-decider.pages.dev/'))).toBe(true)
    expect(cookieSecure(new Request('http://localhost:5173/'))).toBe(false)
    expect(cookieSecure(new Request('http://127.0.0.1:5173/'))).toBe(false)
    expect(cookieSecure(new Request('http://example.test/'))).toBe(true)
    expect(sessionCookie('token', 60, cookieSecure(new Request('http://localhost:5173/')))).not.toContain('Secure')
    expect(clearedSessionCookie(false)).not.toContain('Secure')
  })

  it('只读取完全同名的 Cookie', () => {
    const request = new Request('http://localhost/api/admin/areas', {
      headers: { Cookie: `other=1; ${SESSION_COOKIE}=abc; ${SESSION_COOKIE}_x=wrong` },
    })
    expect(readCookie(request, SESSION_COOKIE)).toBe('abc')
    expect(readCookie(request, 'missing')).toBeNull()
    expect(readCookie(new Request('http://localhost/'), SESSION_COOKIE)).toBeNull()
  })

  it('CSRF 头必须与会话令牌一致', () => {
    const request = (token?: string) => new Request('http://localhost/api/admin/areas', {
      method: 'POST',
      headers: token === undefined ? {} : { [CSRF_HEADER]: token },
    })
    expect(() => requireCsrf(request(session.csrfToken), session)).not.toThrow()
    expect(() => requireCsrf(request(), session)).toThrowError(expect.objectContaining({ status: 403, code: 'CSRF_FAILED' }))
    expect(() => requireCsrf(request('wrong'), session)).toThrowError(expect.objectContaining({ status: 403 }))
    expect(safeEqualText('same', 'same')).toBe(true)
    expect(safeEqualText('same', 'diff')).toBe(false)
  })

  it('写请求必须同源，缺失 Origin 也拒绝', () => {
    const same = new Request('https://example.test/api/admin/areas', { method: 'POST', headers: { Origin: 'https://example.test' } })
    const cross = new Request('https://example.test/api/admin/areas', { method: 'POST', headers: { Origin: 'https://attacker.test' } })
    const missing = new Request('https://example.test/api/admin/areas', { method: 'POST' })
    expect(() => requireSameOrigin(same)).not.toThrow()
    expect(() => requireSameOrigin(cross)).toThrowError(expect.objectContaining({ status: 403, code: 'ORIGIN_REJECTED' }))
    expect(() => requireSameOrigin(missing)).toThrowError(expect.objectContaining({ status: 403 }))
  })
})

describe('认证默认拒绝', () => {
  it('没有会话 Cookie 时直接 401，不读取数据库', async () => {
    const request = new Request('http://localhost/api/admin/areas')
    await expect(authenticate(request, {} as Env)).rejects.toMatchObject({ status: 401, code: 'UNAUTHORIZED' })
  })

  it('会话固定为 12 小时默认值并接受受限范围配置', () => {
    expect(sessionTtlSeconds({} as Env)).toBe(43_200)
    expect(sessionTtlSeconds({ ADMIN_SESSION_TTL_SECONDS: '600' } as Env)).toBe(600)
    expect(sessionTtlSeconds({ ADMIN_SESSION_TTL_SECONDS: '60' } as Env)).toBe(43_200)
    expect(sessionTtlSeconds({ ADMIN_SESSION_TTL_SECONDS: '9999999' } as Env)).toBe(43_200)
  })

  it('生成不可预测的会话令牌与 CSRF 令牌', () => {
    const first = randomToken()
    const second = randomToken()
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(first).not.toBe(second)
  })
})
