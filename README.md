# SWJTU Eat Decider · 今天吃什么？

一个面向校园场景的轻量美食决策 Web 应用：维护一份共享菜单，按店铺或菜品浏览菜单，用三种随机推荐模式决定今天吃什么，并可以为店铺和菜品匿名评分。

**V1.3 改进版源码。** 在线演示（独立部署，功能可能不同步）：<https://eat-decider-cmi.pages.dev>

> 本仓库是脱敏的开源源码副本。正式在线网站由独立的 Private 生产仓库和 Cloudflare Pages 部署；本仓库不会自动驱动线上部署。

公开源码仓库：<https://github.com/Inkensai/swjtu-eat-decider-oss>

## 功能

- **共享菜单**：区域 → 店铺 → 菜品三级结构，普通访客无需登录即可浏览。
- **浏览菜单**：`/menu` 提供店铺与菜品两个二级视图，支持区域、店铺类型、店铺、菜品分类和关键词筛选，也可以从店铺进入该店的全部菜品；没有录入菜品的店铺同样会展示。
- **三种推荐模式**：
  - 随机选店：等概率选择一家店铺；没有设置菜品分类、预算或排除菜品时，允许尚未录入菜品的店铺参与；
  - 店内选菜：在指定店铺内按权重选择菜品；
  - 两级推荐：先选店，再在店内选菜。
- **筛选**：区域、店铺类型、店铺、菜品分类、价格上限，以及排除指定店铺/菜品。
- **营业状态**：每日营业时段支持多段及跨午夜；按北京时间判断。管理员可标记今日休息、菜品今日售罄，次日自动失效。推荐默认排除今日休息/售罄；勾选“正在营业”后，还排除非营业时段及未设置时段的店铺。
- **偏好与分享**：区域、预算、排除项和推荐开关自动保存在本浏览器，可一键清除；菜单视图、筛选和关键词写入 URL，支持分享及浏览器前进/后退。
- **批量维护**：后台可导出菜单 JSON、下载 CSV 模板，预览并校验 JSON/CSV 导入；逐行提示无效数据或重复项，整批追加、全部成功或全部不写入。每批最多 200 条且请求不超过 64 KiB，已有数据不会被覆盖。
- **匿名评分**：无需注册即可给店铺或菜品打 1–5 星；全站展示平均分和有效评分人数；同一匿名身份对同一对象只保留一条评分，可修改或删除；管理员可以删除异常评分。
- **标准化分类**：店铺使用 10 个固定分类下拉，菜品使用 12 个固定分类下拉；新店铺默认「其他 / 综合」，已知旧名称通过兼容映射参与展示和筛选，历史原值保留。
- **紧凑管理**：店铺和菜品的主要字段优先展示，位置、权重、备注和启用状态收进可折叠的更多设置。
- **统一视觉**：暖灰底色、细线分区、黑色大标题与琥珀色点缀，首页、菜单、记录和管理后台使用统一的卡片与控件样式。
- **轻量动效**：页面入场、菜单卡片错峰出现、悬停反馈和推荐结果揭示；首页的分层餐盘使用纯 CSS 绘制，无外部图片、字体或 3D 库。页头可关闭动效并记住选择，同时遵循系统的“减少动态效果”设置。
- **近期去重**：可选地降低最近 5 次出现过的菜品权重。
- **用餐记录**：推荐后立即出现在当前页面；只有「已推荐」和「已采纳」两种状态；刷新后只恢复已采纳记录，最多 100 条，兼容旧版历史数据。
- **管理员维护**：应用内登录后创建、编辑、停用和删除区域/店铺/菜品；有关联数据时拒绝删除，避免隐式级联；管理页内可查看并删除评分。
- **响应式界面**：首页桌面双栏、手机单栏，长表单自然滚动；手机输入框采用 16px 字号，并提供清晰的键盘焦点、跳转到主要内容入口和推荐结果播报。

## 技术栈

- Vue 3 + TypeScript + Vite + Vue Router + Pinia
- Cloudflare Pages Functions（高级模式 `_worker.js`）
- Cloudflare D1（SQLite）
- Vitest、Miniflare、Wrangler

推荐逻辑位于独立的 TypeScript 模块，由服务端执行；前端只负责提交筛选条件并展示结果，不能提交候选菜单或权重。

## 项目结构

