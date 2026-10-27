import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, URL as NodeURL } from 'node:url'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { convertV4MiniflareOptions, Miniflare } from 'miniflare'
import worker from '../server/index'
import type { Env } from '../server/env'
import { SESSION_COOKIE } from '../server/auth'
import type { Area, Dish, Restaurant } from '../shared/types'
import { TEST_ADMIN_PASSWORD, findCookie, passwordHash } from './support'

const origin = 'http://localhost'
let runtime: Miniflare
let env: Env
let adminCookie = ''
let adminCsrf = ''

async function login(): Promise<void> {
  const response = await worker.fetch(new Request(`${origin}/api/admin/session`, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.10' },
    body: JSON.stringify({ password: TEST_ADMIN_PASSWORD }),
  }), env)
  expect(response.status).toBe(200)
  adminCookie = findCookie(response, SESSION_COOKIE)
  adminCsrf = (await response.json() as { csrfToken: string }).csrfToken
  expect(adminCookie).not.toBe('')
}

async function call(
  path: string,
  method = 'GET',
  body?: unknown,
  headers: Record<string, string> = {},
  admin = true,
): Promise<Response> {
  const effectiveHeaders: Record<string, string> = {
    Origin: origin,
    ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    ...(admin ? { Cookie: adminCookie, ...(method === 'GET' ? {} : { 'X-CSRF-Token': adminCsrf }) } : {}),
    ...headers,
  }
  return worker.fetch(new Request(`${origin}${path}`, {
    method,
    headers: effectiveHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
  }), env)
}

async function create<T>(resource: string, body: unknown): Promise<T> {
  const response = await call(`/api/admin/${resource}`, 'POST', body)
  expect(response.status).toBe(201)
  return response.json() as Promise<T>
}

async function menu() {
  const area = await create<Area>('areas', { name: '测试区域', type: 'canteen' })
  const restaurant = await create<Restaurant>('restaurants', { areaId: area.id, name: '测试店铺', category: '窗口' })
  const dish = await create<Dish>('dishes', { restaurantId: restaurant.id, name: '测试面', category: '面食', priceCents: 1250, weight: 2 })
  return { area, restaurant, dish }
}

beforeAll(async () => {
  runtime = new Miniflare(convertV4MiniflareOptions({ name: 'api-test', modules: true, script: 'export default { fetch() { return new Response("ok") } }', compatibilityDate: '2026-10-26', d1Databases: ['DB'] }))
  const db = await runtime.getD1Database('DB', 'api-test')
  env = {
    DB: db as unknown as D1Database,
    ADMIN_PASSWORD_HASH: passwordHash(),
    ASSETS: { fetch: async () => new Response('static') } as unknown as Fetcher,
  }
  const directory = fileURLToPath(new NodeURL('../migrations', import.meta.url))
  for (const file of readdirSync(directory).filter((name) => name.endsWith('.sql')).sort()) {
    const migration = readFileSync(join(directory, file), 'utf8')
    await env.DB.batch(migration.split(';').map(sql => sql.trim()).filter(Boolean).map(sql => env.DB.prepare(sql)))
  }
})

beforeEach(async () => {
  await env.DB.batch([
    ...['dishes', 'restaurants', 'areas'].map(table => env.DB.prepare(`DELETE FROM ${table}`)),
    env.DB.prepare('DELETE FROM admin_sessions'),
    env.DB.prepare('DELETE FROM admin_login_attempts'),
  ])
  await login()
})

afterAll(async () => { await runtime?.dispose() })

