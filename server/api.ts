import type { Area, Dish, Menu, Resource, Restaurant } from '../shared/types'
import { recommend } from '../shared/recommendation'
import { authenticate, requireCsrf, requireSameOrigin } from './auth'
import type { Env } from './env'
import { HttpError, json } from './http'
import { handleAdminSession } from './session'
import { readJson, readOptionalJson, validateId, validateMutation, validateRecommend, validateRestaurantCategoryMutation } from './validation'

type Entity = Area | Restaurant | Dish
type Row = Record<string, string | number>

const columns: Record<Resource, Record<string, string>> = {
  areas: { name: 'name', type: 'type', sortOrder: 'sort_order', enabled: 'enabled' },
  restaurants: { areaId: 'area_id', name: 'name', category: 'category', location: 'location', enabled: 'enabled' },
  dishes: { restaurantId: 'restaurant_id', name: 'name', category: 'category', priceCents: 'price_cents', weight: 'weight', notes: 'notes', enabled: 'enabled' },
}

function entity(resource: Resource, row: Row): Entity {
  const common = { id: row.id as string, name: row.name as string, enabled: row.enabled === 1, createdAt: row.created_at as string, updatedAt: row.updated_at as string }
  if (resource === 'areas') return { ...common, type: row.type as Area['type'], sortOrder: row.sort_order as number }
  if (resource === 'restaurants') return { ...common, areaId: row.area_id as string, category: row.category as string, location: row.location as string }
  return { ...common, restaurantId: row.restaurant_id as string, category: row.category as string, priceCents: row.price_cents as number, weight: row.weight as number, notes: row.notes as string }
}

async function get(env: Env, resource: Resource, id: string): Promise<Entity> {
  const row = await env.DB.prepare(`SELECT * FROM ${resource} WHERE id = ?`).bind(id).first<Row>()
  if (!row) throw new HttpError(404, 'NOT_FOUND', '记录不存在')
  return entity(resource, row)
}

async function list(env: Env, resource: Resource, admin: boolean, url?: URL): Promise<Entity[]> {
  const conditions: string[] = []
  const parameters: string[] = []
  let joins = ''
  if (resource === 'restaurants') joins = ' JOIN areas a ON a.id = t.area_id'
  if (resource === 'dishes') joins = ' JOIN restaurants r ON r.id = t.restaurant_id JOIN areas a ON a.id = r.area_id'
  if (!admin) {
    conditions.push('t.enabled = 1')
    if (resource !== 'areas') conditions.push('a.enabled = 1')
    if (resource === 'dishes') conditions.push('r.enabled = 1')
  }
  const filter = (key: string, column: string) => {
    const value = url?.searchParams.get(key)
    if (value !== undefined && value !== null) {
      conditions.push(`${column} = ?`)
      parameters.push(key === 'category' ? value.trim() : validateId(value))
    }
  }
  filter('areaId', resource === 'areas' ? 't.id' : resource === 'restaurants' ? 't.area_id' : 'r.area_id')
  if (resource !== 'areas') filter('restaurantId', resource === 'restaurants' ? 't.id' : 't.restaurant_id')
  if (resource !== 'areas') filter('category', 't.category')
  const order = resource === 'areas' ? 't.sort_order, t.name, t.id' : 't.name, t.id'
  const result = await env.DB.prepare(`SELECT t.* FROM ${resource} t${joins}${conditions.length ? ` WHERE ${conditions.join(' AND ')}` : ''} ORDER BY ${order}`).bind(...parameters).all<Row>()
  return result.results.map((row) => entity(resource, row))
}

async function requireParent(env: Env, resource: Resource, values: Record<string, unknown>): Promise<void> {
  const key = resource === 'restaurants' ? 'areaId' : resource === 'dishes' ? 'restaurantId' : null
  if (!key || !Object.hasOwn(values, key)) return
  const table = resource === 'restaurants' ? 'areas' : 'restaurants'
  const found = await env.DB.prepare(`SELECT id FROM ${table} WHERE id = ?`).bind(values[key]).first()
  if (!found) throw new HttpError(400, 'INVALID_PARENT', resource === 'restaurants' ? '所属区域不存在' : '所属店铺不存在')
}

function dbValue(value: unknown): string | number {
  return typeof value === 'boolean' ? Number(value) : value as string | number
}

