import { adminAccessKeyHash, generateAdminAccessKey } from './lib/admin-key.mjs'

/**
 * 生成一次性的高熵管理员访问密钥及其 SHA-256 摘要。
 * 密钥只输出到当前终端，不写文件；请立即保存到密码管理器。
 * Cloudflare Pages Production 只配置 ADMIN_ACCESS_KEY_HASH（Encrypt）。
 */
const bytesArg = process.argv.slice(2).find((value) => value.startsWith('--bytes='))
const bytes = bytesArg ? Number(bytesArg.slice('--bytes='.length)) : undefined

let key
try {
  key = generateAdminAccessKey(bytes)
} catch (error) {
  console.error(error instanceof Error ? error.message : '访问密钥生成失败')
  process.exit(2)
}

console.log(`ADMIN_ACCESS_KEY=${key}`)
console.log(`ADMIN_ACCESS_KEY_HASH=${adminAccessKeyHash(key)}`)
console.error('')
console.error('只把 ADMIN_ACCESS_KEY_HASH 配置为 Cloudflare Pages 生产环境加密变量。')
console.error('ADMIN_ACCESS_KEY 是唯一登录凭据，只保存到密码管理器；不要写入 Git、前端、URL 或日志。')
console.error('轮换时重新运行本脚本，更新加密变量并重新部署；旧密钥立即失效。')
