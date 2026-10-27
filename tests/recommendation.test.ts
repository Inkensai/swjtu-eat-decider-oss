import { describe, expect, it } from 'vitest'
import { recommend } from '../shared/recommendation'
import { DEFAULT_RESTAURANT_CATEGORY } from '../shared/categories'
import type { Area, Dish, Filters, Menu, Mode, RecommendRequest, Restaurant } from '../shared/types'

const timestamps = { createdAt: '2026-10-26T00:00:00Z', updatedAt: '2026-10-26T00:00:00Z' }
const area = (id = 'a1', changes: Partial<Area> = {}): Area => ({
  ...timestamps, id, name: id, type: 'canteen', sortOrder: 0, enabled: true, ...changes,
})
const restaurant = (id = 'r1', changes: Partial<Restaurant> = {}): Restaurant => ({
  ...timestamps, id, name: id, areaId: 'a1', category: '', location: '', enabled: true, ...changes,
})
const dish = (id = 'd1', restaurantId = 'r1', changes: Partial<Dish> = {}): Dish => ({
  ...timestamps, id, restaurantId, name: id, category: '米饭', priceCents: 1000,
  weight: 1, notes: '', enabled: true, ...changes,
})
const menu = (dishes: Dish[] = [dish()], restaurants = [restaurant()], areas = [area()]): Menu => ({
  dishes, restaurants, areas,
})
const request = (mode: Mode = 'dish', filters: Filters = { restaurantId: 'r1' }, changes: Partial<RecommendRequest> = {}): RecommendRequest => ({
  mode, filters, avoidRecent: false, recentDishIds: [], ...changes,
})
function selectedDish(data: Menu, options: RecommendRequest, value: number): string | undefined {
  const result = recommend(data, options, () => value)
  return result.status === 'ok' ? result.dish?.id : undefined
}

describe('recommendation candidates and modes', () => {
  it('returns an explicit empty result without drawing when no candidates exist', () => {
    expect(recommend(menu([]), request(), () => { throw new Error('unexpected draw') })).toEqual({
      status: 'empty', message: '没有符合条件的菜品，请放宽筛选条件',
    })
  })

  it('returns the single candidate without retrying', () => {
    const result = recommend(menu(), request(), () => 0.9)
    expect(result).toMatchObject({ status: 'ok', dish: { id: 'd1' }, candidateDishCount: 1 })
  })

  it('requires an explicit restaurant in dish mode', () => {
    expect(recommend(menu(), request('dish', {}))).toEqual({ status: 'empty', message: '请先选择一家店铺' })
  })

  it.each([
    { level: 'area', data: menu([dish()], [restaurant()], [area('a1', { enabled: false })]) },
    { level: 'restaurant', data: menu([dish()], [restaurant('r1', { enabled: false })]) },
    { level: 'dish', data: menu([dish('d1', 'r1', { enabled: false })]) },
  ])('excludes a disabled $level independently of other filters', ({ data }) => {
    expect(recommend(data, request()).status).toBe('empty')
  })

  it('restaurant mode only returns a restaurant with eligible dishes', () => {
    const result = recommend(menu([dish()], [restaurant(), restaurant('empty')]), request('restaurant', {}), () => 0.99)
    expect(result).toMatchObject({ status: 'ok', restaurant: { id: 'r1' }, dish: null, candidateDishCount: 1 })
  })

  it.each([[0, 'r1'], [0.4999, 'r1'], [0.5, 'r2'], [0.9999, 'r2']] as const)('uniformly selects restaurants at draw %s', (value, id) => {
    const data = menu([dish(), dish('d2', 'r2')], [restaurant(), restaurant('r2')])
    expect(recommend(data, request('restaurant', {}), () => value)).toMatchObject({ restaurant: { id } })
  })

  it('filters disabled parents, disabled dishes, missing parents and all request filters', () => {
    const data = menu([
      dish('wanted', 'r1', { priceCents: 0 }),
      dish('disabled', 'r1', { enabled: false }),
      dish('expensive', 'r1', { priceCents: 1 }),
      dish('wrong-category', 'r1', { category: '面食', priceCents: 0 }),
      dish('excluded', 'r1', { priceCents: 0 }),
      dish('excluded-store', 'r2', { priceCents: 0 }),
      dish('disabled-store', 'r3', { priceCents: 0 }),
      dish('disabled-area', 'r4', { priceCents: 0 }),
      dish('other-area', 'r5', { priceCents: 0 }),
      dish('missing-parent', 'missing', { priceCents: 0 }),
      dish('orphaned-store', 'r6', { priceCents: 0 }),
    ], [restaurant(), restaurant('r2'), restaurant('r3', { enabled: false }),
      restaurant('r4', { areaId: 'a2' }), restaurant('r5', { areaId: 'a3' }),
      restaurant('r6', { areaId: 'missing' })],
    [area(), area('a2', { enabled: false }), area('a3')])
    const result = recommend(data, request('combo', {
      areaId: 'a1', category: '米饭', maxPriceCents: 0,
      excludedDishIds: ['excluded'], excludedRestaurantIds: ['r2'],
    }), () => 0.99)
    expect(result).toMatchObject({ status: 'ok', restaurant: { id: 'r1' }, dish: { id: 'wanted' }, candidateDishCount: 1 })
    expect(recommend(data, request('dish', { restaurantId: 'r3' })).status).toBe('empty')
    expect(recommend(data, request('dish', { restaurantId: 'r4' })).status).toBe('empty')
    expect(recommend(data, request('dish', { restaurantId: 'r6' })).status).toBe('empty')
  })

  it('honors explicit restaurant selection and exact price limits', () => {
    const data = menu([dish(), dish('d2', 'r2', { priceCents: 1200 })], [restaurant(), restaurant('r2')])
    expect(selectedDish(data, request('combo', { restaurantId: 'r2', maxPriceCents: 1200 }), 0)).toBe('d2')
    expect(recommend(data, request('combo', { restaurantId: 'r2', maxPriceCents: 1199 })).status).toBe('empty')
  })
})

