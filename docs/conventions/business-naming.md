# 业务命名约定

> Minimal-adapt copy from meta-repo Plan 1 W1.3。Java/Maven 体例已删；NestJS module 路径口径在 ADR-0020 ship(Plan 1 W4-W5)前为占位。

mono-repo 内前端 / 后端共享。前端 / 后端必须 follow。

- 业务概念（account / note / tag / session / ...）在前后端保持**统一英文命名**
- 避免中英混用或拼音
- 业务模块字符串在多处保持严格一致：
  - 后端 NestJS module 目录：`apps/server/src/modules/<module>/`
  - 前端 feature 目录：`apps/mobile/src/features/<module>/`（Plan 2 阶段从旧 `no-vain-years-app` 迁入）
  - 数据库 schema：`<module>`
- **加新模块时**：上述位置必须同时落地（强制由 ESLint boundaries + Prisma schema 在 CI 拦截，Plan 1 W4 ship）
