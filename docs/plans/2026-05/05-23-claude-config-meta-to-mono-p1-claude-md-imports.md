# Sub-Plan P1: CLAUDE.md + @import 内容层迁移

## Context

Phase 1 of master plan（meta → mono 单向迁移），scope = CLAUDE.md + @import 链 **内容层**。基于 2026-05-23 两个 Explore agent 对 11 个候选（9 meta-root conventions + meta-server CLAUDE.md 9 sections + meta-app CLAUDE.md 5 sections）应用 master plan 锁定的 5 类淘汰标准的评估结果 + user 直接 push back 2 项（daily-logs / experience-docs 与 mono Plan 3 iCloud symlink 同步迁入），最终 6 项内容进入迁移 + 1 项收尾整合 = **7 个 sub-PR**。

P1 目标：把 meta 中**对 mono 仍有价值的内容层规范**（conventions/*.md + CLAUDE.md 段）迁入 mono，让 mono 的 always-load 链路在不超 5000 token 红线前提下补齐 meta 时代积累的稳定规范。

## 候选决策表（per master plan 5 类淘汰已锁，此处仅 per-file 决策）

| # | 候选 | 来源（绝对路径） | 目标位置 | 处置 | always-load |
|---|---|---|---|---|---|
| 1 | claude-config-layout | meta-root `docs/conventions/claude-config-layout.md` | 新建 mono `docs/conventions/claude-config-layout.md` | MIGRATE-AS-IS | **是**（@import） |
| 2 | git-workflow-reference | meta-root `docs/conventions/git-workflow-reference.md` | 新建独立文件 mono `docs/conventions/github-ruleset.md` + 顺手清 mono `git-workflow.md` 3 finding（删顶部 stale blockquote / 删 § 分支策略 prose 摘要 prose 同源重复 / fix L35 typo） | MIGRATE-CONDENSED + EXTRACT-TO-NEW-FILE | 否（按需 read 表，触发：改 GitHub repo 设置 / ruleset / CI workflow 改名） |
| 3 | versioning | meta-root `docs/conventions/versioning.md` | ~~并入 mono `versioning.md`~~ → **0 段可迁**（meta 29 行 vs mono 85 行 strictly superior，per Sub-PR 1.3 实证） | **DROP-mono-already-superior**（新增第 5 类淘汰，本 sub-PR 反推 master plan） | n/a |
| 4 | TDD + UI mockup colocation 路径 | meta-server § 一 + meta-app § 三 | 并入 mono `docs/conventions/sdd.md`（已 @import） | KEEP-PRINCIPLE | （already always-load） |
| 5 | RFC 9457 + HTTP API 体例 | meta-server § 三 + § 六 | 新建 mono `docs/conventions/api-contract.md` | KEEP-PRINCIPLE | 否（按需 read 表） |
| 6 | FE monorepo cross-package 边界 | meta-app § 一 + § 五 | 新建 mono `docs/conventions/fe-directory-structure.md` | KEEP-PRINCIPLE | 否（按需 read 表） |

### 已淘汰候选（不进 P1，记录 cross-link 防漏）

- `agent-view-usage.md`（meta-root）→ `DROP: three-repo-only`（3-repo agent worktree 体例；mono-worktree skill 已覆盖）
- `api-contract.md`（meta-root）→ `DROP: stack-specific`（Springdoc 链条；mono 版重写不复用 meta 内容；落点同名但内容来源是 meta-server § 六 而非 meta-root api-contract）
- `worktree.md`（meta-root）→ `DROP: three-repo-only`（与 mono-worktree skill 体例完全不同）
- `README.md`（meta-root）→ 跳过（per claude-md-audit § 6「README 默认路标删」原则；user Q1 confirmed）
- `daily-logs.md`（meta-root）→ `DEFER: 与 plan3 iCloud symlink 物理迁入同步`（mono CLAUDE.md 已明示 `docs/daily/` 在 Plan 3 阶段从 meta 迁入；user push back: 提前迁 convention 描述但物理目录未启用 → 文档 drift；同 PR 物理 + convention 一起做）
- `experience-docs.md`（meta-root）→ `DEFER: 与 plan3 iCloud symlink 物理迁入同步`（同上理由）
- `versioning.md`（meta-root）→ `DROP: mono-already-superior`（meta 29 行 vs mono 85 行；mono 已含 manifest 0.0.0 bug Postmortem + separate-pull-requests + path routing 表 + 手工里程碑 tag 废弃文档化；meta 三仓 row 全 DROP-three-repo-only；起步 v0.1.0 已被 mono 0.0.1 evolution 替代）
- meta-server § 二（包/类命名 DDD 层）→ `DEFER: P2`（NestJS 层结构不同，P2 落地时新写）
- meta-server § 四（日志纪律）→ `DEFER: P2`（适合 `.claude/rules/server-logging.md` path-triggered）
- meta-server § 五（migration expand-migrate-contract）→ `DEFER: plan3`（DDL 部署策略）
- meta-server § 七（测试约定 / coverage 数字）→ `DEFER: P2`（适合 `.claude/rules/server-test.md`；coverage% 数字本身是 anti-pattern → DROP）
- meta-server § 八 + § 九（Maven CLI / Maven 依赖管理）→ `DROP: stack-specific`
- meta-app § 二（NativeWind className 5 规则）→ `DEFER: P2`（`.claude/rules/nativewind-mapping.md`）
- meta-app § 四（FE 测试约定）→ `DEFER: P2`（fe-test rule 或 server-test 等价）

## Sub-PR 拆分（7 PR）

| Sub-PR | Scope | 候选# | PR title (Conventional Commits) | git mv master/P1? |
|---|---|---|---|---|
| 1.1 | 新建 `claude-config-layout.md` + 含 master+P1 git mv | #1 | `docs(repo): migrate claude-config-layout convention from meta` | **是** |
| 1.2 | 新建 `github-ruleset.md` (convention) + `.claude/rules/github-ruleset-sync.md` (path-scoped, **跨 P1→P2 边界**) + 顺手清 git-workflow.md 3 finding | #2 | `docs(repo): extract github-ruleset to standalone convention + add path-scoped rule + clean git-workflow dups` | 否 |
| 1.3 | **workflow amendment + finding 报告**（meta versioning 0 段可迁 → master plan 加第 5 类淘汰 + .gitignore 删 backup glob）；**不动 mono versioning.md** | #3 (DROP) | `docs(repo): simplify migration workflow + add 5th disposal class (mono-superior)` | 否 |
| 1.4 | 并入 sdd.md（TDD 强调 + UI mockup path 澄清） | #4 | `docs(repo): deepen sdd convention with tdd + ui-mockup-path` | 否 |
| 1.5 | 新建 api-contract.md（RFC 9457 + HTTP 体例） | #5 | `docs(repo): add api-contract convention (rfc9457 + url + error code + pagination)` | 否 |
| 1.6 | 新建 fe-directory-structure.md | #6 | `docs(repo): add fe-directory-structure convention` | 否 |
| 1.7 | 收尾：mono CLAUDE.md @import 链 + 按需 read 表 + token 预算验证 | 整合 | `docs(repo): wire phase1 conventions into CLAUDE.md import chain` | 否 |

### Sub-PR 间依赖

- **1.1 必须最先**（含 master + P1 plan 文件 git mv，否则后续 PR 找不到 plan 最终位置）
- **1.2 ~ 1.6 互不依赖，可并行**；同一文件不同 PR 串行避免冲突
- **1.7 收尾必须最后**（依赖 1.1-1.6 全部 merge 后才能验证 token 预算 + 整合 @import）

## Per-sub-PR 执行细节（参 master plan § 迁移操作流程 6 步，含 step 4 post-edit self-audit + step 5 🛑 人肉 review pause）

### Sub-PR 1.1 — claude-config-layout.md MIGRATE-AS-IS + master/P1 git mv

- **备份**：mono 无此文件，跳过 backup
- **2-way read**：直接 read meta 原文（`/Users/butterfly/Documents/projects/no-vain-years/docs/conventions/claude-config-layout.md`）→ 决策段落 → 写 mono 新文件
- **接受标准过滤**：每段过 9 步 checklist 第 6 步「删后犯啥具体错」+ 4 killer questions；mono 路径若与 meta 不同需调整
- **同 PR 内 plan 文件 split**：
  - `git mv 1-plan-05-22-test-infra-master-plan-2-s-breezy-patterson.md docs/plans/2026-05/05-23-claude-config-meta-to-mono-master.md`（保留 master plan 部分）
  - 手动 split：把 file split 标记下方 P1 sub-plan 内容剪出，新建 `docs/plans/2026-05/05-23-claude-config-meta-to-mono-p1-claude-md-imports.md`
  - 同 commit
- **不动 CLAUDE.md** @import 链（收尾 sub-PR 1.7 一并加）
- **`.gitignore` 加 `*.before-migration.md` glob**（防 1.3+ backup 误 commit）

### Sub-PR 1.2 — github-ruleset 拆独立按需文件 + git-workflow.md 清重复

- **备份**：`cp docs/conventions/git-workflow.md docs/conventions/git-workflow.md.before-migration.md`
- **跨仓 read**：meta `git-workflow-reference.md`
- **gh api 实证**：`gh api repos/xiaocaishen-michael/no-vain-years-mono/rulesets` 拿 mono 实际 ruleset（避免文档 drift）
- **DROP 段**（meta 来源）：
  - M1.1 / M3 milestone planning → `<!-- DROP: three-repo-only -->`（timeline 是 meta 三仓特有）
  - 「单人期」exemption + 「M3 引第二人」timeline → `<!-- DROP: three-repo-only -->`（保留 invariant 表述：solo dev 期豁免）
  - meta `required_status_checks ✅ server 9 项 / meta 5 项` 显式清单 → `<!-- DROP: three-repo-only -->` + 命中 § 4.1 手写镜像反模式（不展开 check context 字符串，cross-ref `gh api`）
- **新建文件 1**：`docs/conventions/github-ruleset.md`（convention，按需 read，触发 mental: 改 GitHub repo 设置 / `gh api` 改 ruleset / 引第二人）。内容 4 段：
  1. 仓库 PR 设置（`delete_branch_on_merge` / `allow_auto_merge` 2 bool + `gh api` cross-ref）
  2. Ruleset `main-protection` 规则（4 rule type names + `gh api` 实时 truth 命令）
  3. solo dev 期豁免（引第二人前必收紧的 4 个字段名 + CODEOWNERS）
  4. CI 改名硬约束（同 PR 改 ruleset `required_status_checks` contexts，或拆两步）
- **新建文件 2 (跨 P1→P2 边界，user 显式允许)**：`.claude/rules/github-ruleset-sync.md`（path-scoped，`paths: .github/workflows/*.yml + .github/CODEOWNERS`）。Body = 2 个硬性 invariant（CI job 改名同 PR 改 ruleset / CODEOWNERS 改 implies 引第二人 → 收紧 4 字段）+ cross-ref `docs/conventions/github-ruleset.md` 单源；**rule body 不重复字段值，值实时 truth 走 `gh api`**
- **改 git-workflow.md（顺手清重复）**：
  - 删顶部 stale blockquote（命中 stale label + 手写镜像段名 + state vs invariant 失误三反模式叠加，per § 4.1）
  - 删 § 分支策略 整段（5 个 bullet 全部被 § PR 合入 + 新 github-ruleset.md 取代，命中「prose 摘要 + 同源具体段」反模式）
  - fix L35 末尾「；」孤立标点 → 改「。」
- **post-edit self-audit**：完整 git-workflow.md（精简后）+ github-ruleset.md（新建）双文件每个 H2/H3 段过 9 步 + 4Q
- **删 backup**：sub-PR ship 前 `rm docs/conventions/git-workflow.md.before-migration.md`

### Sub-PR 1.3 — workflow amendment + meta versioning 0-段可迁 finding 报告

> ⚠️ **Sub-PR 1.3 走 read meta + 对比 mono 后发现 0 段可迁（mono superior）→ scope 重定义为 workflow amendment + finding**；本 sub-PR 不动 `docs/conventions/versioning.md`。

- **跨仓 read**：meta `docs/conventions/versioning.md`（29 行）+ **先 read mono `docs/conventions/versioning.md`（85 行）** 建立 mono 基线 — per [[feedback_convention_migration_mono_already_superior]]
- **段级对比**：meta 4 段全部 mono 已 strictly superior（详见 § 已淘汰候选 versioning 条目）
- **scope 实际产出**：
  1. master plan § 迁移操作流程 6 → 4 步（删原 step 1 备份 + 原 step 6 删 backup；改用 `git diff` / `git restore` 替代）
  2. master plan § 5 类淘汰 → **5 类**（加 `mono 已 superior`，per memory [[feedback_convention_migration_mono_already_superior]]）
  3. master plan § Risk + Verification 删 backup 相关条目
  4. P1 sub-plan 候选决策表 row 3 + 已淘汰候选 + Sub-PR 拆分表 row 1.3 + Sub-PR 1.4-1.7 detail 全部对齐新 4 步流程
  5. mono `.gitignore` 删 `*.before-migration.md` glob（死代码 — 4 步流程不再生成 backup）
  6. 新 memory: `feedback_convention_migration_mono_already_superior`
- **claude-md-audit § 3.2 auto-trigger 重审 finding**: mono versioning.md 85 行 命中 3 条 trigger（体积 > 50 / 触发可路径化 / reference-content 主导）→ Step 1 画像建议 Hybrid 拆 `.claude/rules/release-please-versioning.md`。**本 sub-PR 不执行重审拆分**（scope creep），列入 Phase 2 sub-plan 候选

### Sub-PR 1.4 — sdd.md 深化（TDD 强调 + UI mockup 路径澄清）

- **跨仓 read**：meta-server CLAUDE.md § 一 TDD + meta-app CLAUDE.md § 三 UI 工作流
- **MIGRATE 段**：
  - TDD 强调（server 业务模块强制红绿循环）→ 并入 mono sdd.md § /implement 闭环 6 步 前的「## 标准流程」段补一句
  - UI mockup colocation 路径澄清：meta 用 `apps/native/specs/<page>/design/`，mono 用 `specs/NNN-<feature>/design/`（feature-first per ADR-0024）→ 并入 mono sdd.md § 前端 UI 工作流变体 § 类 1 占位 UI 4 边界 之后，明示 mono 路径
- **DROP 段**：meta-server § 一 关于 JUnit/Mockito 工具的实操（mono 走 Vitest+NestJS Test module，工具差异 DROP）→ `<!-- DROP: stack-specific -->`

### Sub-PR 1.5 — 新建 api-contract.md

- **跨仓 read**：meta-server CLAUDE.md § 三 错误处理 + § 六 API 设计
- **MIGRATE 原则**：
  - URL 体例 `/api/v{n}/<resource>`（与 sub-PR 1.4 versioning.md cross-link，但 api-contract.md 是 HTTP contract 单源）
  - HTTP method 语义（GET 幂等 / POST 创建 / PATCH 部分更新 / PUT 整体替换 / DELETE）
  - kebab-case URL path
  - Pagination 体例（cursor-based / limit）
  - ISO 8601 timestamp 体例
  - RFC 9457 ProblemDetail 响应格式 + `application/problem+json` content-type
  - Error code 命名（`PHONE_ALREADY_REGISTERED` 全大写 + 下划线）
- **DROP**：
  - Spring `setProperty()` / `@RestControllerAdvice` 实现细节 → `<!-- DROP: stack-specific -->`
  - JSR 303 等 validation annotation 细节 → `<!-- DROP: stack-specific -->`（mono 走 class-validator / zod）
- **Cross-link**：mono 已有 `server-bounded-context-catalog.md`（业务 Operation 决策导向）— api-contract 是 HTTP wire format 单源，两者分工不重叠

### Sub-PR 1.6 — 新建 fe-directory-structure.md

- **跨仓 read**：meta-app CLAUDE.md § 一（目录约定）+ § 五（AI 协作约束）
- **MIGRATE 原则**：
  - `apps/*` vs `packages/*` 边界（业务逻辑 in packages/，平台 UI in apps/）
  - `packages/*` 不得反向依赖 `apps/*`（ESLint enforce-module-boundaries 配合，per ADR-0020 + master plan 提及的 P2 ESLint 边界电网）
  - 跨 package 禁止 deep-import（仅 entry point）
  - token / secrets 安全（不进 git，env 注入）
  - OpenAPI client 包装位置（`packages/api-client/`，per mono 现状）
- **DROP**：
  - `apps/native/` 命名 → 改用 `apps/mobile/`（mono 实际路径）
  - Expo / pnpm install 实操命令 → cross-link mono `business-naming.md` 已覆盖的模块路径
- **Cross-link**：mono 已有 `business-naming.md` 列了 `apps/*` 和 `packages/*` 三层位置；fe-directory-structure.md 强化跨 package 边界 invariant

### Sub-PR 1.7（收尾）— CLAUDE.md @import 链 + 按需 read 表 + token 预算验证

- **改 mono CLAUDE.md**：
  - 新增 always-load `@import`：`@docs/conventions/claude-config-layout.md`
  - 「按需 read」表新增 3 entries：

    | 操作 | 必读文档 |
    |---|---|
    | 改 GitHub repo 设置 / ruleset / CI workflow 改名 / 加 required check / 引第二人收紧 | `docs/conventions/github-ruleset.md` |
    | server 新增 API / mobile API client 改动 | `docs/conventions/api-contract.md` |
    | Plan 2 mobile 迁入 / 新增 package | `docs/conventions/fe-directory-structure.md` |

- **token 预算验证**（per master plan § 终局验收 § 1）：

  ```bash
  for f in $(grep -oE '@\S+\.md' CLAUDE.md | sed 's/@//'); do wc -c "$f"; done | awk '{s+=$1} END {print s/4, "tokens"}'
  ```

  目标 < 5000；超限 → 触发段级再深挖 + 二轮裁剪 / 转 on-demand

## Phase 1 验收（per master plan § 终局验收 § 1-3，§ 4 sanity 留 3 phase 全 ship 后）

- ☐ **维度 1 体积预算**：always-load total token < 5000（sub-PR 1.7 脚本输出 ≤ 5000）
- ☐ **维度 1 单文件**：新增 conventions 文件 each < 1500 token（≈ 6KB；预估 claude-config-layout < 200 token，api-contract / fe-directory-structure 各 < 800 token）
- ☐ **反模式扫描**：sub-PR 1.1-1.6 每个起手 grep meta 原文常见 stale label（如「三仓」/「meta canonical」/「M1.1」/「mvnw」），新文件 0 命中
- ☐ **段级深挖**：sub-PR 1.4 / 1.5 / 1.6（深化或新建）每段独立过 4 killer questions

## Sub-PR ship 顺序（与 master plan § Sequencing 对齐）

```text
Sub-PR 1.1 (含 master + P1 plan 文件 git mv + claude-config-layout 新建)
  ↓ merged
Sub-PR 1.2 / 1.3 / 1.4 / 1.5 / 1.6 (任意顺序, 可并行;同文件不同 PR 串行)
  ↓ all 5 merged
Sub-PR 1.7 (收尾 + token 预算验证)
  ↓ merged
Phase 1 全 ship → Phase 2 /plan 会话开启
```

## Out of Scope（P1 不做）

- ❌ README.md（per claude-md-audit § 6）
- ❌ NativeWind className 5 规则（DEFER P2 `.claude/rules/`）
- ❌ Logging / Exception strategy / Server test rule（DEFER P2）
- ❌ Migration expand-migrate-contract DDL（DEFER plan3）
- ❌ release-please 具体 SOP / Docker / build-image / deploy（DEFER plan3）
- ❌ DDD 包/类命名（DEFER P2 NestJS 等价物落地时）
- ❌ Maven / Spring / Flyway / Spotless / Checkstyle CLI 命令（DROP-stack-specific）

## Risk + Rollback（P1 专属，per master plan § Risk 通用条目不重复）

| 风险 | 缓解 |
|---|---|
| Sub-PR 1.7 验证 token 超 5000 红线 | sub-PR 1.1 起手就估算 claude-config-layout 加入后总量；超限即停 1.7 触发段级再深挖 / 转 on-demand |
| Sub-PR 1.2 改 git-workflow.md + Sub-PR 1.7 改 CLAUDE.md 都改公共文件 → main drift conflict | sub-PR 1.2 ship 后强制 sub-PR 1.7 起手 `git pull --rebase origin main` |
| meta-server / meta-app CLAUDE.md 跨仓 read 路径漂移（如 user 临时改 meta 目录布局） | 1.4 / 1.5 / 1.6 起手 `ls -la /Users/butterfly/Documents/projects/no-vain-years/{my-beloved-server,no-vain-years-app}/CLAUDE.md` 实证 |
| sub-PR 1.5 api-contract.md 与 sub-PR 1.3 versioning.md 在 API versioning `/api/v{n}/` 段重复 | sub-PR 1.3 仅保留版本号 bump 语义，URL 体例完整 single-source 在 1.5 api-contract.md；1.3 用 cross-link 引用 1.5 |
| sub-PR 1.4 sdd.md 改动与 mono 现行 sdd.md UI 工作流变体段冲突（mono ADR-0017 amends ADR-0015 已稳定） | 1.4 只「附加路径澄清」不改 UI 类 1/2/3 分类决策；保守附加段落，不重写 |
| Phase 1 全 ship 后 Phase 2 开启时发现 token 已贴近 5000 | Phase 2 path-triggered rules 默认走 `.claude/rules/` 而非新增 always-load `@import`；P2 sub-plan 内验证不再增 always-load |

## On Ship 备注（Phase 1 自身）

- **Sub-PR 1.1 ship 时**（含 master + P1 plan 文件 split）：
  - `git mv docs/plans/1-plan-05-22-test-infra-master-plan-2-s-breezy-patterson.md docs/plans/2026-05/05-23-claude-config-meta-to-mono-master.md`（保留 master plan 部分内容）
  - 手动 split：把 file split 标记下方 P1 sub-plan 内容剪出，新建 `docs/plans/2026-05/05-23-claude-config-meta-to-mono-p1-claude-md-imports.md`
  - 同 commit ship；master plan 不单独提 PR
- **Sub-PR 1.7 ship 后**：Phase 1 完全 done；prompt user 开 Phase 2 /plan 会话设计 `.claude/` 目录迁移
