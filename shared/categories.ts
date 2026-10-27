export const RESTAURANT_CATEGORIES = [
  '炒菜 / 家常菜',
  '粉面 / 面食',
  '快餐 / 盖饭',
  '火锅 / 串串',
  '烧烤 / 烤肉',
  '小吃 / 轻食',
  '饮品 / 甜品',
  '其他 / 综合',
] as const

export type RestaurantCategory = typeof RESTAURANT_CATEGORIES[number]

export const DEFAULT_RESTAURANT_CATEGORY: RestaurantCategory = '其他 / 综合'

export function normalizeRestaurantCategory(category: string): string {
  return category.trim() || DEFAULT_RESTAURANT_CATEGORY
}

export function isRestaurantCategory(value: unknown): value is RestaurantCategory {
  return typeof value === 'string' && (RESTAURANT_CATEGORIES as readonly string[]).includes(value)
}

export const DISH_CATEGORIES = [
  '米饭 / 盖饭',
  '粉面',
  '小吃',
  '主菜',
  '饮品 / 甜品',
  '其他',
] as const

export type DishCategory = typeof DISH_CATEGORIES[number]

export function isDishCategory(value: unknown): value is DishCategory {
  return typeof value === 'string' && (DISH_CATEGORIES as readonly string[]).includes(value)
}
