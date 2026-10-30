import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultPreferences, usePreferencesStore, validatePreferences } from './preferences'

const key = 'eat-decider.preferences.v1'
let saved: Record<string, string>
beforeEach(() => {
  saved = {}
  setActivePinia(createPinia())
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => saved[key] ?? null,
    setItem: (key: string, value: string) => { saved[key] = value },
    removeItem: (key: string) => { delete saved[key] },
  })
})
afterEach(() => vi.unstubAllGlobals())

describe('saved recommendation preferences', () => {
  it('validates untrusted persisted data and deduplicates exclusions', () => {
    expect(validatePreferences({ areaId: {}, maxPrice: '-2', excludedDishIds: [' d1 ', 'd1', null, '', 'x'.repeat(129)], avoidRecent: 'false' })).toEqual({ ...defaultPreferences(), excludedDishIds: ['d1'] })
    expect(validatePreferences(null)).toEqual(defaultPreferences())
    expect(validatePreferences({ areaId: ' 店铺 / 1 ', excludedDishIds: Array.from({ length: 250 }, (_, i) => String(i)) }).areaId).toBe('店铺 / 1')
    expect(validatePreferences({ excludedDishIds: Array.from({ length: 250 }, (_, i) => String(i)) }).excludedDishIds).toHaveLength(200)
  })
  it('restores preferences without needing the menu to have loaded', () => {
    saved[key] = JSON.stringify({ ...defaultPreferences(), areaId: 'a1', maxPrice: '20.50', excludedDishIds: ['d1'], avoidRecent: true })
    const store = usePreferencesStore()
    expect(store.value.areaId).toBe('a1')
    expect(store.value.excludedDishIds).toEqual(['d1'])
    store.clear()
    expect(saved[key]).toBeUndefined()
    expect(store.value).toEqual(defaultPreferences())
  })
  it('reports denied storage while keeping usable in-memory preferences', () => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => { throw new Error('denied') } })
    const store = usePreferencesStore()
    store.save({ ...defaultPreferences(), maxPrice: '25' })
    expect(store.value.maxPrice).toBe('25')
    expect(store.warning).toContain('未能保存')
  })
})
