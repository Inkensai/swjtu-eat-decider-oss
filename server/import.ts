import type { Resource } from '../shared/types'
import { csvDishData, IMPORT_RECORD_LIMIT, type ImportIssue, type ImportReport } from '../shared/menu-import'
import { authenticate, requireCsrf, requireSameOrigin } from './auth'
import type { Env } from './env'
import { HttpError, json } from './http'
import { readJson, validateDishCategoryMutation, validateId, validateMutation } from './validation'

type Values = Record<string, string | number | boolean>
interface ImportRow { resource: Resource; row: number; id: string; createdAt: string; updatedAt: string; values: Values }
interface Existing { id: string; name: string; parent_id: string }
const resources: Resource[] = ['areas', 'restaurants', 'dishes']
const columns: Record<Resource, Record<string, string>> = {
  areas: { name: 'name', type: 'type', sortOrder: 'sort_order', enabled: 'enabled' },
  restaurants: { areaId: 'area_id', name: 'name', category: 'category', location: 'location', openingHours: 'opening_hours', closedToday: 'closed_today', enabled: 'enabled' },
  dishes: { restaurantId: 'restaurant_id', name: 'name', category: 'category', priceCents: 'price_cents', weight: 'weight', notes: 'notes', soldOutOn: 'sold_out_on', enabled: 'enabled' },
}

function record(value: unknown, allowed: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'INVALID_IMPORT', '导入内容必须为 JSON 对象')
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw new HttpError(400, 'INVALID_IMPORT', '导入内容含有不支持的字段')
  return value as Record<string, unknown>
}
function timestamp(value: unknown, fallback: string): string {
  if (value === undefined) return fallback
  if (typeof value !== 'string' || value.length > 40 || !Number.isFinite(Date.parse(value))) throw new Error('创建或更新时间无效')
  return new Date(value).toISOString()
}
function parent(row: ImportRow): string { return String(row.values.areaId ?? row.values.restaurantId ?? '') }
function nameKey(name: string, parentId: string): string { return JSON.stringify([parentId, name.trim()]) }

