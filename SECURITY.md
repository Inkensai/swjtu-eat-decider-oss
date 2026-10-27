# 安全策略

## 支持版本

当前维护 V1.0 及 `main` 分支上的最新版本。旧提交和自行修改的部署不保证获得安全更新。

## 报告安全问题

请使用 GitHub 的 **Private vulnerability reporting / Security Advisories**：

<https://github.com/Inkensai/swjtu-eat-decider-oss/security/advisories/new>

不要在公开 issue、讨论区、截图或日志中粘贴以下内容：

- 管理员访问密钥或密码；
- 会话 Cookie、CSRF Token；
- 生产 D1 数据或数据库导出；
- Cloudflare API Token、OAuth Token 或其他云凭据。

报告中请尽量包含：受影响版本或提交、复现步骤、影响范围、相关接口，以及你希望采用的披露时间。维护者会先确认问题，再协调修复和公开披露。

## 适用范围

重点关注：

- 管理员认证绕过、会话固定或会话失效问题；
- CSRF、同源校验或权限默认拒绝问题；
- SQL 注入、路径穿越、XSS 或敏感信息泄漏；
- 登录限流绕过；
- 构建产物意外包含管理员凭据或本地密钥。

请优先在本地或你自己的 Cloudflare 账户中复现，不要对公开演示站点进行破坏性测试、批量登录尝试或写入真实业务数据。
