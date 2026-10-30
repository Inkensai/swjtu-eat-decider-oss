import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, URL as NodeURL } from 'node:url'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { convertV4MiniflareOptions, Miniflare } from 'miniflare'
import worker from '../server/index'
import type { Env } from '../server/env'
import { SESSION_COOKIE } from '../server/auth'
import { RATER_COOKIE } from '../server/ratings'
import type { AdminRatingList, Area, Dish, RatingOverview, RatingSubmission, Restaurant } from '../shared/types'
import { TEST_ADMIN_PASSWORD, findCookie, passwordHash, setCookies } from './support'

const origin = 'http://localhost'
const migrationsDirectory = fileURLToPath(new NodeURL('../migrations', import.meta.url))
let runtime: Miniflare
let env: Env
let adminCookie = ''
let adminCsrf = ''
let area: Area
let restaurant: Restaurant
let dish: Dish

async function migrate(db: D1Database, files: string[]): Promise<void> {
  for (const file of files) {
    const migration = readFileSync(join(migrationsDirectory, file), 'utf8')
    await db.batch(migration.split(';').map(sql => sql.trim()).filter(Boolean).map(sql => db.prepare(sql)))
  }
}

interface CallOptions {
  method?: string
  body?: unknown
  cookie?: string
  headers?: Record<string, string>
}