async function remove(env: Env, resource: Resource, id: string): Promise<Response> {
  await get(env, resource, id)
  if (resource !== 'dishes') {
    const counts = resource === 'areas'
      ? await env.DB.prepare('SELECT (SELECT COUNT(*) FROM restaurants WHERE area_id = ?) AS restaurants, (SELECT COUNT(*) FROM dishes d JOIN restaurants r ON r.id = d.restaurant_id WHERE r.area_id = ?) AS dishes').bind(id, id).first<{ restaurants: number; dishes: number }>()
      : await env.DB.prepare('SELECT COUNT(*) AS dishes FROM dishes WHERE restaurant_id = ?').bind(id).first<{ dishes: number }>()
    if (counts && Object.values(counts).some((count) => count > 0)) throw new HttpError(409, 'HAS_CHILDREN', '请先移动或删除关联数据', counts)
  }
  try {
    await env.DB.prepare(`DELETE FROM ${resource} WHERE id = ?`).bind(id).run()
  } catch (error) {
    if (String(error).includes('FOREIGN KEY')) throw new HttpError(409, 'HAS_CHILDREN', '关联数据发生变化，请刷新后重试')
    throw error
  }
  return new Response(null, { status: 204 })
}

export async function handleApi(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  if (url.pathname === '/api/admin/session') return handleAdminSession(request, env)
  if (url.pathname === '/api/recommend' && request.method === 'POST') {
    const input = validateRecommend(await readJson(request))
    const [areas, restaurants, dishes] = await Promise.all([
      list(env, 'areas', false), list(env, 'restaurants', false), list(env, 'dishes', false),
    ])
    return json(recommend({ areas, restaurants, dishes } as Menu, input))
  }
  const match = /^\/api\/(admin\/)?(areas|restaurants|dishes)(?:\/([^/]+))?$/.exec(url.pathname)
  if (!match) throw new HttpError(404, 'NOT_FOUND', 'API 不存在')
  const admin = !!match[1]
  const resource = match[2] as Resource
  if (admin) {
    const session = await authenticate(request, env)
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      requireSameOrigin(request)
      requireCsrf(request, session)
    }
  }
  let id: string | null = null
  if (match[3]) {
    try { id = validateId(decodeURIComponent(match[3])) }
    catch (error) {
      if (error instanceof HttpError) throw error
      throw new HttpError(400, 'INVALID_INPUT', 'ID 编码无效')
    }
  }
  if (request.method === 'GET' && !id) return json(await list(env, resource, admin, url))
  if (!admin) throw new HttpError(404, 'NOT_FOUND', 'API 不存在')
  if (request.method === 'DELETE' && id) {
    const input = await readOptionalJson(request)
    if (input !== undefined && (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length)) {
      throw new HttpError(400, 'INVALID_INPUT', '删除请求仅允许空 JSON 对象或无请求体')
    }
    return remove(env, resource, id)
  }
  if ((request.method === 'POST' && !id) || (request.method === 'PATCH' && id)) {
    const partial = request.method === 'PATCH'
    const values = validateMutation(resource, await readJson(request), partial)
    const existing = id ? await get(env, resource, id) : null
    if (resource === 'restaurants') validateRestaurantCategoryMutation(values, existing ? (existing as Restaurant).category : undefined)
    await requireParent(env, resource, values)
    const keys = Object.keys(values)
    const now = new Date().toISOString()
    const recordId = id ?? crypto.randomUUID()
    try {
      if (partial) {
        await env.DB.prepare(`UPDATE ${resource} SET ${keys.map((key) => `${columns[resource][key]} = ?`).join(', ')}, updated_at = ? WHERE id = ?`).bind(...keys.map((key) => dbValue(values[key])), now, recordId).run()
      } else {
        await env.DB.prepare(`INSERT INTO ${resource} (id, ${keys.map((key) => columns[resource][key]).join(', ')}, created_at, updated_at) VALUES (${Array(keys.length + 3).fill('?').join(', ')})`).bind(recordId, ...keys.map((key) => dbValue(values[key])), now, now).run()
      }
    } catch (error) {
      if (String(error).includes('FOREIGN KEY')) throw new HttpError(400, 'INVALID_PARENT', '所属区域或店铺已不存在，请刷新后重试')
      throw error
    }
    return json(await get(env, resource, recordId), partial ? 200 : 201)
  }
  throw new HttpError(404, 'NOT_FOUND', 'API 不存在')
}
