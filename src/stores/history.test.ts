import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HistoryEntry, RecommendResult } from '../../shared/types'
import { isHistoryEntry, useHistoryStore } from './history'

const storageKey = 'eat-decider.history.v1'
const restaurant = { id: 'r1', areaId: 'a1', name: '小店', category: '面食', location: '一楼', enabled: true, createdAt: '2026-01-01', updatedAt: '2026-01-01' }
const dish = { id: 'd1', restaurantId: 'r1', name: '牛肉面', category: '面食', priceCents: 1290, weight: 1, notes: '', enabled: true, createdAt: '2026-01-01', updatedAt: '2026-01-01' }
const recommendation: Extract<RecommendResult, { status: 'ok' }> = { status: 'ok', restaurant, dish, candidateDishCount: 1 }
const entry = (id = 'h1', adopted = false): HistoryEntry => ({ id, at: '2026-10-26T00:00:00.000Z', mode: 'combo', restaurant, dish, adopted })

let storage: Record<string, string>
function stored(): HistoryEntry[] {
  const raw = storage[storageKey]
  return raw ? JSON.parse(raw) as HistoryEntry[] : []
}

beforeEach(() => {
  storage = {}
  setActivePinia(createPinia())
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage[key] ?? null,
    setItem: (key: string, value: string) => { storage[key] = value },
  })
})
afterEach(() => { vi.unstubAllGlobals() })

describe('本机推荐历史', () => {
  it('校验完整快照并保留可恢复记录', () => {
    expect(isHistoryEntry(entry())).toBe(true)
    expect(isHistoryEntry({ ...entry(), dish: { ...dish, priceCents: -1 } })).toBe(false)
    expect(isHistoryEntry({ ...entry(), at: 'broken' })).toBe(false)
    expect(isHistoryEntry({ ...entry(), dish: {} })).toBe(false)
  })

  it('只跨刷新恢复已采纳记录，并忽略无法读取的条目', () => {
    storage[storageKey] = JSON.stringify([entry('adopted', true), entry('pending', false), { bad: true }])
    const history = useHistoryStore()
    expect(history.entries.map((item) => item.id)).toEqual(['adopted'])
    expect(history.warning).toContain('已忽略')
  })

  it('兼容旧版 adopted 字段：adopted=true 保留，adopted=false 不再恢复', () => {
    storage[storageKey] = JSON.stringify([{ ...entry('legacy-adopted', true), legacyField: 1 }, entry('legacy-pending', false)])
    const history = useHistoryStore()
    expect(history.entries.map((item) => item.id)).toEqual(['legacy-adopted'])
    expect(stored().map((item) => item.id)).toEqual(['legacy-adopted'])
  })

  it('损坏 JSON 恢复为空，写入失败仍保留当前会话', () => {
    storage[storageKey] = '{broken'
    const history = useHistoryStore()
    expect(history.entries).toHaveLength(0)
    expect(history.warning).toContain('恢复为空')
    history.add('combo', recommendation)
    expect(history.entries).toHaveLength(1)
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage[key] ?? null,
      setItem: () => { throw new Error('quota') },
    })
    history.adopt(history.entries[0]!.id)
    expect(history.warning).toContain('刷新后可能恢复')
  })

  it('推荐后立即进入内存历史但不写入 localStorage，采纳后才持久化', () => {
    const history = useHistoryStore()
    const id = history.add('combo', recommendation)
    expect(history.entries.map((item) => item.id)).toEqual([id])
    expect(stored()).toEqual([])
    history.adopt(id)
    expect(history.entries[0]!.adopted).toBe(true)
    expect(stored().map((item) => item.id)).toEqual([id])
  })

  it('取消采纳后从持久化记录移除，但当前页面仍可看到', () => {
    const history = useHistoryStore()
    const id = history.add('combo', recommendation)
    history.adopt(id)
    history.adopt(id)
    expect(history.entries.map((item) => item.id)).toEqual([id])
    expect(history.entries[0]!.adopted).toBe(false)
    expect(stored()).toEqual([])
  })

  it('刷新后未采纳记录消失、已采纳记录保留', () => {
    const history = useHistoryStore()
    const pending = history.add('combo', recommendation)
    const adopted = history.add('combo', { ...recommendation, dish: { ...dish, id: 'd2' } })
    history.adopt(adopted)
    expect(history.entries).toHaveLength(2)
    setActivePinia(createPinia())
    const reloaded = useHistoryStore()
    expect(reloaded.entries.map((item) => item.id)).toEqual([adopted])
    expect(reloaded.entries.some((item) => item.id === pending)).toBe(false)
  })

  it('最多 100 条：优先淘汰最旧的未采纳记录，其次淘汰最旧的已采纳记录', () => {
    const history = useHistoryStore()
    for (let index = 0; index < 100; index += 1) history.add('combo', { ...recommendation, dish: { ...dish, id: `d${index}` } })
    expect(history.entries).toHaveLength(100)
    const oldest = history.entries[99]!
    const secondOldest = history.entries[98]!
    history.adopt(oldest.id)
    history.adopt(secondOldest.id)
    for (let index = 0; index < 5; index += 1) history.add('combo', { ...recommendation, dish: { ...dish, id: `extra${index}` } })
    expect(history.entries).toHaveLength(100)
    expect(history.entries.filter((item) => item.adopted).map((item) => item.id).sort()).toEqual([oldest.id, secondOldest.id].sort())
    expect(stored().map((item) => item.id).sort()).toEqual([oldest.id, secondOldest.id].sort())

    for (const item of history.entries) if (!item.adopted) history.adopt(item.id)
    expect(stored()).toHaveLength(100)
    // 全部 100 条都已采纳时，新推荐是唯一的未采纳记录，按规则先被淘汰。
    const evictedId = history.add('combo', recommendation)
    expect(history.entries).toHaveLength(100)
    expect(history.entries.some((item) => item.id === evictedId)).toBe(false)
    expect(history.entries.every((item) => item.adopted)).toBe(true)
    expect(stored()).toHaveLength(100)
  })

  it('最近 5 次含菜推荐按旧到新发送，采纳不会新增记录', () => {
    const history = useHistoryStore()
    for (let index = 0; index < 7; index += 1) history.add('combo', { ...recommendation, dish: { ...dish, id: `d${index}` } })
    expect(history.recentDishIds()).toEqual(['d2', 'd3', 'd4', 'd5', 'd6'])
    const id = history.entries[0]!.id
    history.adopt(id)
    expect(history.entries).toHaveLength(7)
    history.clear()
    expect(history.entries).toEqual([])
    expect(stored()).toEqual([])
  })
})
