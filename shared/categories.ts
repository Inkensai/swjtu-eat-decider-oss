export const RESTAURANT_CATEGORIES = [
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
] as const

export type RestaurantCategory = typeof RESTAURANT_CATEGORIES[number]

export const DEFAULT_RESTAURANT_CATEGORY: RestaurantCategory = '其他 / 综合'

export const LEGACY_RESTAURANT_CATEGORIES = ['火锅 / 串串', '小吃 / 轻食'] as const

export type LegacyRestaurantCategory = typeof LEGACY_RESTAURANT_CATEGORIES[number]

export type RestaurantCategoryFilter = RestaurantCategory | LegacyRestaurantCategory

export const LEGACY_RESTAURANT_CATEGORY_ALIASES = {
  '火锅 / 串串': '火锅 / 麻辣烫',
} as const

export function normalizeRestaurantCategory(category: string): string {
  const value = category.trim()
  if (!value) return DEFAULT_RESTAURANT_CATEGORY
  return (LEGACY_RESTAURANT_CATEGORY_ALIASES as Record<string, string>)[value] ?? value
}

export function isRestaurantCategory(value: unknown): value is RestaurantCategory {
  return typeof value === 'string' && (RESTAURANT_CATEGORIES as readonly string[]).includes(value)
}

export function isRestaurantCategoryFilter(value: unknown): value is RestaurantCategoryFilter {
  return isRestaurantCategory(value)
    || (typeof value === 'string' && (LEGACY_RESTAURANT_CATEGORIES as readonly string[]).includes(value))
}

export const DISH_CATEGORIES = [
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
] as const

export type DishCategory = typeof DISH_CATEGORIES[number]

export const LEGACY_DISH_CATEGORY_ALIASES = {
  '米饭 / 盖饭': '米饭 / 套餐',
  '粉面': '粉面 / 米线',
  '主菜': '炒菜 / 热菜',
  '小吃': '小吃 / 轻食',
} as const

export type LegacyDishCategory = keyof typeof LEGACY_DISH_CATEGORY_ALIASES

export function canonicalDishCategory(category: string): string {
  const value = category.trim()
  return (LEGACY_DISH_CATEGORY_ALIASES as Record<string, string>)[value] ?? value
}

export function isDishCategory(value: unknown): value is DishCategory {
  return typeof value === 'string' && (DISH_CATEGORIES as readonly string[]).includes(value)
}
