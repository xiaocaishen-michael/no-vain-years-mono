# 「不虚此生」/ no-vain-years-mono

跨端内容工具型应用 mono-repo，由单人开发。栈：NestJS + Fastify + Prisma + Nx + Expo（[Plan 1](docs/plans/2026-05/05-18-plan1-backend-stack-poc.md) 已 ship，从旧 Java meta-repo 推倒重来；部署已上线；业务迁移见 [account-migration master](docs/plans/2026-05/05-25-account-migration-master.md) 进行中）。

## 工作区结构

Nx mono-repo。`apps/server/`（NestJS + Fastify adapter + Prisma）；`apps/mobile/`（Expo，含 `auth/` / `core/` / `theme/` / `ui/` 内联子目录，per [ADR-0030](docs/adr/0030-package-decomposition.md) 「5 包减 2」）；`packages/`（仅 `api-client` + `types`，跨 mobile + server-types 真共享；其他单 consumer 候选已内联到 `apps/mobile/src/`）。

Doc 文件组织 per [docs/conventions/docs-organization.md](docs/conventions/docs-organization.md)；`docs/experience/` 已起步（`2026-05/` 子目录），`docs/daily/` 同为 mono-native（一日一文体例 per docs-organization.md）。旧 meta-repo 的 daily/experience 历史不迁入（2026-05-23 决定作废 Plan 3 迁入 + iCloud symlink 跨设备同步形态）。

## 跨仓公共约定

### 始终装载（@import 自动展开）

#### 业务命名

@docs/conventions/business-naming.md

#### Git 工作流

@docs/conventions/git-workflow.md

#### Spec-Driven Development

@docs/conventions/sdd.md

#### Docs 文件组织（plans / experience）

@docs/conventions/docs-organization.md

### 按需 read — 触发对应操作前先读

| 操作                                                                                           | 必读文档                                                                                                                                                                        |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 后端选型 / PoC 范围 / 验收门槛 / W1-W5 时间盒                                                  | [Plan 1](docs/plans/2026-05/05-18-plan1-backend-stack-poc.md)（meta 仓 docs/plans/ 是历史源，git 史含 PR #137/#138/#139 amend 链）                                              |
| 后端栈 root 决策（语言 / 框架 / 主 ORM / 模块边界策略）                                        | `docs/adr/0018-backend-language-pivot.md`（Plan 1 W4-W5 ship）                                                                                                                  |
| ORM 选型理由                                                                                   | `docs/adr/0019-orm-prisma.md`（同上）                                                                                                                                           |
| NestJS module 边界 + 模块内构范式（扁平 / 贫血 / 护城河 / 零-class）                           | `docs/adr/0032-backend-bounded-context.md`（bounded context 拆分 + hexagonal 退役）+ `docs/adr/0043-server-flat-module-paradigm.md`（扁平内构正向范式）。ADR-0020 已 Superseded |
| Plan 2 业务迁移 / Plan 3 部署上线 / Phase 0 prep / per-feature SDD gate                        | [account-migration master](docs/plans/2026-05/05-25-account-migration-master.md)（统领子 plan：p1 工具链 / p2 依赖+顺序 / p3 逐 uc 步骤；部署 Plan 3 已先行完成）               |
| **新 server use case / 跨 context 决策 / bounded context 评估**                                | `docs/conventions/server-bounded-context-catalog.md`（3 传播规则 + 7 决策问题 + Operation 清单；`.claude/rules/server-bounded-context-decision.md` 路径触发自动加载摘要）       |
| **执行 `gh pr create` / `gh pr edit` body 改写**                                               | `docs/conventions/pr-creation-protocol.md`（仓库模板 `.github/pull_request_template.md` 是 body 唯一权威 source；CI 严格 regex 扫部署 gate 3 checkbox，缺失 / 未勾全红）        |
| 改 `.claude/` 目录任何内容 / 新建 commands / skills / rules / settings 调整                    | `docs/conventions/claude-config-layout.md`（`.claude/rules/claude-config-layout-sync.md` 路径触发自动加载硬 invariant 摘要）                                                    |
| 改 GitHub repo 设置 / ruleset / CI workflow 改名 / 加 required check / 引第二人收紧            | `docs/conventions/github-ruleset.md`                                                                                                                                            |
| 新增 / 改动 server endpoint (controller / DTO / OpenAPI 装饰器) / packages/api-client 重新 gen | `docs/conventions/api-contract.md`                                                                                                                                              |
| 改 `apps/mobile/src/**` / 加 frontend dependency / 处理客户端凭证存储                          | `docs/conventions/fe-directory-structure.md`                                                                                                                                    |

<!-- nx configuration start-->
<!-- intentionally empty — nx CLI / skill hints belong in docs/conventions/nx-usage.md (TBD), not in always-load CLAUDE.md. Please do not refill. -->
<!-- nx configuration end-->

<!-- SPECKIT START -->

For additional context about technologies to be used, project structure,
shell commands, and other important information, read the current plan

<!-- SPECKIT END -->
