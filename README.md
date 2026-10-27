# SWJTU Eat Decider · 今天吃什么？

一个面向校园场景的轻量美食决策 Web 应用：维护一份共享菜单，按区域、店铺和菜品逐级筛选，用三种随机推荐模式决定今天吃什么。

**V1.0 已上线。** 在线演示：<https://eat-decider-cmi.pages.dev>

> 本仓库是脱敏的开源源码副本。正式在线网站由独立的 Private 生产仓库和 Cloudflare Pages 部署；本仓库不会自动驱动线上部署。

公开源码仓库：<https://github.com/Inkensai/swjtu-eat-decider-oss>

## 功能

- **共享菜单**：区域 → 店铺 → 菜品三级结构，普通访客无需登录即可浏览。
- **三种推荐模式**：
  - 随机选店：等概率选择一家有可用菜品的店铺；
  - 店内选菜：在指定店铺内按权重选择菜品；
  - 两级推荐：先选店，再在店内选菜。
- **筛选**：区域、店铺、菜品分类、价格上限，以及排除指定店铺/菜品。
- **近期去重**：可选地降低最近 5 次出现过的菜品权重。
- **本机历史**：最近 100 条推荐快照、采纳标记和清空功能，仅保存在当前浏览器。
- **管理员维护**：应用内登录后创建、编辑、停用和删除区域/店铺/菜品；有关联数据时拒绝删除，避免隐式级联。
- **响应式界面**：桌面和移动端单列布局。

## 技术栈

- Vue 3 + TypeScript + Vite + Vue Router + Pinia
- Cloudflare Pages Functions（高级模式 `_worker.js`）
- Cloudflare D1（SQLite）
- Vitest、Miniflare、Wrangler

推荐逻辑位于独立的 TypeScript 模块，由服务端执行；前端只负责提交筛选条件并展示结果，不能提交候选菜单或权重。

## 项目结构

```text
src/          Vue 页面、组件、API 客户端和浏览器本地历史
shared/       共享类型与推荐算法
server/       Pages Function 入口、认证、校验和 D1 数据访问
migrations/   版本化 D1 迁移
tests/        算法、API、认证和 Pages 产物集成测试
scripts/      本地初始化、密钥生成、构建与检查脚本
docs/         API、架构、需求和部署文档
```

## 本地开发

要求 Node.js 24.x（仓库通过 `.node-version` 固定 24.16.0）和 npm。

```powershell
npm ci
npm run setup:local
npm run db:migrate
npm run dev
```

打开 <http://127.0.0.1:5173>。

`npm run setup:local` 会生成一份随机本地管理员访问密钥：

- 密钥原文写入被 Git 忽略的 `.dev.vars.admin-key`；
- SHA-256 摘要写入同样被忽略的 `.dev.vars`；
- 进入“菜单管理”后输入该密钥登录。

初始菜单为空。需要本地演示数据时运行：

```powershell
npm run db:seed
```

`scripts/seed.sql` 中的名称和价格均为虚构示例，不代表任何真实校园店铺。

### 测试与构建

```powershell
npm run typecheck
npm test
npm run test:pages
npm run build:pages
```

`npm run build:pages` 会运行源码/集成测试、类型检查、Vite 构建、Pages 产物打包与凭据泄漏检查，并执行真实 Pages 产物测试。产物在 `dist/pages`，包含静态资源、`_worker.js` 和 `_routes.json`。

本地 Pages 预览：

```powershell
npm run build:pages
npm run preview:pages
```

预览地址为 <http://127.0.0.1:8788>，使用本地模拟 D1，不连接生产库。

## 部署到 Cloudflare Pages + D1

以下步骤面向自行部署；生产密钥只配置在 Cloudflare，不进入仓库。

1. **创建或选择 D1 数据库**，把 `wrangler.jsonc` 的 `env.production.d1_databases` 改为你的 `database_name` 和 `database_id`。本开源副本使用全零占位 `database_id`，不会连接现有生产库；部署你自己的实例前必须替换。
2. **应用迁移**：

   ```powershell
   npx wrangler d1 migrations apply <你的数据库名> --remote --env production --config wrangler.jsonc
   ```

   迁移会创建 `areas`、`restaurants`、`dishes`、`admin_sessions`、`admin_login_attempts` 及索引。不要在 Pages 构建命令里执行远程迁移。
3. **创建 Pages 项目并连接 Git 仓库**：
   - Framework preset：None
   - Build command：`npm run build:pages`
   - Build output directory：`dist/pages`
   - Root directory：仓库根目录
   - Production branch：`main`
   - Node.js：由 `.node-version` 固定
4. **配置管理员凭据**。Free 套餐推荐访问密钥模式：

   ```powershell
   npm run admin:key
   ```

   将输出的 `ADMIN_ACCESS_KEY_HASH=sha256:<...>` 配置为 Pages Production 的 **加密变量** `ADMIN_ACCESS_KEY_HASH`。密钥原文只保存在密码管理器，用于登录页，不写入代码、Git、URL、日志或浏览器持久存储。

   人工密码的 PBKDF2 模式（`npm run admin:hash` → `ADMIN_PASSWORD_HASH`）适合付费套餐且完成 CPU 实测的环境。100,000 次迭代在本机量级约 11.5ms，可能超过 Workers Free 的 10ms 单请求 CPU 限额，不能假定 Free 套餐可稳定使用。
5. **首次部署并验收**：确认 D1 绑定、迁移、加密变量和构建日志；用真实密钥登录，验证 Cookie、CSRF、CRUD、退出和公开推荐。完整说明见 [部署文档](docs/deployment.md)。

生产环境不需要 Cloudflare Access、`ACCESS_TEAM_DOMAIN`、`ACCESS_AUD` 或 `ADMIN_EMAILS`。

## 管理员认证与安全

- 浏览器只持有 `HttpOnly; Secure; SameSite=Lax` 会话 Cookie；D1 只保存令牌的 SHA-256 摘要。
- 所有 `/api/admin/*` 在服务端默认拒绝未授权请求；写请求还要求同源 `Origin` 和 `X-CSRF-Token`。
- 登录失败按来源 IP 摘要限流，默认 12 小时绝对会话过期，退出立即删除会话。
- 访问密钥至少 128 位、默认 256 位密码学随机熵；服务端以常量时间比较 SHA-256 摘要。不要把人工密码直接改成快速哈希。
- `.dev.vars*`、本地 D1、备份和日志均被 `.gitignore` 排除。构建脚本会检查产物中是否意外包含管理员密钥、密码或摘要。

安全漏洞请按 [SECURITY.md](SECURITY.md) 私下报告，不要在公开 issue 中粘贴密钥、Cookie 或生产数据。

## 已知边界

- 没有账号体系、云端个人历史或跨设备个人数据同步；历史只存在当前浏览器。
- 没有图片、地图、投稿、收藏或微信小程序构建；当前是普通 Vue Web。
- 管理员是共享菜单的维护者，不提供多角色权限或审计日志。
- 线上可用性、Free CPU 余量和校园网络质量需由部署者按实际环境验证。

## 贡献

欢迎提交 issue 和 pull request。开发、测试和提交前检查见 [CONTRIBUTING.md](CONTRIBUTING.md)。请勿在提交、截图、日志或 issue 中包含真实管理员密钥、Cookie、生产 D1 数据或其他敏感信息。

## 许可证

本项目原创代码以 [MIT License](LICENSE) 发布。第三方依赖保留各自许可证；本项目未复制第三方项目代码。依赖清单及许可证元数据见 `package-lock.json`。
