import { describe, expect, it } from 'vitest'
import { availabilityLabel, campusDate, isDishAvailable, isRestaurantOpen, parseOpeningHours, validCampusDate } from '../shared/availability'
import { recommend } from '../shared/recommendation'
import { validateMutation, validateRecommend } from '../server/validation'
import type { Dish, Menu, Restaurant } from '../shared/types'

const restaurant: Restaurant = { id: 'r', areaId: 'a', name: '店', category: '', location: '', enabled: true, createdAt: '', updatedAt: '', openingHours: '11:00-14:00,17:00-21:00' }
const dish: Dish = { id: 'd', restaurantId: 'r', name: '菜', category: '', priceCents: 100, weight: 1, notes: '', enabled: true, createdAt: '', updatedAt: '' }
const menu: Menu = { areas: [{ id: 'a', name: '区域', enabled: true, type: 'other', sortOrder: 0, createdAt: '', updatedAt: '' }], restaurants: [restaurant], dishes: [dish] }
const noon = new Date('2026-10-30T04:00:00Z')

describe('campus availability', () => {
  it('uses campus midnight, not UTC or browser local time', () => {
    expect(campusDate(new Date('2026-10-29T16:00:00Z'))).toBe('2026-10-30')
    expect(campusDate(new Date('2026-10-29T15:59:59Z'))).toBe('2026-10-29')
  })
  it('supports multiple windows, exclusive close time, overnight and all day', () => {
    expect(isRestaurantOpen(restaurant, noon)).toBe(true)
    expect(isRestaurantOpen(restaurant, new Date('2026-10-30T06:00:00Z'))).toBe(false)
    expect(isRestaurantOpen({ ...restaurant, openingHours: '22:00-02:00' }, new Date('2026-10-29T17:00:00Z'))).toBe(true)
    expect(isRestaurantOpen({ ...restaurant, openingHours: '00:00-24:00' }, noon)).toBe(true)
    expect(parseOpeningHours('11:00-14:00，17:00-21:00')).toHaveLength(2)
  })
  it('does not claim unknown opening hours are open', () => {
    const unknown = { ...restaurant, openingHours: '' }
    expect(isRestaurantOpen(unknown, noon)).toBe(false)
    expect(availabilityLabel(unknown, noon)).toBe('营业时间未设置')
  })
  it('expires temporary closures and sold out flags the next day', () => {
    expect(isRestaurantOpen({ ...restaurant, closedToday: '2026-10-30' }, noon)).toBe(false)
    expect(isRestaurantOpen({ ...restaurant, closedToday: '2026-10-29' }, noon)).toBe(true)
    expect(isDishAvailable({ ...dish, soldOutOn: '2026-10-30' }, noon)).toBe(false)
    expect(isDishAvailable({ ...dish, soldOutOn: '2026-10-29' }, noon)).toBe(true)
  })
  it('validates malformed hours and actual calendar dates', () => {
    for (const value of ['25:00-26:00', '12:60-13:00', '24:00-01:00', '11:00-11:00', '11:00-24:01']) expect(parseOpeningHours(value)).toBeNull()
    expect(validCampusDate('2026-02-30')).toBe(false)
    expect(validCampusDate('2028-02-29')).toBe(true)
    expect(() => validateMutation('restaurants', { openingHours: 'no' }, true)).toThrow()
    expect(() => validateMutation('dishes', { soldOutOn: '2026-02-30' }, true)).toThrow()
    expect(() => validateRecommend({ mode: 'combo', filters: { openNow: 'true' } })).toThrow()
  })
  it('enforces current availability in server recommendation across all modes', () => {
    expect(recommend(menu, { mode: 'combo', filters: { openNow: true }, recentDishIds: [], avoidRecent: false }, () => 0, noon).status).toBe('ok')
    const closed: Menu = { ...menu, restaurants: [{ ...restaurant, closedToday: '2026-10-30' }] }
    expect(recommend(closed, { mode: 'restaurant', filters: {}, recentDishIds: [], avoidRecent: false }, () => 0, noon).status).toBe('empty')
    const sold: Menu = { ...menu, dishes: [{ ...dish, soldOutOn: '2026-10-30' }] }
    expect(recommend(sold, { mode: 'dish', filters: { restaurantId: 'r' }, recentDishIds: [], avoidRecent: false }, () => 0, noon).status).toBe('empty')
    const unknown: Menu = { ...menu, restaurants: [{ ...restaurant, openingHours: '' }] }
    expect(recommend(unknown, { mode: 'combo', filters: {}, recentDishIds: [], avoidRecent: false }, () => 0, noon).status).toBe('ok')
    expect(recommend(unknown, { mode: 'combo', filters: { openNow: true }, recentDishIds: [], avoidRecent: false }, () => 0, noon).status).toBe('empty')
  })
})
