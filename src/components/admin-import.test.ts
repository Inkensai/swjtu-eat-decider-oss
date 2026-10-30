// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia } from 'pinia'
import AdminImportPanel from './AdminImportPanel.vue'
import { useAdminStore } from '../stores/admin'

let wrapper: VueWrapper | undefined
const fetchMock = vi.fn<typeof fetch>()
const data = { version: 1, areas: [{ name: '新区域' }], restaurants: [], dishes: [] }
const valid = { valid: true, applied: false, counts: { areas: 1, restaurants: 0, dishes: 0 }, issues: [], preview: [{ resource: 'areas', row: 1, name: '新区域' }] }
beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (_url, init) => {
    const input = JSON.parse(String(init?.body)) as { dryRun: boolean }
    return Response.json({ ...valid, applied: !input.dryRun }, { status: input.dryRun ? 200 : 201 })
  })
})
afterEach(() => { wrapper?.unmount(); vi.unstubAllGlobals() })

function render() {
  const pinia = createPinia()
  useAdminStore(pinia).csrfToken = 'test-csrf'
  return mount(AdminImportPanel, { props: { menu: { areas: [], restaurants: [], dishes: [] }, selectedRestaurantId: '' }, global: { plugins: [pinia] } })
}
describe('menu import preview confirmation', () => {
  it('writes only after a successful preview and explicit confirmation', async () => {
    wrapper = render()
    await wrapper.get('textarea').setValue(JSON.stringify(data))
    expect(wrapper.findAll('button').some((button) => button.text().includes('确认新增'))).toBe(false)
    await wrapper.findAll('button').find((button) => button.text() === '校验并预览')!.trigger('click')
    await flushPromises()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]?.body))).toEqual({ data, dryRun: true })
    const confirm = wrapper.findAll('button').find((button) => button.text().includes('确认新增'))!
    await confirm.trigger('click')
    await flushPromises()
    expect(JSON.parse(String(fetchMock.mock.calls[1]![1]?.body))).toEqual({ data, dryRun: false })
    expect(new Headers(fetchMock.mock.calls[1]![1]?.headers).get('X-CSRF-Token')).toBe('test-csrf')
    expect(wrapper.emitted('imported')).toHaveLength(1)
    expect(wrapper.text()).toContain('已导入 1 条记录')
  })
  it('invalidates the preview when the user edits the input', async () => {
    wrapper = render()
    await wrapper.get('textarea').setValue(JSON.stringify(data))
    await wrapper.findAll('button').find((button) => button.text() === '校验并预览')!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('确认新增这 1 条记录')
    await wrapper.get('textarea').setValue('{}')
    expect(wrapper.text()).not.toContain('确认新增')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
