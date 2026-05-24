# Plan: orchestrator PoC — A-002 first business migration + 临时 skill 次级目标

> Sub-plan of [2026-05/05-19-plan2-plan3-migration-deploy.md](./2026-05/05-19-plan2-plan3-migration-deploy.md)。
> 状态：**待 user 答 § 7 Q4/Q5/Q6 后定稿**，再启 § 3.1。
> ⚠️ **[HISTORICAL — 布局已变 (2026-05-24)]**：本文 `apps/server/src/modules/account/...` 及 `use-cases/` 子结构反映当时认知；server 实际为**扁平** `apps/server/src/<module>/`（无 `modules/` 包装、无 layer 子目录，per [ADR-0043](../../adr/0043-server-flat-module-paradigm.md)）。

## 1. Context

**为什么现在做**：

- 2026-05-20 完成 orchestrator 工具链全链路 ship（PR #37/#38/#41-#49）+ live-smoke 5 类盲区已修复并沉淀 memory（[`feedback_orchestrator_llm_cwd_must_match_target_paths.md`](../../../../.claude/projects/-Users-butterfly-Documents-projects-no-vain-years-mono/memory/feedback_orchestrator_llm_cwd_must_match_target_paths.md)）。
- 工具链已经实装 spec / plan / tasks 的 Zod schemas（`scripts/orchestrator/schemas/spec.ts` 含 `SpecFrontmatterSchema` + `UsMetaSchema` + `FrMetaSchema` + `ClMetaSchema` + `EntitySchema`），但还没经过真业务 use case 实战验证。
- 母 plan [`2026-05/05-19-plan2-plan3-migration-deploy.md`](./2026-05/05-19-plan2-plan3-migration-deploy.md) § 2.2.5 / § 2.4.1 / § 2.4 仍按 2026-05-19 amend v2 写「orchestrator 数据驱动后写」，叙事 stale（PoC 收尾后回写 v3）。

**User 核心意图**（2026-05-20 给定）：

1. **主目标**：借助 A-002 业务迁移 PoC 验证 orchestrator + spec 重写 + 临时 skill 三合一工具链。
2. **次级目标**：PoC 成功后**抽出临时 skill**（`/migrate-use-case <id>` 或类似），剩余 15 个 use case 借 skill 批量迁移。

**Intended outcome**：

- A-002 server + mobile 同 PR auto-merge 合入 main（D3 v2 全栈走通 + server e2e + mobile UI 前端自动化测试 + 截图）。
- PoC 收尾后产出 1 个临时 skill 草稿 + 母 plan v3 amend + halt-log retro 报告。

## 2. 决策固化（已锁，2026-05-20）

