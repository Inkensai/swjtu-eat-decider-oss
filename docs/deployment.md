# 部署指南：Cloudflare Pages + D1

本文说明如何把本项目部署到 Cloudflare Pages，并配置 D1、管理员认证和上线验收。命令中的 `<...>` 需要替换为你自己的资源名或 ID。

## 架构

- 前端：Vue 3 静态资源，输出到 `dist/pages`。
- API：Pages Functions 高级模式，入口为 `dist/pages/_worker.js`。
- 数据库：Cloudflare D1，绑定名 `DB`。
- 管理员认证：应用内访问密钥或人工密码，由服务端验证；不使用 Cloudflare Access。

`npm run build:pages` 会把 Vite 产物、Worker 和路由配置组合成 `dist/pages`。不要只上传 `dist/client`，也不要把整个 `dist` 作为输出目录。

## 前置要求

- Node.js 24.x（仓库通过 `.node-version` 固定）
- 一个 Cloudflare 账户和已登录的 Wrangler
- 一个 GitHub 仓库（Pages 的 Git 集成）
- 已启用的 D1 数据库

```powershell
npm ci
npx wrangler whoami
```

## 1. 准备 D1

创建数据库（如果尚未创建）：

```powershell
npx wrangler d1 create <D1_NAME>
```

把返回的 `database_id` 填入 `wrangler.jsonc`：

```jsonc
{
  "env": {
    "production": {
      "d1_databases": [{
        "binding": "DB",
        "database_name": "<D1_NAME>",
        "database_id": "<D1_DATABASE_ID>",
        "migrations_dir": "migrations"
      }]
    }
  }
}
```

根环境和 preview 默认不绑定生产库；不要为了让 Preview 可用而复制生产 D1 或生产 Secret。

## 2. 应用迁移

```powershell
npx wrangler d1 migrations apply <D1_NAME> --remote --env production --config wrangler.jsonc
```

迁移内容：

- `0001_menu.sql`：`areas`、`restaurants`、`dishes` 及三个索引；
- `0002_admin_auth.sql`：`admin_sessions`、`admin_login_attempts` 及两个索引；
- `0003_ratings.sql`：`ratings`、`rating_rate_limits`、两个部分唯一索引、两个普通索引与一个窗口索引，以及级联外键和 CHECK 约束。
- `0004_rating_indexes.sql`：个人评分查询、管理员游标分页及筛选索引。
- `0005_availability.sql`：店铺每日营业时段、今日休息日期和菜品售罄日期，旧数据默认空字符串。

必须通过 Wrangler 的迁移登记表执行，不要手工重复执行整份 SQL。不要将迁移放进 Pages 构建命令；构建阶段不应写生产库。从 V1.2 升级时先备份数据库，再应用 `0004`、`0005`，确认成功后发布新 Worker。新增字段不改变已有菜单名称/价格。自行部署可使用自己的数据库名，产物测试只要求有效 DB 绑定及配置结构。

迁移后核验：

```powershell
npx wrangler d1 execute <D1_NAME> --remote --env production --config wrangler.jsonc `
  --command "SELECT name, type FROM sqlite_schema WHERE type IN ('table','index') AND name NOT LIKE 'sqlite_%' ORDER BY type, name;"

npx wrangler d1 execute <D1_NAME> --remote --env production --config wrangler.jsonc `
  --command "SELECT id, name, applied_at FROM d1_migrations ORDER BY id; PRAGMA foreign_key_check; PRAGMA quick_check;"
```

预期有 7 张业务/认证表、10 个索引、3 条迁移记录；`foreign_key_check` 无输出，`quick_check` 返回 `ok`。V1.2 的评分相关对象可用下面的语句单独核验：

```powershell
npx wrangler d1 execute <D1_NAME> --remote --env production --config wrangler.jsonc `
  --command "SELECT type, name, tbl_name FROM sqlite_schema WHERE tbl_name IN ('ratings','rating_rate_limits') ORDER BY type, name;"
```

### 备份与恢复

迁移前如需保留基线：

```powershell
New-Item -ItemType Directory -Force output/backups | Out-Null
npx wrangler d1 export <D1_NAME> --remote --env production --config wrangler.jsonc `
  --output output/backups/before-migration.sql
Get-FileHash output/backups/before-migration.sql -Algorithm SHA256
npx wrangler d1 time-travel info <D1_NAME> --env production --config wrangler.jsonc
```

