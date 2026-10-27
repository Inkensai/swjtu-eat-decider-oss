import { createHash, randomBytes } from 'node:crypto'

export const DEFAULT_ACCESS_KEY_BYTES = 32
export const MIN_ACCESS_KEY_BYTES = 16
export const MAX_ACCESS_KEY_BYTES = 64

/** 生成密码学安全随机访问密钥；16 字节即 128 位熵，默认 32 字节（256 位）。 */
export function generateAdminAccessKey(bytes = DEFAULT_ACCESS_KEY_BYTES) {
  if (!Number.isSafeInteger(bytes) || bytes < MIN_ACCESS_KEY_BYTES || bytes > MAX_ACCESS_KEY_BYTES) {
    throw new Error(`密钥长度必须是 ${MIN_ACCESS_KEY_BYTES} 至 ${MAX_ACCESS_KEY_BYTES} 字节`)
  }
  return randomBytes(bytes).toString('base64url')
}

/** 与服务端 server/auth.ts 的 ADMIN_ACCESS_KEY_HASH 格式一致。 */
export function adminAccessKeyHash(key) {
  if (typeof key !== 'string' || key.length < 16 || key.length > 256) {
    throw new Error('访问密钥长度无效')
  }
  return `sha256:${createHash('sha256').update(key, 'utf8').digest('hex')}`
}
