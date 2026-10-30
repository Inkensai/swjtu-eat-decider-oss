// @vitest-environment jsdom
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../services/api'
import MenuPage from './MenuPage.vue'

vi.mock('../services/api', () => ({ api: vi.fn() }))
const request = vi.mocked(api)
const restaurants = [
  { id: 'r1', areaId: 'a1', name: '面馆', enabled: true, category: '面食', openingHours: '00:00-24:00' },
  { id: 'r2', areaId: 'a1', name: '小店', enabled: true, category: '', openingHours: '' },
]
const dishes = [
  { id: 'd1', restaurantId: 'r1', name: '牛肉面', enabled: true, category: '面食', priceCents: 1200 },
  { id: 'd2', restaurantId: 'r2', name: '米饭', enabled: true, category: '', priceCents: 200 },
]
const wrappers: ReturnType<typeof mount>[] = []
beforeEach(() => {
  request.mockReset().mockImplementation(async path => {
    if (path === '/areas') return [{ id: 'a1', name: '食堂', enabled: true }]
    if (path === '/restaurants') return restaurants
    if (path === '/dishes') return dishes
    if (path === '/ratings/mine') return { mine: [] }
    return { restaurants: [], dishes: [] }
  })
})
afterEach(() => { for (const wrapper of wrappers.splice(0)) wrapper.unmount() })
async function render(url = '/menu') {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/menu', component: MenuPage }] })
  await router.push(url)
  await router.isReady()
  const wrapper = mount(MenuPage, { global: { plugins: [createPinia(), router], stubs: { RatingControl: true } } })
  wrappers.push(wrapper)
  await flushPromises()
  return { wrapper, router }
}

describe('shareable menu navigation', () => {
  it('restores a dish view, restaurant and search from a shared URL', async () => {
    const { wrapper } = await render('/menu?view=dishes&restaurant=r1&q=牛肉')
    expect(wrapper.find<HTMLInputElement>('input[type="search"]').element.value).toBe('牛肉')
    expect(wrapper.findAll('.dish-card')).toHaveLength(1)
    expect(wrapper.find('.shop-detail-title').text()).toContain('面馆')
  })
  it('restores views through browser back and forward', async () => {
    const { wrapper, router } = await render()
    await wrapper.findAll('button').find(button => button.text() === '查看菜单')!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.restaurant).toBe('r1')
    expect(wrapper.findAll('.dish-card')).toHaveLength(1)
    router.back()
    await flushPromises()
    expect(wrapper.findAll('.shop-card')).toHaveLength(2)
    router.forward()
    await flushPromises()
    expect(wrapper.findAll('.dish-card')).toHaveLength(1)
  })
  it('only includes known open restaurants when the availability filter is enabled', async () => {
    const { wrapper, router } = await render()
    await wrapper.find('input[type="checkbox"]').setValue(true)
    await flushPromises()
    expect(router.currentRoute.value.query.open).toBe('1')
    expect(wrapper.findAll('.shop-card')).toHaveLength(1)
    expect(wrapper.find('.shop-card').text()).toContain('营业中')
  })
})
