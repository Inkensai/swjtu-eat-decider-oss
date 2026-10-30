// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useMotionPreference } from './useMotionPreference'

const key = 'eat-decider.motion'
const wrappers: ReturnType<typeof mount>[] = []
let systemMatches: boolean
let listeners: Set<() => void>

function setSystemReduced(value: boolean) {
  systemMatches = value
  for (const listener of listeners) listener()
}

function mountPreference() {
  let preference!: ReturnType<typeof useMotionPreference>
  const wrapper = mount(defineComponent({
    setup() {
      preference = useMotionPreference()
      return () => h('span', preference.reduced.value ? 'reduced' : 'full')
    },
  }))
  wrappers.push(wrapper)
  return preference
}

beforeEach(() => {
  localStorage.clear()
  systemMatches = false
  listeners = new Set()
  vi.stubGlobal('matchMedia', vi.fn(() => ({
    get matches() { return systemMatches },
    addEventListener: (_event: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_event: string, listener: () => void) => listeners.delete(listener),
  })))
})

afterEach(() => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('motion preference', () => {
  it('restores the saved choice and persists both toggle directions across mounts', () => {
    localStorage.setItem(key, 'reduced')
    const preference = mountPreference()
    expect(preference.reduced.value).toBe(true)

    preference.toggle()
    expect(preference.reduced.value).toBe(false)
    expect(localStorage.getItem(key)).toBe('full')
    expect(mountPreference().reduced.value).toBe(false)

    preference.toggle()
    expect(preference.reduced.value).toBe(true)
    expect(localStorage.getItem(key)).toBe('reduced')
    expect(mountPreference().reduced.value).toBe(true)
  })

  it('follows system changes without overriding the saved manual choice', () => {
    localStorage.setItem(key, 'full')
    systemMatches = true
    const preference = mountPreference()
    expect(preference.systemReduced.value).toBe(true)
    expect(preference.reduced.value).toBe(true)

    preference.toggle()
    expect(preference.reduced.value).toBe(true)
    expect(localStorage.getItem(key)).toBe('full')

    setSystemReduced(false)
    expect(preference.systemReduced.value).toBe(false)
    expect(preference.reduced.value).toBe(false)
    preference.toggle()
    setSystemReduced(true)
    setSystemReduced(false)
    expect(preference.reduced.value).toBe(true)
    expect(localStorage.getItem(key)).toBe('reduced')
  })

  it('stops observing system changes when its owner is unmounted', () => {
    const preference = mountPreference()
    expect(listeners.size).toBe(1)
    wrappers.pop()!.unmount()
    expect(listeners.size).toBe(0)
    setSystemReduced(true)
    expect(preference.systemReduced.value).toBe(false)
  })

  it('keeps the in-memory toggle usable when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied') })
    const preference = mountPreference()
    expect(preference.reduced.value).toBe(false)
    expect(() => preference.toggle()).not.toThrow()
    expect(preference.reduced.value).toBe(true)
    preference.toggle()
    expect(preference.reduced.value).toBe(false)
  })

  it('allows a manual preference when matchMedia is not supported', () => {
    vi.stubGlobal('matchMedia', undefined)
    const preference = mountPreference()
    expect(preference.systemReduced.value).toBe(false)
    preference.toggle()
    expect(preference.reduced.value).toBe(true)
  })
})