备份、bookmark、导出文件都只保存在本机被 Git 忽略的目录，不要提交。恢复会覆盖当前数据，必须单独确认后再执行：

```powershell
npx wrangler d1 time-travel restore <D1_NAME> --bookmark "<BOOKMARK>" --env production --config wrangler.jsonc
```

迁移失败时保留日志、当前结构和备份，不要盲目重试、`DROP` 表或直接导入覆盖；先判断是否部分应用，再决定恢复方案。

## 3. 创建 Pages 项目

在 Cloudflare Dashboard 创建 Pages 项目并连接 Git 仓库：

| 设置 | 值 |
| --- | --- |
| Framework preset | None |
| Build command | `npm run build:pages` |
| Build output directory | `dist/pages` |
| Root directory | 仓库根目录 |
| Production branch | `main` |
| Node.js | `.node-version` 固定版本 |
| Preview deployments | 建议关闭，或使用隔离的 D1/凭据 |

首次连接时如果只想完成项目创建、不立即发布，可以临时使用明确返回非零的构建命令（例如 `node -e "process.exit(1)"`），确认项目创建和 Secret 配置后再改为正式命令。不要用空静态页或 Direct Upload 绕过正式构建。

Pages 项目创建后，在 Production 环境确认：

- D1 绑定 `DB` 指向目标库；
- 构建命令为 `npm run build:pages`；
- 输出目录为 `dist/pages`；
- Preview 不绑定生产 D1，也不复制生产 Secret。

## 4. 配置管理员认证

管理员凭据有两种互斥模式，按配置二选一。

### 方式一：访问密钥（Free 推荐）

```powershell
npm run admin:key
```

输出：

- `ADMIN_ACCESS_KEY`：43 字符 base64url 密钥，只保存到密码管理器，用于登录页；
- `ADMIN_ACCESS_KEY_HASH=sha256:<64位十六进制>`：只把这一行配置为 Production 的加密变量 `ADMIN_ACCESS_KEY_HASH`。

服务端对输入做一次 SHA-256，再以常量时间比较摘要。256 位随机空间使离线枚举不可行，因此访问密钥不需要慢哈希。

### 方式二：人工密码 PBKDF2（付费套餐）

```powershell
npm run admin:hash
```

把输出的哈希配置为 Production 的加密变量 `ADMIN_PASSWORD_HASH`。默认 100,000 次迭代；在本机 i7-13620H 的 WebCrypto 中位数约 11.5ms，已接近或超过 Workers Free 的 10ms 单请求 CPU 限额量级。

- 不要因为超限就把迭代直接降到 20,000；如确需降低，必须重新做安全评估并重新验收。
- 人工密码仍应使用足够长的随机密码。
- 只有访问密钥和人工密码都不配置时登录返回 503；管理 API 仍返回 401，不会退化为公开写入。

不要把密钥原文、密码哈希或任何 `VITE_*` 变量写进前端、Git、URL、日志或截图。

## 5. 部署与验收

触发 Pages 构建后，检查：

```powershell
npx wrangler pages deployment list --project-name <PAGES_PROJECT> --environment production
```

构建日志应实际显示 `npm run build:pages`，而不是保护命令。部署完成后验证：

- `/`、`/history`、`/api/areas`、`/api/restaurants`、`/api/dishes` 返回预期状态；
- 三种推荐模式返回 `ok` 或空候选 `empty`；
- 未登录管理 API 返回 401；
- 使用生产密钥登录后能建立会话并完成 CRUD；
- 缺少 CSRF 的写请求返回 403；
- 退出后原会话失效；
- 手机和桌面布局正常。

### Free CPU 测量

Workers Free 按每请求 10ms CPU 计时；Pages Functions 沿用账户的 Workers 计划。PBKDF2 的 `await` 只代表异步调度，底层计算仍计入 CPU；请求总耗时不能替代 CPU 时间。

启动生产日志流：

```powershell
npx wrangler pages deployment tail --project-name <PAGES_PROJECT> --environment production --format json
```

读取 `POST /api/admin/session` 事件的 `cpuTime` 和 `outcome`。通过“登录 → 退出”完成 20 次成功登录，计算 p95：

- 访问密钥模式验收线建议 p95 CPU < 8ms；
- 不得出现 `outcome: "exceededResources"`、1102 或异常 5xx；
- 同时确认错误凭据限流、CSRF 和未登录拒绝正常；
- 如果日志不返回 `cpuTime`，改用 Dashboard 的 Workers Logs/可观测性，不能伪造测量值。

