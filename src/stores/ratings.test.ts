import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../services/api'
import { useRatingsStore } from './ratings'

vi.mock('../services/api', () => ({ api: vi.fn() }))
const request = vi.mocked(api)
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}
const empty = { restaurants: [], dishes: [] }
const rated = { restaurants: [{ targetId: 'r1', count: 1, average: 5 }], dishes: [] }
const owned = { mine: [{ targetType: 'restaurant', targetId: 'r1', stars: 5 }] }
const tick = async () => { for (let i = 0; i < 10; i++) await Promise.resolve() }
beforeEach(() => { setActivePinia(createPinia()); request.mockReset(); vi.stubGlobal('navigator', {}) })
afterEach(() => vi.unstubAllGlobals())

describe('rating request coordination', () => {
  it('does not let an old overview overwrite a completed write, and bypasses cached summaries', async () => {
    const oldSummary = deferred<unknown>()
    const oldMine = deferred<unknown>()
    let summaries = 0
    let mine = 0
    request.mockImplementation(async (path) => {
      if (path === '/ratings/summary') return ++summaries === 1 ? oldSummary.promise : rated
      if (path === '/ratings/mine') return ++mine === 1 ? oldMine.promise : owned
      return { average: 5, count: 1 }
    })
    const store = useRatingsStore()
    const loading = store.load()
    await store.submit('restaurant', 'r1', 5)
    oldSummary.resolve(empty)
    oldMine.resolve({ mine: [] })
    await loading
    expect(store.myStars('restaurant', 'r1')).toBe(5)
    expect(store.summary('restaurant', 'r1').count).toBe(1)
    expect(request).toHaveBeenCalledWith('/ratings/summary', { cache: 'no-store' })
  })

  it('serializes different targets and store instances and acquires the cross-tab lock', async () => {
    const firstWrite = deferred<unknown>()
    const lock = vi.fn(async (_name: string, callback: () => Promise<void>) => callback())
    vi.stubGlobal('navigator', { locks: { request: lock } })
    const writes: string[] = []
    request.mockImplementation(async (path, init) => {
      if (init?.method === 'PUT') { writes.push(path); if (writes.length === 1) return firstWrite.promise; return {} }
      return path === '/ratings/mine' ? { mine: [] } : empty
    })
    const one = useRatingsStore()
    setActivePinia(createPinia())
    const two = useRatingsStore()
    const first = one.submit('restaurant', 'r1', 4)
    const second = two.submit('dish', 'd1', 3)
    await tick()
    expect(writes).toEqual(['/ratings/restaurant/r1'])
    expect(two.isPending('dish', 'd1')).toBe(true)
    firstWrite.resolve({})
    await Promise.all([first, second])
    expect(writes).toEqual(['/ratings/restaurant/r1', '/ratings/dish/d1'])
    expect(lock).toHaveBeenCalledTimes(2)
    expect(lock.mock.calls[0]?.[0]).toBe('eat-decider.rating-write')
    expect(two.isPending('dish', 'd1')).toBe(false)
  })

  it('refreshes after deletion even if an overview is already loading', async () => {
    const oldMine = deferred<unknown>()
    let reads = 0
    request.mockImplementation(async (path) => {
      if (path === '/ratings/mine') return ++reads === 1 ? oldMine.promise : { mine: [] }
      return empty
    })
    const store = useRatingsStore()
    store.mine['restaurant:r1'] = 5
    const loading = store.load()
    await store.remove('restaurant', 'r1')
    oldMine.resolve(owned)
    await loading
    expect(store.myStars('restaurant', 'r1')).toBeNull()
    expect(reads).toBe(2)
  })

  it('releases a rejected write so subsequent ratings can be saved', async () => {
    let writes = 0
    request.mockImplementation(async (path, init) => {
      if (init?.method === 'PUT' && ++writes === 1) throw new Error('offline')
      return path === '/ratings/mine' ? owned : rated
    })
    const store = useRatingsStore()
    await expect(store.submit('restaurant', 'r1', 3)).rejects.toThrow('offline')
    await store.submit('restaurant', 'r1', 5)
    expect(store.myStars('restaurant', 'r1')).toBe(5)
    expect(store.isPending('restaurant', 'r1')).toBe(false)
  })

  it('keeps authoritative mutation results when the fresh read fails', async () => {
    request.mockImplementation(async (_path, init) => {
      if (init?.method === 'PUT') return { targetId: 'r1', targetType: 'restaurant', stars: 5, average: 4.5, count: 2 }
      throw new Error('刷新失败')
    })
    const store = useRatingsStore()
    await store.submit('restaurant', 'r1', 5)
    expect(store.myStars('restaurant', 'r1')).toBe(5)
    expect(store.summary('restaurant', 'r1')).toEqual({ targetId: 'r1', average: 4.5, count: 2 })
    expect(store.error).toBe('刷新失败')
  })
})
