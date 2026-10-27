import { describe, expect, it } from 'vitest'
import {
  DEFAULT_RESTAURANT_CATEGORY,
  DISH_CATEGORIES,
  RESTAURANT_CATEGORIES,
  isDishCategory,
  isRestaurantCategory,
  normalizeRestaurantCategory,
} from '../shared/categories'

describe('shared category definitions', () => {
  it('publishes the eight fixed restaurant categories in display order', () => {
    expect(RESTAURANT_CATEGORIES).toEqual([
      '炒菜 / 家常菜',
      '粉面 / 面食',
      '快餐 / 盖饭',
      '火锅 / 串串',
      '烧烤 / 烤肉',
      '小吃 / 轻食',
      '饮品 / 甜品',
      '其他 / 综合',
    ])
    expect(DEFAULT_RESTAURANT_CATEGORY).toBe('其他 / 综合')
  })

  it('publishes the six fixed dish choices, with no-category represented separately', () => {
    expect(DISH_CATEGORIES).toEqual(['米饭 / 盖饭', '粉面', '小吃', '主菜', '饮品 / 甜品', '其他'])
    expect(isDishCategory('')).toBe(false)
  })

  it('normalizes only blank restaurant categories and leaves historical values intact', () => {
    expect(normalizeRestaurantCategory('')).toBe(DEFAULT_RESTAURANT_CATEGORY)
    expect(normalizeRestaurantCategory('   ')).toBe(DEFAULT_RESTAURANT_CATEGORY)
    expect(normalizeRestaurantCategory('川菜')).toBe('川菜')
    expect(isRestaurantCategory('粉面 / 面食')).toBe(true)
    expect(isRestaurantCategory('川菜')).toBe(false)
  })
})