async function call(path: string, options: CallOptions = {}): Promise<Response> {
  const headers: Record<string, string> = {
    Origin: origin,
    ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
    ...(options.cookie ? { Cookie: options.cookie } : {}),
    ...options.headers,
  }
  return worker.fetch(new Request(`${origin}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  }), env)
}

async function adminCall(path: string, options: CallOptions = {}): Promise<Response> {
  return call(path, {
    ...options,
    cookie: adminCookie,
    headers: {
      ...(options.method && options.method !== 'GET' ? { 'X-CSRF-Token': adminCsrf } : {}),
      ...options.headers,
    },
  })
}

async function login(): Promise<void> {
  const response = await call('/api/admin/session', { method: 'POST', body: { password: TEST_ADMIN_PASSWORD } })
  expect(response.status).toBe(200)
  adminCookie = findCookie(response, SESSION_COOKIE)
  adminCsrf = (await response.json() as { csrfToken: string }).csrfToken
}

async function rate(targetType: 'restaurant' | 'dish', targetId: string, stars: number, cookie = ''): Promise<Response> {
  return call(`/api/ratings/${targetType}/${targetId}`, { method: 'PUT', body: { stars }, cookie })
}

async function overview(cookie = ''): Promise<RatingOverview> {
  const response = await call('/api/ratings', { cookie })
  expect(response.status).toBe(200)
  return response.json() as Promise<RatingOverview>
}

async function summary(targetType: 'restaurant' | 'dish', targetId: string): Promise<{ average: number | null; count: number }> {
  const data = await overview()
  const list = targetType === 'restaurant' ? data.restaurants : data.dishes
  const found = list.find((item) => item.targetId === targetId)
  return { average: found?.average ?? null, count: found?.count ?? 0 }
}

beforeAll(async () => {
  runtime = new Miniflare(convertV4MiniflareOptions({ name: 'ratings-test', modules: true, script: 'export default { fetch() { return new Response("ok") } }', compatibilityDate: '2026-10-26', d1Databases: ['DB'] }))
  const db = await runtime.getD1Database('DB', 'ratings-test')
  env = {
    DB: db as unknown as D1Database,
    ADMIN_PASSWORD_HASH: passwordHash(),
    ASSETS: { fetch: async () => new Response('static') } as unknown as Fetcher,
  }
  await migrate(env.DB, readdirSync(migrationsDirectory).filter((name) => name.endsWith('.sql')).sort())
})

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM ratings'),
    env.DB.prepare('DELETE FROM rating_rate_limits'),
    env.DB.prepare('DELETE FROM dishes'),
    env.DB.prepare('DELETE FROM restaurants'),
    env.DB.prepare('DELETE FROM areas'),
    env.DB.prepare('DELETE FROM admin_sessions'),
    env.DB.prepare('DELETE FROM admin_login_attempts'),
  ])
  await login()
  const created = await adminCall('/api/admin/areas', { method: 'POST', body: { name: '评分测试区域', type: 'canteen' } })
  area = await created.json() as Area
  restaurant = await (await adminCall('/api/admin/restaurants', {
    method: 'POST', body: { areaId: area.id, name: '评分测试店铺', category: '粉面 / 面食' },
  })).json() as Restaurant
  dish = await (await adminCall('/api/admin/dishes', {
    method: 'POST', body: { restaurantId: restaurant.id, name: '评分测试面', category: '粉面 / 米线', priceCents: 1200 },
  })).json() as Dish
})

afterAll(async () => { await runtime?.dispose() })

describe('匿名评分：统计与身份', () => {
  it('公共汇总可短暂缓存，个人评分独立且禁止缓存，兼容原接口', async () => {
    const a = findCookie(await rate('dish', dish.id, 5), RATER_COOKIE)
    const b = findCookie(await rate('dish', dish.id, 3), RATER_COOKIE)
    const publicResponse = await call('/api/ratings/summary', { cookie: a })
    expect(publicResponse.status).toBe(200)
    expect(publicResponse.headers.get('Cache-Control')).toBe('public, max-age=30')
    expect(setCookies(publicResponse)).toEqual([])
    const publicData = await publicResponse.json()
    expect(publicData).toEqual({ restaurants: [], dishes: [{ targetId: dish.id, average: 4, count: 2 }] })
    expect(await (await call('/api/ratings/summary', { cookie: b })).json()).toEqual(publicData)
    const personalResponse = await call('/api/ratings/mine', { cookie: a })
    expect(personalResponse.headers.get('Cache-Control')).toBe('private, no-store')
    expect(setCookies(personalResponse)).toEqual([])
    const personalData = await personalResponse.json() as Pick<RatingOverview, 'mine'>
    expect(personalData).toEqual({ mine: [{ targetType: 'dish', targetId: dish.id, stars: 5 }] })
    expect(await (await call('/api/ratings/mine', { cookie: b })).json()).toEqual({ mine: [{ targetType: 'dish', targetId: dish.id, stars: 3 }] })
    expect(await (await call('/api/ratings/mine')).json()).toEqual({ mine: [] })
    expect(await overview(a)).toEqual({ ...publicData as object, ...personalData })
  })

  it.each(['/api/ratings/summary', '/api/ratings/mine', '/api/ratings'])('%s 支持无正文 HEAD 并拒绝写入', async path => {
    const response = await call(path, { method: 'HEAD' })
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('')
    const write = await call(path, { method: 'POST' })
    expect(write.status).toBe(405)
    expect(write.headers.get('Allow')).toBe('GET, HEAD')
  })

  it('无评分时公开统计为空，且不会为浏览者创建身份', async () => {
    const response = await call('/api/ratings')
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(setCookies(response)).toEqual([])
    expect(await response.json()).toEqual({ restaurants: [], dishes: [], mine: [] })
  })

  it('首次评分写入 HttpOnly 匿名 Cookie，摘要入库且不回显到 JSON', async () => {
    const response = await rate('dish', dish.id, 4)
    expect(response.status).toBe(200)
    const body = await response.json() as RatingSubmission
    expect(body).toMatchObject({ targetType: 'dish', targetId: dish.id, stars: 4, average: 4, count: 1 })
    const cookie = findCookie(response, RATER_COOKIE)
    expect(cookie).toMatch(/^ed_rater_id=[A-Za-z0-9_-]{43}$/)
    const header = setCookies(response).join('\n')
    expect(header).toContain('HttpOnly')
    expect(header).toContain('SameSite=Lax')
    expect(header).toContain('Path=/')
    expect(header).toContain('Max-Age=31536000')
    expect(header).not.toContain('Secure')
    const token = cookie.split('=')[1]!
    expect(JSON.stringify(body)).not.toContain(token)
    const row = await env.DB.prepare('SELECT identity_hash FROM ratings').first<{ identity_hash: string }>()
    expect(row?.identity_hash).toBe(createHash('sha256').update(`rater:${token}`, 'utf8').digest('hex'))
    expect(row?.identity_hash).not.toBe(token)
  })

  it('再次提交同一对象只更新原记录，评分人数不变', async () => {
    const first = await rate('dish', dish.id, 3)
    const cookie = findCookie(first, RATER_COOKIE)
    const second = await rate('dish', dish.id, 5, cookie)
    expect(second.status).toBe(200)
    expect(setCookies(second)).toEqual([])
    expect(await second.json()).toMatchObject({ stars: 5, average: 5, count: 1 })
    expect(await summary('dish', dish.id)).toEqual({ average: 5, count: 1 })
    const rows = await env.DB.prepare('SELECT stars, created_at, updated_at FROM ratings').all<{ stars: number; created_at: string; updated_at: string }>()
    expect(rows.results).toHaveLength(1)
    expect(rows.results[0]!.stars).toBe(5)
    expect(rows.results[0]!.updated_at >= rows.results[0]!.created_at).toBe(true)
  })

  it('不同匿名身份分别计数，平均分按有效评分计算', async () => {
    const a = findCookie(await rate('restaurant', restaurant.id, 5), RATER_COOKIE)
    await rate('restaurant', restaurant.id, 3)
    expect(await summary('restaurant', restaurant.id)).toEqual({ average: 4, count: 2 })
    const mine = await overview(a)
    expect(mine.mine).toEqual([{ targetType: 'restaurant', targetId: restaurant.id, stars: 5 }])
    expect((await overview()).mine).toEqual([])
  })

  it('店铺评分与菜品评分互不混淆，菜品 ID 不能冒充店铺 ID', async () => {
    const cookie = findCookie(await rate('restaurant', restaurant.id, 5), RATER_COOKIE)
    await rate('dish', dish.id, 1, cookie)
    expect(await summary('restaurant', restaurant.id)).toEqual({ average: 5, count: 1 })
    expect(await summary('dish', dish.id)).toEqual({ average: 1, count: 1 })
    expect((await rate('restaurant', dish.id, 5)).status).toBe(404)
    expect((await rate('dish', restaurant.id, 5)).status).toBe(404)
    expect((await rate('dish', 'missing', 5)).status).toBe(404)
  })
})

describe('匿名评分：权限与删除', () => {
  it('同一对象超过 500 条评分可完整分页，时间相同时仍不重复或遗漏', async () => {
    const now = '2026-10-26T01:00:00.000Z'
    const ids = Array.from({ length: 505 }, (_, index) => `pagination-${String(index).padStart(4, '0')}`)
    await env.DB.batch(ids.map((id, index) => env.DB.prepare(
      'INSERT INTO ratings (id, target_type, dish_id, identity_hash, stars, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).bind(id, 'dish', dish.id, index.toString(16).padStart(64, '0'), index % 5 + 1, now, now)))
    // A different target must not enter the filtered count or any page.
    await rate('restaurant', restaurant.id, 5)
    let cursor: string | null = null
    const seen: string[] = []
    let pages = 0
    do {
      const query = new URLSearchParams({ targetType: 'dish', targetId: dish.id, restaurantId: restaurant.id, limit: '10000' })
      if (cursor) query.set('cursor', cursor)
      const response = await adminCall(`/api/admin/ratings?${query.toString()}`)
      expect(response.status).toBe(200)
      const page = await response.json() as AdminRatingList
      expect(page.total).toBe(505)
      expect(page.items.length).toBeLessThanOrEqual(100)
      seen.push(...page.items.map(item => item.id))
      cursor = page.nextCursor
      pages += 1
      expect(pages).toBeLessThanOrEqual(6)
    } while (cursor)
    expect(pages).toBe(6)
    expect(seen).toEqual([...ids].reverse())
    expect(new Set(seen).size).toBe(505)
  })

  it('分页游标绑定筛选条件，删除上一页末条记录不影响继续翻页', async () => {
    const now = '2026-10-26T01:00:00.000Z'
    await env.DB.batch(['a', 'b', 'c'].map(id => env.DB.prepare(
      'INSERT INTO ratings (id, target_type, dish_id, identity_hash, stars, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).bind(id, 'dish', dish.id, id.repeat(64), 4, now, now)))
    const first = await (await adminCall('/api/admin/ratings?targetType=dish&limit=2')).json() as AdminRatingList
    expect(first.items.map(item => item.id)).toEqual(['c', 'b'])
    expect(first.nextCursor).toEqual(expect.any(String))
    const encoded = encodeURIComponent(first.nextCursor!)
    expect((await adminCall(`/api/admin/ratings?targetType=restaurant&limit=2&cursor=${encoded}`)).status).toBe(400)
    expect((await adminCall(`/api/admin/ratings?targetType=dish&limit=3&cursor=${encoded}`)).status).toBe(400)
    expect((await adminCall(`/api/admin/ratings?targetType=dish&targetId=${dish.id}&limit=2&cursor=${encoded}`)).status).toBe(400)
    await adminCall('/api/admin/ratings/b', { method: 'DELETE' })
    const second = await (await adminCall(`/api/admin/ratings?targetType=dish&limit=2&cursor=${encoded}`)).json() as AdminRatingList
    expect(second.items.map(item => item.id)).toEqual(['a'])
    expect(second.total).toBe(2)
    expect(second.nextCursor).toBeNull()
  })

  it('分页数量有上限，拒绝无效分页参数', async () => {
    for (const query of ['limit=0', 'limit=-1', 'limit=1.5', 'limit=abc', 'cursor=!', 'cursor=e30', 'targetId=']) {
      expect((await adminCall(`/api/admin/ratings?${query}`)).status).toBe(400)
    }
    const empty = await (await adminCall('/api/admin/ratings?limit=10000')).json() as AdminRatingList
    expect(empty).toEqual({ items: [], total: 0, nextCursor: null })
  })

  it('本人可以删除自己的评分，删除后人数与平均分重算', async () => {
    const a = findCookie(await rate('dish', dish.id, 5), RATER_COOKIE)
    const b = findCookie(await rate('dish', dish.id, 3), RATER_COOKIE)
    expect(await summary('dish', dish.id)).toEqual({ average: 4, count: 2 })
    const removed = await call(`/api/ratings/dish/${dish.id}`, { method: 'DELETE', cookie: a })
    expect(removed.status).toBe(204)
    expect(await summary('dish', dish.id)).toEqual({ average: 3, count: 1 })
    expect((await call(`/api/ratings/dish/${dish.id}`, { method: 'DELETE', cookie: a })).status).toBe(404)
    expect((await call(`/api/ratings/dish/${dish.id}`, { method: 'DELETE', cookie: b })).status).toBe(204)
    expect(await summary('dish', dish.id)).toEqual({ average: null, count: 0 })
  })

  it('其他匿名身份只能操作自己的评分，不能删除或覆盖他人的评分', async () => {
    const a = findCookie(await rate('dish', dish.id, 5), RATER_COOKIE)
    const b = findCookie(await rate('dish', dish.id, 2), RATER_COOKIE)
    const denied = await call(`/api/ratings/dish/${dish.id}`, { method: 'DELETE', cookie: b })
    expect(denied.status).toBe(204)
    // B 删掉的是自己的评分，A 的评分不受影响。
    const mine = await overview(a)
    expect(mine.mine).toEqual([{ targetType: 'dish', targetId: dish.id, stars: 5 }])
    expect(await summary('dish', dish.id)).toEqual({ average: 5, count: 1 })
    // 另一个身份再次提交只新增自己的记录，不会修改 A 的星级。
    await rate('dish', dish.id, 4, b)
    expect(await summary('dish', dish.id)).toEqual({ average: 4.5, count: 2 })
    expect((await overview(a)).mine).toEqual([{ targetType: 'dish', targetId: dish.id, stars: 5 }])
  })

  it('清除 Cookie 后无法删除原身份的评分', async () => {
    const a = findCookie(await rate('dish', dish.id, 5), RATER_COOKIE)
    expect((await call(`/api/ratings/dish/${dish.id}`, { method: 'DELETE' })).status).toBe(401)
    expect((await call(`/api/ratings/dish/${dish.id}`, { method: 'DELETE', cookie: `${RATER_COOKIE}=forged-token-forged-token-forged-token-forged` })).status).toBe(401)
    expect(await summary('dish', dish.id)).toEqual({ average: 5, count: 1 })
    expect((await overview(a)).mine).toHaveLength(1)
  })

  it('匿名访客无法访问管理员评分接口，管理员删除需要会话、同源与 CSRF', async () => {
    const cookie = findCookie(await rate('dish', dish.id, 5), RATER_COOKIE)
    expect((await call('/api/admin/ratings')).status).toBe(401)
    expect((await call('/api/admin/ratings', { method: 'DELETE', cookie })).status).toBe(401)

    const list = await adminCall('/api/admin/ratings')
    expect(list.status).toBe(200)
    const body = await list.json() as AdminRatingList
    expect(body.total).toBe(1)
    expect(body.items[0]).toMatchObject({ targetType: 'dish', targetId: dish.id, targetName: dish.name, stars: 5, restaurantId: restaurant.id })
    const ratingId = body.items[0]!.id
    const serialized = JSON.stringify(body)
    expect(serialized).not.toMatch(/identity/i)
    const token = cookie.split('=')[1]!
    expect(serialized).not.toContain(token)
    expect(serialized).not.toContain(createHash('sha256').update(`rater:${token}`, 'utf8').digest('hex'))

    expect((await call(`/api/admin/ratings/${ratingId}`, { method: 'DELETE', cookie: adminCookie })).status).toBe(403)
    expect((await adminCall(`/api/admin/ratings/${ratingId}`, { method: 'DELETE', headers: { Origin: 'https://attacker.example' } })).status).toBe(403)
    expect((await adminCall(`/api/admin/ratings/${ratingId}`, { method: 'DELETE' })).status).toBe(204)
    expect((await adminCall(`/api/admin/ratings/${ratingId}`, { method: 'DELETE' })).status).toBe(404)
    expect(await summary('dish', dish.id)).toEqual({ average: null, count: 0 })
  })

  it('管理员可以按对象类型、对象和所属店铺筛选评分列表', async () => {
    await rate('restaurant', restaurant.id, 5)
    await rate('dish', dish.id, 4)
    const other = await (await adminCall('/api/admin/dishes', {
      method: 'POST', body: { restaurantId: restaurant.id, name: '另一道菜', priceCents: 900 },
    })).json() as Dish
    await rate('dish', other.id, 2)

    const byType = await (await adminCall('/api/admin/ratings?targetType=dish')).json() as AdminRatingList
    expect(byType.total).toBe(2)
    expect(byType.items.every((item) => item.targetType === 'dish')).toBe(true)
    const byTarget = await (await adminCall(`/api/admin/ratings?targetId=${other.id}`)).json() as AdminRatingList
    expect(byTarget.total).toBe(1)
    expect(byTarget.items[0]!.stars).toBe(2)
    const byRestaurant = await (await adminCall(`/api/admin/ratings?targetType=dish&restaurantId=${restaurant.id}`)).json() as AdminRatingList
    expect(byRestaurant.total).toBe(2)
    expect((await adminCall('/api/admin/ratings?targetType=area')).status).toBe(400)
  })
})

describe('匿名评分：校验、防滥用与可见性', () => {
  it('只接受 1 至 5 的整数星级和合法 JSON 请求', async () => {
    for (const stars of [0, 6, 1.5, '5', null, true]) {
      const response = await rate('dish', dish.id, stars as unknown as number)
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({ error: { code: 'INVALID_INPUT' } })
    }
    expect((await call(`/api/ratings/dish/${dish.id}`, { method: 'PUT', body: {} })).status).toBe(400)
    expect((await call(`/api/ratings/dish/${dish.id}`, { method: 'PUT', body: { stars: 5, extra: 1 } })).status).toBe(400)
    expect((await call(`/api/ratings/dish/${dish.id}`, { method: 'PUT', body: { stars: 5 }, headers: { 'Content-Type': 'text/plain' } })).status).toBe(415)
    expect((await call(`/api/ratings/dish/${dish.id}`, { method: 'PUT', body: { stars: 5 }, headers: { 'Content-Type': 'application/json' }, })).status).toBe(200)
    const oversized = await worker.fetch(new Request(`${origin}/api/ratings/dish/${dish.id}`, {
      method: 'PUT', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ stars: 5, pad: 'x'.repeat(70_000) }),
    }), env)
    expect(oversized.status).toBe(413)
    expect((await call('/api/ratings', { method: 'POST' })).status).toBe(405)
    expect((await call(`/api/ratings/dish/${dish.id}`, { method: 'GET' })).status).toBe(405)
  })

  it('评分写入要求同源来源，拒绝跨站提交', async () => {
    expect((await call(`/api/ratings/dish/${dish.id}`, { method: 'PUT', body: { stars: 5 }, headers: { Origin: '' } })).status).toBe(403)
    expect((await call(`/api/ratings/dish/${dish.id}`, { method: 'PUT', body: { stars: 5 }, headers: { Origin: 'https://attacker.example' } })).status).toBe(403)
    const cookie = findCookie(await rate('dish', dish.id, 5), RATER_COOKIE)
    expect((await call(`/api/ratings/dish/${dish.id}`, { method: 'DELETE', cookie, headers: { Origin: 'https://attacker.example' } })).status).toBe(403)
    expect(await summary('dish', dish.id)).toEqual({ average: 5, count: 1 })
  })

  it('同一身份高频写入触发 429 与 Retry-After', async () => {
    env.RATING_RATE_LIMIT = '3'
    env.RATING_IP_RATE_LIMIT = '1000'
    try {
      const cookie = findCookie(await rate('dish', dish.id, 5), RATER_COOKIE)
      for (let index = 0; index < 2; index += 1) expect((await rate('dish', dish.id, 4, cookie)).status).toBe(200)
      const limited = await rate('dish', dish.id, 3, cookie)
      expect(limited.status).toBe(429)
      expect(limited.headers.get('Retry-After')).toMatch(/^\d+$/)
      expect(await limited.json()).toMatchObject({ error: { code: 'TOO_MANY_REQUESTS' } })
      expect(await summary('dish', dish.id)).toEqual({ average: 4, count: 1 })
    } finally {
      delete env.RATING_RATE_LIMIT
      delete env.RATING_IP_RATE_LIMIT
    }
  })

  it('同一来源反复更换身份也会被来源 IP 限流', async () => {
    env.RATING_RATE_LIMIT = '1000'
    env.RATING_IP_RATE_LIMIT = '2'
    try {
      expect((await rate('dish', dish.id, 5)).status).toBe(200)
      expect((await rate('dish', dish.id, 4)).status).toBe(200)
      expect((await rate('dish', dish.id, 3)).status).toBe(429)
    } finally {
      delete env.RATING_RATE_LIMIT
      delete env.RATING_IP_RATE_LIMIT
    }
  })

  it('来源 IP 限流不信任客户端可伪造的 X-Real-IP 头', async () => {
    env.RATING_RATE_LIMIT = '1000'
    env.RATING_IP_RATE_LIMIT = '2'
    try {
      const withHeader = (ip: string) => call(`/api/ratings/dish/${dish.id}`, {
        method: 'PUT', body: { stars: 5 }, headers: { 'X-Real-IP': ip },
      })
      expect((await withHeader('198.51.100.1')).status).toBe(200)
      expect((await withHeader('198.51.100.2')).status).toBe(200)
      // 轮换伪造头不能获得新的限流额度。
      expect((await withHeader('198.51.100.3')).status).toBe(429)
    } finally {
      delete env.RATING_RATE_LIMIT
      delete env.RATING_IP_RATE_LIMIT
    }
  })

  it('按 Cloudflare 边缘写入的 CF-Connecting-IP 区分来源', async () => {
    env.RATING_RATE_LIMIT = '1000'
    env.RATING_IP_RATE_LIMIT = '1'
    try {
      const fromAddress = (ip: string) => call(`/api/ratings/dish/${dish.id}`, {
        method: 'PUT', body: { stars: 5 }, headers: { 'CF-Connecting-IP': ip },
      })
      expect((await fromAddress('203.0.113.7')).status).toBe(200)
      expect((await fromAddress('203.0.113.7')).status).toBe(429)
      expect((await fromAddress('203.0.113.8')).status).toBe(200)
    } finally {
      delete env.RATING_RATE_LIMIT
      delete env.RATING_IP_RATE_LIMIT
    }
  })

  it('并发重复提交只产生一条有效评分', async () => {
    const cookie = findCookie(await rate('dish', dish.id, 5), RATER_COOKIE)
    const responses = await Promise.all(Array.from({ length: 8 }, (_, index) => rate('dish', dish.id, (index % 5) + 1, cookie)))
    expect(responses.every((response) => response.status === 200)).toBe(true)
    const rows = await env.DB.prepare('SELECT stars FROM ratings WHERE dish_id = ?').bind(dish.id).all<{ stars: number }>()
    expect(rows.results).toHaveLength(1)
    expect(await summary('dish', dish.id)).toMatchObject({ count: 1 })
    expect([1, 2, 3, 4, 5]).toContain(rows.results[0]!.stars)
  })

  it('停用对象拒绝新评分并从公开统计中隐藏，重新启用后恢复', async () => {
    await rate('dish', dish.id, 5)
    expect(await summary('dish', dish.id)).toEqual({ average: 5, count: 1 })
    await adminCall(`/api/admin/dishes/${dish.id}`, { method: 'PATCH', body: { enabled: false } })
    expect((await rate('dish', dish.id, 3)).status).toBe(404)
    expect(await summary('dish', dish.id)).toEqual({ average: null, count: 0 })
    await adminCall(`/api/admin/dishes/${dish.id}`, { method: 'PATCH', body: { enabled: true } })
    expect(await summary('dish', dish.id)).toEqual({ average: 5, count: 1 })
  })

  it('删除店铺或菜品时级联清理评分，不产生孤儿记录', async () => {
    await rate('restaurant', restaurant.id, 4)
    await rate('dish', dish.id, 5)
    expect((await adminCall(`/api/admin/dishes/${dish.id}`, { method: 'DELETE' })).status).toBe(204)
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM ratings WHERE dish_id IS NOT NULL').first<{ count: number }>()).toEqual({ count: 0 })
    expect((await adminCall(`/api/admin/restaurants/${restaurant.id}`, { method: 'DELETE' })).status).toBe(204)
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM ratings').first<{ count: number }>()).toEqual({ count: 0 })
  })
})

describe('V1.2 数据库迁移', () => {
  it('从 V1.1.2 数据库升级时保留原有菜单数据', async () => {
    const legacy = new Miniflare(convertV4MiniflareOptions({
      name: 'legacy-migration', modules: true, script: 'export default { fetch() { return new Response("ok") } }',
      compatibilityDate: '2026-10-26', d1Databases: ['DB'],
    }))
    try {
      const db = await legacy.getD1Database('DB', 'legacy-migration') as unknown as D1Database
      await migrate(db, ['0001_menu.sql', '0002_admin_auth.sql'])
      const now = '2026-10-26T00:00:00.000Z'
      await db.batch([
        db.prepare("INSERT INTO areas (id, name, type, created_at, updated_at) VALUES ('legacy-area', '旧食堂', 'canteen', ?, ?)").bind(now, now),
        db.prepare("INSERT INTO restaurants (id, area_id, name, category, created_at, updated_at) VALUES ('legacy-shop', 'legacy-area', '旧店铺', '火锅 / 串串', ?, ?)").bind(now, now),
        db.prepare("INSERT INTO dishes (id, restaurant_id, name, category, price_cents, created_at, updated_at) VALUES ('legacy-dish', 'legacy-shop', '旧菜品', '米饭 / 盖饭', 900, ?, ?)").bind(now, now),
      ])
      await migrate(db, ['0003_ratings.sql'])
      expect(await db.prepare('SELECT name, category FROM restaurants').first()).toEqual({ name: '旧店铺', category: '火锅 / 串串' })
      expect(await db.prepare('SELECT name, category, price_cents FROM dishes').first()).toEqual({ name: '旧菜品', category: '米饭 / 盖饭', price_cents: 900 })
      await db.prepare('INSERT INTO ratings (id, target_type, dish_id, identity_hash, stars, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind('legacy-rating', 'dish', 'legacy-dish', 'a'.repeat(64), 4, now, now).run()
      await migrate(db, ['0004_rating_indexes.sql'])
      expect(await db.prepare('SELECT COUNT(*) AS count FROM ratings').first()).toEqual({ count: 1 })
      const plan = await db.prepare('EXPLAIN QUERY PLAN SELECT target_type, COALESCE(restaurant_id, dish_id), stars FROM ratings WHERE identity_hash = ?')
        .bind('a'.repeat(64)).all<{ detail: string }>()
      expect(plan.results.some(row => row.detail.includes('ratings_identity'))).toBe(true)
    } finally {
      await legacy.dispose()
    }
  })
})
