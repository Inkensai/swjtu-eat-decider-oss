import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { RatingOverview, RatingSubmission, RatingSummary, RatingTargetType } from '../../shared/types'
import { api } from '../services/api'

function key(targetType: RatingTargetType, targetId: string): string { return `${targetType}:${targetId}` }
const empty = (targetId: string): RatingSummary => ({ targetId, average: null, count: 0 })
// Receive the first identity cookie before starting another write, including in other tabs.
let writeQueue: Promise<unknown> = Promise.resolve()
function serializeWrite(task: () => Promise<void>): Promise<void> {
  const run = writeQueue.catch(() => {}).then(() => {
    if (typeof navigator !== 'undefined' && navigator.locks) {
      return navigator.locks.request('eat-decider.rating-write', task)
    }
    return task()
  })
  writeQueue = run.catch(() => {})
  return run
}

export const useRatingsStore = defineStore('ratings', () => {
  const summaries = ref<Record<string, RatingSummary>>({})
  const mine = ref<Record<string, number>>({})
  const pending = ref<Record<string, number>>({})
  const loading = ref(false)
  const error = ref('')
  let revision = 0
  let writes = 0

  async function refresh(fresh = false): Promise<void> {
    const current = ++revision
    loading.value = true
    error.value = ''
    try {
      const [overview, owned] = await Promise.all([
        api<Pick<RatingOverview, 'restaurants' | 'dishes'>>('/ratings/summary', { cache: fresh ? 'no-store' : 'default' }),
        api<Pick<RatingOverview, 'mine'>>('/ratings/mine', { cache: 'no-store' }),
      ])
      if (current !== revision) return
      const next: Record<string, RatingSummary> = {}
      for (const item of overview.restaurants) next[key('restaurant', item.targetId)] = item
      for (const item of overview.dishes) next[key('dish', item.targetId)] = item
      summaries.value = next
      mine.value = Object.fromEntries(owned.mine.map((item) => [key(item.targetType, item.targetId), item.stars]))
    } catch (e) {
      if (current === revision) error.value = e instanceof Error ? e.message : '评分暂时无法加载。'
    } finally {
      if (current === revision) loading.value = false
    }
  }

  async function load(): Promise<void> {
    if (writes) { await writeQueue; return }
    await refresh()
  }
  function summary(targetType: RatingTargetType, targetId: string): RatingSummary {
    return summaries.value[key(targetType, targetId)] ?? empty(targetId)
  }
  function myStars(targetType: RatingTargetType, targetId: string): number | null {
    return mine.value[key(targetType, targetId)] ?? null
  }
  function isPending(targetType: RatingTargetType, targetId: string): boolean {
    return Boolean(pending.value[key(targetType, targetId)])
  }

  async function mutate(targetType: RatingTargetType, targetId: string, stars?: number): Promise<void> {
    const target = key(targetType, targetId)
    pending.value[target] = (pending.value[target] ?? 0) + 1
    writes++
    ++revision
    loading.value = false
    try {
      await serializeWrite(async () => {
        ++revision
        const result = await api<RatingSubmission | undefined>(`/ratings/${targetType}/${encodeURIComponent(targetId)}`, stars === undefined
          ? { method: 'DELETE' }
          : { method: 'PUT', body: JSON.stringify({ stars }) })
        // Ownership remains accurate even when the follow-up read fails.
        if (stars === undefined) delete mine.value[target]
        else {
          mine.value[target] = stars
          if (result) summaries.value[target] = { targetId, average: result.average, count: result.count }
        }
        await refresh(true)
      })
    } finally {
      writes--
      pending.value[target] = (pending.value[target] ?? 1) - 1
    }
  }
  const submit = (targetType: RatingTargetType, targetId: string, stars: number) => mutate(targetType, targetId, stars)
  const remove = (targetType: RatingTargetType, targetId: string) => mutate(targetType, targetId)
  return { summaries, mine, loading, error, load, submit, remove, summary, myStars, isPending }
})
