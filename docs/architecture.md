# 架构与数据模型

## 总览

Vue 3 单页应用通过同源 JSON API 调用 Cloudflare Pages Function，使用 D1 参数绑定 SQL 持久化共享菜单。管理员页面也是公开 SPA，由前端查询会话状态后显示登录表单或管理界面；真正的权限判断全部在服务端。

推荐逻辑位于 `shared/recommendation.ts`，由服务端调用，前端只提交筛选条件并展示结果。

## 模块

- `src/`：首页、浏览菜单、历史页、管理页、API 客户端、浏览器本地历史与评分状态镜像。
- `src/components/`：可复用评分控件（键盘可操作、带可访问标签）和管理员评分管理面板。
- `shared/`：共享类型与独立推荐逻辑，无 DOM 或持久化依赖。
- `server/`：Worker 入口、认证、参数校验、D1 数据访问和路由；`server/ratings.ts` 集中匿名身份、评分写入与管理员评分接口。
- `migrations/`：版本化 SQL；三张业务表、管理员会话与登录限流表，以及 V1.2 的评分与评分限流表。
- `tests/`：确定性算法、密码哈希/会话/CSRF、匿名评分权限与防滥用、真实本地 D1 与 Pages 产物集成测试。
- `scripts/`：本地初始化、密钥生成、构建、产物检查和 smoke 测试。

## 数据模型

- `areas`：名称、type、sort_order、enabled。
- `restaurants`：引用 `area_id`，名称、category、location、enabled，以及 `opening_hours`、`closed_today`。
- `dishes`：引用 `restaurant_id`，名称、category、price_cents、weight、notes、enabled，以及 `sold_out_on`。
- `admin_sessions`：会话令牌的 SHA-256 摘要、CSRF 令牌、创建和过期时间。
- `admin_login_attempts`：按来源 IP 摘要预留的尝试次数、窗口和锁定时间；单条原子 UPSERT 在凭据校验前执行，成功后清除计数。
- `ratings`：评分对象类型、`restaurant_id` / `dish_id`、匿名身份摘要、星级和时间。
- `rating_rate_limits`：按匿名身份摘要与来源 IP 摘要统计的固定窗口写入次数。

每张业务表都有字符串 UUID 及 UTC ISO 创建/更新时间。数据库外键为 `RESTRICT`，没有级联删除；`ratings` 的两个外键例外，使用 `ON DELETE CASCADE`，删除店铺或菜品时一并清理其评分，避免孤儿数据。

价格为非负整数分，默认权重 1，禁止非有限或负权重。API 额外限制文本长度和数值范围。排序先按区域 `sort_order`，再按名称和 ID，确保稳定展示。

`sort_order` 的整数限制由 API 校验；数据库 CHECK 只限制范围，直接绕过 API 写 SQL 仍可写入小数。这是低风险边界，不应通过导入脚本绕过 API 校验。

### 评分表约束

`ratings` 用 `target_type`（restaurant / dish）加两个可空外键列表达评分对象，CHECK 约束保证二者恰有一个非空，因此店铺评分与菜品评分不会混淆，菜品 ID 也无法冒充店铺 ID。

- `identity_hash` 是匿名 Cookie 凭据的 SHA-256 摘要（加 `rater:` 前缀做域分隔），长度固定 64，D1 不保存原文。
- 两个部分唯一索引 `(identity_hash, restaurant_id)` 与 `(identity_hash, dish_id)` 保证同一身份对同一对象只有一条有效评分，并作为并发重复提交的最终约束。
- 写入使用 `INSERT ... ON CONFLICT ... DO UPDATE`：重复提交只更新星级与 `updated_at`，`created_at` 保留，评分人数不变。
- 统计直接使用 `AVG(stars)` 与 `COUNT(*)`，只覆盖当前公开可见（自身与父级均启用）的对象。
- `0004` 添加非部分的 `identity_hash` 索引，支持个人评分查询；分页采用 `(updated_at,id)` 游标，并有对应排序/筛选索引。公共统计独立接口可缓存30秒，私人评分单独读取且不缓存。

前端所有评分写入经统一队列执行，并在支持 Web Locks 时跨标签页串行，确保首次响应 Cookie 落地后才发出下一次写入。读请求带版本号，过期响应不能覆盖后续操作。写入完成后绕过公共缓存重新读取。

### 营业与批量维护

`shared/availability.ts` 在前后端复用北京时间规则；默认推荐剔除今日休息/售罄，`openNow` 额外要求有效营业时段。未设置时段属于未知状态，不能当作已知营业。临时标记以日期保存，次日无需写数据库即可失效。

