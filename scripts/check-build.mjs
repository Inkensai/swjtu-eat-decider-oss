import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const project = dirname(dirname(fileURLToPath(import.meta.url)))
const root = join(project, 'dist')
const devVarsPath = join(project, '.dev.vars')

const secretValues = []
if (existsSync(devVarsPath)) {
  for (const line of readFileSync(devVarsPath, 'utf8').split(/\r?\n/)) {
    const match = /^(ADMIN_[A-Z0-9_]+)=(.+)$/.exec(line.trim())
    if (match && match[2].length >= 32) secretValues.push(match[2])
  }
}
for (const name of ['.dev.vars.admin-key', '.dev.vars.admin-password']) {
  const path = join(project, name)
  if (!existsSync(path)) continue
  const value = readFileSync(path, 'utf8').trim()
  assert(value.length >= 16, `${name} 看起来不完整`)
  secretValues.push(value)
}

for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
  if (!entry.isFile()) continue
  assert(!/^\.(dev\.vars|env)(\.|$)/.test(entry.name), '构建产物含本地环境文件，拒绝交付')
  const content = readFileSync(join(entry.parentPath, entry.name), 'utf8')
  for (const secret of secretValues) {
    assert(!content.includes(secret), '构建产物含本地管理员凭据或摘要，拒绝交付')
  }
}
console.log('构建检查通过：无本地环境文件、管理员密钥、密码或摘要。')