| # | 决策 | 选项 | 来源 |
|---|---|---|---|
| D1 | PoC 首发 use case | **A-002** `GetAccountProfile + UpdateDisplayName` | § 7 Q1 (history) |
| D2 | orchestrator 介入时机 | **跳 manual 2a baseline，/speckit-implement 直接由 orchestrator 接管** | § 7 Q2 (history) |
| D3 | PoC done 信号 | ① PR auto-merge + nx affected 全绿 ② server-side E2E（Vitest + Testcontainers）通过 ③ **mobile UI 前端自动化测试通过 + 测试运行时截图附 PR**（2026-05-20 user push back v2 升级） ④ **E2E 框架 = Playwright + Expo Web**（D12） | user 2026-05-20 amend |
| D4 | mobile bootstrap scope | **PoC 含 mobile bootstrap（同 PR）+ 「分级重写」原则**（user 2026-05-20 amend v2，精细化「激进重写」per 母 plan § 2.1 line 26 + § 2.6 line 155-160）：① `apps/mobile/` Expo workspace init ② **5 packages 命名保留，重写策略分级**：`@nvy/auth`（zustand v5 + secure-store + token refresh 业务流**代码重写**适配新 NestJS API）/ `@nvy/design-tokens`（Tailwind 配色**直搬不重写**，**禁止用 claude-design 重新设计 token**）/ `@nvy/ui`（NativeWind v4 + Tailwind 组件**尽量重用原 app**，必要时改造，**不为重写而重写**）/ `@nvy/types`（D11 `@prisma/client` 直 export）/ `@nvy/api-client`（@hey-api/openapi-ts regenerate） ③ **路由结构沿用** 旧 Expo Router（per 旧 app inventory），hooks / 状态管理重写（适配 zustand v5 + 新 API），组件层尽量复用 ④ profile screen 实装 + 单元测试 | § 2.6 mobile per-feature + user 2026-05-20 amend v2 |
| D5 | 母 plan amend 时点 | **PoC 完成时同步 amend 母 plan v3（绑入 D10 retro PR，防止 drift）**（user 2026-05-20 amend v2，收紧旧 Q5=a "PoC 后回写"）：A-002 PoC 主 PR merge 后立即开 1 个 retro PR，同时含 ① 母 plan § 2.2.5 / § 2.4.1 / § 2.4 amend v3（写「orchestrator 工具链 2026-05-20 已 ship，A-002 起首发实战 PoC，halt-log 实际数据」） ② D10 临时 skill 草稿。**两件事强制同 PR**，不允许 amend 滞后超过 retro PR 时点 | user 2026-05-20 amend v2 |
| **D6** | spec 重写规范 | **使用 user 2026-05-20 提供的 system prompt**（"AST-Driven Markdown Generator"）把旧 spec 重写为新 spec.md，**保证业务逻辑不变**，落到 `specs/002-account-profile/spec.md`，通过 `scripts/orchestrator/schemas/spec.ts` 已实装的 Zod schema 校验 | user 2026-05-20 message |
| **D7** | 临时 skill 次级目标 | PoC 完成后抽 `/migrate-use-case` skill（或类似名），位于 mono root `.claude/skills/<name>/SKILL.md`；**非 PoC done 门槛**，PoC retro 阶段产出 | user 2026-05-20 message |
| **D8** | spec 重写执行宿主 | **Sub-agent 隔离执行**（§ 7 Q4 锁定）：派一个 general-purpose Agent（带写权限）读双源旧 spec + 用 D6 prompt 重写 → 产出 `specs/002-account-profile/spec.md` + 摘要回报。主 context 干净，且 sub-agent 调用形态与 D7 skill 化对齐（skill 封装这次 sub-agent prompt） | § 7 Q4 |
| **D9** | clarify / analyze 步骤 | **clarify 跳 + analyze 走**（§ 7 Q5 锁定）：信任新 spec 的 CL 段已含原 clarification（D6 strict rule 保证），但走 `/speckit-analyze` 做跨 spec/plan/tasks 一致性扫描 | § 7 Q5 |
| **D10** | D7 skill 实施时点 | **PoC 后单独 PR**（§ 7 Q6 锁定）：PoC PR 合入 main 后写 retro 报告 + skill 草稿同 1 个 PR；保护 PoC 主路径纯度 | § 7 Q6 |
| **D11** | `@nvy/types` 派生方案 | **`@prisma/client` 直 export**（§ 7 Q7 锁定）：`packages/types/index.ts` re-export Prisma 生成的 type（Account / DisplayName 等）。无 codegen 依赖，PoC 风险最低；A-002 不需要 runtime Zod 故方案足够 | § 7 Q7 |
| **D12** | mobile UI E2E 框架 | **Playwright + Expo Web**（§ 7 Q8 锁定）：A-002 PoC 通过 `apps/mobile/playwright.config.ts` 跑 GetProfile + UpdateDisplayName 端到端路径；`page.screenshot()` 自动截屏附 PR；`@nvy/auth` secure-store 在 web 走 fallback（localStorage 或 mock）。后续 native-only use case 再加 Detox/Maestro | § 7 Q8 |

## 3. PoC 流程（4 步迁移思路）

### 3.0 隐含前提：mobile bootstrap（2026-05-20 fact-checked）

**当前仓状态**：`apps/` 只有 `server/`，**没有 `apps/mobile/`**；`packages/` 只有 `api-client/`。母 plan § 2.6 line 152-154 规定「每个 NNN-<slug> feature 同 PR 包 server + mobile」+ § 2.1 line 26 line 「激进重写」原则，意味着 A-002 隐含承担：

**5 packages bootstrap（命名保留 + 内部重写，per D4）**：

