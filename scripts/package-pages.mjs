import assert from 'node:assert/strict'
import { cpSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const project = realpathSync(dirname(dirname(fileURLToPath(import.meta.url))))
const dist = resolve(project, 'dist')
const client = join(dist, 'client')
const workerPath = join(dist, 'eat_decider', 'index.js')
const output = resolve(project, 'dist', 'pages')
const redirectPath = join(project, '.wrangler', 'deploy', 'config.json')

function validateBuildRedirect() {
  const redirect = lstatSync(redirectPath, { throwIfNoEntry: false })
  if (!redirect) return false
  assert(redirect.isFile() && !redirect.isSymbolicLink(), 'Wrangler 构建重定向必须是普通文件')
  assert.equal(realpathSync(dirname(redirectPath)), dirname(redirectPath), 'Wrangler 构建重定向目录不得指向其他目录')
  const metadata = JSON.parse(readFileSync(redirectPath, 'utf8'))
  assert(metadata && typeof metadata.configPath === 'string', 'Wrangler 构建重定向缺少 configPath')
  assert.equal(resolve(dirname(redirectPath), metadata.configPath), join(dist, 'eat_decider', 'wrangler.json'), '拒绝清理指向其他项目或产物的 Wrangler 重定向')
  return true
}

assert(lstatSync(join(client, 'index.html')).isFile(), '缺少 dist/client/index.html，请先完成构建')
assert(lstatSync(workerPath).isFile(), '缺少 dist/eat_decider/index.js，请先完成构建')
assert.equal(realpathSync(dist), dist, 'dist 不得通过符号链接或目录联接指向其他目录')
assert.equal(realpathSync(client), client, '静态产物目录不得重定向到其他目录')
assert.equal(realpathSync(dirname(workerPath)), dirname(workerPath), 'Worker 产物目录不得重定向到其他目录')

const worker = readFileSync(workerPath, 'utf8')
assert(/\bexport\s+default\b|\bexport\s*\{[^}]*\bas\s+default\b[^}]*\}/s.test(worker), 'Worker 必须导出 ES module default')
assert(!worker.includes('__LOCAL_DEV__'), 'Worker 含未解析的 __LOCAL_DEV__，拒绝打包')
assert(!/\bLOCAL_ADMIN_TOKEN\b|\bBearer\b/.test(worker), 'Worker 仍包含本地 Bearer 认证分支，拒绝打包')
for (const marker of ['ACCESS_TEAM_DOMAIN', 'ACCESS_AUD', 'ADMIN_EMAILS', 'Cf-Access-Jwt-Assertion', 'cloudflareaccess']) {
  assert(!worker.includes(marker), `Worker 仍包含已移除的 Cloudflare Access 集成：${marker}`)
}
assert(worker.includes('ADMIN_PASSWORD_HASH'), 'Worker 必须包含管理员密码哈希校验')
assert(worker.includes('ADMIN_ACCESS_KEY_HASH'), 'Worker 必须包含管理员访问密钥摘要校验')

for (const entry of readdirSync(client, { recursive: true, withFileTypes: true })) {
  assert(!entry.isSymbolicLink(), `静态产物不得包含符号链接：${entry.name}`)
  assert(!/^\.(?:env|dev\.vars)(?:\.|$)/.test(entry.name), `静态产物含本地环境文件：${entry.name}`)
}

// 清理目标固定在项目生成目录内，并拒绝目录联接，防止删除范围被重定向。
assert.equal(output, join(project, 'dist', 'pages'))
assert.equal(dirname(output), dist)
const previous = lstatSync(output, { throwIfNoEntry: false })
if (previous) {
  assert(previous.isDirectory() && !previous.isSymbolicLink(), 'dist/pages 必须是普通生成目录')
  assert.equal(realpathSync(output), output, 'dist/pages 不得重定向到其他目录')
}
validateBuildRedirect()
rmSync(output, { recursive: true, force: true })
mkdirSync(output, { recursive: true })
cpSync(client, output, { recursive: true })
cpSync(workerPath, join(output, '_worker.js'))
writeFileSync(join(output, '_routes.json'), `${JSON.stringify({
  version: 1,
  include: ['/api', '/api/*', '/admin', '/admin/*'],
  exclude: [],
}, null, 2)}\n`)
writeFileSync(join(output, '.assetsignore'), '.env\n.env.*\n.dev.vars\n.dev.vars.*\nwrangler.json\nwrangler.jsonc\nwrangler.toml\n')
// Pages 必须读取根配置，不能沿用 Vite 为本地 Worker 生成的配置重定向。
if (validateBuildRedirect()) rmSync(redirectPath)
assert.equal(lstatSync(redirectPath, { throwIfNoEntry: false }), undefined, 'Pages 打包后仍残留 Wrangler 构建重定向')
console.log('Pages 打包完成：dist/pages（静态页面、模块 Worker 和 API/管理路由）。')
