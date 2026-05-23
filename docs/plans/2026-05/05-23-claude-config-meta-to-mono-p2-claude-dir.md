# Phase 2 Sub-Plan — `.claude/` 加载层 meta→mono 迁移

> **Scratch 路径**：`docs/plans/enchanted-skipping-raven.md`；ship 时 `git mv` 到 `docs/plans/2026-05/05-23-claude-config-meta-to-mono-p2-claude-dir.md`（per master plan § 跨阶段决策 表）。

## Context

Phase 1 完成 `CLAUDE.md` 内容层（5 sub-PR ship + 1 收尾 wiring + 1 drift fix + 1 orphan cleanup，1.1-1.7 + #125 + #126）。Phase 2 范围 = mono `.claude/` 加载层（rules / commands / skills / settings.json）从 meta 3 仓迁入。

应用 master plan § 迁移操作 4 步流程 + 5 类淘汰标准（含 Sub-PR 1.3 实证的「mono-already-superior」5th）+ master plan § Out of Scope（spec-symlink / speckit-git-_ skill / Docker DEFER plan3 等）。

## 候选 inventory + 决策表

### Source inventory（已 read）

| 仓 | rules | commands | skills | settings.json |
|---|---|---|---|---|
| meta root | `plan-lifecycle-rules` (42L) | `speckit-link-spec` (40L) | 14 speckit-_ | 4 Java allow |
| meta-server | `api-contract-rules` (23L) + `checkstyle-rationale` (48L) + `docker-rules` (51L) + `migration-rules` (72L) | `speckit-tasks-verify` (45L) + `speckit-trigger-sync-types` (108L) | 14 speckit-_ | (空，继承 meta) |
| meta-app | `api-contract-rules` (23L) + `nativewind-mapping` (103L, 在 .claude/ 根) | `speckit-tasks-verify` (45L) + `sync-api-types` (15L) | 14 speckit-_ | 0 allow (空) |
| **mono current** | `github-ruleset-sync` + `preset-modification` + `server-bounded-context-decision` (3) | `speckit-tasks-verify` (1) | 9 speckit-_ + `mono-worktree` (10) | 10 Bash allow + plansDirectory + nx marketplace |

### Rules 决策（path-triggered auto-load）

| # | Meta 来源 | LOC | 决策 | 理由 |
|---|---|---|---|---|
| R1 | `plan-lifecycle-rules` (meta root) | 42 | **DROP: mono-already-superior** | meta 体例 `YY-MM-DD-<adj>-<noun>.md` + `archive/YY-MM/` 归档；mono 用 `YYYY-MM/MM-DD-<kebab-slug>.md`（[docs-organization.md](../conventions/docs-organization.md)，已 always-load）+ **无归档生命周期概念**（plan 直接落月度子目录）；既 superior 又场景缺失 |
| R2 | `api-contract-rules` (server) | 23 | **MIGRATE TRANSLATED** → `.claude/rules/api-contract-trigger.md` | Path trigger 改 `apps/server/src/**/*.controller.ts` + `apps/server/openapi.json` + `packages/api-client/**`；body cross-ref [docs/conventions/api-contract.md](../conventions/api-contract.md)（sub-PR 1.5 ship）+ [ADR-0038](../adr/0038-error-handling-ux-contract.md)；约 15-20 行 |
| R3 | `api-contract-rules` (app) | 23 | **DROP**: duplicate of R2 | meta 三仓 mirror；mono 单仓 R2 一份足够 |
| R4 | `checkstyle-rationale` (server) | 48 | **DROP: stack-specific** | Java/Checkstyle/Spotless mono 不用 |
| R5 | `docker-rules` (server) | 51 | **DEFER Plan 3** | per master plan § Out of Scope "Docker / build-image / deploy（DEFER plan3）" |
| R6 | `migration-rules` (server) | 72 | **MIGRATE TRANSLATED** → `.claude/rules/migration-rules.md` | Path trigger `prisma/migrations/**/*.sql`；文件名约定换 Prisma `prisma/migrations/<timestamp>_<name>/`；**不可变 + expand-migrate-contract 三步法 + 跳步条件** 全 stack-agnostic 保留；约 50 行 |
| R7 | `nativewind-mapping` (app `.claude/` 根) | 103 | **MIGRATE TRANSLATED** → `.claude/rules/nativewind-mapping.md` | Path trigger `apps/mobile/src/**`；packages 引用换 `apps/mobile/src/{theme,ui}/`（per [ADR-0030](../adr/0030-package-decomposition.md) "5 包减 2" 已内联）；§1-8 强约束 + 推荐 + 反模式 + 升级路径全保留；删 `apps/web` 占位（mono 0 apps/web）；约 80-90 行 |