`server/import.ts` 复用单条 CRUD 校验，在 dry-run 给出逐行预览。确认后再次校验并用 D1 `batch` 原子执行；每条 INSERT 内再次检测重复 ID/同级名称，约束冲突会回滚整个批次。限制200条和65536字节，既不覆盖旧数据，也不绕过鉴权与CSRF。JSON 允许原有历史分类往返，CSV 新增菜品遵循标准分类。

`rating_rate_limits` 保存固定窗口计数，按匿名身份摘要和来源 IP 摘要分别限流。来源 IP 只读取 Cloudflare 边缘写入的 `CF-Connecting-IP`；`X-Real-IP` 等头可由普通客户端伪造，不作为限流维度。

## 权限

公共 API 只读菜单并进行无持久副作用的推荐。管理 API 在服务端统一验证 `ed_admin_session` 会话 Cookie；没有有效会话一律返回 401。

- D1 只保存会话令牌的 SHA-256 摘要，会话有服务端绝对过期时间（默认 12 小时），退出登录立即删除对应行。
- 所有管理写请求要求与目标同源的 `Origin` 及与会话一致的 `X-CSRF-Token`，缺失或不匹配返回 403。
- 生产 Cookie 带 `Secure`；仅本地回环 HTTP 开发省略。
- 管理员凭据支持两种服务端配置，按配置二选一：`ADMIN_ACCESS_KEY_HASH`（高熵随机访问密钥的 SHA-256 摘要，适合 Workers Free）或 `ADMIN_PASSWORD_HASH`（人工密码的 PBKDF2-HMAC-SHA256 哈希，适合付费套餐并需通过 CPU 实测）。同时配置时访问密钥优先。
- 凭据不写入源码、前端、浏览器存储或 Git；登录失败按来源 IP 摘要计数限流，达到上限返回 429 并带 `Retry-After`。
- 生产运行不依赖 Cloudflare Access、`ACCESS_TEAM_DOMAIN`、`ACCESS_AUD` 或 `ADMIN_EMAILS`。

选择访问密钥模式的原因：PBKDF2 100,000 次迭代在本机 WebCrypto 中位数约 11.5ms，已高于 Free 的 10ms 单请求 CPU 限额量级；256 位随机密钥的 SHA-256 验证成本可忽略，且随机空间使离线暴力枚举不可行。详细测量与验收方案见 [部署说明](deployment.md)。

### 匿名评分权限

评分删除权限只有两种来源：原匿名 Cookie 身份，或经过认证的管理员。

- 普通访客可以浏览全站统计，并用服务端下发的匿名身份提交自己的评分。
- 原 Cookie 身份可以读取、修改、删除自己的评分；`PUT` / `DELETE` 都以 `identity_hash` 作为查询条件，其他身份的评分无法通过该路由寻址。
- 没有身份 Cookie 的删除返回 401，身份没有该评分返回 404，两者都不会修改数据。
- 管理员使用现有会话、同源 `Origin` 与 CSRF 校验后，可以列出并删除任意评分，但不能替用户改星级；管理员列表不返回任何身份摘要。
- 评分写入同时校验 `Origin` 与目标同源；匿名 Cookie 为 `SameSite=Lax`，跨站写请求不会携带原身份。

## 本地历史

浏览器使用 `localStorage` 保存用餐记录。当前页面运行期间所有推荐（含未采纳）都保留在 Pinia 内存；只有用户主动标记采纳的记录写入 `eat-decider.history.v1`，刷新后也只恢复已采纳记录。上限 100 条，超出时优先淘汰最旧的未采纳记录，其次淘汰最旧的已采纳记录。读取旧版数据时保留 `adopted=true` 的记录并迁移为只含已采纳记录的结构。历史不包含管理员凭据或评分身份，不上传服务器；清除浏览器数据或换设备后无法恢复。清空历史不会删除 D1 中的评分。

## 构建与部署

- `build:pages` 组合 `dist/client` 静态资源和已编译 Worker，输出 `dist/pages`。
- `_worker.js` 使用 Pages 高级模式，`_routes.json` 只把 `/api`、`/api/*`、`/admin`、`/admin/*` 送入 Function。
- 根 `wrangler.jsonc` 是 Pages 配置；本地开发使用 `wrangler.dev.jsonc` 和模拟 D1。
- 构建过程不迁移远程 D1、不上传、不需要 Cloudflare 或 GitHub Token。
- 构建脚本检查产物，拒绝本地环境文件、管理员密钥、密码或摘要进入 `dist`。

## 第三方与许可

项目基于官方 `create-vite` Vue TypeScript 模板开始，推荐模块和界面为独立实现，未复制第三方项目代码。第三方依赖保留各自许可证，清单和许可证元数据见 `package-lock.json`；本项目原创代码以 MIT License 发布。新增第三方代码、字体、图片或其他资源时，必须同时记录来源和许可证并确认兼容性。
