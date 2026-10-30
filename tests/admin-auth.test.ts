import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, URL as NodeURL } from 'node:url'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { convertV4MiniflareOptions, Miniflare } from 'miniflare'
import worker from '../server/index'
import type { Env } from '../server/env'
import { SESSION_COOKIE } from '../server/auth'
import { TEST_ADMIN_KEY, TEST_ADMIN_PASSWORD, accessKeyHash, findCookie, passwordHash, setCookies } from './support'

const origin = 'https://localhost'
const attacker = 'https://attacker.example'
const clientIp = '203.0.113.7'
let runtime: Miniflare
let env: Env

interface SessionBody {
  authenticated: boolean
  csrfToken?: string
  expiresAt?: string
}

interface CallOptions {
  method?: string
  body?: unknown
  origin?: string | null
  ip?: string
  cookie?: string
  csrf?: string
  contentType?: string
}

async function call(path: string, options: CallOptions = {}): Promise<Response> {
  const { method = 'GET', body, origin: requestOrigin = origin, ip = clientIp, cookie, csrf, contentType = 'application/json' } = options
  const headers: Record<string, string> = {}
  if (body !== undefined) headers['Content-Type'] = contentType
  if (requestOrigin !== null) headers.Origin = requestOrigin
  if (ip) headers['CF-Connecting-IP'] = ip
  if (cookie) headers.Cookie = cookie
  if (csrf) headers['X-CSRF-Token'] = csrf
  return worker.fetch(new Request(`${origin}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  }), env)
}

async function login(credential = TEST_ADMIN_KEY, ip = clientIp, targetEnv: Env = env) {
  const response = await worker.fetch(new Request(`${origin}/api/admin/session`, {
    method: 'POST',
    headers: { Origin: origin, 'CF-Connecting-IP': ip, 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: credential }),
  }), targetEnv)
  const body = await response.json() as SessionBody
  return { response, body, cookie: findCookie(response, SESSION_COOKIE), csrf: body.csrfToken ?? '' }
}

beforeAll(async () => {
  runtime = new Miniflare(convertV4MiniflareOptions({
    name: 'admin-auth-test', modules: true,
    script: 'export default { fetch() { return new Response("ok") } }',
    compatibilityDate: '2026-10-26', d1Databases: ['DB'],
  }))
  const db = await runtime.getD1Database('DB', 'admin-auth-test')
  env = {
    DB: db as unknown as D1Database,
    ADMIN_ACCESS_KEY_HASH: accessKeyHash(),
    ADMIN_LOGIN_MAX_ATTEMPTS: '5',
    ADMIN_LOGIN_WINDOW_SECONDS: '60',
    ASSETS: { fetch: async () => new Response('static') } as unknown as Fetcher,
  }
  const directory = fileURLToPath(new NodeURL('../migrations', import.meta.url))
  for (const file of readdirSync(directory).filter((name) => name.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(directory, file), 'utf8')
    await env.DB.batch(sql.split(';').map((statement) => statement.trim()).filter(Boolean).map((statement) => env.DB.prepare(statement)))
  }
})

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM admin_sessions'),
    env.DB.prepare('DELETE FROM admin_login_attempts'),
  ])
})

afterAll(async () => { await runtime?.dispose() })

describe('应用内管理员登录与会话', () => {
  it('登录成功下发安全 Cookie，可查询会话并退出', async () => {
    const { response, body, cookie, csrf } = await login()
    expect(response.status).toBe(200)
    expect(body.authenticated).toBe(true)
    expect(body.csrfToken).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(new Date(body.expiresAt!).getTime()).toBeGreaterThan(Date.now())

    const setCookie = setCookies(response).join('\n')
    expect(setCookie).toContain(`${SESSION_COOKIE}=`)
    expect(setCookie).toContain('Path=/')
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('Secure')
    expect(setCookie).toContain('SameSite=Lax')
    expect(setCookie).toMatch(/Max-Age=43200/)
    expect(cookie).not.toBe('')

    const token = cookie.slice(`${SESSION_COOKIE}=`.length)
    const row = await env.DB.prepare('SELECT token_hash, csrf_token FROM admin_sessions').first<{ token_hash: string; csrf_token: string }>()
    expect(row?.token_hash).toMatch(/^[a-f0-9]{64}$/)
    expect(row?.token_hash).not.toContain(token)
    expect(row?.csrf_token).toBe(csrf)

    const status = await call('/api/admin/session', { cookie })
    expect(status.status).toBe(200)
    expect(await status.json()).toMatchObject({ authenticated: true, csrfToken: csrf })
    expect((await call('/api/admin/areas', { cookie })).status).toBe(200)

    const logout = await call('/api/admin/session', { method: 'DELETE', cookie, csrf })
    expect(logout.status).toBe(204)
    expect(setCookies(logout).join('\n')).toMatch(new RegExp(`${SESSION_COOKIE}=;.*Max-Age=0`))
    expect((await call('/api/admin/areas', { cookie })).status).toBe(401)
    expect(await (await call('/api/admin/session', { cookie })).json()).toEqual({ authenticated: false })
  })

  it('错误凭据返回通用 401，缺少服务端配置返回 503', async () => {
    const wrong = await login('not-the-access-key')
    expect(wrong.response.status).toBe(401)
    expect(wrong.body).toMatchObject({ error: { code: 'INVALID_CREDENTIALS' } })
    expect(JSON.stringify(wrong.body)).not.toContain(env.ADMIN_ACCESS_KEY_HASH!)
    expect(wrong.cookie).toBe('')

    const unconfigured = await login(TEST_ADMIN_KEY, clientIp, { ...env, ADMIN_ACCESS_KEY_HASH: undefined })
    expect(unconfigured.response.status).toBe(503)
    expect(unconfigured.body).toMatchObject({ error: { code: 'AUTH_NOT_CONFIGURED' } })
  })

  it('连续失败触发 429，锁定按来源隔离', async () => {
    const limited: Env = { ...env, ADMIN_LOGIN_MAX_ATTEMPTS: '3' }
    for (let attempt = 0; attempt < 2; attempt += 1) {
      expect((await login('wrong', clientIp, limited)).response.status).toBe(401)
    }
    const third = await login('wrong', clientIp, limited)
    expect(third.response.status).toBe(429)
    expect(third.response.headers.get('Retry-After')).toMatch(/^\d+$/)
    expect(third.body).toMatchObject({ error: { code: 'TOO_MANY_ATTEMPTS' } })
    expect((await login(TEST_ADMIN_KEY, clientIp, limited)).response.status).toBe(429)

    const otherSource = await login(TEST_ADMIN_KEY, '198.51.100.9', limited)
    expect(otherSource.response.status).toBe(200)
    expect(otherSource.cookie).not.toBe('')
  })

  it('并发登录原子预留额度，不丢计数或绕过锁定', async () => {
    const limited: Env = { ...env, ADMIN_LOGIN_MAX_ATTEMPTS: '3' }
    const responses = await Promise.all(Array.from({ length: 10 }, () => login('wrong', clientIp, limited)))
    expect(responses.filter(result => result.response.status === 401)).toHaveLength(2)
    expect(responses.filter(result => result.response.status === 429)).toHaveLength(8)
    const row = await env.DB.prepare('SELECT failures, locked_until FROM admin_login_attempts').first<{ failures: number; locked_until: number }>()
    expect(row?.failures).toBe(3)
    expect(row?.locked_until).toBeGreaterThan(Date.now())
    expect((await login(TEST_ADMIN_KEY, clientIp, limited)).response.status).toBe(429)
    expect((await login(TEST_ADMIN_KEY, '198.51.100.21', limited)).response.status).toBe(200)
  })

  it('最后一次允许的尝试仍可成功，锁定过期后重新计数', async () => {
    const limited: Env = { ...env, ADMIN_LOGIN_MAX_ATTEMPTS: '3' }
    await login('wrong', clientIp, limited)
    await login('wrong', clientIp, limited)
    expect((await login(TEST_ADMIN_KEY, clientIp, limited)).response.status).toBe(200)
    expect(await env.DB.prepare('SELECT COUNT(*) AS total FROM admin_login_attempts').first()).toEqual({ total: 0 })
    for (let attempt = 0; attempt < 3; attempt++) await login('wrong', clientIp, limited)
    await env.DB.prepare('UPDATE admin_login_attempts SET window_start = ?, locked_until = ?')
      .bind(Date.now() - 120_000, Date.now() - 1).run()
    expect((await login('wrong', clientIp, limited)).response.status).toBe(401)
    expect(await env.DB.prepare('SELECT failures, locked_until FROM admin_login_attempts').first()).toEqual({ failures: 1, locked_until: 0 })
  })

  it('管理写入必须携带与会话一致的 CSRF 令牌且同源', async () => {
    const { cookie, csrf } = await login()
    expect((await call('/api/admin/areas', { cookie })).status).toBe(200)
    expect((await call('/api/admin/areas', { method: 'POST', cookie, body: { name: '无 CSRF' } })).status).toBe(403)
    expect((await call('/api/admin/areas', { method: 'POST', cookie, csrf: 'wrong', body: { name: '错误 CSRF' } })).status).toBe(403)
    expect((await call('/api/admin/areas', { method: 'POST', cookie, csrf, origin: attacker, body: { name: '跨源' } })).status).toBe(403)
    expect((await call('/api/admin/areas', { method: 'POST', cookie, csrf, body: { name: '合法区域', type: 'nearby' } })).status).toBe(201)
    expect(await (await call('/api/areas')).json()).toMatchObject([{ name: '合法区域' }])
  })

  it('过期会话立即失效并被清理', async () => {
    const { cookie } = await login()
    await env.DB.prepare('UPDATE admin_sessions SET expires_at = 1').run()
    expect((await call('/api/admin/areas', { cookie })).status).toBe(401)
    const status = await call('/api/admin/session', { cookie })
    expect(await status.json()).toEqual({ authenticated: false })
    expect(setCookies(status).join('\n')).toContain('Max-Age=0')
    expect(await env.DB.prepare('SELECT COUNT(*) AS total FROM admin_sessions').first<{ total: number }>()).toEqual({ total: 0 })
  })

  it('登录与退出拒绝跨源和无效请求格式', async () => {
    expect((await call('/api/admin/session', { method: 'POST', origin: attacker, body: { password: TEST_ADMIN_KEY } })).status).toBe(403)
    expect((await call('/api/admin/session', { method: 'POST', body: { password: TEST_ADMIN_KEY }, contentType: 'text/plain' })).status).toBe(415)
    expect((await call('/api/admin/session', { method: 'POST', body: '{' })).status).toBe(400)
    expect((await call('/api/admin/session', { method: 'POST', body: { password: TEST_ADMIN_KEY, extra: true } })).status).toBe(400)
    expect((await call('/api/admin/session', { method: 'PUT' })).status).toBe(405)
    expect((await call('/api/admin/session', { method: 'PUT' })).headers.get('Allow')).toBe('GET, POST, DELETE')
    expect(await (await call('/api/admin/session')).json()).toEqual({ authenticated: false })
  })

  it('每次登录生成独立会话，退出只影响当前会话', async () => {
    const first = await login()
    const second = await login()
    expect(first.cookie).not.toBe(second.cookie)
    expect((await call('/api/admin/areas', { cookie: first.cookie })).status).toBe(200)
    expect((await call('/api/admin/areas', { cookie: second.cookie })).status).toBe(200)
    expect((await call('/api/admin/session', { method: 'DELETE', cookie: first.cookie, csrf: first.csrf })).status).toBe(204)
    expect((await call('/api/admin/areas', { cookie: first.cookie })).status).toBe(401)
    expect((await call('/api/admin/areas', { cookie: second.cookie })).status).toBe(200)
  })

  it('被篡改或伪造的会话 Cookie 一律拒绝', async () => {
    const { cookie } = await login()
    const token = cookie.slice(`${SESSION_COOKIE}=`.length)
    const forged = `${SESSION_COOKIE}=${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`
    expect((await call('/api/admin/areas', { cookie: forged })).status).toBe(401)
    expect((await call('/api/admin/areas', { cookie: `${SESSION_COOKIE}=short` })).status).toBe(401)
  })

  it.each(['areas', 'restaurants', 'dishes'])('未登录时默认拒绝 %s 的全部管理方法', async (resource) => {
    expect((await call(`/api/admin/${resource}`)).status).toBe(401)
    expect((await call(`/api/admin/${resource}`, { method: 'POST', body: { name: 'x' } })).status).toBe(401)
    expect((await call(`/api/admin/${resource}/missing`, { method: 'PATCH', body: { name: 'x' } })).status).toBe(401)
    expect((await call(`/api/admin/${resource}/missing`, { method: 'DELETE' })).status).toBe(401)
  })

  it('PBKDF2 密码模式仍可用，访问密钥不能代替', async () => {
    const pbkdf2Env: Env = { ...env, ADMIN_ACCESS_KEY_HASH: undefined, ADMIN_PASSWORD_HASH: passwordHash() }
    const viaPassword = await login(TEST_ADMIN_PASSWORD, clientIp, pbkdf2Env)
    expect(viaPassword.response.status).toBe(200)
    expect(viaPassword.cookie).not.toBe('')
    const viaKey = await login(TEST_ADMIN_KEY, '198.51.100.8', pbkdf2Env)
    expect(viaKey.response.status).toBe(401)
  })

  it('同时配置时访问密钥优先，轮换后旧密钥立即失效', async () => {
    const both: Env = { ...env, ADMIN_PASSWORD_HASH: passwordHash() }
    expect((await login(TEST_ADMIN_KEY, '198.51.100.10', both)).response.status).toBe(200)
    expect((await login(TEST_ADMIN_PASSWORD, '198.51.100.11', both)).response.status).toBe(401)

    const original = await login(TEST_ADMIN_KEY, '198.51.100.12')
    const rotatedKey = 'rotated-admin-access-key-abcdefghijklmnopq'
    const rotated: Env = { ...env, ADMIN_ACCESS_KEY_HASH: accessKeyHash(rotatedKey) }
    expect((await login(TEST_ADMIN_KEY, '198.51.100.13', rotated)).response.status).toBe(401)
    expect((await login(rotatedKey, '198.51.100.14', rotated)).response.status).toBe(200)
    // 轮换登录凭据不会强制结束已有会话；旧会话在到期前仍有效。
    expect((await call('/api/admin/areas', { cookie: original.cookie })).status).toBe(200)
  })
})