| package | 命名 | 内部实现来源 / 决策 | 备注 |
|---|---|---|---|
| `packages/auth/` | `@nvy/auth` | zustand v5 + secure-store + token refresh 业务流；**代码重写**适配新 NestJS API | A-002 不直接依赖；mobile bootstrap 一并初始化 |
| `packages/ui/` | `@nvy/ui` | NativeWind v4 + Tailwind 组件；**尽量重用原 app**，必要时改造，**不为重写而重写** | A-002 profile screen 用到 |
| `packages/design-tokens/` | `@nvy/design-tokens` | Tailwind 配色；**直搬不重写**，**禁止用 claude-design 重新设计 token** | `@nvy/ui` 依赖 |
| `packages/types/` | `@nvy/types` | **`@prisma/client` 直 export**（D11） | A-002 Account / DisplayName 类型 |
| `packages/api-client/` | `@nvy/api-client` | @hey-api/openapi-ts，已有 | A-002 GetProfile/UpdateDisplayName client |

**`apps/mobile/` bootstrap**：
- Expo workspace init + Nx project.json + tsconfig + metro 等
- **路由结构沿用** 旧 Expo Router（per 旧 app inventory），目录骨架迁入但 hooks / components / 状态管理代码全重写
- A-002 profile screen 落到 `apps/mobile/src/features/account/profile/`

**双源 spec 已确认存在**（§ 3.1 输入源）：
- server-side：`/Users/butterfly/Documents/projects/no-vain-years/specs/account/profile/spec.md`
- app-side：`/Users/butterfly/Documents/projects/no-vain-years/no-vain-years-app/apps/native/specs/account/profile/`

**体量估算**：~7-10 day（5 packages bootstrap 各 0.5-1 day + apps/mobile init + A-002 实装 + e2e）。比单纯一个 feature 多 5-7 day。

### 3.1 Step 1：spec 重写（旧 → 新 AST-Driven 格式）

**3.1.1 旧 spec inventory**

- 读 server-side spec：`/Users/butterfly/Documents/projects/no-vain-years/specs/account/profile/spec.md`
- 读 app-side spec：`/Users/butterfly/Documents/projects/no-vain-years/no-vain-years-app/apps/native/specs/account/profile/*` 全文件
- 识别 server FR-001 / FR-005 等 与 app FR-CL-001 之间的依赖（trace_us / trace_fr 单向树）

**3.1.2 重写**

按 user 2026-05-20 提供的 system prompt（"Expert System Architect & AST-Driven Markdown Generator"，含 3 strict rules + 7 目标结构节）输出新 `specs/002-account-profile/spec.md`：

| 节 | 输出 | 元数据 marker |
|---|---|---|
| 1 | YAML Frontmatter | `feature_id` / `modules` / `owners` / `status` / `created_at` / `updated_at` / `spec_kit_version` / `orchestrator_compat` |
| 2 | User Scenarios & Testing | 每个 User Story 下加 `<!-- us-meta: {...} -->` |
| 3 | Functional Requirements | 每个 FR 末尾加 `<!-- fr-meta: {...} -->` |
| 4 | Edge Cases | 自然语言括号 `(covers FR-XXX)`，无 marker |
| 5 | Key Entities | json entities fenced block |
| 6 | Success Criteria | 保留 `**SC-XXX:**` 锚点，无 marker |
| 7 | Clarifications | 每个 CL 下加 `<!-- cl-meta: {...} -->` |

**Strict rules**（违反即 PoC 失败）：
- ❌ NO Business Logic Changes（不改业务规则，只做格式升维 + 信息排布）
- ❌ HTML marker JSON 不合法（双引号闭合 / 数组完整）
- ❌ trace_us / trace_fr 单向依赖树错误

**3.1.3 Zod schema validate**

- 用 `scripts/orchestrator/schemas/spec.ts` 已实装的 Zod schema 校验：
  - `SpecFrontmatterSchema` validate YAML frontmatter
  - `UsMetaSchema` / `FrMetaSchema` / `ClMetaSchema` 逐条 validate HTML marker JSON
  - `EntitiesBlockSchema` validate json entities block
- **零错误通过**才允许进入 § 3.2。否则 retro spec 重写。

