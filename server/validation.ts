import type { RecommendRequest, Resource } from '../shared/types'
import { DEFAULT_RESTAURANT_CATEGORY, isDishCategory, isRestaurantCategory, isRestaurantCategoryFilter } from '../shared/categories'
import { HttpError } from './http'

type Input = Record<string, unknown>

function invalid(message: string): never {
  throw new HttpError(400, 'INVALID_INPUT', message)
}

function object(value: unknown, allowed: readonly string[]): Input {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('请输入 JSON 对象')
  const result = value as Input
  const unknown = Object.keys(result).filter((key) => !allowed.includes(key))
  if (unknown.length) invalid(`不支持的字段：${unknown.join('、')}`)
  return result
}

function string(value: unknown, name: string, max: number, required = false): string {
  if (typeof value !== 'string') invalid(`${name}必须是文本`)
  const result = value.trim()
  if ((required && !result) || result.length > max) invalid(`${name}长度无效`)
  return result
}

export function validateId(value: unknown): string {
  return string(value, 'ID', 128, true)
}

export function validateAdminLogin(value: unknown): { password: string } {
  const input = object(value, ['password'])
  const password = input.password
  if (typeof password !== 'string' || password.length < 1 || password.length > 1024) invalid('请输入管理员密码或访问密钥')
  return { password }
}

function number(value: unknown, name: string, max: number, integer = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max || (integer && !Number.isSafeInteger(value))) {
    invalid(`${name}必须为 0 到 ${max} 之间的${integer ? '整数' : '有限数值'}`)
  }
  return value
}

function boolean(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') invalid(`${name}必须为布尔值`)
  return value
}

function ids(value: unknown, name: string, max: number): string[] {
  if (!Array.isArray(value) || value.length > max) invalid(`${name}最多包含 ${max} 个 ID`)
  return value.map(validateId)
}

function isJsonRequest(request: Request): boolean {
  return request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() === 'application/json'
}

async function readBodyText(request: Request): Promise<string> {
  const reader = request.body?.getReader()
  if (!reader) return ''
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false })
  let text = ''
  let bytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > 65_536) {
        try { await reader.cancel() } catch { /* The size error still applies if cancellation fails. */ }
        throw new HttpError(413, 'BODY_TOO_LARGE', '请求内容过大')
      }
      text += decoder.decode(value, { stream: true })
    }
    text += decoder.decode()
  } catch (error) {
    if (error instanceof HttpError) throw error
    invalid('JSON 内容读取失败或 UTF-8 编码无效')
  } finally {
    reader.releaseLock()
  }
  return text
}

export async function readJson(request: Request): Promise<unknown> {
  if (!isJsonRequest(request)) throw new HttpError(415, 'JSON_REQUIRED', '请使用 application/json')
  const text = await readBodyText(request)
  try {
    return JSON.parse(text) as unknown
  } catch {
    invalid('JSON 格式无效')
  }
}

/**
 * 部分运行时会把 DELETE 的“无请求体”表示为带 Content-Type 的空流。
 * 空内容一律视为无请求体；非空内容仍要求 application/json。
 */
export async function readOptionalJson(request: Request): Promise<unknown> {
  if (request.body === null) return undefined
  const text = await readBodyText(request)
  if (!text.trim()) return undefined
  if (!isJsonRequest(request)) throw new HttpError(415, 'JSON_REQUIRED', '请使用 application/json')
  try {
    return JSON.parse(text) as unknown
  } catch {
    invalid('JSON 格式无效')
  }
}

const fields: Record<Resource, readonly string[]> = {
  areas: ['name', 'type', 'sortOrder', 'enabled'],
  restaurants: ['areaId', 'name', 'category', 'location', 'enabled'],
  dishes: ['restaurantId', 'name', 'category', 'priceCents', 'weight', 'notes', 'enabled'],
}

