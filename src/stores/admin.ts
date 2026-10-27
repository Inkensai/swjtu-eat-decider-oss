import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api } from '../services/api'

interface SessionPayload {
  authenticated: boolean
  csrfToken?: string
  expiresAt?: string
}

/**
 * 管理员会话状态只保存在内存中。
 * 会话凭据在 HttpOnly Cookie 里，前端拿不到；CSRF 令牌由服务端在登录/状态查询时返回。
 */
export const useAdminStore = defineStore('admin-session', () => {
  const authenticated = ref(false)
  const csrfToken = ref('')
  const expiresAt = ref('')
  const ready = ref(false)

  function apply(payload: SessionPayload): void {
    authenticated.value = payload.authenticated === true
    csrfToken.value = authenticated.value ? payload.csrfToken ?? '' : ''
    expiresAt.value = authenticated.value ? payload.expiresAt ?? '' : ''
  }

  function clear(): void {
    apply({ authenticated: false })
  }

  async function refresh(): Promise<boolean> {
    try {
      apply(await api<SessionPayload>('/admin/session'))
    } catch {
      clear()
    } finally {
      ready.value = true
    }
    return authenticated.value
  }

  async function login(password: string): Promise<boolean> {
    apply(await api<SessionPayload>('/admin/session', { method: 'POST', body: JSON.stringify({ password }) }))
    ready.value = true
    return authenticated.value
  }

  async function logout(): Promise<void> {
    await api('/admin/session', { method: 'DELETE' }, { csrf: csrfToken.value })
    clear()
  }

  return { authenticated, csrfToken, expiresAt, ready, refresh, login, logout, clear }
})
