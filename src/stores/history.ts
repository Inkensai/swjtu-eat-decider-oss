import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { HistoryEntry, Mode, RecommendResult } from '../../shared/types'

const storageKey = 'eat-decider.history.v1'
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null }
function baseValid(value: Record<string, unknown>): boolean {
  return typeof value.id === 'string' && value.id.length > 0 && typeof value.name === 'string' && value.name.length > 0 && typeof value.enabled === 'boolean' && typeof value.createdAt === 'string' && typeof value.updatedAt === 'string'
}
export function isHistoryEntry(value: unknown): value is HistoryEntry {
  if (!isRecord(value) || !isRecord(value.restaurant) || !baseValid(value.restaurant)) return false
  const restaurant = value.restaurant
  if (![restaurant.areaId, restaurant.category, restaurant.location].every((item) => typeof item === 'string')) return false
  if (value.dish !== null) {
    if (!isRecord(value.dish) || !baseValid(value.dish)) return false
    const dish = value.dish
    if (![dish.restaurantId, dish.category, dish.notes].every((item) => typeof item === 'string') || dish.restaurantId !== restaurant.id) return false
    if (!Number.isSafeInteger(dish.priceCents) || (dish.priceCents as number) < 0 || typeof dish.weight !== 'number' || !Number.isFinite(dish.weight) || dish.weight < 0) return false
  }
  return typeof value.id === 'string' && value.id.length > 0 && typeof value.at === 'string' && Number.isFinite(Date.parse(value.at)) && typeof value.mode === 'string' && ['restaurant', 'dish', 'combo'].includes(value.mode) && (value.mode === 'restaurant' ? value.dish === null : value.dish !== null) && typeof value.adopted === 'boolean'
}

export const useHistoryStore = defineStore('history', () => {
  const entries = ref<HistoryEntry[]>([])
  const warning = ref('')
  try {
    const raw = localStorage.getItem(storageKey)
    if (raw) {
      const saved: unknown = JSON.parse(raw)
      if (!Array.isArray(saved)) throw new Error('invalid history')
      entries.value = saved.filter(isHistoryEntry).slice(0, 100)
      if (entries.value.length !== saved.length) warning.value = '已忽略无法读取的历史记录，其余记录已恢复。'
    }
  } catch { warning.value = '本机历史暂时无法读取，已恢复为空列表；新推荐仍可正常使用。' }
  function persist() {
    try { localStorage.setItem(storageKey, JSON.stringify(entries.value)); warning.value = '' }
    catch { warning.value = '浏览器未能保存历史变更；当前页面仍可使用，刷新后可能恢复先前记录。' }
  }
  function add(mode: Mode, result: Extract<RecommendResult, { status: 'ok' }>): string {
    const id = crypto.randomUUID()
    entries.value.unshift({ id, at: new Date().toISOString(), mode, restaurant: { ...result.restaurant }, dish: result.dish ? { ...result.dish } : null, adopted: false })
    entries.value = entries.value.slice(0, 100)
    persist()
    return id
  }
  function adopt(id: string) {
    const entry = entries.value.find((item) => item.id === id)
    if (entry) { entry.adopted = !entry.adopted; persist() }
  }
  function clear() { entries.value = []; persist() }
  function recentDishIds(): string[] { return entries.value.filter((entry) => entry.dish).slice(0, 5).reverse().map((entry) => entry.dish!.id) }
  return { entries, warning, add, adopt, clear, recentDishIds }
})
