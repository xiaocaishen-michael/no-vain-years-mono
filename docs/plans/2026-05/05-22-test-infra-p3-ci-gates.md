# Sub-plan 3: CI/CD 与门禁大合围（门禁层 / PR-T3）

> 主 plan「门禁层」阶段详细设计。本 sub-plan 由主 plan §跨阶段决策 + user 2026-05-22 PR-T3 4-step blueprint commit。**不变更**主 plan 跨阶段契约。

## Context

机制层 (PR #80) + 策略层 (PR #81) 已 merged。`nx run server:runtime-smoke` + `nx run mobile:runtime-smoke` 本地稳定跑通，`api-client → server` implicit dep 让 1 行 server 改动可牵连 `[server, api-client, mobile]` 3 projects 的 cascade chain 已 wired。但当前还没人**强制**这套 infra 的使用 — PR 作者可以装聋作哑、merge auto-pass、CI 完全不调 runtime-smoke。

本 PR-T3 把所有物理基础设施**浇筑成水泥门禁**：

1. **本地 commit 阶段** — lefthook anti-mock 正则拦 `new (Guard|Filter|...)`  不带 `createTestingModule` 的伪测试
2. **PR 阶段 — CI 主防线** — `.github/workflows/pr-validation.yml` 跑 `nx affected -t lint typecheck test build runtime-smoke --base=origin/main` + PR body 强制 checkbox 扫描
3. **夜间 — 兜底扫雷** — `.github/workflows/nightly-sweep.yml` 跑 `nx run-many --all --skip-nx-cache`，捕 cache 假绿；失败自动 `gh issue create`
4. **branch ruleset 终态** — 删旧 server-only 3 checks（build/test/lint），加 `validate-and-test` 综合 check
5. **PR template + state_branches** — 文档契约 + spec.zod 字段 optional → required + spec 001/002 backfill
6. **ADR-0040 终态** — amend Proposed → Accepted（含三阶段 ship 证据）

## 4 处架构裁决（user blueprint 锁定）

| # | 裁决 | 落点 |
|---|---|---|
| 1 | PR template 强制 3 checkbox 在 `### 🚨 部署与存活前置确认` 区域（runtime-smoke local pass / 禁过度 mock / state_branches 100% 覆盖）| `.github/pull_request_template.md` 新建 |
| 2 | Lefthook `no-bad-mocks` pre-commit hook 扫 staged `*.{guard,interceptor,filter,pipe}.spec.ts` 含 `new XXX(` 但无 `createTestingModule` 拒提交 | `lefthook.yml` 新 hook |
| 3 | `.github/workflows/pr-validation.yml` 新 workflow — checkout/setup/install + checkbox scan via `actions/github-script@v7` + `nx affected -t lint typecheck test build runtime-smoke --base=origin/main` 单巨型 job | `.github/workflows/pr-validation.yml` 新建 |
| 4 | `.github/workflows/nightly-sweep.yml` cron 19:00 UTC + workflow_dispatch + `nx run-many --all --skip-nx-cache` + `gh issue create` on failure | `.github/workflows/nightly-sweep.yml` 新建 |

## 5 处 implementation 决策（master 锁定 + grep 实证）

### A. Lefthook anti-mock 正则**精确化**（避免误伤）

User blueprint 给的 `new [A-Za-z0-9_]+\(` 太宽 — 会撞 `new BadRequestException()` / `new Error()` / `new Date()` 等合法 exception/value 实例化。grep 现有 `problem-detail.filter.spec.ts` 实证：

| 行 | 代码 | 应否拦 |
|---|---|---|
| 40 | `new ProblemDetailFilter(mockCls)` | ✅ **拦** — Filter 直 `new` 是反模式 |
| 44 | `new BadRequestException('...')` | ❌ 不拦 — Exception 是 value |
| 58 | `new UnauthorizedException('...')` | ❌ 不拦 |
| 65 | `new HttpException({...}, 429)` | ❌ 不拦 |
| 72 | `new Error('...')` | ❌ 不拦 |

**收紧正则**：`new\s+\w+(Guard|Interceptor|Filter|Pipe|Repository)\b\s*\(`
- 仅命中以 NestJS lifecycle 后缀结尾的 class instantiation
- File 扩展含 `repository.spec.ts`（user blueprint 列了 Repository 但 file glob 漏，补上）

**预期生效**：`problem-detail.filter.spec.ts` 现含 L40 violation → lefthook 阻**未来对此文件的 commit**。Out of scope: 不在 PR-T3 内 rewrite 该 spec（lefthook 是 commit-time gate，既有 committed 文件不强制追溯；下次 author 修该 spec 时被迫用 `createTestingModule`）。

### B. CI workflow 拓扑：**replace 旧 ci.yml 3 jobs 用 pr-validation.yml 综合 job**

| 旧 ci.yml job | 处置 |
|---|---|
| gitleaks | 保留（commit history 全扫，非 nx affected 范畴） |
| actionlint | 保留（GH workflow YAML 校验） |
| pr-title (conventional commits) | 保留（PR 元数据校验） |
| Build (nx build server) | **删** — 被 pr-validation.yml 的 nx affected -t build 取代 |
| Test (nx test server) | **删** — 被 pr-validation.yml 的 nx affected -t test 取代 |
| Lint (nx lint server) | **删** — 被 pr-validation.yml 的 nx affected -t lint 取代 |
| docker-image (Trivy) | 保留（push-to-main 才触发，PR 不影响） |

结果：ci.yml 从 6 job + 1 conditional 减到 3 job + 1 conditional；pr-validation.yml 加 1 综合 job。PR 上的 required checks 净增减 = `+validate-and-test, -Build, -Test, -Lint` = 净减 2 个 required check（合理 — nx affected 综合 job 覆盖三者）。

### C. pnpm version 校准

User blueprint 写 `version: 9`（"根据你实际使用的 pnpm 版本调整"）。mono 实际 pnpm 10.33.2 (per memory `reference_pnpm10_pnpm_deploy_for_nx_docker`)。pr-validation.yml + nightly-sweep.yml 改成 `version: 10`。

### D. branch ruleset 更新（gh api）

PR-T3 ship 时（commit 后、merge 前）跑 `gh api PUT` 更新 ruleset `main-protection` (id: 16500378) 的 `required_status_checks.required_status_checks[]`：
- 添加 `{context: "validate-and-test"}` (新)
- 删除 `Build (nx build server)` / `Test (nx test server)` / `Lint (nx lint server)` 3 个

**注**：ruleset 改动需手动 gh api 调用 — PR 本身改的是 yml 文件 + 元数据；GitHub ruleset 不通过 PR 走，需 PR-T3 commit 后**额外 gh api PUT**。Plan 含命令模板。

### E. state_branches optional → required + spec 001/002 backfill

`.specify/schemas/mono-orchestrator-ready/spec.zod.ts`：
- `state_branches: z.array(z.string().min(1)).optional()` → `state_branches: z.array(z.string().min(1)).min(1)`
- preset.yml version 0.2.2 → **0.3.0**（minor bump，schema 含 breaking）
- description 加 0.3.0 增量描述

spec 001/002 frontmatter backfill（基于 Explore agent 提议 + User Stories 实读）：

`specs/001-phone-sms-auth/spec.md`:
```yaml
state_branches:
  - "registered user: correct SMS code → token issued, last_login_at updated"
  - "unregistered user: correct SMS code → account auto-created ACTIVE, token issued"
  - "any user: FROZEN/ANONYMIZED account with correct code → 401 INVALID_CREDENTIALS, byte-identical to code-error"
  - "any user: SMS code expired (>5min) → 401 INVALID_CREDENTIALS"
  - "concurrent phone-sms-auth requests same unregistered number → single Account created (idempotent)"
```

`specs/002-account-profile/spec.md`:
```yaml
state_branches:
  - "new user auto-created: GET /me → displayName=null, phone present (onboarding trigger state)"
  - "new user onboarding: PATCH /me {displayName} → 200, persisted, subsequent GET /me returns same"
  - "existing user with displayName set: GET /me → displayName returns stored value, no onboarding"
  - "invalid/expired JWT: GET /me or PATCH /me → 401 (boundary, no enumeration leak)"
```

## 10 项交付清单（PR-T3 全量）

| # | 项 | 落点 |
|---|---|---|
| A | `.github/pull_request_template.md` 新建（user blueprint 全文 + 3 checkbox） | `.github/pull_request_template.md` |
| B | `lefthook.yml` 加 `no-bad-mocks` pre-commit hook（**narrow regex**: `new\s+\w+(Guard\|Interceptor\|Filter\|Pipe\|Repository)\b\s*\(`） | `lefthook.yml` |
| C | `.github/workflows/pr-validation.yml` 新建（checkbox scan + nx affected mega-job, pnpm@10） | `.github/workflows/pr-validation.yml` |
| D | `.github/workflows/nightly-sweep.yml` 新建（cron + run-many --skip-nx-cache + gh issue create） | `.github/workflows/nightly-sweep.yml` |
| E | `.github/workflows/ci.yml` 删 3 nx-server jobs (Build/Test/Lint)，保 Gitleaks + Actionlint + PR title + docker-image | `.github/workflows/ci.yml` |
| F | spec.zod state_branches optional → required + preset 0.2.2 → 0.3.0 + description 段补 0.3.0 增量 | `.specify/schemas/mono-orchestrator-ready/spec.zod.ts` + `.specify/presets/mono-orchestrator-ready/preset.yml` |
| G | spec 001 + spec 002 frontmatter backfill `state_branches:` 字段（5 + 4 entries） | `specs/001-phone-sms-auth/spec.md` + `specs/002-account-profile/spec.md` |
| H | ADR-0040 amend Proposed → Accepted（添加 3 阶段实际 ship 证据 + Sandbox 终局验收说明） | `docs/adr/0040-multi-layer-test-gate.md` |
| I | branch ruleset `main-protection` (id: 16500378) 更新 — 添加 `validate-and-test`，删 3 个 server-only required checks | `gh api PUT repos/.../rulesets/16500378`（PR 内提供命令脚本；merge 后人工跑） |
| J | scratch plan → `docs/plans/2026-05/05-22-test-infra-p3-ci-gates.md` | git mv |

## Verification（local 裸跑 evidence，PR ready 前全通）

1. ☐ `pnpm tsx scripts/check-spec-frontmatters.ts` — 2 specs GREEN（含新 state_branches 字段 + schema 已转 required）
2. ☐ `pnpm tsx scripts/check-adr-frontmatters.ts` — 22 ADRs GREEN（含 ADR-0040 amend）
3. ☐ `pnpm exec nx run-many --target=typecheck,test,lint --all --skip-nx-cache` — 5 projects GREEN（基线 sanity）
4. ☐ Lefthook 实证 — 在临时 `apps/server/src/__smoke__/lefthook-test.guard.spec.ts` 写 `new SomeGuard()` 不带 `createTestingModule` → `git add` + `git commit` → **必须红 + 拒绝提交**（含错误消息） → `git restore`
5. ☐ Lefthook negative case — 删 file，确认其他 commit 通过（无误伤）
6. ☐ `.github/workflows/pr-validation.yml` + `nightly-sweep.yml` 跑 `pnpm exec actionlint` 单独验 yml 语法
7. ☐ PR body 模拟：本 PR-T3 自身 PR body 含 3 checkbox 全勾（dogfooding — 自己的 PR 自己用门禁验）

## STOP criteria（任一红即 STOP，不绕过）

- Lefthook anti-mock regex 误伤现有任何 commit-able file（除已知 `problem-detail.filter.spec.ts`）— 调整正则窄度
- spec.zod required 校验撞既有 spec 001/002 — 说明 backfill 未做完，回退
- pr-validation.yml `nx affected` 在某临时 PR 跑挂 — 说明 `--base=origin/main` 拉不到 / depth 不够
- ADR-0040 amend 后 `adr-frontmatter-check` 红 — status enum 错（应是 Accepted 不是 accepted）

## Out of Scope（defer / follow-up）

- **不**在 PR-T3 内 rewrite `problem-detail.filter.spec.ts`（用户未要求；既有 committed 文件不追溯）— 下次 author 修该 spec 时 lefthook 自动逼迫遵守
- **不**在 PR-T3 内 重写其他 spec to createTestingModule pattern — 同上原则
- upstream `michael-speckit-presets` 同步 → PR-T1 留的 follow-up issue
- mobile-only e2e `playwright.config.ts` (dev server 路径) 不动 — sub-plan 1/2 已锁定保留作本地 DevX

## Risk + Rollback

| 风险 | 缓解 |
|---|---|
| Lefthook 正则误伤合法 use case | A 节 narrow regex + grep 现有 specs 实证；STOP criteria 1 |
| PR body checkbox 扫描 regex 撞到 unrelated `- [ ]`（如 test plan 段） | C 节 actions/github-script 正则严格限定 `### 🚨 部署与存活前置确认` 段抽取，不全文扫 |
| `nx affected --base=origin/main` 在某 fork 场景失效 | pr-validation.yml `fetch-depth: 0`（user blueprint 含）确保全量历史可达 |
| nightly cron 19:00 UTC 撞已有 cron / SLA 时段 | workflow_dispatch 同时支持手动；cron 误触 fallback `gh workflow run` 重跑 |
| Ruleset gh api 更新失败（权限不足） | I 节命令脚本含 fallback：手动 GitHub UI 编辑 ruleset |
| state_branches required 后 future spec 漏字段 | F 节 schema 强校验已是机制；lefthook spec-frontmatter-check 同样拦 commit |
| nightly-sweep `gh issue create` 频繁触发 spam | 失败时仅一条 issue（无重复抑制）— 接受短期 noise，后续 PR-T4 引入去重 |
| ADR-0040 amend "Accepted" 状态触发 schema 校验失败 | adr.zod AdrStatusEnum 含 "Accepted" — 已验过 |

## 执行步骤建议顺序（PR-T3 内）

1. **本地基础设施第一波**（10 min）：PR template + lefthook anti-mock hook + lefthook 实证测试（验证拦 / 不误伤）
2. **CI workflow 重塑**（10 min）：ci.yml 删 3 jobs + pr-validation.yml 新建 + nightly-sweep.yml 新建 + `actionlint` 验 yml 语法
3. **spec-kit governance 升级**（10 min）：spec.zod required + preset 0.3.0 + spec 001/002 backfill + `check-spec-frontmatters` GREEN
4. **ADR-0040 amend**（5 min）：Proposed → Accepted + 加 3 阶段 ship 证据段
5. **scratch plan git mv**（2 min）：→ `docs/plans/2026-05/05-22-test-infra-p3-ci-gates.md`
6. **全包 cascade verify**（5 min）：`nx run-many --target=typecheck,test,lint --all --skip-nx-cache` GREEN
7. **commit + push + PR + 自我 dogfooding 验证**（10 min）：PR-T3 自己的 PR body 含 3 checkbox + 跑通新 pr-validation.yml workflow
8. **ruleset 手工 gh api PUT**（merge 后 5 min）：删 3 旧 checks + 加 `validate-and-test` + 验 `gh api ... rulesets/16500378`

总 estimated time：~50 min 主线 + ~15 min buffer / dogfooding。
