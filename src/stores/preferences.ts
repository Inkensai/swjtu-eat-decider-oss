import { defineStore } from 'pinia'
import { ref } from 'vue'
import { centsFromInput } from '../lib/format'

const STORAGE_KEY = 'eat-decider.preferences.v1'
export interface Preferences {
  areaId: string
  maxPrice: string
  excludedRestaurantIds: string[]
  excludedDishIds: string[]
  avoidRecent: boolean
  openNow: boolean
}
export const defaultPreferences = (): Preferences => ({ areaId: '', maxPrice: '', excludedRestaurantIds: [], excludedDishIds: [], avoidRecent: false, openNow: false })
const validId = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 128
const ids = (value: unknown): string[] => Array.isArray(value) ? [...new Set(value.filter(validId).map((id) => id.trim()))].slice(0, 200) : []
export function validatePreferences(value: unknown): Preferences {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  return {
    areaId: validId(source.areaId) ? source.areaId.trim() : '',
    maxPrice: typeof source.maxPrice === 'string' && centsFromInput(source.maxPrice) !== null ? source.maxPrice.trim() : '',
    excludedRestaurantIds: ids(source.excludedRestaurantIds),
    excludedDishIds: ids(source.excludedDishIds),
    avoidRecent: source.avoidRecent === true,
    openNow: source.openNow === true,
  }
}

export const usePreferencesStore = defineStore('preferences', () => {
  const value = ref(defaultPreferences())
  const warning = ref('')
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) value.value = validatePreferences(JSON.parse(raw))
  } catch { warning.value = '偏好暂时无法读取，本次仍可正常选择。' }

  function save(next: Preferences): void {
    value.value = validatePreferences(next)
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(value.value)); warning.value = '' }
    catch { warning.value = '浏览器未能保存偏好；本次选择仍然有效。' }
  }
  function clear(): void {
    value.value = defaultPreferences()
    try { localStorage.removeItem(STORAGE_KEY); warning.value = '' }
    catch { warning.value = '浏览器未能清除已保存的偏好，请检查存储设置。' }
  }
  return { value, warning, save, clear }
})