**Sub-agent 执行（D8 锁定）**：派 general-purpose Agent，prompt 含 user 2026-05-20 给的完整 system prompt + 双源 spec 路径 + 输出路径 + 要求 ≤ 400 字摘要回报（含字段对照表 + 关键合并决策 + Zod validate 结果）。Agent 不走 ExitPlanMode，直接 Write 产出 `specs/002-account-profile/spec.md`。

### 3.2 Step 2：spec-kit workflow 闭环

| # | 命令 | 是否走 | 备注 |
|---|---|---|---|
| 1 | `/speckit-specify` | **跳过** | spec.md 已由 § 3.1 产出 |
| 2 | `/speckit-clarify` | **跳过**（D9） | 信任新 spec CL 段已含原 clarification |
| 3 | `/speckit-plan` | **必走** | 产 `specs/002-account-profile/plan.md` |
| 4 | `/speckit-tasks` | **必走** | 产 `specs/002-account-profile/tasks.md` |
| 5 | `/speckit-analyze` | **必走**（D9） | 跨 spec/plan/tasks 一致性扫描 |

**Review gates**（人工审）：plan → tasks、analyze → implement（§ 3.3）。

### 3.3 Step 3：orchestrator 跑 implement

入口：`scripts/orchestrator/index.ts` 的 `pnpm orchestrate 002-account-profile --live`。

**Scope（D4 锁定，含 mobile bootstrap + 5 packages 激进重写）**：

- 后端 use case + handler + controller + Prisma schema + 单元测试 + integration/e2e 测试
- 前端 mobile bootstrap：`apps/mobile/` Expo workspace init + 路由结构骨架迁入（per § 3.0 inventory，代码重写）
- **5 packages 命名保留 + 分级重写**（per D4 v2）：`@nvy/auth`（重写业务流）/ `@nvy/ui`（尽量重用旧组件）/ `@nvy/design-tokens`（直搬不重写，禁止 claude-design）/ `@nvy/types`（@prisma/client 直 export，D11）/ `@nvy/api-client`（regenerate）
- `apps/mobile/src/features/account/profile/` profile screen 实装 + 单元测试 + 各依赖 package 实际 import 验证

**期望行为**：
- 读 `tasks.md`，按顺序起 Claude CLI 子进程跑每个 task
- 每个 task：TDD 红绿 → typecheck/lint pass → tasks.md `[X]` flip → git commit
- halt 时 append `.specify/implement-halts.log`

**人工监督**：先 `--dry-run` 看 plan，再 `--live`；用 `Monitor` 跟 stdout；halt 立即 TaskStop。

### 3.4 Step 4：E2E + 截图 review

- server-side E2E（Vitest + Testcontainers）automated：复用 `apps/server/test/integration/accounts.us*.e2e.spec.ts` pattern，写 A-002 两条 e2e（GetProfile + UpdateDisplayName）。
- **mobile UI 前端自动化测试**（D3 v2 升级）：用 § 7 Q8 选定的框架跑 GetProfile + UpdateDisplayName 端到端路径，测试运行时自动截屏（`page.screenshot()` / `takeScreenshot` 等原生 API），截图附 PR 描述。
- `gh pr create` + `gh pr merge --auto --squash --delete-branch`，`Monitor` 跟 CI / auto-merge 结果。

### 3.5 PoC retro + 临时 skill（D7 次级目标）

PoC 主 PR 合入 main 后立即开 **1 个 retro PR**（D5 + D10 强制同 PR，防止 drift），内容含：

1. **retro 报告**（`docs/experience/2026-MM-DD-a002-poc-retro.md`）：halt-log 分析 / orchestrator 5 类盲区是否回归 / spec 重写实际工作量 / mobile bootstrap 实际踩坑 / Playwright e2e setup 体感
2. **母 plan amend v3**（D5 强制）：改 `docs/plans/2026-05/05-19-plan2-plan3-migration-deploy.md` § 2.2.5 / § 2.4.1 / § 2.4 stale 叙事 → 「orchestrator 工具链 2026-05-20 已 ship，A-002 起首发实战 PoC，halt-log 实际数据 N 条」
3. **临时 skill 草稿**（D10 强制）：`.claude/skills/<name>/SKILL.md` 封装：
   - 旧 spec 路径定位
   - 重写 prompt（user 2026-05-20 AST-Driven 模板）
   - Zod schema validate 调用
   - spec-kit /plan /tasks /analyze 触发
   - orchestrator --live 调用
   - Playwright e2e + 截图 review

