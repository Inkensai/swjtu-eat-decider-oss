import { describe, expect, it } from 'vitest'
import {
  DEFAULT_RESTAURANT_CATEGORY,
  DISH_CATEGORIES,
  RESTAURANT_CATEGORIES,
  canonicalDishCategory,
  isDishCategory,
  isRestaurantCategory,
  isRestaurantCategoryFilter,
  normalizeRestaurantCategory,
} from '../shared/categories'

describe('shared category definitions', () => {
  it('publishes the ten fixed restaurant categories in display order', () => {
    expect(RESTAURANT_CATEGORIES).toEqual([
      '炒菜 / 家常菜',
      '粉面 / 面食',
      '快餐 / 盖饭',
      '汉堡 / 炸鸡',
      '火锅 / 麻辣烫',
      '烧烤 / 烤肉',
      '小吃 / 面点',
      '轻食 / 简餐',
      '饮品 / 甜品',
      '其他 / 综合',
    ])
    expect(DEFAULT_RESTAURANT_CATEGORY).toBe('其他 / 综合')
  })

  it('publishes the twelve fixed dish categories, with no-category represented separately', () => {
    expect(DISH_CATEGORIES).toEqual([
      '米饭 / 套餐',
      '粉面 / 米线',
      '炒菜 / 热菜',
      '汉堡 / 炸鸡',
      '披萨 / 意面',
      '火锅 / 麻辣烫',
      '烧烤 / 烤肉',
      '饺馄 / 面点',
      '小吃 / 轻食',
      '汤粥 / 砂锅',
      '饮品 / 甜品',
      '其他',
    ])
    expect(isDishCategory('')).toBe(false)
  })

  it('normalizes blank and firepot restaurant categories without guessing split categories', () => {
    expect(normalizeRestaurantCategory('')).toBe(DEFAULT_RESTAURANT_CATEGORY)
    expect(normalizeRestaurantCategory('   ')).toBe(DEFAULT_RESTAURANT_CATEGORY)
    expect(normalizeRestaurantCategory('火锅 / 串串')).toBe('火锅 / 麻辣烫')
    expect(normalizeRestaurantCategory('小吃 / 轻食')).toBe('小吃 / 轻食')
    expect(normalizeRestaurantCategory('川菜')).toBe('川菜')
    expect(isRestaurantCategory('粉面 / 面食')).toBe(true)
    expect(isRestaurantCategory('川菜')).toBe(false)
  })

  it('accepts current and known legacy restaurant filters only', () => {
    expect(isRestaurantCategoryFilter('轻食 / 简餐')).toBe(true)
    expect(isRestaurantCategoryFilter('火锅 / 串串')).toBe(true)
    expect(isRestaurantCategoryFilter('小吃 / 轻食')).toBe(true)
    expect(isRestaurantCategoryFilter('川菜')).toBe(false)
  })

  it('maps only the explicitly supported V1.1 dish names', () => {
    expect(canonicalDishCategory('米饭 / 盖饭')).toBe('米饭 / 套餐')
    expect(canonicalDishCategory('粉面')).toBe('粉面 / 米线')
    expect(canonicalDishCategory('主菜')).toBe('炒菜 / 热菜')
    expect(canonicalDishCategory('小吃')).toBe('小吃 / 轻食')
    expect(canonicalDishCategory('饮品 / 甜品')).toBe('饮品 / 甜品')
    expect(canonicalDishCategory('其他')).toBe('其他')
    expect(canonicalDishCategory('宵夜')).toBe('宵夜')
  })
})
