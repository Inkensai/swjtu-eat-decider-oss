import type { AdminRating, AdminRatingList, RatingOverview, RatingSubmission, RatingSummary, RatingTargetType } from '../shared/types'
import { authenticate, cookieSecure, randomToken, readCookie, requireCsrf, requireSameOrigin, sha256Hex } from './auth'
import type { Env } from './env'
import { HttpError, json } from './http'
import { readJson, validateId, validateRatingSubmission } from './validation'

/**
 * 匿名评分身份。
 *
 * 服务端生成 256 位随机凭据并通过 HttpOnly Cookie 持有；D1 只保存
 * `sha256("rater:" + 凭据)` 摘要，因此数据库泄露也无法还原 Cookie 原文。
 * 客户端不能提交身份 ID：所有写入都以 Cookie 解析出的摘要为准。
 *
 * Cookie 只代表当前匿名身份，不等于自然人身份；清除 Cookie、使用无痕窗口
 * 或更换浏览器都会得到新身份，无法再修改原身份提交的评分。产品说明必须
 * 如实告知这一限制。
 */
export const RATER_COOKIE = 'ed_rater_id'
const RATER_TTL_SECONDS = 31_536_000
const RATER_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/
const TARGET_COLUMNS: Record<RatingTargetType, string> = { restaurant: 'restaurant_id', dish: 'dish_id' }
const DEFAULT_WRITE_LIMIT = 30
const DEFAULT_IP_LIMIT = 120
const DEFAULT_WINDOW_SECONDS = 600
const RATE_LIMIT_RETENTION_MS = 86_400_000
const ADMIN_LIST_LIMIT = 500

interface Identity { token: string; hash: string }

function boundedInteger(raw: string | undefined, fallback: number, min: number, max: number): number {
  const value = Number(raw)
  return Number.isSafeInteger(value) && value >= min && value <= max ? value : fallback
}

async function readIdentity(request: Request): Promise<Identity | null> {
  const token = readCookie(request, RATER_COOKIE)
  if (!token || !RATER_TOKEN_PATTERN.test(token)) return null
  return { token, hash: await sha256Hex(`rater:${token}`) }
}

function raterCookie(token: string, request: Request): string {
  const secure = cookieSecure(request) ? '; Secure' : ''
  return `${RATER_COOKIE}=${token}; Path=/; HttpOnly${secure}; SameSite=Lax; Max-Age=${RATER_TTL_SECONDS}`
}

async function requireVisibleTarget(env: Env, targetType: RatingTargetType, targetId: string): Promise<void> {
  const row = targetType === 'restaurant'
    ? await env.DB.prepare('SELECT r.id FROM restaurants r JOIN areas a ON a.id = r.area_id WHERE r.id = ? AND r.enabled = 1 AND a.enabled = 1')
      .bind(targetId).first()
    : await env.DB.prepare(
      'SELECT d.id FROM dishes d JOIN restaurants r ON r.id = d.restaurant_id JOIN areas a ON a.id = r.area_id '
      + 'WHERE d.id = ? AND d.enabled = 1 AND r.enabled = 1 AND a.enabled = 1',
    ).bind(targetId).first()
  if (!row) throw new HttpError(404, 'NOT_FOUND', targetType === 'restaurant' ? '店铺不存在或已停用' : '菜品不存在或已停用')
}

function averageOf(value: number | null): number | null {
  return value === null || value === undefined ? null : Math.round(value * 100) / 100
}

async function summaryOf(env: Env, targetType: RatingTargetType, targetId: string): Promise<RatingSummary> {
  const column = TARGET_COLUMNS[targetType]
  const row = await env.DB.prepare(`SELECT AVG(stars) AS average, COUNT(*) AS count FROM ratings WHERE ${column} = ?`)
    .bind(targetId).first<{ average: number | null; count: number }>()
  return { targetId, average: averageOf(row?.average ?? null), count: row?.count ?? 0 }
}