```text
src/          Vue 页面、组件（评分控件、评分管理面板）、API 客户端、本地历史与评分状态
shared/       共享类型与推荐算法
server/       Pages Function 入口、认证、校验、D1 数据访问与匿名评分
migrations/   版本化 D1 迁移（0001–0005：菜单、会话、评分、索引、营业状态）
tests/        算法、API、认证、评分和 Pages 产物集成测试
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

`npm run db:migrate` 只作用于本地模拟 D1，按顺序应用 `migrations/` 下全部迁移（当前到 `0005_availability.sql`）。`scripts/seed.sql` 中的名称和价格均为虚构示例，不代表任何真实校园店铺。

查看迁移状态（本地）：

```powershell
npx wrangler d1 migrations list DB --local --config wrangler.dev.jsonc
```

### 测试与构建

```powershell
npm run build:pages
```

`npm run build:pages` 会运行源码/集成测试、类型检查、Vite 构建、Pages 产物打包与凭据泄漏检查，并执行真实 Pages 产物测试。产物在 `dist/pages`，包含静态资源、`_worker.js` 和 `_routes.json`。

开发中可单独执行 `npm test` 或 `npm run typecheck`。`npm run test:pages` 仅用于已经完成打包的产物；首次检出直接运行 `build:pages`。PR 和 main 推送会通过 GitHub Actions 执行同一完整检查。

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

   迁移会创建菜单、会话和评分表，并补充评分查询/分页索引及营业状态字段。升级现有 V1.2 实例时先应用 `0004`、`0005`，再发布新代码；旧菜单的营业字段默认为空，未开启营业筛选时继续参与推荐。不要在 Pages 构建命令里执行远程迁移。
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
- 登录按来源 IP 摘要原子预留尝试额度，成功后清除计数；并发失败不能覆盖计数。默认 12 小时绝对会话过期，退出立即删除会话。
- 访问密钥至少 128 位、默认 256 位密码学随机熵；服务端以常量时间比较 SHA-256 摘要。不要把人工密码直接改成快速哈希。
- `.dev.vars*`、本地 D1、备份和日志均被 `.gitignore` 排除。构建脚本会检查产物中是否意外包含管理员密钥、密码或摘要。

安全漏洞请按 [SECURITY.md](SECURITY.md) 私下报告，不要在公开 issue 中粘贴密钥、Cookie 或生产数据。

## 匿名评分与权限

- 评分对象是店铺或菜品，两者互相独立；星级为 1–5 整数，不收集姓名、邮箱、评论或浏览器指纹。
- 首次提交评分时，服务端生成 256 位随机匿名凭据，通过 `ed_rater_id` Cookie 保存（生产为 `Path=/; HttpOnly; Secure; SameSite=Lax`，有效期一年）。D1 只保存 `sha256("rater:" + 凭据)` 摘要，不保存 Cookie 原文，响应 JSON 也不会回显凭据。
- 同一匿名身份对同一对象只有一条有效评分：再次提交更新原记录，平均分重算而评分人数不变；删除后不再计入统计。数据库唯一索引同时防止并发重复提交。
- 删除权限只有两种来源：原匿名 Cookie 身份，或经过认证的管理员。普通访客无法修改或删除他人的评分；管理员删除需要会话、同源 `Origin` 和 `X-CSRF-Token`。
- 防滥用：1–5 星级与对象存在性校验、类型与 ID 匹配、参数化 SQL、65536 字节请求体上限、同源校验，以及按匿名身份和来源 IP 的固定窗口限流。默认每个身份每 600 秒 30 次、每个 IP 120 次，可用 `RATING_RATE_LIMIT`、`RATING_IP_RATE_LIMIT`、`RATING_RATE_WINDOW_SECONDS` 调整；来源 IP 只信任 Cloudflare 边缘写入的 `CF-Connecting-IP`。
- 限流是近似防护，不声称绝对防刷，也不引入外部限流服务。

**限制**：匿名 Cookie 只代表当前匿名身份，不是自然人身份。清除 Cookie、使用无痕窗口或更换浏览器会得到新的匿名身份，无法再修改原身份提交的评分；同一个人也可能产生多条评分。这是无账号评分方案的固有限制，请在产品说明中如实告知用户。

## 已知边界

- 没有账号体系、云端个人历史或跨设备个人数据同步；历史只存在当前浏览器。
- 匿名评分无法彻底防止「清除 Cookie 后换身份重复评分」；这是无账号方案的固有限制。
- 没有图片、地图、投稿、收藏或微信小程序构建；当前是普通 Vue Web。
- 管理员是共享菜单的维护者，不提供多角色权限或操作审计日志。
- 公共评分汇总可缓存 30 秒，其他访客最多延迟 30 秒看到新统计；个人评分与旧版完整评分接口始终不缓存。当前提交者会强制重新读取。没有排行榜。
- 前端评分写入串行执行；支持 Web Locks 的浏览器会跨标签页串行，没有 Web Locks 时保证当前标签页内串行。
- 菜单 JSON 导出不包含管理员凭据、个人历史或评分数据库；导入仅追加，恢复到空实例时请先导入区域，再导入店铺和菜品，并按 200 条/64 KiB 限制分批。
- 线上可用性、Free CPU 余量和校园网络质量需由部署者按实际环境验证。

## 贡献

欢迎提交 issue 和 pull request。开发、测试和提交前检查见 [CONTRIBUTING.md](CONTRIBUTING.md)。请勿在提交、截图、日志或 issue 中包含真实管理员密钥、Cookie、生产 D1 数据或其他敏感信息。

## 许可证

本项目原创代码以 [MIT License](LICENSE) 发布。第三方依赖保留各自许可证；本项目未复制第三方项目代码。依赖清单及许可证元数据见 `package-lock.json`。
