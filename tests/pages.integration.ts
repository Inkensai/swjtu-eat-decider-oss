import { readFile } from 'node:fs/promises'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, URL as NodeURL } from 'node:url'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { convertV4MiniflareOptions, Miniflare } from 'miniflare'
import { SESSION_COOKIE } from '../server/auth'
import type { Area, Dish, Restaurant } from '../shared/types'
import { DEFAULT_RESTAURANT_CATEGORY } from '../shared/categories'
import { TEST_ADMIN_KEY, accessKeyHash, findCookie, setCookies } from './support'

const origin = 'https://pages-test.example'
const pagesDirectory = fileURLToPath(new NodeURL('../dist/pages', import.meta.url))
const workerPath = fileURLToPath(new NodeURL('../dist/pages/_worker.js', import.meta.url))
const migrationsDirectory = fileURLToPath(new NodeURL('../migrations', import.meta.url))
const seedArea = 'seed-area'
const seedRestaurant = 'seed-restaurant'
const seedDish = 'seed-dish'
let runtime: Miniflare
let preview: Miniflare
let db: D1Database
const unexpectedNetwork: string[] = []
let adminCookie = ''
let adminCsrf = ''

interface CallOptions {
  method?: string
  body?: unknown
  headers?: Record<string, string>
}