/** 全站统计只覆盖当前公开可见的对象；停用对象的历史评分不进入公开结果。 */
export async function handleRatingsOverview(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    throw new HttpError(405, 'METHOD_NOT_ALLOWED', '不支持该评分操作', undefined, { Allow: 'GET, HEAD' })
  }
  const identity = await readIdentity(request)
  const [restaurants, dishes, mine] = await Promise.all([
    env.DB.prepare(
      'SELECT r.restaurant_id AS target_id, AVG(r.stars) AS average, COUNT(*) AS count FROM ratings r '
      + 'JOIN restaurants s ON s.id = r.restaurant_id JOIN areas a ON a.id = s.area_id '
      + 'WHERE r.restaurant_id IS NOT NULL AND s.enabled = 1 AND a.enabled = 1 GROUP BY r.restaurant_id',
    ).all<{ target_id: string; average: number; count: number }>(),
    env.DB.prepare(
      'SELECT r.dish_id AS target_id, AVG(r.stars) AS average, COUNT(*) AS count FROM ratings r '
      + 'JOIN dishes d ON d.id = r.dish_id JOIN restaurants s ON s.id = d.restaurant_id JOIN areas a ON a.id = s.area_id '
      + 'WHERE r.dish_id IS NOT NULL AND d.enabled = 1 AND s.enabled = 1 AND a.enabled = 1 GROUP BY r.dish_id',
    ).all<{ target_id: string; average: number; count: number }>(),
    identity
      ? env.DB.prepare('SELECT target_type, COALESCE(restaurant_id, dish_id) AS target_id, stars FROM ratings WHERE identity_hash = ?')
        .bind(identity.hash).all<{ target_type: RatingTargetType; target_id: string; stars: number }>()
      : Promise.resolve({ results: [] as { target_type: RatingTargetType; target_id: string; stars: number }[] }),
  ])
  const overview: RatingOverview = {
    restaurants: restaurants.results.map(row => ({ targetId: row.target_id, average: averageOf(row.average), count: row.count })),
    dishes: dishes.results.map(row => ({ targetId: row.target_id, average: averageOf(row.average), count: row.count })),
    mine: mine.results.map(row => ({ targetType: row.target_type, targetId: row.target_id, stars: row.stars })),
  }
  return json(overview)
}

async function consumeRateLimit(env: Env, scope: string, limit: number, windowSeconds: number): Promise<number> {
  const now = Date.now()
  const windowMs = windowSeconds * 1000
  await env.DB.prepare(
    'INSERT INTO rating_rate_limits (scope, window_start, count) VALUES (?, ?, 1) '
    + 'ON CONFLICT(scope) DO UPDATE SET '
    + 'count = CASE WHEN excluded.window_start - rating_rate_limits.window_start >= ? THEN 1 ELSE rating_rate_limits.count + 1 END, '
    + 'window_start = CASE WHEN excluded.window_start - rating_rate_limits.window_start >= ? THEN excluded.window_start ELSE rating_rate_limits.window_start END',
  ).bind(scope, now, windowMs, windowMs).run()
  const row = await env.DB.prepare('SELECT window_start, count FROM rating_rate_limits WHERE scope = ?')
    .bind(scope).first<{ window_start: number; count: number }>()
  if (!row || row.count <= limit) return 0
  return Math.max(1, Math.ceil((row.window_start + windowMs - now) / 1000))
}

/**
 * 只信任 Cloudflare 边缘写入的 CF-Connecting-IP：该头由边缘覆盖，普通客户端无法伪造。
 * X-Real-IP 等头可由客户端任意设置，不能作为限流维度，否则换一个头即可绕过限制。
 */
function clientAddress(request: Request): string {
  return request.headers.get('CF-Connecting-IP')?.trim() || 'unknown'
}

/**
 * 固定窗口限流：同一匿名身份与同一来源 IP 分别计数。
 * 身份维度防止单个浏览器高频写入，IP 维度兜底批量清除 Cookie 的重复提交。
 */