describe('restaurant category filtering', () => {
  const categorized = menu([
    dish('noodle-dish', 'noodle'),
    dish('rice-dish', 'rice'),
    dish('legacy-dish', 'legacy'),
    dish('other-dish', 'other'),
    dish('custom-dish', 'custom'),
    dish('far-dish', 'far'),
  ], [
    restaurant('noodle', { category: '粉面 / 面食' }),
    restaurant('rice', { category: '快餐 / 盖饭' }),
    restaurant('legacy', { category: '' }),
    restaurant('other', { category: DEFAULT_RESTAURANT_CATEGORY }),
    restaurant('custom', { category: '川菜' }),
    restaurant('far', { areaId: 'a2', category: '粉面 / 面食' }),
  ], [area(), area('a2')])

  it('only draws from the selected restaurant category', () => {
    expect(selectedDish(categorized, request('combo', { restaurantCategory: '粉面 / 面食' }), 0)).toBe('noodle-dish')
    expect(selectedDish(categorized, request('combo', { restaurantCategory: '快餐 / 盖饭' }), 0.99)).toBe('rice-dish')
  })

  it('combines area and restaurant category filters', () => {
    expect(selectedDish(categorized, request('combo', { areaId: 'a2', restaurantCategory: '粉面 / 面食' }), 0.99)).toBe('far-dish')
  })

  it('treats legacy blank categories as the default category without rewriting data', () => {
    const data = menu([dish('legacy-dish', 'legacy'), dish('other-dish', 'other')], [
      restaurant('legacy', { category: '' }),
      restaurant('other', { category: DEFAULT_RESTAURANT_CATEGORY }),
    ])
    expect(selectedDish(data, request('combo', { restaurantCategory: DEFAULT_RESTAURANT_CATEGORY }), 0)).toBe('legacy-dish')
    expect(selectedDish(data, request('combo', { restaurantCategory: DEFAULT_RESTAURANT_CATEGORY }), 0.99)).toBe('other-dish')
  })

  it('keeps custom historical categories only in the unlimited filter', () => {
    const data = menu([dish('custom-dish', 'custom')], [restaurant('custom', { category: '川菜' })])
    expect(selectedDish(data, request('combo', {}), 0)).toBe('custom-dish')
    expect(recommend(data, request('combo', { restaurantCategory: '其他 / 综合' }))).toMatchObject({ status: 'empty' })
  })

  it('does not apply a restaurant category to an explicitly selected dish-mode store', () => {
    const data = menu([dish('d1')], [restaurant('r1', { category: '炒菜 / 家常菜' })])
    expect(recommend(data, request('dish', { restaurantId: 'r1', restaurantCategory: '粉面 / 面食' }), () => 0.1))
      .toMatchObject({ status: 'ok', restaurant: { id: 'r1' }, dish: { id: 'd1' } })
  })

  it('keeps dish category independent from restaurant category', () => {
    const data = menu([dish('d1', 'r1', { category: '米饭 / 盖饭' })], [restaurant('r1', { category: '粉面 / 面食' })])
    expect(recommend(data, request('combo', {
      restaurantId: 'r1', restaurantCategory: '粉面 / 面食', category: '米饭 / 盖饭',
    }), () => 0)).toMatchObject({ status: 'ok', restaurant: { id: 'r1' }, dish: { id: 'd1' } })
  })

  it('returns a category-specific empty message', () => {
    const data = menu([dish('d1')], [restaurant('r1', { category: '快餐 / 盖饭' })])
    expect(recommend(data, request('combo', { restaurantCategory: '火锅 / 串串' }))).toEqual({
      status: 'empty',
      message: '没有符合「火锅 / 串串」分类和当前条件的店铺或菜品，请放宽筛选条件',
    })
  })
})

