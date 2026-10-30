import type { Menu, Resource } from './types'

export const IMPORT_RECORD_LIMIT = 200
export const IMPORT_BODY_LIMIT = 65_536
export interface MenuSnapshot extends Menu { version: 1 }
export interface ImportIssue { resource: Resource; row: number; message: string }
export interface ImportPreviewRow { resource: Resource; row: number; name: string; parentId?: string }
export interface ImportReport {
  valid: boolean
  applied: boolean
  counts: Record<Resource, number>
  issues: ImportIssue[]
  preview: ImportPreviewRow[]
}
export const DISH_CSV_TEMPLATE = 'name,category,price,weight,notes\r\n示例盖饭,米饭 / 套餐,15.50,1,"少辣，可加饭"\r\n'

/** RFC 4180-style fields: escaped quotes, commas and newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  text = text.replace(/^\uFEFF/, '')
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  let closedQuote = false
  const endField = () => { row.push(field); field = ''; closedQuote = false }
  const endRow = () => { endField(); rows.push(row); row = [] }
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') { field += '"'; index++ }
        else { quoted = false; closedQuote = true }
      } else field += char
      continue
    }
    if (char === ',') endField()
    else if (char === '\n' || char === '\r') {
      endRow()
      if (char === '\r' && text[index + 1] === '\n') index++
    } else if (char === '"' && !field && !closedQuote) quoted = true
    else {
      if (char === '"' || closedQuote) throw new Error(`CSV 第 ${rows.length + 1} 行引号格式无效`)
      field += char
    }
  }
  if (quoted) throw new Error('CSV 含有未闭合的引号')
  if (field || row.length || closedQuote) endRow()
  return rows
}

export function csvDishData(text: string, restaurantId: string): { version: 1; areas: unknown[]; restaurants: unknown[]; dishes: Record<string, unknown>[] } {
  const rows = parseCsv(text)
  const header = rows.shift()?.map((field) => field.trim())
  if (!header || header.join(',') !== 'name,category,price,weight,notes') {
    throw new Error('CSV 表头必须为 name,category,price,weight,notes；price 单位为元')
  }
  const dishes = rows.filter((row) => row.some((field) => field.trim())).map((row, index) => {
    if (row.length !== 5) throw new Error(`CSV 第 ${index + 2} 行应有 5 列`)
    const [name, category, rawPrice, rawWeight, notes] = row as [string, string, string, string, string]
    const price = rawPrice.trim()
    if (!/^\d+(?:\.\d{1,2})?$/.test(price)) throw new Error(`CSV 第 ${index + 2} 行价格应为非负金额，最多两位小数`)
    const [whole, decimal = ''] = price.split('.')
    const priceCents = Number(whole) * 100 + Number(decimal.padEnd(2, '0'))
    if (!rawWeight.trim() || !/^\d+(?:\.\d+)?$/.test(rawWeight.trim())) throw new Error(`CSV 第 ${index + 2} 行权重应为非负数值`)
    return { restaurantId, name, category, priceCents, weight: Number(rawWeight), notes }
  })
  return { version: 1, areas: [], restaurants: [], dishes }
}

export function exportMenu(menu: Menu): MenuSnapshot {
  return { version: 1, areas: menu.areas, restaurants: menu.restaurants, dishes: menu.dishes }
}
