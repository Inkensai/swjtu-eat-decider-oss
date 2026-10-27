import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HistoryEntry, RecommendResult } from '../../shared/types'
import { isHistoryEntry, useHistoryStore } from './history'

const restaurant = { id: 'r1', areaId: 'a1', name: '小店', category: '面食', location: '一楼', enabled: true, createdAt: '2026-01-01', updatedAt: '2026-01-01' }
const dish = { id: 'd1', restaurantId: 'r1', name: '牛肉面', category: '面食', priceCents: 1290, weight: 1, notes: '', enabled: true, createdAt: '2026-01-01', updatedAt: '2026-01-01' }
const recommendation: Extract<RecommendResult, { status: 'ok' }> = { status: 'ok', restaurant, dish, candidateDishCount: 1 }
const entry: HistoryEntry = { id: 'h1', at: '2026-10-26T00:00:00.000Z', mode: 'combo', restaurant, dish, adopted: false }

beforeEach(() => {
  setActivePinia(createPinia())
  vi.stubGlobal('localStorage', { getItem: vi.fn(() => null), setItem: vi.fn() })
})
afterEach(() => { vi.unstubAllGlobals() })

describe('本机推荐历史', () => {
  it('校验完整快照并保留可恢复记录', () => {
    expect(isHistoryEntry(entry)).toBe(true)
    expect(isHistoryEntry({ ...entry, dish: { ...dish, priceCents: -1 } })).toBe(false)
    expect(isHistoryEntry({ ...entry, at: 'broken' })).toBe(false)
    expect(isHistoryEntry({ ...entry, dish: {} })).toBe(false)
    vi.mocked(localStorage.getItem).mockReturnValue(JSON.stringify([entry, { bad: true }]))
    const history = useHistoryStore()
    expect(history.entries).toHaveLength(1)
    expect(history.warning).toContain('已忽略')
  })
  it('损坏JSON恢复为空，写入失败仍保留当前会话', () => {
    vi.mocked(localStorage.getItem).mockReturnValue('{broken')
    vi.mocked(localStorage.setItem).mockImplementation(() => { throw new Error('quota') })
    const history = useHistoryStore()
    expect(history.entries).toHaveLength(0)
    expect(history.warning).toContain('恢复为空')
    history.add('combo', recommendation)
    expect(history.entries).toHaveLength(1)
    expect(history.warning).toContain('刷新后可能恢复')
  })
  it('单条畸形模式不会影响其余正常历史恢复', () => {
    vi.mocked(localStorage.getItem).mockReturnValue(JSON.stringify([entry, { ...entry, mode: { toString: null } }]))
    const history = useHistoryStore()
    expect(history.entries).toEqual([entry])
    expect(history.warning).toContain('已忽略')
  })
  it('最多100条，最近5次含菜推荐按旧到新发送，采纳不会新增记录', () => {
    const history = useHistoryStore()
    for (let i = 0; i < 103; i++) history.add('combo', { ...recommendation, dish: { ...dish, id: `d${i}` } })
    history.add('restaurant', { ...recommendation, dish: null })
    expect(history.entries).toHaveLength(100)
    expect(history.recentDishIds()).toEqual(['d98', 'd99', 'd100', 'd101', 'd102'])
    const id = history.entries[0]!.id
    history.adopt(id)
    expect(history.entries[0]!.adopted).toBe(true)
    expect(history.entries).toHaveLength(100)
    history.clear()
    expect(history.entries).toEqual([])
  })
})