**Retro PR title**: `chore(repo): a002-poc retro + plan2-plan3 amend v3 + migrate-use-case skill draft`

## 4. Critical files

**read-only source（旧 spec 输入）**：
- `/Users/butterfly/Documents/projects/no-vain-years/specs/account/profile/spec.md` — server-side
- `/Users/butterfly/Documents/projects/no-vain-years/no-vain-years-app/apps/native/specs/account/profile/` — app-side
- `/Users/butterfly/Documents/projects/no-vain-years/no-vain-years-app/` — mobile 基础结构源（D4 mobile bootstrap 用）

**read-only（工具链，PoC 内不改）**：
- `scripts/orchestrator/index.ts` / `run-feature.ts` / `ralph-loop.ts` / `llm-client.ts`
- `scripts/orchestrator/schemas/spec.ts` / `plan.ts` / `tasks.ts` / `common.ts` — Zod schemas（§ 3.1.3 validate 用）
- `apps/server/src/modules/account/` — phone-sms-auth 既有结构
- `docs/conventions/sdd.md` / `business-naming.md` / `git-workflow.md`

**会被创建 / 编辑**：
- `specs/002-account-profile/spec.md`（§ 3.1.2 重写产出）
- `specs/002-account-profile/plan.md` / `tasks.md` / `analysis.md`（spec-kit 产物，§ 3.2）
- `apps/server/src/modules/account/use-cases/get-account-profile/*` + `update-display-name/*`（含 unit + e2e tests）
- `apps/mobile/`（**全新**，D4 bootstrap 产物 — Expo workspace + 路由骨架 + features/account/profile）
- `packages/auth/`（**全新**，命名保留代码重写）
- `packages/ui/`（**全新**，命名保留代码重写）
- `packages/design-tokens/`（**全新**，命名保留代码重写）
- `packages/types/`（**全新**，`@prisma/client` 直 export，D11）
- `packages/api-client/`（已有，openapi-ts regenerate）
- `apps/server/openapi.json`
- `.claude/skills/<migrate-use-case-name>/SKILL.md`（D7 skill 草稿，PoC retro 后）

**预期 lingering items（PoC 结束后清理）**：
- 本地 `chore/orch-live-smoke` 分支可 `git branch -D`
- 母 plan `2026-05/05-19-plan2-plan3-migration-deploy.md` § 2.2.5 / § 2.4.1 amend v3

## 5. Verification

```bash
# 1. § 3.1.3 spec Zod validate（PoC 第一关）
pnpm -C /Users/butterfly/Documents/projects/no-vain-years-mono tsx scripts/orchestrator/validate-spec.ts specs/002-account-profile/spec.md
# 期望：exit 0，schema 错误 = 0
# 注：validate-spec.ts 入口若不存在，PoC § 3.1 期间补一个 50-line wrapper 调用 schemas/spec.ts 既有 schema

# 2. PR 状态
gh pr list --repo xiaocaishen-michael/no-vain-years-mono --state merged --search "002-account-profile"

# 3. tasks.md 全 [X]
grep -E "^\- \[ \]" specs/002-account-profile/tasks.md
# 期望：empty

# 4. nx affected 全绿
pnpm nx affected --target=test,lint,build,typecheck --base=main~1 --head=main

# 5. main 上看到 002 代码
git log --oneline main | head -5 | grep -E "(002|account|profile)"

# 6. [D3 ②] server-side E2E 通过
pnpm -C apps/server vitest run test/integration/accounts.us*-002*.e2e.spec.ts

# 7. [D3 ③ v2 / D12] mobile UI 前端自动化测试 = Playwright + Expo Web
pnpm -C /Users/butterfly/Documents/projects/no-vain-years-mono/apps/mobile playwright test
# 期望：GetProfile + UpdateDisplayName 端到端路径通过；page.screenshot() 自动截屏到 apps/mobile/playwright-report/screenshots/，附 PR 描述
```

