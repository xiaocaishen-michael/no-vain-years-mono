# 业务命名约定

> mono-repo 内业务概念命名 SoT。前后端 + DB schema 三处保持严格一致。

mono-repo 内前端 / 后端共享。前端 / 后端必须 follow。

- 业务概念（account / note / tag / session / ...）在前后端保持**统一英文命名**
- 避免中英混用或拼音
- 业务模块字符串在多处保持严格一致：
  - 后端 NestJS module 目录：`apps/server/src/<module>/`（如 `auth/` / `account/` / `security/`，per [ADR-0020](../adr/0020-module-boundary-nestjs.md) hexagonal 4 层 `domain/application/infrastructure/web`）
  - 前端 feature 目录：`apps/mobile/src/<feature>/`（已迁入 `auth/`；其余 use case 续 [Plan 2](../plans/2026-05/05-19-plan2-plan3-migration-deploy.md) 顺序）
  - 数据库 schema：`<module>`
- **加新模块时**：上述位置必须同时落地（强制由 ESLint boundaries (per [ADR-0020](../adr/0020-module-boundary-nestjs.md)) + Prisma schema 在 CI 拦截）
