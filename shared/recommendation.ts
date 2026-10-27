import type { Dish, Menu, RecommendRequest, RecommendResult } from './types'
import { normalizeRestaurantCategory } from './categories'

function randomValue(rng: () => number): number {
  const value = rng()
  if (!Number.isFinite(value) || value < 0 || value >= 1) {
    throw new RangeError('INVALID_RNG: 随机数必须在 [0, 1) 内')
  }
  return value
}

function chooseDish(dishes: Dish[], recent: Set<string>, rng: () => number): Dish {
  const maximum = dishes.reduce((max, dish) => Math.max(max, dish.weight), 0)
  // Normalize before summing so finite weights cannot overflow their total.
  const weights = dishes.map(dish => (maximum === 0 ? 1 : dish.weight / maximum)
    * (recent.has(dish.id) ? 0.5 : 1))
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  let threshold = randomValue(rng) * total
  let lastPositive = 0
  for (let index = 0; index < dishes.length; index++) {
    const weight = weights[index]!
    if (weight === 0) continue
    lastPositive = index
    if (threshold < weight) return dishes[index]!
    threshold -= weight
  }
  return dishes[lastPositive]!
}

export function recommend(
  menu: Menu,
  request: RecommendRequest,
  rng: () => number = Math.random,
): RecommendResult {
  for (const dish of menu.dishes) {
    if (!Number.isFinite(dish.weight) || dish.weight < 0) {
      throw new RangeError(`INVALID_WEIGHT: ${dish.id}`)
    }
  }

  const { filters } = request
  if (request.mode === 'dish' && !filters.restaurantId) {
    return { status: 'empty', message: '请先选择一家店铺' }
  }

  const areaIds = new Set(menu.areas
    .filter(area => area.enabled && (!filters.areaId || area.id === filters.areaId))
    .map(area => area.id))
  const excludedRestaurants = new Set(filters.excludedRestaurantIds ?? [])
  const excludedDishes = new Set(filters.excludedDishIds ?? [])
  // 店内选菜已明确指定店铺，不再让店铺分类额外收窄候选。
  const restaurantCategory = request.mode === 'dish' ? undefined : filters.restaurantCategory
  const restaurants = menu.restaurants.filter(restaurant => restaurant.enabled
    && areaIds.has(restaurant.areaId)
    && (!filters.restaurantId || restaurant.id === filters.restaurantId)
    && (!restaurantCategory || normalizeRestaurantCategory(restaurant.category) === restaurantCategory)
    && !excludedRestaurants.has(restaurant.id))
  const dishesByRestaurant = new Map(restaurants.map(restaurant => [restaurant.id, [] as Dish[]]))

  for (const dish of menu.dishes) {
    const candidates = dishesByRestaurant.get(dish.restaurantId)
    if (candidates && dish.enabled
      && (!filters.category || dish.category === filters.category)
      && (filters.maxPriceCents === undefined || dish.priceCents <= filters.maxPriceCents)
      && !excludedDishes.has(dish.id)) {
      candidates.push(dish)
    }
  }

  const candidates = restaurants.filter(restaurant => dishesByRestaurant.get(restaurant.id)!.length > 0)
  if (candidates.length === 0) {
    return {
      status: 'empty',
      message: restaurantCategory
        ? `没有符合「${restaurantCategory}」分类和当前条件的店铺或菜品，请放宽筛选条件`
        : '没有符合条件的菜品，请放宽筛选条件',
    }
  }

  const restaurant = request.mode === 'dish'
    ? candidates[0]!
    : candidates[Math.floor(randomValue(rng) * candidates.length)]!
  const dishes = dishesByRestaurant.get(restaurant.id)!
  const recent = new Set(request.avoidRecent ? request.recentDishIds.slice(-5) : [])
  return {
    status: 'ok',
    restaurant,
    dish: request.mode === 'restaurant' ? null : chooseDish(dishes, recent, rng),
    candidateDishCount: dishes.length,
  }
}
