import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { RatingOverview, RatingSubmission, RatingSummary, RatingTargetType } from '../../shared/types'
import { api } from '../services/api'

function key(targetType: RatingTargetType, targetId: string): string { return `${targetType}:${targetId}` }
const empty = (targetId: string): RatingSummary => ({ targetId, average: null, count: 0 })

/**
 * 全站评分的只读镜像与当前匿名身份的评分状态。
 * 统计与「我的评分」都由服务端返回；前端不做乐观计算，避免人数/均分漂移。
 */
export const useRatingsStore = defineStore('ratings', () => {
  const summaries = ref<Record<string, RatingSummary>>({})
  const mine = ref<Record<string, number>>({})
  const loading = ref(false)
  const error = ref('')

  async function load(): Promise<void> {
    if (loading.value) return
    loading.value = true
    error.value = ''
    try {
      const overview = await api<RatingOverview>('/ratings')
      const next: Record<string, RatingSummary> = {}
      for (const item of overview.restaurants) next[key('restaurant', item.targetId)] = item
      for (const item of overview.dishes) next[key('dish', item.targetId)] = item
      summaries.value = next
      const owned: Record<string, number> = {}
      for (const item of overview.mine) owned[key(item.targetType, item.targetId)] = item.stars
      mine.value = owned
    } catch (e) {
      error.value = e instanceof Error ? e.message : '评分暂时无法加载。'
    } finally {
      loading.value = false
    }
  }

  function summary(targetType: RatingTargetType, targetId: string): RatingSummary {
    return summaries.value[key(targetType, targetId)] ?? empty(targetId)
  }

  function myStars(targetType: RatingTargetType, targetId: string): number | null {
    return mine.value[key(targetType, targetId)] ?? null
  }

  async function submit(targetType: RatingTargetType, targetId: string, stars: number): Promise<void> {
    const result = await api<RatingSubmission>(`/ratings/${targetType}/${encodeURIComponent(targetId)}`, {
      method: 'PUT',
      body: JSON.stringify({ stars }),
    })
    summaries.value = { ...summaries.value, [key(targetType, targetId)]: { targetId, average: result.average, count: result.count } }
    mine.value = { ...mine.value, [key(targetType, targetId)]: stars }
  }

  async function remove(targetType: RatingTargetType, targetId: string): Promise<void> {
    await api(`/ratings/${targetType}/${encodeURIComponent(targetId)}`, { method: 'DELETE' })
    // 删除后平均分与人数必须由服务端重新聚合，不能在前端猜测。
    await load()
  }

  return { summaries, mine, loading, error, load, submit, remove, summary, myStars }
})
