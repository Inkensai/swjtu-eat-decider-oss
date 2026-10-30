import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath, URL as NodeURL } from 'node:url'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { convertV4MiniflareOptions, Miniflare } from 'miniflare'
import worker from '../server/index'
import { createAdminSession, SESSION_COOKIE } from '../server/auth'
import type { Env } from '../server/env'
import { csvDishData, parseCsv, type ImportReport } from '../shared/menu-import'

let runtime: Miniflare
let env: Env
let cookie = ''
let csrf = ''
const origin = 'http://localhost'
const snapshot = () => ({
  version: 1,
  areas: [{ id: 'area-import', name: '新食堂', type: 'canteen', sortOrder: 2, enabled: false }],
  restaurants: [{ id: 'restaurant-import', areaId: 'area-import', name: '新窗口', category: '历史风味', openingHours: '11:00-14:00,17:00-21:00', closedToday: '2026-10-30' }],
  dishes: [{ id: 'dish-import', restaurantId: 'restaurant-import', name: '盖饭', category: '历史饭类', priceCents: 1550, weight: 2, soldOutOn: '2026-10-30', createdAt: '2025-01-01T00:00:00.000Z' }],
})
const empty = () => ({ version: 1, areas: [], restaurants: [], dishes: [] })

async function call(body: unknown, headers: Record<string, string> = {}, target = env): Promise<Response> {
  return worker.fetch(new Request(`${origin}/api/admin/import`, {
    method: 'POST', headers: { Origin: origin, Cookie: cookie, 'X-CSRF-Token': csrf, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
  }), target)
}
async function count(table: string): Promise<number> {
  return (await env.DB.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first<{ count: number }>())!.count
}
beforeAll(async () => {
  runtime = new Miniflare(convertV4MiniflareOptions({ name: 'import-test', modules: true, script: 'export default { fetch() { return new Response("ok") } }', compatibilityDate: '2026-10-26', d1Databases: ['DB'] }))
  env = { DB: await runtime.getD1Database('DB', 'import-test') as unknown as D1Database, ASSETS: { fetch: async () => new Response('static') } as unknown as Fetcher }
  const directory = fileURLToPath(new NodeURL('../migrations', import.meta.url))
  for (const name of readdirSync(directory).filter((name) => name.endsWith('.sql')).sort()) {
    const migration = readFileSync(join(directory, name), 'utf8')
    await env.DB.batch(migration.split(';').map((sql) => sql.trim()).filter(Boolean).map((sql) => env.DB.prepare(sql)))
  }
})
beforeEach(async () => {
  await env.DB.batch(['ratings', 'dishes', 'restaurants', 'areas', 'admin_sessions'].map((table) => env.DB.prepare(`DELETE FROM ${table}`)))
  const session = await createAdminSession(env)
  cookie = `${SESSION_COOKIE}=${session.token}`
  csrf = session.csrfToken
})
afterAll(async () => { await runtime?.dispose() })

describe('menu import safety and atomic writes', () => {
  it('previews without writing and restores IDs, parent links, timestamps and availability', async () => {
    const data = snapshot()
    const response = await call({ dryRun: true, data })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ valid: true, applied: false, counts: { areas: 1, restaurants: 1, dishes: 1 } })
    expect(await count('areas')).toBe(0)
    const apply = await call({ dryRun: false, data })
    expect(apply.status).toBe(201)
    expect(await env.DB.prepare('SELECT id, restaurant_id, price_cents, created_at, sold_out_on FROM dishes').first()).toMatchObject({ id: 'dish-import', restaurant_id: 'restaurant-import', price_cents: 1550, created_at: '2025-01-01T00:00:00.000Z', sold_out_on: '2026-10-30' })
    expect(await env.DB.prepare('SELECT opening_hours, closed_today FROM restaurants').first()).toEqual({ opening_hours: '11:00-14:00,17:00-21:00', closed_today: '2026-10-30' })
  })
  it('requires authenticated session, same origin and CSRF even for preview', async () => {
    const body = { dryRun: true, data: snapshot() }
    expect((await call(body, { Cookie: '' })).status).toBe(401)
    expect((await call(body, { Origin: 'https://attacker.invalid' })).status).toBe(403)
    expect((await call(body, { 'X-CSRF-Token': '' })).status).toBe(403)
    expect(await count('areas')).toBe(0)
  })
  it('rejects oversized requests, too many records, empty input and unknown fields', async () => {
    expect((await call({ dryRun: true, data: { ...empty(), areas: [{ name: 'x'.repeat(70_000) }] } })).status).toBe(413)
    expect((await call({ dryRun: true, data: { ...empty(), areas: Array.from({ length: 201 }, (_, index) => ({ name: `area-${index}` })) } })).status).toBe(400)
    expect((await call({ dryRun: true, data: empty() })).status).toBe(400)
    expect((await call({ dryRun: true, data: snapshot(), ignoreErrors: true })).status).toBe(400)
  })
  it('reports invalid rows and missing parents; valid earlier rows remain unwritten', async () => {
    const data = { ...snapshot(), dishes: [{ name: 'bad price', restaurantId: 'restaurant-import', priceCents: -1 }, { name: 'orphan', restaurantId: 'missing', priceCents: 100 }] }
    const response = await call({ dryRun: true, data })
    const report = await response.json() as ImportReport
    expect(report.valid).toBe(false)
    expect(report.issues).toHaveLength(2)
    expect(report.issues.map((issue) => issue.row)).toEqual([1, 2])
    expect((await call({ dryRun: false, data })).status).toBe(400)
    expect(await count('areas')).toBe(0)
  })
  it('rejects invalid availability dates/ranges using the normal server validators', async () => {
    const data = snapshot()
    data.restaurants[0]!.openingHours = '25:00-26:00'
    data.dishes[0]!.soldOutOn = '2026-02-30'
    const report = await (await call({ dryRun: true, data })).json() as ImportReport
    expect(report.valid).toBe(false)
    expect(report.issues.some((issue) => issue.resource === 'restaurants')).toBe(true)
    expect(report.issues.some((issue) => issue.resource === 'dishes')).toBe(true)
    expect(await count('areas')).toBe(0)
  })
  it('detects repeated IDs and trimmed names within an import and against existing records', async () => {
    const duplicate = { ...empty(), areas: [{ id: 'same', name: '北区' }, { id: 'same', name: ' 北区 ' }] }
    const report = await (await call({ dryRun: true, data: duplicate })).json() as ImportReport
    expect(report.issues.map((issue) => issue.message).join(' ')).toMatch(/ID 重复/)
    expect(report.issues.map((issue) => issue.message).join(' ')).toMatch(/名称重复/)
    expect((await call({ dryRun: false, data: snapshot() })).status).toBe(201)
    const retry = await (await call({ dryRun: true, data: snapshot() })).json() as ImportReport
    expect(retry.valid).toBe(false)
    expect(retry.issues).toHaveLength(6)
    expect(await count('dishes')).toBe(1)
  })
  it('allows names in distinct parents and attaches CSV dishes to an existing restaurant', async () => {
    await call({ dryRun: false, data: snapshot() })
    const csv = 'name,category,price,weight,notes\r\n"辣子,鸡",米饭 / 套餐,12.34,0,"他说""少辣""\n加饭"\r\n'
    const response = await call({ dryRun: false, csv, restaurantId: 'restaurant-import' })
    expect(response.status).toBe(201)
    expect(await env.DB.prepare('SELECT name, price_cents, notes FROM dishes WHERE name = ?').bind('辣子,鸡').first()).toEqual({ name: '辣子,鸡', price_cents: 1234, notes: '他说"少辣"\n加饭' })
    expect((await call({ dryRun: false, data: { ...empty(), areas: [{ id: 'other-area', name: '另一食堂' }], restaurants: [{ id: 'other-store', name: '新窗口', areaId: 'other-area' }] } })).status).toBe(201)
  })
  it('rejects CSV unknown category and non-finite or out-of-range prices', async () => {
    await call({ dryRun: false, data: snapshot() })
    const report = await (await call({ dryRun: true, csv: 'name,category,price,weight,notes\n未知,随意分类,1.00,1,\n超价,,1000000.01,1,', restaurantId: 'restaurant-import' })).json() as ImportReport
    expect(report.valid).toBe(false)
    expect(report.issues).toHaveLength(2)
    expect(await count('dishes')).toBe(1)
  })
  it('rolls the whole batch back if a duplicate appears after validation', async () => {
    const database = env.DB
    let batches = 0
    const raceEnv = { ...env, DB: {
      prepare: database.prepare.bind(database),
      batch: async (statements: D1PreparedStatement[]) => {
        batches++
        if (batches === 2) await database.prepare("INSERT INTO areas (id,name,created_at,updated_at) VALUES ('external','第二个','now','now')").run()
        return database.batch(statements)
      },
    } as D1Database }
    const response = await call({ dryRun: false, data: { ...empty(), areas: [{ id: 'first', name: '第一个' }, { id: 'second', name: '第二个' }] } }, {}, raceEnv)
    expect(response.status).toBe(409)
    expect(await count('areas')).toBe(1)
    expect(await database.prepare('SELECT id FROM areas WHERE id = ?').bind('first').first()).toBeNull()
  })
})

describe('CSV parser', () => {
  it('accepts BOM, CRLF and escaped quotes and rejects malformed quoted fields', () => {
    expect(parseCsv('\uFEFFa,b\r\n"x,y","z""q"\r\n')).toEqual([['a', 'b'], ['x,y', 'z"q']])
    expect(() => parseCsv('a,"unfinished')).toThrow(/未闭合/)
    expect(() => parseCsv('a,"closed"junk')).toThrow(/引号/)
    expect(() => csvDishData('name,price\na,1', 'r')).toThrow(/表头/)
    expect(() => csvDishData('name,category,price,weight,notes\na,,1.001,1,', 'r')).toThrow(/价格/)
  })
})
