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
export type RatingTargetType = 'restaurant' | 'dish'
/** 全站统计；average 为 null 表示暂无评分。 */
export interface RatingSummary { targetId: string; average: number | null; count: number }
/** 当前匿名身份对某对象的评分。 */
export interface MyRating { targetType: RatingTargetType; targetId: string; stars: number }
export interface RatingOverview { restaurants: RatingSummary[]; dishes: RatingSummary[]; mine: MyRating[] }
export interface RatingSubmission extends MyRating { average: number | null; count: number }
/** 管理员评分列表行；不包含任何身份凭据或摘要。 */
export interface AdminRating {
  id: string
  targetType: RatingTargetType
  targetId: string
  targetName: string
  targetEnabled: boolean
  restaurantId: string | null
  restaurantName: string | null
  stars: number
  createdAt: string
  updatedAt: string
}
export interface AdminRatingList { items: AdminRating[]; total: number }