async function enforceRateLimit(request: Request, env: Env, identityHash: string): Promise<void> {
  const limit = boundedInteger(env.RATING_RATE_LIMIT, DEFAULT_WRITE_LIMIT, 1, 10_000)
  const ipLimit = boundedInteger(env.RATING_IP_RATE_LIMIT, DEFAULT_IP_LIMIT, 1, 100_000)
  const windowSeconds = boundedInteger(env.RATING_RATE_WINDOW_SECONDS, DEFAULT_WINDOW_SECONDS, 10, 86_400)
  const [identityRetry, ipRetry] = await Promise.all([
    consumeRateLimit(env, `rating:id:${identityHash}`, limit, windowSeconds),
    consumeRateLimit(env, `rating:ip:${await sha256Hex(clientAddress(request))}`, ipLimit, windowSeconds),
  ])
  const retryAfter = Math.max(identityRetry, ipRetry)
  if (retryAfter > 0) {
    throw new HttpError(
      429,
      'TOO_MANY_REQUESTS',
      `评分操作过于频繁，请 ${Math.max(1, Math.ceil(retryAfter / 60))} 分钟后重试`,
      { retryAfterSeconds: retryAfter },
      { 'Retry-After': String(retryAfter) },
    )
  }
}

async function pruneRateLimits(env: Env): Promise<void> {
  await env.DB.prepare('DELETE FROM rating_rate_limits WHERE window_start < ?').bind(Date.now() - RATE_LIMIT_RETENTION_MS).run()
}

/**
 * PUT /api/ratings/{restaurant|dish}/:id —— 提交或更新当前匿名身份的评分。
 * UPSERT 依赖唯一索引，同一身份重复提交只会更新原记录，评分人数不变。
 */
async function submit(request: Request, env: Env, targetType: RatingTargetType, targetId: string): Promise<Response> {
  requireSameOrigin(request)
  const identity = await readIdentity(request)
  const token = identity?.token ?? randomToken()
  const hash = identity?.hash ?? await sha256Hex(`rater:${token}`)
  await enforceRateLimit(request, env, hash)
  const { stars } = validateRatingSubmission(await readJson(request))
  await requireVisibleTarget(env, targetType, targetId)
  const column = TARGET_COLUMNS[targetType]
  const now = new Date().toISOString()
  await env.DB.prepare(
    `INSERT INTO ratings (id, target_type, ${column}, identity_hash, stars, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) `
    + `ON CONFLICT(identity_hash, ${column}) WHERE ${column} IS NOT NULL `
    + 'DO UPDATE SET stars = excluded.stars, updated_at = excluded.updated_at',
  ).bind(crypto.randomUUID(), targetType, targetId, hash, stars, now, now).run()
  await pruneRateLimits(env)
  const summary = await summaryOf(env, targetType, targetId)
  const body: RatingSubmission = { targetType, targetId, stars, average: summary.average, count: summary.count }
  return json(body, 200, identity ? {} : { 'Set-Cookie': raterCookie(token, request) })
}

/** DELETE /api/ratings/{restaurant|dish}/:id —— 只删除当前 Cookie 身份自己的评分。 */
async function removeOwn(request: Request, env: Env, targetType: RatingTargetType, targetId: string): Promise<Response> {
  requireSameOrigin(request)
  const identity = await readIdentity(request)
  if (!identity) throw new HttpError(401, 'IDENTITY_REQUIRED', '当前浏览器还没有评分身份，无法删除评分')
  await enforceRateLimit(request, env, identity.hash)
  const column = TARGET_COLUMNS[targetType]
  const result = await env.DB.prepare(`DELETE FROM ratings WHERE identity_hash = ? AND ${column} = ?`)
    .bind(identity.hash, targetId).run()
  if (!result.meta.changes) throw new HttpError(404, 'NOT_FOUND', '当前身份没有该对象的评分')
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } })
}

