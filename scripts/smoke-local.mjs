import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

const dev = 'http://127.0.0.1:5173'
const preview = 'http://127.0.0.1:4173'
const keyFile = new URL('../.dev.vars.admin-key', import.meta.url)
const passwordFile = new URL('../.dev.vars.admin-password', import.meta.url)
assert(existsSync(keyFile) || existsSync(passwordFile), '请先运行 npm run setup:local 生成管理员凭据')
const credential = readFileSync(existsSync(keyFile) ? keyFile : passwordFile, 'utf8').trim()
assert(credential, '本地管理员凭据为空')

let cookie = ''
let csrf = ''

function sessionCookie(response) {
  const values = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie') ?? '']
  for (const value of values) {
    const pair = value.split(';')[0]?.trim()
    if (pair?.startsWith('ed_admin_session=')) return pair
  }
  return ''
}

async function login() {
  const response = await fetch(`${dev}/api/admin/session`, {
    method: 'POST',
    headers: { Origin: dev, 'Content-Type': 'application/json', 'CF-Connecting-IP': '127.0.0.1' },
    body: JSON.stringify({ password: credential }),
  })
  assert.equal(response.status, 200, '本地管理员登录失败')
  const body = await response.json()
  assert.equal(body.authenticated, true)
  cookie = sessionCookie(response)
  csrf = body.csrfToken
  assert(cookie, '登录响应缺少 HttpOnly 会话 Cookie')
  assert(csrf, '登录响应缺少 CSRF 令牌')
}

async function call(base, path, method = 'GET', body, admin = false) {
  const headers = {}
  if (admin) {
    headers.Cookie = cookie
    headers['X-CSRF-Token'] = csrf
    headers.Origin = base
  }
  if (body) headers['Content-Type'] = 'application/json'
  return fetch(base + path, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) })
}

async function create(resource, body) {
  const response = await call(dev, '/api/admin/' + resource, 'POST', body, true)
  assert.equal(response.status, 201, `${resource}创建失败`)
  return response.json()
}

const owned = []
try {
  await login()

  const noCsrf = await fetch(`${dev}/api/admin/areas`, {
    method: 'POST',
    headers: { Origin: dev, Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '缺少 CSRF 令牌' }),
  })
  assert.equal(noCsrf.status, 403, '缺少 CSRF 令牌的写入必须被拒绝')

  const area = await create('areas', { name: '自动验收区域（示例）', type: 'other', sortOrder: 7 })
  owned.push(['areas', area.id])
  const restaurant = await create('restaurants', { name: '自动验收店（示例）', areaId: area.id })
  owned.push(['restaurants', restaurant.id])
  const dish = await create('dishes', { name: '自动验收菜（示例）', restaurantId: restaurant.id, priceCents: 1234, weight: 3 })
  owned.push(['dishes', dish.id])
  for (const mode of ['restaurant', 'dish', 'combo']) {
    const response = await call(dev, '/api/recommend', 'POST', { mode, filters: { restaurantId: restaurant.id, maxPriceCents: 1234 }, avoidRecent: true, recentDishIds: [dish.id] })
    assert.equal(response.status, 200)
    const result = await response.json()
    assert.equal(result.restaurant.id, restaurant.id)
    assert.equal(result.dish?.id ?? null, mode === 'restaurant' ? null : dish.id)
  }
  assert.equal((await call(dev, `/api/admin/areas/${area.id}`, 'DELETE', undefined, true)).status, 409)
  const shared = await (await call(preview, `/api/dishes?restaurantId=${restaurant.id}`)).json()
  assert.equal(shared[0].id, dish.id, '开发与生产预览必须使用同一个持久本地D1')

  assert.equal((await call(preview, '/api/admin/areas')).status, 401, '生产构建必须拒绝未登录的管理读取')
  const adminPage = await fetch(`${preview}/admin`, { headers: { Accept: 'text/html' } })
  assert.equal(adminPage.status, 200, '管理页面本身应公开并由前端显示登录表单')
  const previewLogin = await fetch(`${preview}/api/admin/session`, {
    method: 'POST',
    headers: { Origin: preview, 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: credential }),
  })
  assert.ok([500, 503].includes(previewLogin.status), '生产预览缺少 D1 或生产密钥时登录必须失败')
  assert.equal(sessionCookie(previewLogin), '', '登录失败不得下发会话 Cookie')

  const unknown = await fetch(preview + '/api/unknown', { headers: { Accept: 'text/html' } })
  assert.equal(unknown.status, 404)
  assert.match(unknown.headers.get('Content-Type'), /application\/json/)
  const historyPage = await fetch(preview + '/history', { headers: { Accept: 'text/html' } })
  assert.equal(historyPage.status, 200)
  assert.match(await historyPage.text(), /<html/)
  console.log('本地实测通过：管理员凭据登录、CSRF拒绝、创建链路、三模式、删除保护、持久D1共享、未登录拒绝、API404及SPA路由。')
} finally {
  for (const [resource, id] of owned.reverse()) {
    const removed = await call(dev, `/api/admin/${resource}/${id}`, 'DELETE', undefined, true)
    assert.equal(removed.status, 204, '只清理本次自建验收记录失败')
  }
  if (cookie) {
    const loggedOut = await call(dev, '/api/admin/session', 'DELETE', undefined, true)
    assert.equal(loggedOut.status, 204, '本地退出登录失败')
    assert.equal((await call(dev, '/api/admin/areas')).status, 401, '退出后管理接口必须立即失效')
  }
}