describe('菜单 API 与真实本地 D1', () => {
  it('完成创建、公开筛选、推荐、更新和逐级删除', async () => {
    const { area, restaurant, dish } = await menu()
    expect(area).toMatchObject({ type: 'canteen', enabled: true, sortOrder: 0 })
    expect(dish).toMatchObject({ restaurantId: restaurant.id, priceCents: 1250, weight: 2, notes: '', enabled: true })
    expect(dish.id).toMatch(/^[\da-f-]{36}$/)
    expect(new Date(dish.createdAt).toISOString()).toBe(dish.createdAt)
    expect(dish).not.toHaveProperty('restaurant_id')
    expect(await (await call(`/api/dishes?areaId=${area.id}&restaurantId=${restaurant.id}&category=${encodeURIComponent('面食')}`, 'GET', undefined, {}, false)).json()).toEqual([dish])
    expect(await (await call('/api/dishes?category=missing', 'GET', undefined, {}, false)).json()).toEqual([])
    const decision = await call('/api/recommend', 'POST', { mode: 'combo', filters: { maxPriceCents: 1250 }, recentDishIds: [], avoidRecent: true }, {}, false)
    expect(await decision.json()).toMatchObject({ status: 'ok', restaurant: { id: restaurant.id }, dish: { id: dish.id }, candidateDishCount: 1 })
    const update = await call(`/api/admin/dishes/${dish.id}`, 'PATCH', { name: '新菜名', priceCents: 1300, enabled: false })
    expect(update.status).toBe(200)
    expect(await update.json()).toMatchObject({ id: dish.id, name: '新菜名', enabled: false, createdAt: dish.createdAt })
    expect(await (await call('/api/dishes', 'GET', undefined, {}, false)).json()).toEqual([])
    expect(await (await call('/api/admin/dishes')).json()).toHaveLength(1)
    for (const [resource, id] of [['dishes', dish.id], ['restaurants', restaurant.id], ['areas', area.id]]) {
      const response = await call(`/api/admin/${resource}/${id}`, 'DELETE')
      expect(response.status).toBe(204)
      expect(await response.text()).toBe('')
    }
  })

  it('认证保护所有管理接口，拒绝跨源写入、缺少 CSRF 及错误内容类型', async () => {
    for (const method of ['GET', 'POST']) {
      expect((await call('/api/admin/areas', method, method === 'POST' ? { name: 'x' } : undefined, {}, false)).status).toBe(401)
    }
    expect((await call('/api/admin/areas', 'POST', { name: 'x' }, { Origin: 'https://attacker.example' })).status).toBe(403)
    expect((await call('/api/admin/areas', 'POST', { name: 'x' }, { Origin: '' })).status).toBe(403)
    expect((await call('/api/admin/areas', 'POST', { name: 'x' }, { 'X-CSRF-Token': '' })).status).toBe(403)
    expect((await call('/api/admin/areas', 'POST', { name: 'x' }, { 'Content-Type': 'text/plain' })).status).toBe(415)
    expect((await call('/api/areas', 'POST', { name: 'x' }, {}, false)).status).toBe(404)
    expect((await call('/api/areas', 'GET', undefined, {}, false)).status).toBe(200)
    expect((await call('/api/admin/dishes/%ZZ', 'PATCH', { name: 'x' })).status).toBe(400)
    const { dish } = await menu()
    expect((await call(`/api/admin/dishes/${dish.id}`, 'DELETE', {}, { 'Content-Type': 'text/plain' })).status).toBe(415)
    expect((await call(`/api/admin/dishes/${dish.id}`, 'DELETE', { force: true })).status).toBe(400)
    expect((await call(`/api/admin/dishes/${dish.id}`, 'DELETE', {})).status).toBe(204)
  })

  it('所有公开读取和推荐都屏蔽停用的区域、店铺、菜品', async () => {
    const { area, restaurant, dish } = await menu()
    await call(`/api/admin/areas/${area.id}`, 'PATCH', { enabled: false })
    for (const resource of ['areas', 'restaurants', 'dishes']) {
      expect(await (await call(`/api/${resource}`, 'GET', undefined, {}, false)).json()).toEqual([])
      expect(await (await call(`/api/admin/${resource}`)).json()).toHaveLength(1)
    }
    expect(await (await call('/api/recommend', 'POST', { mode: 'combo' }, {}, false)).json()).toMatchObject({ status: 'empty' })
    await call(`/api/admin/areas/${area.id}`, 'PATCH', { enabled: true })
    await call(`/api/admin/restaurants/${restaurant.id}`, 'PATCH', { enabled: false })
    expect(await (await call('/api/dishes', 'GET', undefined, {}, false)).json()).toEqual([])
    expect(await (await call('/api/recommend', 'POST', { mode: 'dish', filters: { restaurantId: restaurant.id } }, {}, false)).json()).toMatchObject({ status: 'empty' })
    await call(`/api/admin/restaurants/${restaurant.id}`, 'PATCH', { enabled: true })
    await call(`/api/admin/dishes/${dish.id}`, 'PATCH', { enabled: false })
    expect(await (await call('/api/recommend', 'POST', { mode: 'restaurant' }, {}, false)).json()).toMatchObject({ status: 'empty' })
  })

  it('非空父项删除返回关联数量，数据库外键同时拒绝级联丢失', async () => {
    const { area, restaurant, dish } = await menu()
    const areaResponse = await call(`/api/admin/areas/${area.id}`, 'DELETE')
    expect(areaResponse.status).toBe(409)
    expect(await areaResponse.json()).toMatchObject({ error: { code: 'HAS_CHILDREN', details: { restaurants: 1, dishes: 1 } } })
    const restaurantResponse = await call(`/api/admin/restaurants/${restaurant.id}`, 'DELETE')
    expect(restaurantResponse.status).toBe(409)
    expect(await restaurantResponse.json()).toMatchObject({ error: { details: { dishes: 1 } } })
    await expect(env.DB.prepare('DELETE FROM areas WHERE id = ?').bind(area.id).run()).rejects.toThrow(/FOREIGN KEY/)
    expect(await (await call('/api/dishes', 'GET', undefined, {}, false)).json()).toEqual([dish])
  })

  it('验证父项、只读字段、价格、权重和部分更新', async () => {
    const { restaurant, dish } = await menu()
    expect((await call('/api/admin/restaurants', 'POST', { areaId: 'missing', name: 'x' })).status).toBe(400)
    expect((await call('/api/admin/dishes', 'POST', { restaurantId: 'missing', name: 'x', priceCents: 1 })).status).toBe(400)
    for (const input of [{ weight: -1 }, { weight: '2' }, { weight: 1_000_001 }, { priceCents: 1.5 }, { priceCents: -1 }, { priceCents: null }, { enabled: 1 }, { name: ' ' }, { id: 'client-id' }, { updatedAt: 'client-time' }, {}]) {
      expect((await call(`/api/admin/dishes/${dish.id}`, 'PATCH', input)).status).toBe(400)
    }
    expect((await call('/api/admin/areas', 'POST', { name: 'x', type: 'invalid' })).status).toBe(400)
    expect((await call('/api/admin/dishes', 'POST', { restaurantId: restaurant.id, name: 'x' })).status).toBe(400)
    expect((await call('/api/admin/dishes/missing', 'PATCH', { name: 'x' })).status).toBe(404)
    expect((await call('/api/admin/dishes/missing', 'DELETE')).status).toBe(404)
  })

  it('推荐仅使用数据库菜单，支持三种模式、空集合和有限历史', async () => {
    expect(await (await call('/api/recommend', 'POST', { mode: 'combo' }, {}, false)).json()).toMatchObject({ status: 'empty' })
    const { restaurant, dish } = await menu()
    for (const mode of ['restaurant', 'dish', 'combo']) {
      const response = await call('/api/recommend', 'POST', { mode, filters: { restaurantId: restaurant.id } }, {}, false)
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ status: 'ok', restaurant: { id: restaurant.id }, dish: mode === 'restaurant' ? null : { id: dish.id } })
    }
    for (const filters of [{ maxPriceCents: 1249 }, { excludedDishIds: [dish.id] }, { excludedRestaurantIds: [restaurant.id] }]) {
      expect(await (await call('/api/recommend', 'POST', { mode: 'combo', filters }, {}, false)).json()).toMatchObject({ status: 'empty' })
    }
    for (const input of [{ mode: 'unknown' }, { mode: 'dish' }, { mode: 'combo', recentDishIds: Array(6).fill(dish.id) }, { mode: 'combo', filters: { excludedDishIds: Array(201).fill(dish.id) } }, { mode: 'combo', filters: { maxPriceCents: '100' } }, { mode: 'combo', menu: {} }, { mode: 'combo', avoidRecent: 1 }]) {
      expect((await call('/api/recommend', 'POST', input, {}, false)).status).toBe(400)
    }
    await call(`/api/admin/dishes/${dish.id}`, 'PATCH', { weight: 0 })
    expect(await (await call('/api/recommend', 'POST', { mode: 'combo', recentDishIds: [dish.id], avoidRecent: true }, {}, false)).json()).toMatchObject({ status: 'ok', dish: { id: dish.id } })
  })

  it('移动菜品后筛选更新，不混淆不同店铺的同名菜品', async () => {
    const { area, restaurant, dish } = await menu()
    const other = await create<Restaurant>('restaurants', { areaId: area.id, name: '另一店铺' })
    const duplicate = await create<Dish>('dishes', { restaurantId: other.id, name: dish.name, category: dish.category, priceCents: dish.priceCents })
    expect(duplicate.id).not.toBe(dish.id)
    const response = await call(`/api/admin/dishes/${dish.id}`, 'PATCH', { restaurantId: other.id })
    expect(response.status).toBe(200)
    expect(await (await call(`/api/dishes?restaurantId=${restaurant.id}`, 'GET', undefined, {}, false)).json()).toEqual([])
    expect(await (await call(`/api/dishes?restaurantId=${other.id}`, 'GET', undefined, {}, false)).json()).toHaveLength(2)
  })

  it('未知路由与无效 JSON 返回 JSON 错误', async () => {
    const response = await call('/api/does-not-exist', 'GET', undefined, {}, false)
    expect(response.status).toBe(404)
    expect(response.headers.get('Content-Type')).toContain('application/json')
    expect((await call('/api/admin/dishes/%ZZ', 'PATCH', { name: 'x' })).status).toBe(400)
    const malformed = await worker.fetch(new Request('http://localhost/api/recommend', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' }), env)
    expect(malformed.status).toBe(400)
  })

  it('按 UTF-8 字节限制 JSON 大小，并在读取超限时取消流', async () => {
    for (const body of ['x'.repeat(65_537), JSON.stringify({ mode: 'combo', filters: { category: '中'.repeat(30_000) } })]) {
      const response = await worker.fetch(new Request('http://localhost/api/recommend', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }), env)
      expect(response.status).toBe(413)
    }
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({
      pull(controller) { controller.enqueue(new Uint8Array(20_000).fill(32)) },
      cancel() { cancelled = true },
    })
    const options = { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': '1' }, body, duplex: 'half' } as RequestInit & { duplex: 'half' }
    const response = await worker.fetch(new Request('http://localhost/api/recommend', options), env)
    expect(response.status).toBe(413)
    expect(cancelled).toBe(true)
  })
})
