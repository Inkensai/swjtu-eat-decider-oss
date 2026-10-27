# 架构与数据模型

## 总览

Vue 3 单页应用通过同源 JSON API 调用 Cloudflare Pages Function，使用 D1 参数绑定 SQL 持久化共享菜单。管理员页面也是公开 SPA，由前端查询会话状态后显示登录表单或管理界面；真正的权限判断全部在服务端。

推荐逻辑位于 `shared/recommendation.ts`，由服务端调用，前端只提交筛选条件并展示结果。

## 模块

- `src/`：首页、历史页、管理页、API 客户端和浏览器本地历史。
- `shared/`：共享类型与独立推荐逻辑，无 DOM 或持久化依赖。
- `server/`：Worker 入口、认证、参数校验、D1 数据访问和路由。
- `migrations/`：版本化 SQL；三张业务表、管理员会话与登录限流表。
- `tests/`：确定性算法、密码哈希/会话/CSRF、真实本地 D1 与 Pages 产物集成测试。
- `scripts/`：本地初始化、密钥生成、构建、产物检查和 smoke 测试。

## 数据模型

- `areas`：名称、type、sort_order、enabled。
- `restaurants`：引用 `area_id`，名称、category、location、enabled。
- `dishes`：引用 `restaurant_id`，名称、category、price_cents、weight、notes、enabled。
- `admin_sessions`：会话令牌的 SHA-256 摘要、CSRF 令牌、创建和过期时间。
- `admin_login_attempts`：按来源 IP 摘要统计的失败窗口和锁定时间。

每张业务表都有字符串 UUID 及 UTC ISO 创建/更新时间。数据库外键为 `RESTRICT`，没有级联删除。

价格为非负整数分，默认权重 1，禁止非有限或负权重。API 额外限制文本长度和数值范围。排序先按区域 `sort_order`，再按名称和 ID，确保稳定展示。

`sort_order` 的整数限制由 API 校验；数据库 CHECK 只限制范围，直接绕过 API 写 SQL 仍可写入小数。这是低风险边界，不应通过导入脚本绕过 API 校验。

## 权限

公共 API 只读菜单并进行无持久副作用的推荐。管理 API 在服务端统一验证 `ed_admin_session` 会话 Cookie；没有有效会话一律返回 401。

- D1 只保存会话令牌的 SHA-256 摘要，会话有服务端绝对过期时间（默认 12 小时），退出登录立即删除对应行。
- 所有管理写请求要求与目标同源的 `Origin` 及与会话一致的 `X-CSRF-Token`，缺失或不匹配返回 403。
- 生产 Cookie 带 `Secure`；仅本地回环 HTTP 开发省略。
- 管理员凭据支持两种服务端配置，按配置二选一：`ADMIN_ACCESS_KEY_HASH`（高熵随机访问密钥的 SHA-256 摘要，适合 Workers Free）或 `ADMIN_PASSWORD_HASH`（人工密码的 PBKDF2-HMAC-SHA256 哈希，适合付费套餐并需通过 CPU 实测）。同时配置时访问密钥优先。
- 凭据不写入源码、前端、浏览器存储或 Git；登录失败按来源 IP 摘要计数限流，达到上限返回 429 并带 `Retry-After`。
- 生产运行不依赖 Cloudflare Access、`ACCESS_TEAM_DOMAIN`、`ACCESS_AUD` 或 `ADMIN_EMAILS`。

选择访问密钥模式的原因：PBKDF2 100,000 次迭代在本机 WebCrypto 中位数约 11.5ms，已高于 Free 的 10ms 单请求 CPU 限额量级；256 位随机密钥的 SHA-256 验证成本可忽略，且随机空间使离线暴力枚举不可行。详细测量与验收方案见 [部署说明](deployment.md)。

## 本地历史

浏览器使用 `localStorage` 保存最近 100 条推荐快照和采纳状态。历史不包含管理员凭据，不上传服务器；清除浏览器数据或换设备后无法恢复。

## 构建与部署

- `build:pages` 组合 `dist/client` 静态资源和已编译 Worker，输出 `dist/pages`。
- `_worker.js` 使用 Pages 高级模式，`_routes.json` 只把 `/api`、`/api/*`、`/admin`、`/admin/*` 送入 Function。
- 根 `wrangler.jsonc` 是 Pages 配置；本地开发使用 `wrangler.dev.jsonc` 和模拟 D1。
- 构建过程不迁移远程 D1、不上传、不需要 Cloudflare 或 GitHub Token。
- 构建脚本检查产物，拒绝本地环境文件、管理员密钥、密码或摘要进入 `dist`。

## 第三方与许可

项目基于官方 `create-vite` Vue TypeScript 模板开始，推荐模块和界面为独立实现，未复制第三方项目代码。第三方依赖保留各自许可证，清单和许可证元数据见 `package-lock.json`；本项目原创代码以 MIT License 发布。新增第三方代码、字体、图片或其他资源时，必须同时记录来源和许可证并确认兼容性。