export async function handleMenuImport(request: Request, env: Env): Promise<Response> {
  const session = await authenticate(request, env)
  if (request.method !== 'POST') throw new HttpError(405, 'METHOD_NOT_ALLOWED', '请使用 POST 导入', undefined, { Allow: 'POST' })
  requireSameOrigin(request)
  requireCsrf(request, session)
  const input = record(await readJson(request), ['dryRun', 'data', 'csv', 'restaurantId'])
  if (typeof input.dryRun !== 'boolean') throw new HttpError(400, 'INVALID_IMPORT', '必须明确指定 dryRun')
  const csv = Object.hasOwn(input, 'csv')
  let rawData: unknown
  if (csv) {
    if (Object.hasOwn(input, 'data') || typeof input.csv !== 'string') throw new HttpError(400, 'INVALID_IMPORT', 'CSV 与 JSON 导入不能同时提交')
    try { rawData = csvDishData(input.csv, validateId(input.restaurantId)) }
    catch (error) { throw new HttpError(400, 'INVALID_IMPORT', error instanceof Error ? error.message : 'CSV 格式无效') }
  } else {
    if (Object.hasOwn(input, 'restaurantId')) throw new HttpError(400, 'INVALID_IMPORT', 'JSON 数据应在每条记录内指定所属对象')
    rawData = input.data
  }
  const data = record(rawData, ['version', ...resources])
  if (data.version !== 1 || resources.some((resource) => !Array.isArray(data[resource]))) throw new HttpError(400, 'INVALID_IMPORT', '需要 version: 1 和 areas、restaurants、dishes 三个数组')
  const count = resources.reduce((total, resource) => total + (data[resource] as unknown[]).length, 0)
  if (!count || count > IMPORT_RECORD_LIMIT) throw new HttpError(400, 'INVALID_IMPORT', `每次导入 1 至 ${IMPORT_RECORD_LIMIT} 条记录，请分批提交`)
  const issues: ImportIssue[] = []
  const rows: ImportRow[] = []
  const now = new Date().toISOString()
  for (const resource of resources) {
    for (const [index, value] of (data[resource] as unknown[]).entries()) {
      try {
        const item = record(value, ['id', 'createdAt', 'updatedAt', ...Object.keys(columns[resource])])
        const { id, createdAt, updatedAt, ...fields } = item
        const values = validateMutation(resource, fields, false) as Values
        // JSON snapshots may contain historical category names and must round-trip.
        // CSV introduces new dishes, so it uses the same standard categories as the editor.
        if (csv) validateDishCategoryMutation(values)
        rows.push({ resource, row: index + 1, id: id === undefined ? crypto.randomUUID() : validateId(id), createdAt: timestamp(createdAt, now), updatedAt: timestamp(updatedAt, now), values })
      } catch (error) {
        issues.push({ resource, row: index + 1, message: error instanceof Error ? error.message : '记录无效' })
      }
    }
  }
  const existing = await env.DB.batch<Existing>([
    env.DB.prepare("SELECT id, name, '' AS parent_id FROM areas"),
    env.DB.prepare('SELECT id, name, area_id AS parent_id FROM restaurants'),
    env.DB.prepare('SELECT id, name, restaurant_id AS parent_id FROM dishes'),
  ])
  const ids = Object.fromEntries(resources.map((resource, i) => [resource, new Set(existing[i]!.results.map((row) => row.id))])) as Record<Resource, Set<string>>
  const names = Object.fromEntries(resources.map((resource, i) => [resource, new Set(existing[i]!.results.map((row) => nameKey(row.name, row.parent_id)))])) as Record<Resource, Set<string>>
  for (const row of rows) {
    const name = String(row.values.name)
    const key = nameKey(name, parent(row))
    if (ids[row.resource].has(row.id)) issues.push({ resource: row.resource, row: row.row, message: `ID 重复：${row.id}` })
    if (names[row.resource].has(key)) issues.push({ resource: row.resource, row: row.row, message: `同一上级下名称重复：${name}` })
    ids[row.resource].add(row.id)
    names[row.resource].add(key)
  }
  for (const row of rows) {
    const parentResource = row.resource === 'restaurants' ? 'areas' : row.resource === 'dishes' ? 'restaurants' : null
    if (parentResource && !ids[parentResource].has(parent(row))) issues.push({ resource: row.resource, row: row.row, message: '所属区域或店铺不存在，也未包含在本次导入中' })
  }
  const report: ImportReport = {
    valid: !issues.length, applied: false,
    counts: Object.fromEntries(resources.map((resource) => [resource, rows.filter((row) => row.resource === resource).length])) as Record<Resource, number>,
    issues,
    preview: rows.map((row) => ({ resource: row.resource, row: row.row, name: String(row.values.name), ...(parent(row) ? { parentId: parent(row) } : {}) })),
  }
  if (issues.length && !input.dryRun) throw new HttpError(400, 'IMPORT_VALIDATION_FAILED', `导入校验失败，整批未写入：${issues[0]!.message}。请重新预览。`, report)
  if (input.dryRun) return json(report)
  const statements = rows.map((row) => {
    const keys = Object.keys(row.values)
    const parentColumn = row.resource === 'restaurants' ? 'area_id' : row.resource === 'dishes' ? 'restaurant_id' : null
    // Guard runs inside the atomic batch, so a name added after preview cannot
    // cause a silent duplicate or a partially applied import. NULL fails id NOT NULL.
    const conflict = `SELECT 1 FROM ${row.resource} WHERE id = ? OR (trim(name) = ?${parentColumn ? ` AND ${parentColumn} = ?` : ''})`
    const guard = [row.id, row.values.name, ...(parentColumn ? [parent(row)] : []), row.id]
    return env.DB.prepare(`INSERT INTO ${row.resource} (id, ${keys.map((key) => columns[row.resource][key]).join(', ')}, created_at, updated_at) VALUES (CASE WHEN EXISTS (${conflict}) THEN NULL ELSE ? END, ${Array(keys.length + 2).fill('?').join(', ')})`)
      .bind(...guard, ...keys.map((key) => typeof row.values[key] === 'boolean' ? Number(row.values[key]) : row.values[key]), row.createdAt, row.updatedAt)
  })
  try { await env.DB.batch(statements) }
  catch (error) {
    if (/constraint|FOREIGN KEY|NOT NULL|UNIQUE/i.test(String(error))) throw new HttpError(409, 'IMPORT_CONFLICT', '菜单在导入期间发生变化，整批未写入。请重新预览。')
    throw error
  }
  report.applied = true
  return json(report, 201)
}