/** 匿名评分写入入口；身份只来自 Cookie，路径中的对象类型与 ID 必须匹配。 */
export async function handleRatingMutation(
  request: Request,
  env: Env,
  targetType: RatingTargetType,
  rawTargetId: string,
): Promise<Response> {
  const targetId = validateId(rawTargetId)
  if (request.method === 'PUT') return submit(request, env, targetType, targetId)
  if (request.method === 'DELETE') return removeOwn(request, env, targetType, targetId)
  throw new HttpError(405, 'METHOD_NOT_ALLOWED', '不支持的评分操作', undefined, { Allow: 'PUT, DELETE' })
}

/**
 * GET /api/admin/ratings：管理员评分列表。
 * 返回对象名称、类型、星级与时间；绝不返回身份摘要或 Cookie 凭据。
 */
export async function handleAdminRatings(request: Request, env: Env, rawRatingId: string | null): Promise<Response> {
  const session = await authenticate(request, env)
  if (request.method === 'GET' && !rawRatingId) {
    const url = new URL(request.url)
    const targetType = url.searchParams.get('targetType')
    if (targetType !== null && targetType !== 'restaurant' && targetType !== 'dish') {
      throw new HttpError(400, 'INVALID_INPUT', '评分对象类型无效')
    }
    const targetId = url.searchParams.get('targetId')
    const restaurantId = url.searchParams.get('restaurantId')
    const conditions: string[] = []
    const parameters: string[] = []
    if (targetType) { conditions.push('r.target_type = ?'); parameters.push(targetType) }
    if (targetId) { conditions.push('COALESCE(r.restaurant_id, r.dish_id) = ?'); parameters.push(validateId(targetId)) }
    if (restaurantId) {
      conditions.push('(r.restaurant_id = ? OR d.restaurant_id = ?)')
      parameters.push(validateId(restaurantId), validateId(restaurantId))
    }
    const where = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : ''
    const from = 'FROM ratings r LEFT JOIN restaurants s ON s.id = r.restaurant_id '
      + 'LEFT JOIN dishes d ON d.id = r.dish_id LEFT JOIN restaurants dr ON dr.id = d.restaurant_id'
    const [rows, total] = await Promise.all([
      env.DB.prepare(
        'SELECT r.id, r.target_type, COALESCE(r.restaurant_id, r.dish_id) AS target_id, r.stars, r.created_at, r.updated_at, '
        + 'COALESCE(s.name, d.name) AS target_name, COALESCE(s.enabled, d.enabled) AS target_enabled, '
        + 'd.restaurant_id AS dish_restaurant_id, COALESCE(s.name, dr.name) AS restaurant_name '
        + `${from}${where} ORDER BY r.updated_at DESC, r.id LIMIT ${ADMIN_LIST_LIMIT}`,
      ).bind(...parameters).all<Record<string, string | number | null>>(),
      env.DB.prepare(`SELECT COUNT(*) AS total ${from}${where}`).bind(...parameters).first<{ total: number }>(),
    ])
    const items: AdminRating[] = rows.results.map(row => ({
      id: row.id as string,
      targetType: row.target_type as RatingTargetType,
      targetId: row.target_id as string,
      targetName: (row.target_name as string | null) ?? '',
      targetEnabled: row.target_enabled === 1,
      restaurantId: (row.dish_restaurant_id as string | null) ?? null,
      restaurantName: (row.restaurant_name as string | null) ?? null,
      stars: row.stars as number,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    }))
    const body: AdminRatingList = { items, total: total?.total ?? items.length }
    return json(body)
  }
  if (request.method === 'DELETE' && rawRatingId) {
    requireSameOrigin(request)
    requireCsrf(request, session)
    const id = validateId(rawRatingId)
    const result = await env.DB.prepare('DELETE FROM ratings WHERE id = ?').bind(id).run()
    if (!result.meta.changes) throw new HttpError(404, 'NOT_FOUND', '评分不存在或已被删除')
    return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } })
  }
  if (!rawRatingId) {
    throw new HttpError(405, 'METHOD_NOT_ALLOWED', '不支持的评分管理操作', undefined, { Allow: 'GET' })
  }
  throw new HttpError(405, 'METHOD_NOT_ALLOWED', '不支持的评分管理操作', undefined, { Allow: 'DELETE' })
}