export function validateMutation(resource: Resource, value: unknown, partial: boolean): Input {
  const input = object(value, fields[resource])
  if (partial && Object.keys(input).length === 0) invalid('至少提供一个需要修改的字段')
  const result: Input = {}
  const set = (key: string, validate: (value: unknown) => unknown, fallback?: unknown) => {
    if (Object.hasOwn(input, key)) result[key] = validate(input[key])
    else if (!partial) result[key] = fallback === undefined ? validate(undefined) : fallback
  }
  set('name', (item) => string(item, '名称', 100, true))
  set('enabled', (item) => boolean(item, '启用状态'), true)
  if (resource === 'areas') {
    set('type', (item) => {
      if (item !== 'canteen' && item !== 'nearby' && item !== 'other') invalid('区域类型无效')
      return item
    }, 'other')
    set('sortOrder', (item) => number(item, '排序', 1_000_000, true), 0)
  } else {
    set('category', (item) => string(item, '分类', 60), resource === 'restaurants' ? DEFAULT_RESTAURANT_CATEGORY : '')
    if (resource === 'restaurants') {
      set('areaId', validateId)
      set('location', (item) => string(item, '位置', 300), '')
    } else {
      set('restaurantId', validateId)
      set('priceCents', (item) => number(item, '价格（分）', 100_000_000, true))
      set('weight', (item) => number(item, '推荐权重', 1_000_000), 1)
      set('notes', (item) => string(item, '备注', 500), '')
    }
  }
  return result
}

export function validateRestaurantCategoryMutation(values: Record<string, unknown>, currentCategory?: string): void {
  if (!Object.hasOwn(values, 'category')) return
  const category = values.category
  if (typeof category !== 'string') invalid('店铺分类必须是文本')
  if (currentCategory !== undefined && category === currentCategory) return
  if (!isRestaurantCategory(category)) invalid('店铺分类必须是标准分类；历史分类只能在未修改时保留')
}

export function validateDishCategoryMutation(values: Record<string, unknown>, currentCategory?: string): void {
  if (!Object.hasOwn(values, 'category')) return
  const category = values.category
  if (typeof category !== 'string') invalid('菜品分类必须是文本')
  if (currentCategory !== undefined && category === currentCategory) return
  if (category !== '' && !isDishCategory(category)) invalid('菜品分类必须是标准分类或留空；历史分类只能在未修改时保留')
}

export function validateRatingSubmission(value: unknown): { stars: number } {
  const input = object(value, ['stars'])
  if (!Object.hasOwn(input, 'stars')) invalid('请选择 1 至 5 星')
  const stars = input.stars
  if (typeof stars !== 'number' || !Number.isSafeInteger(stars) || stars < 1 || stars > 5) invalid('评分必须是 1 至 5 的整数')
  return { stars }
}

export function validateRecommend(value: unknown): RecommendRequest {
  const input = object(value, ['mode', 'filters', 'avoidRecent', 'recentDishIds'])
  const mode = input.mode
  if (mode !== 'restaurant' && mode !== 'dish' && mode !== 'combo') invalid('推荐模式无效')
  const source = object(input.filters ?? {}, ['areaId', 'restaurantId', 'restaurantCategory', 'category', 'maxPriceCents', 'excludedRestaurantIds', 'excludedDishIds'])
  const filters: RecommendRequest['filters'] = {}
  if (Object.hasOwn(source, 'areaId')) filters.areaId = validateId(source.areaId)
  if (Object.hasOwn(source, 'restaurantId')) filters.restaurantId = validateId(source.restaurantId)
  if (Object.hasOwn(source, 'restaurantCategory')) {
    const value = string(source.restaurantCategory, '店铺分类', 60, true)
    if (!isRestaurantCategoryFilter(value)) invalid('店铺分类无效')
    filters.restaurantCategory = value
  }
  if (Object.hasOwn(source, 'category')) filters.category = string(source.category, '分类', 60, true)
  if (Object.hasOwn(source, 'maxPriceCents')) filters.maxPriceCents = number(source.maxPriceCents, '价格上限（分）', 100_000_000, true)
  if (Object.hasOwn(source, 'excludedRestaurantIds')) filters.excludedRestaurantIds = ids(source.excludedRestaurantIds, '排除店铺', 200)
  if (Object.hasOwn(source, 'excludedDishIds')) filters.excludedDishIds = ids(source.excludedDishIds, '排除菜品', 200)
  if (mode === 'dish' && !filters.restaurantId) invalid('选菜模式需要指定店铺')
  return {
    mode,
    filters,
    avoidRecent: input.avoidRecent === undefined ? false : boolean(input.avoidRecent, '近期去重'),
    recentDishIds: input.recentDishIds === undefined ? [] : ids(input.recentDishIds, '近期菜品', 5),
  }
}
