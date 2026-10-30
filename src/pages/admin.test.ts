// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia } from 'pinia'
import AdminPage from './AdminPage.vue'

let wrapper: VueWrapper | undefined
const fetchMock = vi.fn<typeof fetch>()
const area = { id: 'area', name: '测试区域', type: 'canteen', sortOrder: 0, enabled: true, createdAt: '2026-01-01', updatedAt: '2026-01-01' }
beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (url, init) => {
    if (init?.method === 'PATCH' || init?.method === 'DELETE') return Response.json({ error: { message: '服务器拒绝本次修改' } }, { status: 409 })
    if (String(url).endsWith('/session')) return Response.json({ authenticated: true, csrfToken: 'csrf' })
    if (String(url).endsWith('/areas')) return Response.json([area])
    return Response.json([])
  })
})
afterEach(() => { wrapper?.unmount(); vi.unstubAllGlobals() })

describe('admin mutation error notices', () => {
  it('retains toggle errors and does not refresh away the failed state', async () => {
    wrapper = mount(AdminPage, { global: { plugins: [createPinia()] } })
    await flushPromises()
    const getCount = fetchMock.mock.calls.length
    await wrapper.findAll('.item-actions button').find((button) => button.text() === '停用')!.trigger('click')
    await flushPromises()
    expect(wrapper.find('[role="alert"]').text()).toContain('服务器拒绝本次修改')
    expect(fetchMock.mock.calls).toHaveLength(getCount + 1)
    expect(wrapper.text()).toContain('停用')
  })
  it('retains deletion errors and the confirmation for retry', async () => {
    wrapper = mount(AdminPage, { global: { plugins: [createPinia()] } })
    await flushPromises()
    const getCount = fetchMock.mock.calls.length
    await wrapper.findAll('.item-actions button').find((button) => button.text() === '删除')!.trigger('click')
    await wrapper.find('.delete-confirm .danger-button').trigger('click')
    await flushPromises()
    expect(wrapper.find('.notice.error').text()).toContain('服务器拒绝本次修改')
    expect(wrapper.find('.delete-confirm').exists()).toBe(true)
    expect(fetchMock.mock.calls).toHaveLength(getCount + 1)
  })
})
