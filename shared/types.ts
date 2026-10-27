import type { RestaurantCategoryFilter } from './categories'

export type AreaType = 'canteen' | 'nearby' | 'other'
export interface BaseRecord { id: string; createdAt: string; updatedAt: string }
export interface Area extends BaseRecord { name: string; type: AreaType; sortOrder: number; enabled: boolean }
export interface Restaurant extends BaseRecord { areaId: string; name: string; category: string; location: string; enabled: boolean }
export interface Dish extends BaseRecord { restaurantId: string; name: string; category: string; priceCents: number; weight: number; notes: string; enabled: boolean }
export interface Menu { areas: Area[]; restaurants: Restaurant[]; dishes: Dish[] }
export type Resource = 'areas' | 'restaurants' | 'dishes'
export type Mode = 'restaurant' | 'dish' | 'combo'
export interface Filters { areaId?: string; restaurantId?: string; restaurantCategory?: RestaurantCategoryFilter; category?: string; maxPriceCents?: number; excludedRestaurantIds?: string[]; excludedDishIds?: string[] }
export interface RecommendRequest { mode: Mode; filters: Filters; avoidRecent: boolean; recentDishIds: string[] }
export type RecommendResult = { status: 'ok'; restaurant: Restaurant; dish: Dish | null; candidateDishCount: number } | { status: 'empty'; message: string }
export interface HistoryEntry { id: string; at: string; mode: Mode; restaurant: Restaurant; dish: Dish | null; adopted: boolean }
