import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Area, Restaurant, Dish } from '../../shared/types'
import { api } from '../services/api'

export const useMenuStore = defineStore('menu', () => {
  const areas = ref<Area[]>([])
  const restaurants = ref<Restaurant[]>([])
  const dishes = ref<Dish[]>([])
  const loading = ref(false)
  const error = ref('')
  async function load() {
    if (loading.value) return
    loading.value = true
    error.value = ''
    try {
      const [a, r, d] = await Promise.all([api<Area[]>('/areas'), api<Restaurant[]>('/restaurants'), api<Dish[]>('/dishes')])
      areas.value = a
      restaurants.value = r
      dishes.value = d
    } catch (e) { error.value = e instanceof Error ? e.message : '菜单加载失败。' }
    finally { loading.value = false }
  }
  return { areas, restaurants, dishes, loading, error, load }
})
