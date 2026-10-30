import type { Dish, Restaurant } from './types'

// Campus opening times and temporary flags always use China Standard Time,
// independent of the visitor's browser/server timezone.
export function campusDate(now: Date = new Date()): string {
  return new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

export function validCampusDate(value: string): boolean {
  return value === '' || (/^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value)
}

export function parseOpeningHours(value: string): [number, number][] | null {
  if (!value.trim()) return []
  const parts = value.replaceAll('，', ',').split(',')
  if (parts.length > 8) return null
  const ranges: [number, number][] = []
  for (const part of parts) {
    const match = /^(\d{2}):(\d{2})\s*-\s*(\d{2}):(\d{2})$/.exec(part.trim())
    if (!match) return null
    const [, h1, m1, h2, m2] = match.map(Number)
    if (h1! > 23 || h2! > 24 || m1! > 59 || m2! > 59 || (h2 === 24 && m2 !== 0)) return null
    const start = h1! * 60 + m1!
    const end = h2! * 60 + m2!
    if (start === end) return null
    ranges.push([start, end])
  }
  return ranges
}

export function isRestaurantOpen(restaurant: Restaurant, now: Date = new Date()): boolean {
  if (!restaurant.enabled || restaurant.closedToday === campusDate(now)) return false
  const ranges = parseOpeningHours(restaurant.openingHours ?? '')
  if (!ranges?.length) return false // Unknown hours are not a promise that a shop is open.
  const local = new Date(now.getTime() + 8 * 60 * 60 * 1000)
  const minute = local.getUTCHours() * 60 + local.getUTCMinutes()
  return ranges.some(([start, end]) => start < end
    ? minute >= start && minute < end
    : minute >= start || minute < end)
}

export function isDishAvailable(dish: Dish, now: Date = new Date()): boolean {
  return dish.enabled && dish.soldOutOn !== campusDate(now)
}

export function availabilityLabel(restaurant: Restaurant, now: Date = new Date()): string {
  if (!restaurant.enabled) return '已停用'
  if (restaurant.closedToday === campusDate(now)) return '今日休息'
  if (!restaurant.openingHours?.trim()) return '营业时间未设置'
  return isRestaurantOpen(restaurant, now) ? '营业中' : '休息中'
}
