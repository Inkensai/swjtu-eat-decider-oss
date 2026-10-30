// @vitest-environment jsdom
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../services/api'
import { usePreferencesStore } from '../stores/preferences'
import HomePage from './HomePage.vue'

vi.mock('../services/api', () => ({ api: vi.fn() }))
const request = vi.mocked(api)
const key = 'eat-decider.preferences.v1'
const wrappers: ReturnType<typeof mount>[] = []
const restaurant = { id: 'r1', areaId: 'a1', name: '面馆', enabled: true, category: '', openingHours: '00:00-24:00' }
const dish = { id: 'd1', restaurantId: 'r1', name: '牛肉面', enabled: true, category: '', priceCents: 1200 }
const menu: Record<string, unknown> = { '/areas': [{ id: 'a1', name: '食堂', enabled: true }], '/restaurants': [restaurant], '/dishes': [dish] }
beforeEach(() => { request.mockReset(); localStorage.clear() })
afterEach(() => { for (const wrapper of wrappers.splice(0)) wrapper.unmount() })

describe('home preference restoration', () => {
  it('keeps exclusions and saved area while the initial menu is empty and after loading', async () => {
    localStorage.setItem(key, JSON.stringify({ areaId: 'a1', maxPrice: '25', excludedRestaurantIds: ['other-shop'], excludedDishIds: ['other-dish'], avoidRecent: true }))
    const replies: (() => void)[] = []
    request.mockImplementation(path => new Promise(resolve => { replies.push(() => resolve(menu[path])) }))
    const pinia = createPinia()
    const wrapper = mount(HomePage, { global: { plugins: [pinia] } })
    wrappers.push(wrapper)
    const preferences = usePreferencesStore(pinia)
    expect(wrapper.find<HTMLInputElement>('input[inputmode="decimal"]').element.value).toBe('25')
    expect(preferences.value.excludedDishIds).toEqual(['other-dish'])
    for (const reply of replies) reply()
    await flushPromises()
    expect(preferences.value.areaId).toBe('a1')
    expect(preferences.value.excludedRestaurantIds).toEqual(['other-shop'])
    expect(preferences.value.excludedDishIds).toEqual(['other-dish'])
    await wrapper.findAll('button').find(button => button.text() === '清除偏好')!.trigger('click')
    await flushPromises()
    expect(localStorage.getItem(key)).toBeNull()
    expect(preferences.value.excludedDishIds).toEqual([])
    expect(wrapper.find<HTMLInputElement>('input[inputmode="decimal"]').element.value).toBe('')
  })

  it('includes the restored open-now preference in the server recommendation request', async () => {
    localStorage.setItem(key, JSON.stringify({ areaId: 'a1', openNow: true }))
    request.mockImplementation(async path => menu[path] ?? { status: 'empty', message: '测试结果' })
    const wrapper = mount(HomePage, { global: { plugins: [createPinia()] } })
    wrappers.push(wrapper)
    await flushPromises()
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    const recommend = request.mock.calls.find(([path]) => path === '/recommend')
    expect(JSON.parse(String(recommend?.[1]?.body)).filters.openNow).toBe(true)
  })

  it('preserves the focused reroll button across requests and blocks repeated activation while busy', async () => {
    let recommendationCount = 0
    let finishRecommendation!: (value: unknown) => void
    const result = { status: 'ok', restaurant, dish, candidateDishCount: 1 }
    request.mockImplementation(path => {
      if (path !== '/recommend') return Promise.resolve(menu[path])
      recommendationCount++
      return recommendationCount === 1
        ? Promise.resolve(result)
        : new Promise(resolve => { finishRecommendation = resolve })
    })
    const wrapper = mount(HomePage, { attachTo: document.body, global: { plugins: [createPinia()] } })
    wrappers.push(wrapper)
    await flushPromises()
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    const reroll = wrapper.find<HTMLButtonElement>('.result-actions .secondary')
    const focusedButton = reroll.element
    focusedButton.focus()
    expect(document.activeElement).toBe(focusedButton)
    await reroll.trigger('click')
    expect(recommendationCount).toBe(2)
    expect(reroll.attributes('aria-disabled')).toBe('true')
    expect(focusedButton.disabled).toBe(false)
    expect(document.activeElement).toBe(focusedButton)
    await reroll.trigger('click')
    expect(recommendationCount).toBe(2)

    finishRecommendation({ ...result, dish: { ...dish, id: 'd2', name: '番茄面' } })
    await flushPromises()
    expect(wrapper.find('.result-content h2').text()).toBe('番茄面')
    expect(wrapper.find('.result-actions .secondary').element).toBe(focusedButton)
    expect(document.activeElement).toBe(focusedButton)
    expect(reroll.attributes('aria-disabled')).toBe('false')

    await reroll.trigger('click')
    expect(recommendationCount).toBe(3)
    finishRecommendation(result)
    await flushPromises()
    expect(document.activeElement).toBe(focusedButton)
  })
})