async function call(path: string, options: CallOptions = {}, target = runtime): Promise<Response> {
  const { method = 'GET', body, headers = {} } = options
  return await target.dispatchFetch(`${origin}${path}`, {
    method,
    headers: {
      Origin: origin,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }) as unknown as Response
}

async function login(target = runtime): Promise<Response> {
  return call('/api/admin/session', { method: 'POST', body: { password: TEST_ADMIN_KEY } }, target)
}

async function loginAsAdmin(): Promise<void> {
  const response = await login()
  expect(response.status).toBe(200)
  adminCookie = findCookie(response, SESSION_COOKIE)
  adminCsrf = (await response.json() as { csrfToken: string }).csrfToken
  expect(adminCookie).not.toBe('')
  expect(adminCsrf).not.toBe('')
}

async function adminCall(path: string, options: CallOptions = {}): Promise<Response> {
  const { method = 'GET', body, headers = {} } = options
  return call(path, {
    method,
    body,
    headers: {
      Cookie: adminCookie,
      ...(method === 'GET' ? {} : { 'X-CSRF-Token': adminCsrf }),
      ...headers,
    },
  })
}

beforeAll(async () => {
  await readFile(workerPath, 'utf8')
  const options = {
    modules: true,
    scriptPath: workerPath,
    compatibilityDate: '2026-10-26',
    bindings: { ADMIN_ACCESS_KEY_HASH: accessKeyHash() },
    assets: {
      directory: pagesDirectory,
      binding: 'ASSETS',
      run_worker_first: true,
      assetConfig: { not_found_handling: 'single-page-application' as const },
    },
    outboundService: async (request: Request) => {
      unexpectedNetwork.push(request.url)
      return new Response('External network is forbidden in this test', { status: 502 })
    },
  }
  const productionOptions = convertV4MiniflareOptions({ ...options, name: 'pages-production-test', d1Databases: ['DB'] })
  const previewOptions = convertV4MiniflareOptions({ ...options, name: 'pages-preview-test' })
  // The V4 converter omits the V5 flag required to route assets requests to the user Worker.
  for (const converted of [productionOptions, previewOptions]) converted.workers[0]!.config.assets!.hasUserWorker = true
  runtime = new Miniflare(productionOptions)
  preview = new Miniflare(previewOptions)
  db = await runtime.getD1Database('DB', 'pages-production-test') as unknown as D1Database
  for (const file of readdirSync(migrationsDirectory).filter((name) => name.endsWith('.sql')).sort()) {
    const migration = await readFile(join(migrationsDirectory, file), 'utf8')
    await db.batch(migration.split(';').map(sql => sql.trim()).filter(Boolean).map(sql => db.prepare(sql)))
  }
})

beforeEach(async () => {
  await db.batch([
    ...['dishes', 'restaurants', 'areas'].map(table => db.prepare(`DELETE FROM ${table}`)),
    db.prepare('DELETE FROM admin_sessions'),
    db.prepare('DELETE FROM admin_login_attempts'),
    db.prepare("INSERT INTO areas (id, name, type, created_at, updated_at) VALUES (?, '测试食堂', 'canteen', '2026-10-26T00:00:00Z', '2026-10-26T00:00:00Z')").bind(seedArea),
    db.prepare("INSERT INTO restaurants (id, area_id, name, created_at, updated_at) VALUES (?, ?, '测试窗口', '2026-10-26T00:00:00Z', '2026-10-26T00:00:00Z')").bind(seedRestaurant, seedArea),
    db.prepare("INSERT INTO dishes (id, restaurant_id, name, category, price_cents, weight, created_at, updated_at) VALUES (?, ?, '测试面', '面食', 1250, 2, '2026-10-26T00:00:00Z', '2026-10-26T00:00:00Z')").bind(seedDish, seedRestaurant),
  ])
  adminCookie = ''
  adminCsrf = ''
})

afterAll(async () => {
  await Promise.all([runtime?.dispose(), preview?.dispose()])
  expect(unexpectedNetwork).toEqual([])
})

describe('真实 Pages advanced-mode 构建产物', () => {
  it('锁定 Pages 生产绑定、路由和应用内认证产物契约', async () => {
    const config = JSON.parse(await readFile(new NodeURL('../wrangler.jsonc', import.meta.url), 'utf8'))
    expect(config.name).toBe('eat-decider')
    expect(config.pages_build_output_dir).toBe('./dist/pages')
    expect(config).not.toHaveProperty('main')
    expect(config).not.toHaveProperty('assets')
    expect(config.d1_databases).toEqual([])
    expect(config.env.preview.d1_databases).toEqual([])
    expect(config.env.production.d1_databases).toEqual([expect.objectContaining({
      binding: 'DB', database_name: 'eat-decider-db',
    })])
    expect(JSON.stringify(config)).not.toMatch(/ACCESS_TEAM_DOMAIN|ACCESS_AUD|ADMIN_EMAILS/)
    const routes = JSON.parse(await readFile(new NodeURL('../dist/pages/_routes.json', import.meta.url), 'utf8'))
    expect(routes).toEqual({ version: 1, include: ['/api', '/api/*', '/admin', '/admin/*'], exclude: [] })
    const bundle = await readFile(workerPath, 'utf8')
    for (const marker of ['__LOCAL_DEV__', 'LOCAL_ADMIN_TOKEN', 'Bearer', 'ACCESS_TEAM_DOMAIN', 'ACCESS_AUD', 'ADMIN_EMAILS', 'Cf-Access-Jwt-Assertion', 'cloudflareaccess']) {
      expect(bundle).not.toContain(marker)
    }
    expect(bundle).toContain('ADMIN_PASSWORD_HASH')
    expect(bundle).toContain('ADMIN_ACCESS_KEY_HASH')
    expect(bundle).not.toContain(TEST_ADMIN_KEY)
  })

  it.each([
    ['areas', seedArea], ['restaurants', seedRestaurant], ['dishes', seedDish],
  ])('匿名读取共享 %s 菜单', async (resource, id) => {
    const response = await call(`/api/${resource}`)
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toContain('application/json')
    expect(await response.json()).toMatchObject([{ id }])
  })

  it.each(['restaurant', 'dish', 'combo'])('通过真实生产入口执行 %s 推荐', async mode => {
    const response = await call('/api/recommend', {
      method: 'POST',
      body: {
        mode, filters: { restaurantId: seedRestaurant, maxPriceCents: 1250 },
        avoidRecent: true, recentDishIds: [seedDish],
      },
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      status: 'ok', restaurant: { id: seedRestaurant },
      dish: mode === 'restaurant' ? null : { id: seedDish, priceCents: 1250 },
    })
  })

  it('空候选返回明确结果，未知 API 不落入 SPA HTML', async () => {
    const empty = await call('/api/recommend', { method: 'POST', body: { mode: 'combo', filters: { maxPriceCents: 1249 } } })
    expect(empty.status).toBe(200)
    expect(await empty.json()).toMatchObject({ status: 'empty' })
    for (const path of ['/api', '/api/unknown', '/api/admin/unknown']) {
      const response = await call(path, { headers: { Accept: 'text/html' } })
      expect(response.status).toBe(404)
      expect(response.headers.get('Content-Type')).toContain('application/json')
      expect(await response.json()).toMatchObject({ error: { code: 'NOT_FOUND' } })
    }
  })

  it('真实 Pages 入口按店铺分类筛选推荐，并默认归入其他分类', async () => {
    await loginAsAdmin()
    expect((await adminCall('/api/admin/restaurants', {
      method: 'POST', body: { areaId: seedArea, name: '非法分类店', category: '川菜' },
    })).status).toBe(400)
    const blankSame = await adminCall(`/api/admin/restaurants/${seedRestaurant}`, { method: 'PATCH', body: { category: '' } })
    expect(blankSame.status).toBe(200)
    expect(await blankSame.json()).toMatchObject({ id: seedRestaurant, category: '' })
    expect((await adminCall(`/api/admin/restaurants/${seedRestaurant}`, { method: 'PATCH', body: { category: '川菜' } })).status).toBe(400)
    const renamed = await adminCall(`/api/admin/restaurants/${seedRestaurant}`, { method: 'PATCH', body: { name: '测试窗口改名' } })
    expect(renamed.status).toBe(200)
    expect(await renamed.json()).toMatchObject({ id: seedRestaurant, name: '测试窗口改名', category: '' })

    const noodle = await (await adminCall('/api/admin/restaurants', {
      method: 'POST', body: { areaId: seedArea, name: '粉面分类店', category: '粉面 / 面食' },
    })).json() as Restaurant
    const rice = await (await adminCall('/api/admin/restaurants', {
      method: 'POST', body: { areaId: seedArea, name: '盖饭分类店', category: '快餐 / 盖饭' },
    })).json() as Restaurant
    const defaulted = await (await adminCall('/api/admin/restaurants', {
      method: 'POST', body: { areaId: seedArea, name: '默认分类店' },
    })).json() as Restaurant
    expect(defaulted.category).toBe(DEFAULT_RESTAURANT_CATEGORY)
    expect((await adminCall('/api/admin/dishes', {
      method: 'POST', body: { restaurantId: noodle.id, name: '非法菜品分类', category: '粉面', priceCents: 1000 },
    })).status).toBe(400)
    await adminCall('/api/admin/dishes', { method: 'POST', body: { restaurantId: noodle.id, name: '粉面店菜品', category: '粉面 / 米线', priceCents: 1000 } })
    await adminCall('/api/admin/dishes', { method: 'POST', body: { restaurantId: rice.id, name: '盖饭店菜品', category: '米饭 / 套餐', priceCents: 1100 } })

    const filtered = await call('/api/recommend', {
      method: 'POST', body: { mode: 'combo', filters: { restaurantCategory: '快餐 / 盖饭' } },
    })
    expect(await filtered.json()).toMatchObject({ status: 'ok', restaurant: { id: rice.id } })
    expect((await call('/api/recommend', {
      method: 'POST', body: { mode: 'combo', filters: { restaurantCategory: '不存在的分类' } },
    })).status).toBe(400)
  })

  it('未登录时默认拒绝全部管理 API，管理页面本身公开', async () => {
    const forgedHeaders = {
      Authorization: `Bearer ${'x'.repeat(64)}`,
      'Cf-Access-Jwt-Assertion': 'forged-access-token',
      Cookie: `${SESSION_COOKIE}=forged-token-forged-token-forged-token-forged-token`,
      Host: 'localhost',
    }
    for (const path of ['/api/admin/areas', '/api/admin/dishes']) {
      expect((await call(path, { headers: forgedHeaders })).status).toBe(401)
    }
    for (const [path, method, body] of [
      ['/api/admin/areas', 'POST', { name: '未经授权的区域' }],
      ['/api/admin/areas/' + seedArea, 'PATCH', { name: '未经授权的名称' }],
      ['/api/admin/areas/' + seedArea, 'DELETE', undefined],
    ] as const) {
      expect((await call(path, { method, body, headers: forgedHeaders })).status).toBe(401)
    }
    expect(await (await call('/api/areas')).json()).toMatchObject([{ id: seedArea, name: '测试食堂' }])

    const adminPage = await call('/admin', { headers: { Accept: 'text/html' } })
    expect(adminPage.status).toBe(200)
    expect(await adminPage.text()).toContain('<html')
  })

  it('应用内管理员登录后可完成 CRUD，RESTRICT 保护父子数据', async () => {
    await loginAsAdmin()
    const createArea = await adminCall('/api/admin/areas', { method: 'POST', body: { name: '新增区域', type: 'nearby' } })
    expect(createArea.status).toBe(201)
    const area = await createArea.json() as Area
    const createRestaurant = await adminCall('/api/admin/restaurants', { method: 'POST', body: { areaId: area.id, name: '新增店铺' } })
    expect(createRestaurant.status).toBe(201)
    const restaurant = await createRestaurant.json() as Restaurant
    const createDish = await adminCall('/api/admin/dishes', { method: 'POST', body: { restaurantId: restaurant.id, name: '新增菜品', priceCents: 1500 } })
    expect(createDish.status).toBe(201)
    const dish = await createDish.json() as Dish
    expect((await adminCall('/api/admin/dishes')).status).toBe(200)
    const update = await adminCall(`/api/admin/dishes/${dish.id}`, { method: 'PATCH', body: { name: '更新菜品', priceCents: 1600 } })
    expect(update.status).toBe(200)
    expect(await update.json()).toMatchObject({ id: dish.id, name: '更新菜品', priceCents: 1600 })
    for (const [resource, id] of [['areas', area.id], ['restaurants', restaurant.id]]) {
      const denied = await adminCall(`/api/admin/${resource}/${id}`, { method: 'DELETE' })
      expect(denied.status).toBe(409)
      expect(await denied.json()).toMatchObject({ error: { code: 'HAS_CHILDREN' } })
    }
    await expect(db.prepare('DELETE FROM restaurants WHERE id = ?').bind(restaurant.id).run()).rejects.toThrow(/FOREIGN KEY/)
    for (const [resource, id] of [['dishes', dish.id], ['restaurants', restaurant.id], ['areas', area.id]]) {
      expect((await adminCall(`/api/admin/${resource}/${id}`, { method: 'DELETE' })).status).toBe(204)
    }
    expect((await adminCall('/api/admin/session', { method: 'DELETE' })).status).toBe(204)
    expect((await adminCall('/api/admin/areas')).status).toBe(401)
  })

  it('错误凭据、缺少 CSRF 与跨源写入都被拒绝', async () => {
    const wrong = await call('/api/admin/session', { method: 'POST', body: { password: 'wrong-access-key' } })
    expect(wrong.status).toBe(401)
    expect(findCookie(wrong, SESSION_COOKIE)).toBe('')

    await loginAsAdmin()
    expect((await call('/api/admin/areas', { method: 'POST', body: { name: '无 CSRF' }, headers: { Cookie: adminCookie } })).status).toBe(403)
    expect((await adminCall('/api/admin/areas', { method: 'POST', body: { name: '跨源写入' }, headers: { Origin: 'https://attacker.example' } })).status).toBe(403)
    expect((await call('/api/admin/session', { method: 'POST', body: { password: TEST_ADMIN_KEY }, headers: { Origin: 'https://attacker.example' } })).status).toBe(403)
    expect(setCookies(wrong).join('\n')).not.toContain('Max-Age=43200')
  })

  it('ASSETS 提供真实 SPA 页面、JS/CSS；管理页面公开且由前端显示登录表单', async () => {
    const expectedHtml = await readFile(new NodeURL('../dist/pages/index.html', import.meta.url), 'utf8')
    for (const path of ['/', '/history', '/admin']) {
      const response = await call(path, { headers: { Accept: 'text/html' } })
      expect(response.status).toBe(200)
      expect(await response.text()).toBe(expectedHtml)
    }
    const resources = [...expectedHtml.matchAll(/(?:src|href)="(\/assets\/[^\"]+)"/g)].map(match => match[1]!)
    expect(resources.some(path => path.endsWith('.js'))).toBe(true)
    expect(resources.some(path => path.endsWith('.css'))).toBe(true)
    for (const path of resources) {
      const response = await call(path)
      expect(response.status).toBe(200)
      expect(response.headers.get('Content-Type')).toMatch(path.endsWith('.css') ? /text\/css/ : /javascript/)
      expect(await response.text()).not.toContain('<!doctype html>')
    }
  })

  it('无 DB 的 Preview 保留 SPA，并拒绝菜单读取、推荐和登录', async () => {
    const staticPage = await call('/history', { headers: { Accept: 'text/html' } }, preview)
    expect(staticPage.status).toBe(200)
    expect((await call('/api/admin/areas', {}, preview)).status).toBe(401)
    for (const [path, method, body] of [
      ['/api/areas', 'GET', undefined],
      ['/api/recommend', 'POST', { mode: 'combo' }],
      ['/api/admin/session', 'POST', { password: TEST_ADMIN_KEY }],
    ] as const) {
      const response = await call(path, { method, body }, preview)
      expect(response.status).toBe(500)
      expect(await response.json()).toMatchObject({ error: { code: 'INTERNAL_ERROR' } })
      expect(findCookie(response, SESSION_COOKIE)).toBe('')
    }
    expect(await (await call('/api/areas')).json()).toMatchObject([{ id: seedArea, name: '测试食堂' }])
  })
})