更换认证方式或密钥后应重新测量。

## 6. 会话、CSRF 与限流

- 登录成功写入 `ed_admin_session` Cookie：`Path=/; HttpOnly; Secure; SameSite=Lax`。生产 HTTPS 始终带 `Secure`；只有本地回环 HTTP 开发省略。
- D1 只保存会话令牌的 SHA-256 摘要，不保存 Cookie 原文。
- 会话默认 12 小时绝对过期；退出立即删除对应行。
- 所有管理写请求要求同源 `Origin` 和与会话一致的 `X-CSRF-Token`，缺失或不匹配返回 403。
- 登录失败按来源 IP 摘要计数，达到上限返回 429 并带 `Retry-After`。
- 轮换访问密钥：重新运行 `npm run admin:key`，更新 `ADMIN_ACCESS_KEY_HASH` 并重新部署；旧密钥立即失效。已有会话在到期前仍有效；如需立即全部失效，需在明确批准后清理 `admin_sessions`，不要把该操作放进构建或迁移流程。

可选普通变量：

| 变量 | 默认值 | 范围 | 作用 |
| --- | --- | --- | --- |
| `ADMIN_SESSION_TTL_SECONDS` | 43200 | 300–604800 | 会话绝对有效期 |
| `ADMIN_LOGIN_MAX_ATTEMPTS` | 5 | 3–100 | 窗口内连续失败上限 |
| `ADMIN_LOGIN_WINDOW_SECONDS` | 900 | 60–86400 | 限流窗口与锁定时长 |
| `RATING_RATE_LIMIT` | 30 | 1–10000 | 同一匿名身份在评分窗口内的写入上限 |
| `RATING_IP_RATE_LIMIT` | 120 | 1–100000 | 同一来源 IP 在评分窗口内的写入上限 |
| `RATING_RATE_WINDOW_SECONDS` | 600 | 10–86400 | 评分限流窗口（秒） |

## 7. 匿名评分与评分限流

- **不需要新增 Secret。** 匿名评分身份在运行时由服务端生成，D1 只保存其 SHA-256 摘要；没有需要配置的评分密钥。
- 首次提交评分时下发 `ed_rater_id` Cookie：生产为 `Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=31536000`。只有本地回环 HTTP 开发省略 `Secure`；不要为了让明文 HTTP 可用而关闭它。
- 同一匿名身份对同一对象只有一条有效评分；再次提交更新原记录，评分人数不变。删除权限只有原 Cookie 身份或认证管理员；管理员删除同时要求 `Origin` 与 `X-CSRF-Token`。
- 限流按匿名身份摘要与来源 IP 摘要分别计数，使用上表的三个普通变量。来源 IP 只信任 `CF-Connecting-IP`（Cloudflare 边缘写入），不要改为信任 `X-Real-IP` 等客户端可伪造的头。
- 个人评分与完整评分接口始终 `Cache-Control: no-store`；仅 `/api/ratings/summary` 公共汇总可缓存30秒，永远不包含个人评分或 Set-Cookie。评分写入成功后的客户端刷新绕过缓存。

上线后只读核验：

```powershell
curl.exe -s https://<你的域名>/api/ratings
# 期望：{"restaurants":[],"dishes":[],"mine":[]}
```

如需在生产验证写入，请先得到明确授权，并使用一个受控身份完成「首次评分 → 修改（人数不变）→ 删除本人评分」后清理；不要删除真实访客的评分，也不要把测试评分留在生产库。

## 8. 回退

- 代码回退与数据库回退分开处理；不要把代码回退当作数据恢复。
- 保留上一可用部署和失败日志。
- 不自动删除 D1、修改 DNS 或改动其他 Pages 项目。
- 如需恢复数据库，先展示备份/bookmark、数据损失范围和影响，再单独确认。

## 参考

- [Cloudflare Pages Git 集成](https://developers.cloudflare.com/pages/get-started/git-integration/)
- [Pages 构建配置](https://developers.cloudflare.com/pages/configuration/build-configuration/)
- [D1 迁移](https://developers.cloudflare.com/d1/reference/migrations/)
- [D1 导入导出](https://developers.cloudflare.com/d1/best-practices/import-export-data/)
- [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)
- [Workers 限制](https://developers.cloudflare.com/workers/platform/limits/)
- [Workers 计费](https://developers.cloudflare.com/workers/platform/pricing/)
