// @vitest-environment jsdom
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdminRating, Restaurant, Dish } from '../../shared/types'
import { api } from '../services/api'
import AdminRatingsPanel from './AdminRatingsPanel.vue'

vi.mock('../services/api', () => ({ api: vi.fn() }))
const request = vi.mocked(api)
const restaurant = (id: string): Restaurant => ({ id, areaId: 'a1', name: id, category: '', location: '', enabled: true, createdAt: '', updatedAt: '' })
const dish = (id: string, restaurantId: string): Dish => ({ id, restaurantId, name: id, category: '', notes: '', enabled: true, priceCents: 100, weight: 1, createdAt: '', updatedAt: '' })
const rating = (id: string, name: string): AdminRating => ({ id, targetType: 'dish', targetId: 'd1', targetName: name, targetEnabled: true, restaurantId: 'r1', restaurantName: 'r1', stars: 5, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z' })
const wrappers: ReturnType<typeof mount>[] = []
function render() {
  const wrapper = mount(AdminRatingsPanel, { props: { restaurants: [restaurant('r1'), restaurant('r2')], dishes: [dish('d1', 'r1'), dish('d2', 'r2')] }, global: { plugins: [createPinia()] } })
  wrappers.push(wrapper)
  return wrapper
}
beforeEach(() => request.mockReset())
afterEach(() => { for (const wrapper of wrappers.splice(0)) wrapper.unmount() })

describe('admin rating filters and pagination', () => {
  it('requests the latest filter while a previous query is pending and ignores stale responses', async () => {
    let finishOld!: (value: unknown) => void
    request.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve }))
      .mockResolvedValue({ items: [rating('new', '最新菜品')], total: 1, nextCursor: null })
    const wrapper = render()
    await wrapper.find('select').setValue('dish')
    await flushPromises()
    expect(request.mock.calls[1]?.[0]).toContain('targetType=dish')
    finishOld({ items: [rating('old', '旧结果')], total: 1, nextCursor: null })
    await flushPromises()
    expect(wrapper.text()).toContain('最新菜品')
    expect(wrapper.text()).not.toContain('旧结果')
  })

  it('appends subsequent pages and resets the cursor when changing filters', async () => {
    request.mockResolvedValueOnce({ items: [rating('one', '第一条')], total: 2, nextCursor: 'page-two' })
      .mockResolvedValueOnce({ items: [rating('two', '第二条')], total: 2, nextCursor: null })
      .mockResolvedValue({ items: [], total: 0, nextCursor: null })
    const wrapper = render()
    await flushPromises()
    await wrapper.findAll('button').find(button => button.text() === '加载更多评分')!.trigger('click')
    await flushPromises()
    expect(request.mock.calls[1]?.[0]).toContain('cursor=page-two')
    expect(wrapper.findAll('.rating-list li')).toHaveLength(2)
    await wrapper.find('select').setValue('restaurant')
    await flushPromises()
    expect(request.mock.calls[2]?.[0]).not.toContain('cursor=')
    expect(wrapper.findAll('.rating-list li')).toHaveLength(0)
  })

  it('clears a selected dish when the parent restaurant filter changes', async () => {
    request.mockResolvedValue({ items: [], total: 0, nextCursor: null })
    const wrapper = render()
    await wrapper.find('select').setValue('dish')
    await flushPromises()
    await wrapper.findAll('select')[2]!.setValue('d1')
    await flushPromises()
    await wrapper.findAll('select')[1]!.setValue('r2')
    await flushPromises()
    expect(request.mock.calls.at(-1)?.[0]).toContain('restaurantId=r2')
    expect(request.mock.calls.at(-1)?.[0]).not.toContain('targetId=')
  })

  it('keeps a failed deletion visible and does not overwrite it with a reload', async () => {
    request.mockImplementation(async (_path, init) => {
      if (init?.method === 'DELETE') throw new Error('删除被拒绝')
      return { items: [rating('one', '待删除')], total: 1, nextCursor: null }
    })
    const wrapper = render()
    await flushPromises()
    await wrapper.findAll('button').find(button => button.text() === '删除')!.trigger('click')
    await wrapper.findAll('button').find(button => button.text() === '确认删除')!.trigger('click')
    await flushPromises()
    expect(wrapper.find('[role="alert"]').text()).toContain('删除被拒绝')
    expect(request).toHaveBeenCalledTimes(2)
  })
})