**Instrumentation（必采，retro 用）**：

```bash
cat .specify/implement-halts.log 2>/dev/null
grep -iE "(is_error|cwd mismatch|verify empty|CLAUDECODE|--bare)" .specify/implement-halts.log 2>/dev/null
```

## 6. PoC 风险 + 回退

| 风险 | 信号 | 回退动作 |
|---|---|---|
| spec 重写违反 "NO Business Logic Changes" | PR review / e2e 行为 drift | retro spec 重写（§ 3.1.2），用 diff 工具比新旧 spec User Stories / FRs 全文 |
| HTML marker JSON 不合法 | § 3.1.3 Zod validate 报错 | retro 重写当前节 marker；Zod 错误信息精确指 line/字段 |
| trace_us / trace_fr 依赖树错 | Zod refine fail 或 manual review | 重新跑 § 3.1.1 inventory + 重画依赖图 |
| orchestrator halt 反复触发同形态 ≥ 3 次 | halt-log grep | TaskStop + 手动接管剩余 task + fix PR |
| 5 类已知 LLM-subprocess 盲区任一回归 | live smoke stdout 出现 known pattern | 直接 fix orchestrator 开 PR（per #48/#49 先例） |
| spec drift（实装与 spec.md 不一致） | analyze 阶段 / PR review | 手动 amend spec.md + 重跑该 task |
| PR CI 持续红 + auto-merge 不触发 | gh pr checks 红 | Monitor + 手动 debug |
| mobile bootstrap 工作量超 PoC scope | A-002 PR ≥ 7 day | 监控；考虑拆 PR（D4 提前回写） |
| api-client @hey-api 与 RN runtime 不兼容 | mobile import api-client 报 RN runtime error | 升 SDK 56 或回退 @openapitools 临时方案 |
| 临时 skill 抽不出（PoC 流程 ad-hoc 太多无法封装） | retro 阶段发现重写 prompt 高度 use-case 特定 | D7 降级为「记录 retro 即可，skill 化推迟 003」 |
| **5 packages bootstrap 工作量分配不均** | `@nvy/ui` 组件改造远超估算（D4 v2 "尽量重用" 边界踩坑） | A-002 PR 内只 bootstrap "够用"（最小可跑通 profile screen 的组件 + 配色），剩余组件留 003+ 增量 |
| **orchestrator / sub-agent 自动重写 design-tokens** | sub-agent 默认习惯重写组件，可能违反 D4 v2 "design-tokens 直搬 / 禁止 claude-design 重新设计" | sub-agent prompt 中显式约束「保留旧 token 文件，不允许重新生成 / 重新 design」；PoC 期间专门 grep 检查是否新生成 design-tokens 文件 |
| **母 plan v3 amend drift**（user 2026-05-20 显式担忧） | PoC 主 PR 合入后忘记开 retro PR，母 plan § 2.2.5 / § 2.4.1 stale 叙事永久残留 | D5 v2 强制绑定 retro PR（与 D10 skill 同 PR）；主 PR description 加 "TODO retro PR: plan amend v3 + skill draft"；PR merge 后 24h 内必开 |
| **`@nvy/types` 派生方案选错** | § 7 Q7 选定后实操踩坑（如 prisma-nestjs-graphql GraphQL 包袱、手写 generator 不稳） | 回退 `@prisma/client` 直 export（最简方案）；A-002 不试错 ≥ 2 个方案 |

---

## 7. Decisions log

✅ **D1-D12 全锁** (2026-05-20)。详见 § 2 表格。

**Next action**：ExitPlanMode 启动 § 3.1.1 旧 spec inventory + § 3.0 5 packages bootstrap。

**Post-ExitPlan first actions（reminder）**：

1. Save memory `feedback_design_tokens_reuse_not_redesign.md`（type=feedback）：「design-tokens 直搬不重写 + UI 组件尽量重用 + 不用 claude-design 重新设计 token」—— 跨 use case 通用偏好，sub-agent / orchestrator prompt 必须显式约束。
2. 清理本地 `chore/orch-live-smoke` 分支（lingering items）。
3. Read 双源旧 spec 摸清体量，决定 sub-agent prompt 是否需要 chunked dispatch。
