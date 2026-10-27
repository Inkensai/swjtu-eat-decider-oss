import { pbkdf2Sync, randomBytes } from 'node:crypto'

const PREFIX = 'pbkdf2-sha256'
export const DEFAULT_ITERATIONS = 100_000
export const MIN_ITERATIONS = 10_000
export const MAX_ITERATIONS = 1_000_000

/** 与服务端 server/auth.ts 的编码格式保持一致：pbkdf2-sha256$迭代$盐$散列。 */
export function hashAdminPassword(password, iterations = DEFAULT_ITERATIONS) {
  if (typeof password !== 'string' || password.length < 1 || password.length > 1024) {
    throw new Error('密码必须是 1 至 1024 个字符的文本')
  }
  if (!Number.isSafeInteger(iterations) || iterations < MIN_ITERATIONS || iterations > MAX_ITERATIONS) {
    throw new Error(`迭代次数必须是 ${MIN_ITERATIONS} 至 ${MAX_ITERATIONS} 之间的整数`)
  }
  const salt = randomBytes(16)
  const derived = pbkdf2Sync(password, salt, iterations, 32, 'sha256')
  return `${PREFIX}$${iterations}$${salt.toString('base64url')}$${derived.toString('base64url')}`
}