describe('weighted draws and recent penalties', () => {
  const weighted = menu([dish('d1', 'r1', { weight: 5 }), dish('d2', 'r1', { weight: 3 }), dish('d3', 'r1', { weight: 2 })])

  it.each([[0, 'd1'], [0.4999, 'd1'], [0.5, 'd2'], [0.7999, 'd2'], [0.8, 'd3'], [0.9999, 'd3']] as const)('uses cumulative weight boundaries at draw %s', (value, id) => {
    expect(selectedDish(weighted, request(), value)).toBe(id)
  })

  it('never selects zero weights when a positive weight exists', () => {
    const data = menu([dish('zero-start', 'r1', { weight: 0 }), dish('positive'), dish('zero-end', 'r1', { weight: 0 })])
    expect(selectedDish(data, request(), 0)).toBe('positive')
    expect(selectedDish(data, request(), 1 - Number.EPSILON)).toBe('positive')
  })

  it('normalizes large finite weights without an overflowing total', () => {
    const data = menu([dish('d1', 'r1', { weight: Number.MAX_VALUE }), dish('d2', 'r1', { weight: Number.MAX_VALUE })])
    expect(selectedDish(data, request(), 0.49)).toBe('d1')
    expect(selectedDish(data, request(), 0.5)).toBe('d2')
  })

  it('falls back to uniform selection when all weights are zero', () => {
    const data = menu([dish('d1', 'r1', { weight: 0 }), dish('d2', 'r1', { weight: 0 })])
    expect(selectedDish(data, request(), 0.49)).toBe('d1')
    expect(selectedDish(data, request(), 0.5)).toBe('d2')
  })

  it('applies recent penalties after the all-zero fallback', () => {
    const data = menu([dish('d1', 'r1', { weight: 0 }), dish('d2', 'r1', { weight: 0 })])
    expect(selectedDish(data, request('dish', { restaurantId: 'r1' }, { avoidRecent: true, recentDishIds: ['d1'] }), 0.4)).toBe('d2')
  })

  it('uses only the last five entries and penalizes each dish once', () => {
    const data = menu([dish('d1'), dish('d2')])
    const options = request('dish', { restaurantId: 'r1' }, {
      avoidRecent: true, recentDishIds: ['d2', 'unknown', 'unknown', 'unknown', 'd1', 'd1'],
    })
    expect(selectedDish(data, options, 0.3)).toBe('d1')
    expect(selectedDish(data, options, 0.4)).toBe('d2')
    expect(selectedDish(data, { ...options, avoidRecent: false }, 0.4)).toBe('d1')
  })

  it('keeps single and fully recent candidates selectable', () => {
    expect(selectedDish(menu(), request('dish', { restaurantId: 'r1' }, { avoidRecent: true, recentDishIds: ['d1'] }), 0.99)).toBe('d1')
    expect(selectedDish(menu([dish('d1'), dish('d2')]), request('dish', { restaurantId: 'r1' }, {
      avoidRecent: true, recentDishIds: ['d1', 'd2'],
    }), 0.5)).toBe('d2')
  })

  it.each([-1, NaN, Infinity, -Infinity])('rejects illegal menu weight %s', weight => {
    expect(() => recommend(menu([dish('invalid', 'r1', { weight })]), request())).toThrow('INVALID_WEIGHT: invalid')
  })

  it.each([-1, 1, NaN, Infinity, -Infinity])('rejects an out-of-range RNG value %s', value => {
    expect(() => recommend(menu(), request(), () => value)).toThrow('INVALID_RNG')
    expect(() => recommend(menu(), request('restaurant', {}), () => value)).toThrow('INVALID_RNG')
  })
})

function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 0x100000000
  }
}

describe('fixed-seed probability checks', () => {
  it('keeps stores equally likely with one versus one hundred dishes', () => {
    const data = menu([dish('only', 'r1'), ...Array.from({ length: 100 }, (_, index) => dish(`many-${index}`, 'r2'))],
      [restaurant(), restaurant('r2')])
    const rng = seededRandom(20261026)
    let firstStore = 0
    for (let index = 0; index < 10_000; index++) {
      const result = recommend(data, request('combo', {}), rng)
      if (result.status === 'ok' && result.restaurant.id === 'r1') firstStore++
    }
    expect(firstStore / 10_000).toBeGreaterThan(0.47)
    expect(firstStore / 10_000).toBeLessThan(0.53)
  })

  it('approximates 5:3:2 dish probabilities', () => {
    const data = menu([dish('d1', 'r1', { weight: 5 }), dish('d2', 'r1', { weight: 3 }), dish('d3', 'r1', { weight: 2 })])
    const counts: Record<string, number> = { d1: 0, d2: 0, d3: 0 }
    const rng = seededRandom(42)
    for (let index = 0; index < 10_000; index++) {
      const result = recommend(data, request(), rng)
      if (result.status === 'ok' && result.dish) counts[result.dish.id]!++
    }
    expect(Math.abs(counts.d1! / 10_000 - 0.5)).toBeLessThan(0.03)
    expect(Math.abs(counts.d2! / 10_000 - 0.3)).toBeLessThan(0.03)
    expect(Math.abs(counts.d3! / 10_000 - 0.2)).toBeLessThan(0.03)
  })
})
