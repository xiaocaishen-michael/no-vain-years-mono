# Phase 4 Sub-Plan — sdd.md path-trigger split

> **Scratch 路径**：`docs/plans/enchanted-skipping-raven.md`；ship 时 `git mv` 到 `docs/plans/2026-05/05-23-sdd-path-trigger-split.md`。

## Context

3-phase claude-config-meta-to-mono migration（#118-#137）全 ship 后，**B 组终局验收**留下 1 项 known tech debt：sdd.md 单文件 2737t > 1500 per-file 红线（always-load budget guideline）。

B3 段级深挖识别 2 强 path-trigger 拆分 candidates，原计划留 Phase 4 独立 plan。本 sub-plan 落地这 2 拆分：

| 段 | 当前 LOC / token | 拆分目标 |
|---|---|---|
| `§ server impl 后 mobile types 同步` (L109-119) | 12L / ~80t | **merge into** `.claude/rules/api-contract-trigger.md`（Sub-PR 2.1 现有 rule，path-trigger 已配 server endpoint/DTO/openapi 等同路径，rule body invariant 2 已 cross-ref 此段）|
| `§ /implement 闭环 6 步` (L87-107) | 22L / ~165t | **新建** `.claude/rules/implement-task-closure.md`（path: `specs/*/tasks.md` + impl 文件，编辑 tasks.md 或 impl ts 时自动加载）|

**总收益**：always-load total 4304t → **~4059t**（-245t / -5.7%，5000 budget 81% util）；sdd.md 2737t → **~2492t**（仍 > 1500 单文件红线但显著减少；剩余内容 = SDD 工作流核心 invariant，always-load 价值最高，不再拆）。

## Goal

应用 master plan 5 类淘汰 + 「能机械执行的规则优先放 Hook/CI」原则（per memory `feedback_hook_before_claude_md`），把 sdd.md 中触发可路径化的 2 段（path-able + 与既有强制层 lefthook tasks-md-drift / nx affected --target=generate 配套）移到 `.claude/rules/` path-trigger，always-load 释放 245t 预算 + sdd.md 单文件回归 always-load 主要 invariant 内容。

## Sub-PR 拆分

