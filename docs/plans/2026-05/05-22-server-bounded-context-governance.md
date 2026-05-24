# Plan: Server Bounded Context Governance（security / account / auth 长期治理）

> **Status（2026-05-24 闭合）**：基线已稳。Carry-over O1-O4 全部 resolved — O1 Outbox `metadata.trace_id` 强制 (#90) / O2 Operation Catalog (#93) / O3 hexagonal layer ESLint **VOID**（扁平贫血范式取代，见下 O3）/ O4 `src/common/` policy → ADR-0041 (#87)。下方「Governance Checklist（per feature 触发）」已毕业为常驻约定 [server-bounded-context-catalog.md](../../conventions/server-bounded-context-catalog.md)，随 Plan 2 feature 持续生效，不随本 plan 闭合。

## Context

2026-05-21 ship [05-21-review-tech-stack-post-a002.md](05-21-review-tech-stack-post-a002.md) 的 PR-4「Server bounded context split」(PR #72) 完成物理拆分，但后续 PR-5 链落地时**仅靠 unit test 没能拦住 2 处 cross-module wiring bug**——`security.module.ts` 的 ClsModule interceptor mode 让 Guards/Filters 看不到 `trace_id`；`FormValidationException` 定义了但 `main.ts` 全局 ValidationPipe 未挂接。两 bug 等到 PR #79 真后端 smoke 才浮出，这种「装配 gap」是 bounded context 分层的固有副作用，**Plan 2 的 16 use case 顺序迁入时每个 feature 都可能触碰**。

本 plan 从 05-21-review-tech-stack-post-a002 PR-4 段 + 05-22-pr5-tail-orval-stabilize.md 单独迁出，理由：

1. **「已完成 PR」的标签和 bounded context 的真实状态不匹配** — physical split done ≠ wiring 经过验证；governance 是持续工作
2. **Plan 2 业务迁入触发面广** — pkm / notification / 实名认证等模块加入时必须做 module 归属评估（归 account？新建？同步还是 Outbox？），这套判断没有归宿就会成为 implicit drift
3. **ADR-0033 / 0034 + hexagonal layer ESLint 三项 carry-over** — 原 plan 标 deferred 到 PR-7，但 PR-7 是「doc 收口」scope，扛不动这些半设计-半实施任务
4. **`src/common/` 决策需要 ADR 化** — PR-4 scope round 用户选不做，但未文档化为 lock；后续 PrismaService 跨更多 module / common error 增加时会重新触发，应让 ADR-0041 一次性写死决策路径

## Out of Scope（明确不做）

- ADR-0036 / 0037 / 0038 / 0039 落地（在 05-21 review plan PR-6 范围内，不迁过来）
- mobile 端 Orval / react-query / Zustand 决策（已 locked）
- Plan 2 业务迁入本身（本 plan 只提供 governance checklist；feature 工作有独立 plan）
- spec-kit 模板调整（在 05-21 PR-1 已 ship + 05-22 test-infra master 加固）

## 已完成基线

### Part A — PR #72 物理 split

- 23 file `git mv`（保 log）+ 24 source import rewrites + 8 e2e import rewrites
- 新增 `apps/server/src/security/security.module.ts`、`apps/server/src/account/account.module.ts`，重写 `apps/server/src/auth/auth.module.ts`
- ESLint `boundaries` plugin elements 由 layer (domain/application/infra/web) 切到 module (security/account/auth)，单向 `auth → account → security`
- `tsconfig` + `main.ts` 引用全部同步

### Part A discoveries（与原 ADR-0032 设计的偏差，已 amend）

- **`security/` scope 比原 ADR 设计宽** — 不只 JWT，还含 `PrismaService` + `REDIS_CLIENT` + 共用 DTO + `form-validation.exception`。原因：`account/AccountPrismaRepository` 注入 `PrismaService` 时不能反向 import auth/，security 必须做 platform base layer
- **`JwtAuthGuard` 不在 `security/`** — 它做 token verify *plus* `Account.isActive` 查询（FR-002 / FR-009 anti-enumeration），含业务逻辑，因此落 `account/web/jwt-auth.guard.ts`；纯 JWT verify 留在 `security/JwtTokenService`
- ADR-0032 frontmatter status: Accepted with notes

### Part B — PR #79 cascade 修（unified from 05-22-pr5-tail）

PR-5 链（#73 / #74 / #75）2026-05-21 全部 merged 但**从未跑过真后端 + 真 mobile runtime smoke**。PR #79 跑全链路 smoke 暴露 8 处 cascade，**前 2 处是 PR-4 territory 的 cross-module wiring gap**，其余 6 处是 A-002 / PR-5 链留下的 mobile / e2e / orchestrator 缺陷。**全部纳入 baseline 由本 plan 归口**——同一次 runtime smoke 暴露的事实链不应割裂归档，整轮 smoke 的实证是 governance 的 base data：

| # | 层 | 类型 | 文件 | PR-4 territory？ |
|---|---|---|---|---|
| 1 | server `x-trace-id` 全链路断 | CLS interceptor mode → middleware mode + `useEnterWith: true`（Fastify req lifecycle 兼容） | `apps/server/src/security/security.module.ts` | ✅ 是 |
| 2 | server `FORM_VALIDATION` 0 caller | ValidationPipe `useGlobalPipes` 未挂；`main.ts` 加 `app.useGlobalPipes(new ValidationPipe({ exceptionFactory: ... }))` | `apps/server/src/main.ts` | ✅ 是 |
| 3 | mobile 冷启动 blank screen | `decideAuthRoute` 漏 root `/` 分支 | `apps/mobile/src/core/auth-gate-decision.{ts,spec.ts}` + `_layout.tsx` | — |
| 4 | e2e URL regex 不识 expo-router web 隐藏 route groups | A-002 spec 未考虑 | `apps/mobile/e2e/profile.spec.ts` | — |
| 5 | Playwright `.tap()` throw | playwright config 缺 `hasTouch` | `apps/mobile/playwright.config.ts` | — |
| 6 | US11 selector role mismatch | A-002 test 用 `'button'` 但 ARIA 是 `'tab'` | `apps/mobile/e2e/profile.spec.ts` | — |
| 7 | mobile crypto polyfill | 加 `import 'react-native-get-random-values'`（预防 lib 升级） | `apps/mobile/{app/_layout.tsx,package.json}` | — |
| 8 | orchestrator lint 红 | nx cache 蒙过；1 行 fix | `scripts/orchestrator/llm-client.ts` | — |

## Carry-over Open Items

### O1 — ADR-0033 Outbox `metadata.trace_id` 强制

**现状**：ADR-0033 frontmatter status: Proposed；outbox 实现仍在 `apps/server/src/auth/infrastructure/outbox-event.prisma.publisher.ts`；event payload 未强制 `metadata.trace_id` 字段。

**触发**：Plan 2 第一个引入新 module 的 feature（pkm / notification 候选），需要 cross-context async 时立即落地。

**工作单元**（脚手架已就绪，约 1-2h）：

- ADR-0033 status: Proposed → Accepted
- `outbox-event.prisma.publisher.ts` 改 `publish()` signature 强制 `metadata: { trace_id: string, ... }`（从 `ClsService.getId()` 取）
- Zod schema `OutboxEventEnvelope` 校验 payload shape
- e2e 验：触发 `OutboxPublisher` → consumer 读取 event 拿到同 trace_id

**Verify**：`grep -r 'OutboxPublisher.publish\|outbox.*publish' apps/server/src` 所有 caller 都传 `metadata.trace_id`；server log + outbox event row 同一 trace_id 串得通

### O2 — ADR-0034 Operation Catalog + LLM decision tree

**现状**：ADR-0034 frontmatter status: Proposed；尚无目录文档。

**触发**：当 Plan 2 第二个引入 bounded context 决策（「这个 use case 归 account 还是新 module？需不需要 Outbox？」）的 feature 启动前。

**工作单元**（约 2-3h）：

- 在 `docs/conventions/server-bounded-context-catalog.md`（或 ADR-0034 正文）写 3 条传播规则：
  1. 同 context 内：直接 module import + 同步调用
  2. 跨 context async（业务事件外发）：走 Outbox + ADR-0033 trace_id envelope
  3. 跨 context sync（强依赖查询）：只通过 SecurityModule 暴露的共享 service（如 `PrismaService`），禁 cross-context service 直引
- LLM decision tree：5-7 个 Yes/No question 帮 agent 选 1/2/3
- 落 spec-kit hook 提示（`/speckit-specify` 后软提醒）

**Verify**：用 spec 003+ 写一份 mock 跨 context 需求，跑 decision tree 命中 1/2/3 分支

### O3 — Hexagonal layer ESLint rules reintroduce

> ⚠️ **VOID（2026-05-24）** — 本 carry-over 工作项已**正式作废**：hexagonal 四层永久退役，全仓以 Bounded Context（module 级）为唯一最高物理红线。见 [ADR-0032 §架构历史决议对齐](../../adr/0032-backend-bounded-context.md)。下文保留作历史留痕，**勿执行**。

**现状**：PR-4 把 boundaries elements 由 layer 切到 module，hexagonal layer 单向规则（domain ← application ← infra/web）**暂时**移除。

**触发**：跨 context 落地 ≥ 2 个新 use case 后，或 `grep` 出 ≥ 1 处 layer 反向 import 实证。

**工作单元**（约 30-60 min）：

- `apps/server/eslint.config.mjs` boundaries elements 改为 module × layer = 12 elements 矩阵
- 规则：同 module 内 layer 单向；跨 module 仅 `auth → account → security`
- 加 forbidden-import 测试验证 rule 真 fire（per memory `feedback_lint_plugin_upgrade_must_verify_with_violation`）

### O4 — `src/common/` Directory Policy → ADR-0041

**现状**：PR-4 scope round 用户明示不引入 `src/common/`；`security/` 实际承担了 platform base layer 角色（`PrismaService` / `REDIS_CLIENT` / `form-validation.exception` / `problem-detail.response`）。

**问题**：这是 implicit 决策，没文档化。Plan 2 引入第 4-5 个 module 时若有人提议引入 `src/common/`，没文档 baseline。

**工作单元**（约 30 min，独立 PR）：

- 新建 `docs/adr/0041-server-common-directory-policy.md`：
  - Context：`security/` 已承担 platform base 角色
  - Decision：`src/common/` 不引入；platform-wide infra 统一进 `security/`；business-domain 共享类放对应 bounded context
  - Sunset trigger：`security/` 内非 JWT 类成员数 > 7 / 跨 context 共享 business class 出现 / TypeScript circular dep 频繁
  - `applies_to: [apps/server]`
- frontmatter 4 字段（`adr_id` / `status` / `applies_to` / `sunset_trigger`）齐全，过 `.specify/schemas/adr.zod.ts` 校验

**Verify**：`pnpm exec node .specify/schemas/check-all-frontmatters.ts` GREEN；`security/` 现有成员对应 sunset trigger 阈值 < 7（≈ 5 当前）

## Governance Checklist（长期，per feature 触发）

**每个 Plan 2 feature 起手 `/speckit-specify` 后、`/speckit-plan` 前必跑**：

- [ ] **Module 归属评估** — spec.md `modules:` 字段：归现有 security / account / auth 之一？还是新建 module？
  - 新建 module 必须 cite 触发条件（如 spec User Scenarios 行数 ≥ 某阈值 / 跨已有 module 边界数 ≥ 2）
- [ ] **跨 context 通信路径** — 若 spec 描述涉及多 module，跑 O2 decision tree 锁定 1/2/3 分支
- [ ] **新 SecurityModule export** — 加新成员到 `security/` 前必经 ADR-0041 sunset trigger 阈值 review
- [ ] **Runtime smoke gate** — PR 必含 `runtime-smoke`（P4 已 ship in #84）覆盖该 feature 的至少 1 个 endpoint
- [ ] **ESLint boundaries 同步** — 新 module 必加进 `apps/server/eslint.config.mjs` elements 列表 + 单向规则
- [ ] **Outbox + trace_id** — 任何新 cross-context async 发布都过 ADR-0033 envelope schema

## Verification

### End-to-end

- `pnpm nx run server:typecheck,test,lint --skip-nx-cache` GREEN，e2e 5/5 Playwright pass
- `pnpm nx graph` 出 dependency graph，肉眼或 programmatic 验单向 `auth → account → security`，无环
- O1 / O2 / O3 / O4 各自 verify 步骤 GREEN

### Critical assertions

1. **Cross-module wiring regression**：再次跑 PR #79 同款 smoke（401 ProblemDetail + traceId + x-trace-id header；400 FORM_VALIDATION），3 项断言全绿
2. **Module 边界 ESLint**：手工尝试 `security → account` 反向 import → eslint fail；`account → auth` 反向 → fail
3. **O4 ADR-0041 ship 后**：`security/` 内成员 count ≤ sunset trigger 阈值

## Cross-reference

- 原 plan：[05-21-review-tech-stack-post-a002.md](05-21-review-tech-stack-post-a002.md) 的 PR-4 段已 banner 指向本 plan
- 收口子 plan：[05-22-pr5-tail-orval-stabilize.md](05-22-pr5-tail-orval-stabilize.md) baseline 并入本 plan，原文件作 historical trace
- 关联 ADR：0032（bounded context）· 0033（outbox）· 0034（operation catalog）· 0036（observability）· 0038（error contract）· **0041（待立, src/common/ policy）**
- 关联 convention：[business-naming.md](../../conventions/business-naming.md) module 命名 SSOT
