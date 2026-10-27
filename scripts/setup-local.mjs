import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { adminAccessKeyHash, generateAdminAccessKey } from './lib/admin-key.mjs'

const devVars = new URL('../.dev.vars', import.meta.url)
const keyFile = new URL('../.dev.vars.admin-key', import.meta.url)

if (existsSync(devVars)) {
  const content = readFileSync(devVars, 'utf8')
  console.log('.dev.vars 已存在，保留原有配置。')
  if (!/^ADMIN_ACCESS_KEY_HASH=sha256:[0-9a-f]{64}$/m.test(content) && !/^ADMIN_PASSWORD_HASH=/m.test(content)) {
    console.error('现有 .dev.vars 不含受支持的管理员凭据配置。')
    console.error('请确认后自行删除 .dev.vars，再重新运行 npm run setup:local。')
    process.exitCode = 1
  } else if (/^ADMIN_ACCESS_KEY_HASH=/m.test(content) && !existsSync(keyFile)) {
    console.error('缺少 .dev.vars.admin-key，无法找回已摘要的访问密钥。')
    console.error('请确认后自行删除 .dev.vars，再重新运行 npm run setup:local。')
    process.exitCode = 1
  }
} else {
  const key = generateAdminAccessKey()
  writeFileSync(devVars, `ADMIN_ACCESS_KEY_HASH=${adminAccessKeyHash(key)}\n`, { flag: 'wx', mode: 0o600 })
  writeFileSync(keyFile, `${key}\n`, { flag: 'wx', mode: 0o600 })
  console.log('已创建 .dev.vars 与 .dev.vars.admin-key（均被 Git 忽略）。')
  console.log('本地管理员访问密钥在 .dev.vars.admin-key 中；生产环境另行运行 npm run admin:key 并只配置加密摘要。')
}