| Sub-PR | Scope | Branch | LOC est | 依赖 |
|---|---|---|---|---|
| **4.1** | `§ server impl mobile types 同步` 段 merge 进 `.claude/rules/api-contract-trigger.md`；sdd.md 留 1 行 cross-ref | `docs/sdd-mobile-types-merge-api-contract` | sdd.md -11 / api-contract-trigger +12 | 无 |
| **4.2** | `§ /implement 闭环 6 步` 段新建 `.claude/rules/implement-task-closure.md` (path: specs/*/tasks.md + impl files)；sdd.md 留 1 行 cross-ref | `docs/implement-closure-path-rule` | sdd.md -21 / 新建 rule ~25L | 无 |

**4.1 / 4.2 互不依赖可并行**（sdd.md 不同段 + 不同 .claude/rules/ 目标文件）。

每个 sub-PR 同 commit amend 本 sub-plan 的 Sub-PR 表（per Sub-PR 1.3-1.7 / 2.x / 3.x 模式）。

## Per-sub-PR 执行细节

### Sub-PR 4.1 — sdd.md § mobile types 同步 → api-contract-trigger.md

- **改 `docs/conventions/sdd.md`** L109-119 整段（12L）→ 删除，替换为 1 行：

  ```markdown
  ## server impl 后的 mobile types 同步

  → `.claude/rules/api-contract-trigger.md` § Nx target 依赖链（path-trigger 自动加载，详细 server → api-client → mobile 同步链 + `pnpm nx affected --target=generate` 命令）
  ```

- **改 `.claude/rules/api-contract-trigger.md`**（现 18L → ~30L）— 在 § 单源真理 之后新增 § Nx target 依赖链 段：

  ```markdown
  ## Nx target 依赖链（server → api-client → mobile）

  mono 内 server → api-client → mobile 走 **Nx target 依赖链**（不装 `api-types-sync` preset，per W2.0 决策）：

  1. `apps/server` `@nestjs/swagger` 装饰器 → `nx run server:export-openapi` 启临时实例 curl `/docs-json` → 写 `apps/server/openapi.json`
  2. `packages/api-client` `nx run api-client:generate` 依赖 server openapi.json，跑 `openapi-typescript` 生成 TS client
  3. `apps/mobile` 依赖 `packages/api-client`，`nx affected` 改 server endpoint 自动传导触发 api-client regen + mobile rebuild

  **PR 边界**：mono 单仓内 server impl + api-client regen + mobile 消费**可同 PR**（跨仓 PR 拆分概念 meta 时代专属，mono 不适用）；commit message `chore(api-client): sync types — <feature-slug>` 或并入主 PR commit message 备注 types 已 regen。
  ```

  - 既有 invariant 2 「server endpoint / DTO 改后必跑 `pnpm nx affected --target=generate`」**保留不变**（与新段互补：invariant = 简版 strong rule；新段 = 详版 mechanism）

### Sub-PR 4.2 — sdd.md § /implement 闭环 → 新建 implement-task-closure.md

- **改 `docs/conventions/sdd.md`** L87-107 整段（22L）→ 删除，替换为 1 行：

  ```markdown
  ## /implement 每 task 闭环 6 步（强制）

  → `.claude/rules/implement-task-closure.md`（path-trigger 自动加载，详细 TDD 6 步 + tasks.md `[X]` flip + lefthook `tasks-md-drift` 强制层 + 历史 ✅ 标记兼容 + 常见反模式）
  ```

- **新建 `.claude/rules/implement-task-closure.md`**（~25L）:

  ```markdown
  ---
  paths:
    - 'specs/*/tasks.md'
    - 'apps/server/src/**/*.usecase.ts'
    - 'apps/server/src/**/*.controller.ts'
    - 'apps/mobile/src/**/*.tsx'
    - 'apps/mobile/src/**/*.ts'
  ---

  # /implement 每 task 闭环 6 步（path-triggered，改 tasks.md / impl 文件时自动加载）

  `/speckit-implement` 执行每个 task 时，**最后一步必须改 tasks.md**，与业务代码 + 测试同 commit：

  1. 红：写测试 → typecheck pass + 测试 RED
  2. 绿：写实现 → 测试 GREEN
  3. typecheck + lint pass
  4. **改 tasks.md**：把 task 行的 `- [ ] T<N> ...` 翻成 `- [X] T<N> ...`（spec-kit 原生 checkbox 体例）。**状态语义**：`- [ ]` = pending，`- [X]` = done
  5. `git add` impl + 测试 + tasks.md 同 stage
  6. 进 commit 流程

  **Per-task 节奏**：每 task 走完 6 步**直接 commit**，无需用户审批；§ phase 之间 `Review gate`（clarify → plan / plan → tasks / analyze → implement）是 phase-level 人工卡点，不在 implement 内 per-task 触发。

  **强制层**（双层兜底）：

  - prompt-time 软提醒：`task-closure` preset 通过 `after_implement` hook 触发 `/speckit-tasks-verify` slash command，扫近 2h commit 报告 `[X]` 状态与 impl 是否 drift（per [michael-speckit-presets](https://github.com/xiaocaishen-michael/michael-speckit-presets)）
  - commit-time 硬拦：mono 仓 lefthook `tasks-md-drift` 拒「commit 含 impl 代码但 tasks.md 未 staged」；`--no-verify` 仅限格式化 / typo / 紧急 hotfix 出口

  **常见反模式**：写完 impl 喊 /commit、事后再开 PR 改 tasks.md → 应 impl PR 内**同 commit** stage tasks.md `[X]`。

  **历史 `✅` 标记**：meta-repo 时代有 use case tasks.md 使用 `✅` emoji；mono 仓所有新 use case 一律走 `[X]`。lefthook `tasks-md-drift` 识别两种 marker。
  ```

  - frontmatter `paths:` 含 5 globs：specs/*/tasks.md（直接 task 标记触发）+ usecase/controller/tsx/ts 等 impl 文件（即 tasks-md-drift hook 触发 impl detection 同 glob，per lefthook.yml L107-110）

## 4 步流程（per sub-PR）

1. 跨仓 read meta 原文（本 sub-plan 不跨仓；纯 mono 内重组）
2. 决策 + 改 mono 正式文件（每段过 5 类淘汰 + 9 步 checklist + 4 killer questions；git diff 看改前 vs 改后）
3. **Post-edit 全文 self-audit**：完整文件 / 改动段过 4 killer questions
4. **🛑 人肉 review pause**：self-audit 报告 + diff summary 给 user

## Phase 4 验收

- ☐ Sub-PR 4.1 / 4.2 全 merged
- ☐ sdd.md token 实测 ≤ 2500t（pre-Phase-4 2737t → 目标 < 2500t；split ~245t 释放）
- ☐ always-load total 实测 ≤ 4100t（pre-Phase-4 4304t → 目标 < 4100t；headroom > 900t）
- ☐ markdownlint cli2 dry-run sdd.md + api-contract-trigger.md + implement-task-closure.md 全 0 error
- ☐ path-trigger glob 实证：touch `specs/001-phone-sms-auth/tasks.md` 验 implement-task-closure rule 加载（新 session）+ touch `apps/server/src/auth/web/account-sms-code.controller.ts` 验 api-contract-trigger rule 加载（新 session）
- ☐ B3 段级深挖重审 sdd.md：2 强 candidate 段消失后无 2 次升级 finding

## Sub-PR ship 顺序

```text
Sub-PR 4.1 / 4.2 任意顺序，可并行（sdd.md 不同段 + 不同 rules 目标文件）
  ↓ all 2 merged
Phase 4 全 done → sdd.md 回归 always-load 主要 invariant 内容 (~2492t) + always-load total ~4059t
```

## Out of Scope（Phase 4 不做）

- ❌ sdd.md `§ spec.md frontmatter` H3 拆分（17L 小段，always-load 价值高 — 写 spec.md 时 frontmatter 强制）
- ❌ sdd.md `§ 前端 UI 工作流变体` 拆分（设计决策导向，不限于 impl path edit）
- ❌ sdd.md `§ 类 1 占位 UI 4 边界` / `§ Mockup 留迹路径` 拆分（同上，design phase decision）
- ❌ sdd.md 单文件回归 < 1500t（per master plan budget guideline，sdd.md 作为 SDD 核心 reference 接受 ~2500t 后稳态；real ROI 在 always-load total 释放）
- ❌ 整体行为层 sanity check（B4 留 user 主导新 session）

## Risk + Rollback

| 风险 | 缓解 |
|---|---|
| Sub-PR 4.2 implement-task-closure rule 在 commit 时不 fire（path-trigger 未匹配 commit-time 场景） | lefthook `tasks-md-drift` hook 是硬强制 (already shipped, ADR-0035/Phase 1 era)；rule body 是 edit-time 提醒，commit-time hard gate 已存在 |
| Sub-PR 4.1 后 sdd.md cross-ref 失效（无对应路径段） | 4.1 同 PR 验 sdd.md L109 cross-ref 落 `.claude/rules/api-contract-trigger.md` 实存 + markdownlint 0 error |
| api-contract-trigger.md 加 §「Nx target 依赖链」段后 > 50L 触发 claude-md-audit § 3.2 auto-trigger | 段长 ~10L (per draft) ≪ 50L 阈值；rule 总 LOC ~30L 仍小 |
| 新 implement-task-closure.md 5 paths globs 漏匹配 | path globs 来源 = lefthook.yml `tasks-md-drift` hook impl detection 同 glob (line 107-110 实证)，coverage 等价 |

## On Ship 备注

- **Sub-PR 4.1 ship 时**：含本 sub-plan `git mv` 到 `docs/plans/2026-05/05-23-sdd-path-trigger-split.md`
- **Sub-PR 4.2 ship 后**：Phase 4 全 done；建议 user 起新 Claude session 跑：(a) B4 行为层 sanity check (5 典型问题) (b) Phase 2 + Phase 4 path-trigger rule auto-load 验证（touch matching paths 观察 system-reminder 注入）

## Verification（本 sub-plan 自身）

- ☐ User 在 ExitPlanMode 批准
- ☐ Sub-PR 4.1 / 4.2 全 merge
- ☐ Phase 4 验收 5 项全过
- ☐ 本 sub-plan `git mv` 到 `docs/plans/2026-05/` 约定路径（随 Sub-PR 4.1 ship）
