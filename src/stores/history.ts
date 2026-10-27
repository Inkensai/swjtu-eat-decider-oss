import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { HistoryEntry, Mode, RecommendResult } from '../../shared/types'

const storageKey = 'eat-decider.history.v1'
const MAX_ENTRIES = 100
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

/**
 * 用餐记录。
 *
 * - 当前页面运行期间：全部记录（含未采纳）都保留在内存里，页面内部切换不丢失。
 * - 刷新或重新打开：只从 localStorage 恢复已采纳记录。
 * - 旧版 `eat-decider.history.v1` 中 adopted=true 的记录继续保留，
 *   adopted=false 的旧记录不再跨刷新恢复。
 */
export const useHistoryStore = defineStore('history', () => {
  const entries = ref<HistoryEntry[]>([])
  const warning = ref('')
  let migrate = false
  try {
    const raw = localStorage.getItem(storageKey)
    if (raw) {
      const saved: unknown = JSON.parse(raw)
      if (!Array.isArray(saved)) throw new Error('invalid history')
      const valid = saved.filter(isHistoryEntry)
      entries.value = valid.filter((entry) => entry.adopted).slice(0, MAX_ENTRIES)
      if (valid.length !== saved.length) warning.value = '已忽略无法读取的历史记录，其余记录已恢复。'
      // 旧版会把未采纳记录一并写入；读取时顺手把持久化结构迁移为只含已采纳记录。
      migrate = valid.some((entry) => !entry.adopted)
    }
  } catch { warning.value = '本机历史暂时无法读取，已恢复为空列表；新推荐仍可正常使用。' }
  function persist() {
    try {
      localStorage.setItem(storageKey, JSON.stringify(entries.value.filter((entry) => entry.adopted)))
      warning.value = ''
    } catch { warning.value = '浏览器未能保存历史变更；当前页面仍可使用，刷新后可能恢复先前记录。' }
  }
  if (migrate) {
    try { localStorage.setItem(storageKey, JSON.stringify(entries.value)) }
    catch { /* 写入失败不影响当前页面，下次采纳时会再次尝试。 */ }
  }
  /** 超过上限时优先淘汰最旧的未采纳记录，其次才淘汰最旧的已采纳记录。 */
  function trim() {
    while (entries.value.length > MAX_ENTRIES) {
      let index = -1
      for (let cursor = entries.value.length - 1; cursor >= 0; cursor -= 1) {
        if (!entries.value[cursor]!.adopted) { index = cursor; break }
      }
      entries.value.splice(index >= 0 ? index : entries.value.length - 1, 1)
    }
  }
  function add(mode: Mode, result: Extract<RecommendResult, { status: 'ok' }>): string {
    const id = crypto.randomUUID()
    entries.value.unshift({ id, at: new Date().toISOString(), mode, restaurant: { ...result.restaurant }, dish: result.dish ? { ...result.dish } : null, adopted: false })
    trim()
    // 未采纳记录只留在内存：刷新后不会恢复，因此这里不写 localStorage。
    return id
  }
  function adopt(id: string) {
    const entry = entries.value.find((item) => item.id === id)
    if (!entry) return
    entry.adopted = !entry.adopted
    trim()
    persist()
  }
  function clear() { entries.value = []; persist() }
  function recentDishIds(): string[] { return entries.value.filter((entry) => entry.dish).slice(0, 5).reverse().map((entry) => entry.dish!.id) }
  return { entries, warning, add, adopt, clear, recentDishIds }
})
