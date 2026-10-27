# 贡献指南

感谢你愿意改进 SWJTU Eat Decider。请保持改动聚焦，并附上可验证的测试或复现步骤。

## 开发环境

```powershell
npm ci
npm run setup:local
npm run db:migrate
npm run dev
```

本地密钥会写入被 Git 忽略的 `.dev.vars` 和 `.dev.vars.admin-key`。不要提交、截图或分享这两个文件。

## 提交前检查

```powershell
npm run typecheck
npm test
npm run test:pages
npm run build:pages
```

涉及界面或交互的改动，请至少检查桌面和窄屏布局；涉及管理员认证、CSRF、会话或 D1 的改动，请补充对应测试。

## Pull Request

- 一个 PR 尽量只解决一个问题。
- 说明改动目的、行为和验证方式。
- 不提交 `node_modules/`、`dist/`、`.wrangler/`、本地数据库、`output/`、日志、备份或任何真实凭据。
- 不修改生产 Cloudflare 配置、生产 D1 或 DNS 作为普通 PR 的一部分。
- 新增第三方代码或资源时，明确标注来源和许可证，确认与 MIT 许可证兼容。

安全问题请按 [SECURITY.md](SECURITY.md) 私下报告，不要先开公开 issue。
