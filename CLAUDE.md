# 「不虚此生」/ no-vain-years-mono

跨端内容工具型应用 mono-repo，由单人开发。从 Java meta-repo 推倒重来（[Plan 1](docs/plans/1-claude-java-claude-ai-2-meta-repo-ai-breezy-quill.md)），新栈 NestJS + Fastify + Prisma + Nx + Expo。

## 工作区结构

Nx mono-repo。`apps/server/`（NestJS + Fastify adapter + Prisma，Plan 1 PoC 范围）；`apps/mobile/`（Expo，Plan 2 阶段从旧 `no-vain-years-app` 迁入）；`packages/shared-types/` / `packages/api-client/` 等共享包随 Plan 2 充实。

`docs/daily/` 与 `docs/experience/` 在 Plan 3 阶段从旧 meta-repo 迁入（iCloud symlink，跨设备同步，`.gitignore` 排除）。

## 跨仓公共约定

### 始终装载（@import 自动展开）

#### 业务命名

@docs/conventions/business-naming.md

#### Git 工作流

@docs/conventions/git-workflow.md

#### Spec-Driven Development

@docs/conventions/sdd.md

### 按需 read — 触发对应操作前先读

| 操作 | 必读文档 |
|---|---|
| 后端选型 / PoC 范围 / 验收门槛 / W1-W5 时间盒 | [Plan 1](docs/plans/1-claude-java-claude-ai-2-meta-repo-ai-breezy-quill.md)（meta 仓 docs/plans/ 是历史源，git 史含 PR #137/#138/#139 amend 链） |
| 后端栈 root 决策（语言 / 框架 / 主 ORM / 模块边界策略） | `docs/adr/0018-backend-language-pivot.md`（Plan 1 W4-W5 ship） |
| ORM 选型理由 | `docs/adr/0019-orm-prisma.md`（同上） |
| NestJS module + ESLint boundaries 规则 | `docs/adr/0020-module-boundary-nestjs.md`（同上） |


<!-- nx configuration start-->
<!-- intentionally empty — nx CLI / skill hints belong in docs/conventions/nx-usage.md (TBD), not in always-load CLAUDE.md. Please do not refill. -->
<!-- nx configuration end-->

<!-- SPECKIT START -->
For additional context about technologies to be used, project structure,
shell commands, and other important information, read the current plan
<!-- SPECKIT END -->
