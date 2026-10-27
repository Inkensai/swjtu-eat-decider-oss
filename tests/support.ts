import { createHash, pbkdf2Sync, randomBytes } from 'node:crypto'

/** 单元/集成测试共用的管理员密码与哈希（与生产脚本格式一致）。 */
export const TEST_ADMIN_PASSWORD = 'test-admin-password-2026'
export const TEST_PASSWORD_ITERATIONS = 10_000
export const TEST_ADMIN_KEY = 'test-admin-access-key-0123456789abcdefghijklmnopq'

export function passwordHash(password = TEST_ADMIN_PASSWORD, iterations = TEST_PASSWORD_ITERATIONS): string {
  const salt = randomBytes(16)
  const derived = pbkdf2Sync(password, salt, iterations, 32, 'sha256')
  return `pbkdf2-sha256$${iterations}$${salt.toString('base64url')}$${derived.toString('base64url')}`
}

export function accessKeyHash(key = TEST_ADMIN_KEY): string {
  return `sha256:${createHash('sha256').update(key, 'utf8').digest('hex')}`
}

export function setCookies(response: Response): string[] {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] }
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie()
  const single = response.headers.get('set-cookie')
  return single ? [single] : []
}

export function findCookie(response: Response, name: string): string {
  for (const header of setCookies(response)) {
    const pair = header.split(';')[0]?.trim() ?? ''
    if (pair.startsWith(`${name}=`)) return pair
  }
  return ''
}