**Rules 净增 3 文件**（R2 / R6 / R7），全部 path-triggered（**不计入 always-load token budget**）。

### Commands 决策

| # | Meta 来源 | LOC | 决策 | 理由 |
|---|---|---|---|---|
| C1 | `speckit-link-spec` (meta root) | 40 | **DROP: three-repo-only** | spec-kit canonical→impl 仓 symlink，master plan OOS 明示 |
| C2 | `speckit-tasks-verify` (server + app) | 45 | **DROP: mono 已有** | mono `.claude/commands/speckit-tasks-verify.md` 已存在（45L diff check via git log + tasks.md drift report） |
| C3 | `speckit-trigger-sync-types` (server) | 108 | **DROP: cross-repo only** | meta `after_implement` hook 跨仓调用 sibling app；mono 单仓走 `pnpm nx affected --target=generate`（per [sdd.md L119](../conventions/sdd.md#server-impl-后的-mobile-types-同步)），不需 cross-cwd hook |
| C4 | `sync-api-types` (app) | 15 | **DROP: cross-repo only** | 同 C3，mono nx affected 已覆盖 |

**Commands 净增 0 文件**。

### Skills 决策

| 范畴 | 决策 | 理由 |
|---|---|---|
| 9 speckit-_ (mono 已有) | DROP | mono 已 |
| 5 speckit-git-_ | **DROP: master plan OOS** 明示 | "speckit-git-_ 5 个 skill" 列入 OOS |
| `mono-worktree` | KEEP unchanged | mono-only，meta 没 |

**Skills 净增 0**（整个 skills sub-PR 跳过）。

### settings.json 决策

- meta root: 4 entries 全 Java/Maven (`mvnw dependency:tree` / `spotless` / `checkstyle` / `javap`) → **DROP: stack-specific**
- meta-app: 0 allow entries（空对象）
- mono current: 10 entries (nx / prisma / @nestjs/cli 各 variants) + `defaultMode: "plan"` + `plansDirectory` + `extraKnownMarketplaces.nx-claude-plugins` + `enabledPlugins`

→ mono 现状不动；meta 候选 0 净增。**settings.json sub-PR 跳过**（settings allow 清单 enrichment 走另外的 /fewer-prompts skill 路径，不在 phase 2 scope）。

### 其他 .claude/ 候选

| 文件 | 来源 | 决策 |
|---|---|---|
| `last-session-notes-real-name-auth.md` | meta root | **DROP: ephemeral state** |
| `scheduled_tasks.lock` | meta root | **DROP: state file** |
| `worktrees/` (空) | meta root | **DROP: empty** |
| `settings.local.json` | 3 仓 | **DROP: 个人本地** (.gitignore 已排除) |

## Sub-PR 拆分

| Sub-PR | Scope | Branch | LOC est | 依赖 |
|---|---|---|---|---|
| **2.1** | `.claude/rules/api-contract-trigger.md` 新建（R2 TRANSLATED） | `docs/api-contract-rule-trigger` | +20 | 无 |
| **2.2** | `.claude/rules/migration-rules.md` 新建（R6 TRANSLATED Prisma） | `docs/migration-rules-prisma` | +50 | 无 |
| **2.3** | `.claude/rules/nativewind-mapping.md` 新建（R7 TRANSLATED apps/mobile） | `docs/nativewind-mapping-rule` | +90 | 无 |

**3 sub-PR 互不依赖可并行**（同仓但不同文件，不冲突）。无收尾 sub-PR（Phase 2 不需新增 always-load `@import` 也不需改 CLAUDE.md 按需 read 表 — rules 是 path-triggered auto-load，CLAUDE.md 不显式引用）。

每个 sub-PR 同 commit amend 本 sub-plan 的 Sub-PR 表（per Sub-PR 1.3-1.7 模式）。

## Per-sub-PR 执行细节（参 master plan § 迁移操作 4 步流程）

### Sub-PR 2.1 — `api-contract-trigger.md`

- **跨仓 read**：meta-server `.claude/rules/api-contract-rules.md`（已读）+ meta-app `.claude/rules/api-contract-rules.md`（duplicate, R3 DROP）
- **MIGRATE TRANSLATED**：
  - frontmatter `paths:` 改 `apps/server/src/**/*.controller.ts` + `apps/server/src/**/*.dto.ts` + `apps/server/openapi.json` + `packages/api-client/src/**`
  - body 极简：cross-ref `docs/conventions/api-contract.md` + `ADR-0038` + 一句「禁手写 fetch 走 @nvy/api-client」+ 一句「server endpoint 改后 `pnpm nx affected --target=generate`」
- **DROP 段**：meta「URI 前缀 `/api/v{n}/...`」+「Springdoc 自动生成」→ cross-ref docs/conventions/api-contract.md（superior 单源）

### Sub-PR 2.2 — `migration-rules.md` (Prisma 等价)

- **跨仓 read**：meta-server `.claude/rules/migration-rules.md`（已读，72 行）
- **MIGRATE TRANSLATED**：
  - frontmatter `paths: prisma/migrations/**/*.sql`
  - 文件名约定换 Prisma `prisma/migrations/<timestamp>_<snake_case_name>/migration.sql`
  - **不可变约束** stack-agnostic 保留（CI `git diff origin/main --diff-filter=MD` immutability check 仍适用）
  - **expand-migrate-contract 三步法** 全保留（含反例 + 正例 + 跳步条件）
  - cross-ref [ADR-0035](../adr/0035-data-layer-governance.md) data-layer-governance（若覆盖 migration 治理则 cross-ref）
- **DROP 段**：Flyway `V<n>__<desc>.sql` / `V<timestamp>__<desc>.sql` 文件名（DROP: stack-specific）；meta cross-ref `.specify/memory/constitution.md` § V（mono constitution Plan 3 阶段迁入，per [sdd.md L5](../conventions/sdd.md)）→ delay cross-ref 或 cross-ref ADR-0035

### Sub-PR 2.3 — `nativewind-mapping.md`

- **跨仓 read**：meta-app `.claude/nativewind-mapping.md`（已读，103 行）
- **MIGRATE TRANSLATED**：
  - 文件位置：从 meta `.claude/` 根 → mono `.claude/rules/`（与其他 rules 一致 + 增加 path-trigger）
  - frontmatter `paths: apps/mobile/src/**`（trigger UI 代码修改时自动加载）
  - 引用替换：`packages/design-tokens/src/index.ts` → `apps/mobile/src/theme/`；`packages/ui/` → `apps/mobile/src/ui/`（per [ADR-0030](../adr/0030-package-decomposition.md) "5 包减 2"）
  - tailwind config 路径：`apps/native/tailwind.config.ts` → `apps/mobile/tailwind.config.ts`
  - §5 RN-Web 兼容写法保留（NativeWind v4 `web:` modifier 通用）
  - §1-4 强约束 + §6-8 推荐 + 反模式 + 升级路径全保留
- **DROP 段**：「UI UX Pro Max skill」cross-ref（meta 用 plugin，mono 不必装 — DROP 整行 cross-ref）；「未来 `apps/web/tailwind.config.ts` 共同 import」（mono 0 apps/web — DROP）；「转 `apps/web` (Next.js) 重写」升级路径条目（同样 DROP）

## 4 步流程（per sub-PR）

1. 跨仓 read meta 原文（meta 仓绝对路径，read-only）
2. 决策 + 改 mono 正式文件（每个 meta 段过 5 类淘汰 + 9 步 checklist + 4 killer questions；`git diff` 看改前 vs 改后）
3. **Post-edit 全文 self-audit**（per memory `feedback_post_edit_self_audit_against_acceptance_criteria`）：完整文件每段过 4 killer questions；段 > 50 行命中 claude-md-audit § 3.2 auto-trigger
4. **🛑 人肉 review pause**：self-audit 报告 + diff summary 给 user；user 可显式 OK / 直接补改 / 回滚

## Phase 2 验收

- ☐ 维度 1 体积：path-triggered rules 不计入 always-load budget；rules 总文件 = 3（mono 原 3） + 3（新 R2/R6/R7） = **6 个** rules
- ☐ 反模式扫描：3 新 rules 各 0 命中 7 反模式（手写镜像 / prose 摘要 / stale ref / 状态 vs invariant 失误 / 跨文件重复 / 自创术语 / dead code）
- ☐ 段级深挖：3 新 rules 每段独立过 4 killer questions
- ☐ Path-trigger 真触发实证（per Sub-PR 1.4 lesson learned）：每个 rule 改完后 `touch` 一个 matching path 文件，验证 Claude session 内 rule 加载（manual 测试，PR description 留痕）

## Sub-PR ship 顺序

```text
Sub-PR 2.1 / 2.2 / 2.3 任意顺序，可并行（同仓不同文件不冲突）
  ↓ all 3 merged
Phase 2 全 ship → Phase 3 PR / CI / lefthook 强制层 /plan 会话开启
```

## Out of Scope（Phase 2 不做）

- ❌ `.claude/rules/docker-rules.md`（DEFER Plan 3，per master plan OOS）
- ❌ `.claude/commands/` 新增（C1-C4 全 DROP / mono 已有）
- ❌ `.claude/skills/` 任何 meta skill（master plan OOS + mono 已有 9 speckit + mono-worktree）
- ❌ `.claude/settings.json` allow 清单 enrich（走 `/fewer-prompts` skill 独立路径）
- ❌ `.claude/last-session-notes-*.md`（ephemeral state）
- ❌ `nx-claude-plugins marketplace` 增 / `enabledPlugins` 改（不在 phase 2 scope）

## Risk + Rollback

| 风险 | 缓解 |
|---|---|
| Sub-PR 2.3 nativewind-mapping 净 90 行单段可能超 50 行 trigger claude-md-audit § 3.2 auto-trigger | 起手分 §1-5 强约束（< 50 行）+ §6-8 推荐（< 30 行）两 H2 段；若仍单 H2 > 50 行触发拆分，转 Hybrid（canonical 在 `docs/conventions/`，规则在 `.claude/rules/`） |
| meta 3 仓 `.claude/` 路径漂移（user 临时改） | 每 sub-PR 起手 `ls -la /Users/butterfly/Documents/projects/no-vain-years/{,my-beloved-server/,no-vain-years-app/}.claude/` 实证 |
| Phase 2 ship 后 phase 3 发现遗漏 rule | 允许 sub-plan 内反推 master plan 5 类淘汰清单（per Sub-PR 1.3 「mono-already-superior」5th 先例） |
| Path-trigger frontmatter 路径 typo 静默不 fire | per Phase 2 验收第 4 项 manual 测试；PR description 留 `touch + cat` 实证 |

## On Ship 备注

- **Sub-PR 2.1 ship 时**：含本 sub-plan `git mv` 到 `docs/plans/2026-05/05-23-claude-config-meta-to-mono-p2-claude-dir.md`（master plan § 跨阶段决策 表）
- **Sub-PR 2.3 ship 后**：Phase 2 全 done；prompt user 开 Phase 3 PR/CI/lefthook 强制层 /plan 会话

## Verification（本 sub-plan 自身）

- ☐ User 在 ExitPlanMode 批准
- ☐ Sub-PR 2.1 / 2.2 / 2.3 全 merge
- ☐ Phase 2 验收 4 项全过
- ☐ 本 sub-plan `git mv` 到 `docs/plans/2026-05/` 约定路径（随 Sub-PR 2.1 ship）
