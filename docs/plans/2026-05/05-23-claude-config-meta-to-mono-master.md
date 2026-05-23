# Master Plan: meta → mono Claude Config 规范单向迁移

> **统领 3 个独立子 plan**：CLAUDE.md + @import 链 → `.claude/` 目录 → PR/CI/lefthook 自动化层；本文件**不下钻子 plan 内部**，只锁单向迁移原则、4 类淘汰标准、跨阶段契约、终局验收。

## Context

mono 仓从 Java/Spring + 三仓布局推倒重来为 NestJS + Fastify + Prisma + Nx 单仓后（per memory `project_plan_pivot_nestjs_mono`），meta 三仓（`no-vain-years/` + `my-beloved-server/` + `no-vain-years-app/`）积累的一批 Claude 配置规范、约束、约定**部分有效迁移**、部分**主动淘汰**、部分**漏迁**。

2026-05-23 的 mono vs meta 三仓 Claude cwd 配置全面对比（上一对话节点 inventory + 二维矩阵）显示，缺口集中在 3 个维度：

1. **CLAUDE.md + @import 链** — meta 三层 CLAUDE.md 合并成 mono 单层后，meta-root 的 9 个按需 read 文档收敛到 mono 4 个；meta-server / meta-app 各自的栈编码约束在 mono 未建立等价物
2. **`.claude/` 目录** — meta-server 4 个 rules（checkstyle / docker / Flyway / api-contract）+ meta-app 1 个 nativewind-mapping 在 mono 未建立 NestJS / Expo 等价物；speckit-git-* 5 个 skill 在 mono 单仓不需
3. **PR / CI / lefthook 自动化层** — mono 已有「PR hard-gate 体系」+ 5 个新 lefthook hook（mono 独家增量），但 meta-server 的 build-image / deploy workflow / nightly-full-tests 等部署相关链路 mono 尚未引入（Plan 3 阶段才需）

**目标**：把 meta 中**对 mono 仍有价值**的规范、约束、约定按 `claude-md-audit` skill 的 4 维度标准精简后并入 mono；mono 主动淘汰 / 三仓专属 / 已被 hook 替代 / mono 阶段未到的内容一律**不迁**。

**反向不动**：mono 独家增量（`pr-creation-protocol` / `docs-organization` / `nx-claude-plugins` / `mono-worktree` skill / 5 个新 hook / 3 hard-gate checkbox 等）保留现状不回滚 — meta 没有的不参与对比。

本 plan 用 **3 阶段渐进结构** 迁移：

| 阶段 | 心法 | 性质 | 出错代价 |
|---|---|---|---|
| **P1 内容层** | 先迁 CLAUDE.md + @import 的 conventions/*.md 内容 | 规范本体 | 规范缺失 / Claude 行为退化 |
| **P2 加载层** | 再迁 `.claude/` 的 path-triggered rules + commands + skills | 触发机制 | 规则不被触发 / 行为漂移 |
| **P3 强制层** | 最后迁 PR / CI / lefthook 的强制门禁 | 硬拦截 | 反噬：误拦好 PR |

设计纪律：**P1 内容稳定后再做 P2 触发机制；P2 机制稳定后再上 P3 强制门禁**。

## 子 plan 拆分

| Phase | Sub-plan 文件（ship 后落点） | 阶段名 | 候选文件数（粗估） | 核心交付 |
|---|---|---|---|---|
| 1 | `docs/plans/2026-05/05-23-claude-config-meta-to-mono-p1-claude-md-imports.md` | CLAUDE.md + @import 链 | 9 meta-root convention 候选 + meta-server 183L + meta-app 101L CLAUDE.md → 预计 5-7 项迁入 / 转化 | mono `CLAUDE.md` @import 链增 + `docs/conventions/*.md` 新增 / 更新 + 按需 read 表新增 entry |
| 2 | `docs/plans/2026-05/05-23-claude-config-meta-to-mono-p2-claude-dir.md` | `.claude/` 目录 4 子目录 | 6 rules + 5 commands + 14 skills + nativewind-mapping → 预计 3-5 项迁入（NestJS / Expo 等价物） | mono `.claude/rules/` + `commands/` + `skills/` + `settings.json` 增量 |
| 3 | `docs/plans/2026-05/05-23-claude-config-meta-to-mono-p3-automation.md` | PR / CI / lefthook | 3 PR template + 11 workflow + 3 lefthook → 预计 2-4 项迁入（多数 defer 到 Plan 3） | mono PR template 段增 + workflows 增 + `lefthook.yml` hook 增 |

每个子 plan **独立 `/plan` 会话设计**、独立 PR、独立验收。本主 plan 不下钻细节决策。

## 跨阶段契约（master 锁定，sub-plan 不得违反）

### P1 → P2 接口

P1 输出：
- `docs/conventions/*.md` 文件级迁移决策（哪些迁、哪些转化、哪些跳）已 ship
- 新增 / 更新的 conventions 文件已 @import 到 `CLAUDE.md`（如属 always-load）
- 「按需 read」表新增 entry（如属 trigger-read）

P2 消费：
- P2 中新建的 `.claude/rules/*.md`（path-triggered）与 P1 的 conventions 文件 cross-link 一致 — 不重复内容、不矛盾
- P2 不应再迁出 conventions 内容（避免重复）

### P2 → P3 接口

P2 输出：
- `.claude/rules/` 增量已 ship（含 `paths:` frontmatter）
- `.claude/skills/` + `commands/` 增量已 ship
- `.claude/settings.json` allow 清单已 ship

P3 消费：
- P3 lefthook hook 不重复 P2 已 path-trigger 的检查（避免双层守护冗余）
- P3 PR template / workflows 引用的 spec 字段以 P1 @import 后的 conventions 为准（spec frontmatter / SDD 流程 step 等）

### P1 ↔ P3 直接契约（跳过 P2）

- P1 迁入的「commit/PR 体例」相关规范，P3 在 commit-msg / PR validation workflow 中配套硬拦截（如果还有 mono 未拦的项）

## 单向迁移原则

**对比方向**：meta 三仓有 → mono 没（或不完整）一律纳入候选  
**反方向（mono 有 meta 没）一律不动**：mono 独家增量保留现状不回滚

### 4 类淘汰标准（master 锁定，子 plan 不重复决策）

| 类型 | 判定信号（关键词） | 处理 | 临时 diff 文件 drop 注释 |
|---|---|---|---|
| **栈相关淘汰** | Java/Spring/Maven/Flyway/Spotless/Checkstyle/ArchUnit/javap/mvnw/Springdoc | 默认直接淘汰。例外：明显有 NestJS/Prisma/ESLint/Expo 等价物 **且 mono 阶段已到** → 转化迁移，临时文件标 `<!-- TRANSLATED-TO: <new-stack> -->` 显式列映射 | `<!-- DROP: stack-specific -->` |
| **三仓相关淘汰** | spec-symlink / 跨仓 mirror / cross-repo PR / 三仓一致 / meta canonical / impl 仓 mirror | 直接淘汰，mono 单仓不需要 | `<!-- DROP: three-repo-only -->` |
| **已被 hook 替代** | meta 描述「请记得 X」的规则，mono 已在 `lefthook.yml` / `workflows/*.yml` 实现强制 | 直接淘汰，不冗余写 CLAUDE.md（per memory `feedback_hook_before_claude_md`） | `<!-- DROP: hook-replaced -->` |
| **mono 阶段未到** | Plan 3 部署 / release / Docker 相关（`docker-rules` / `migration-rules` Flyway 部分 / `build-image` / `deploy` workflow / release-please component config） | defer 不迁，等 Plan 3 启动时再迁；在 Plan 2/3 master plan 加 cross-link | `<!-- DEFER: plan3 -->` |

## 接受标准（master 锁定）

候选段落迁入 mono 前必过 `claude-md-audit` skill 的 9 步 checklist 第 6 步：

> **删后犯啥具体错？** 必须给出「用户问 Y 时 Claude 会答错 Z」的具体场景。说不出 = 不迁。

外加 § 3.1 段级深挖 4 killer questions 必跑：
1. 存在价值 — 这段提供什么独特信息，删了丢什么具体的事
2. 替代成本 — 能不能用 `ls` / `grep` / cross-ref 单源更便宜地提供
3. drift 风险 — 是不是手写镜像文件系统 / 代码 / config 真相
4. 实证 vs 文本判断 — 能不能跑 `ls` / `grep` / `cat` 验证

任一答案为「不能 / 是 / 有 drift / 没实证」→ 不迁，或迁入时整段重写为单源 cross-ref。

## 迁移操作流程（每个候选文件统一走 4 步）

1. **备份当前 mono 文件**: `cp <mono-path>.md <mono-path>.before-migration.md`；`*.before-migration.md` 加入 `.gitignore`，**不进仓**；与 mono 正式文件**同目录**便于 diff 工具直接对比
2. **3-way diff**：用 vim/VSCode/Beyond Compare 同时打开
   - meta 原文（绝对路径，跨仓 read-only）
   - `<mono-path>.before-migration.md`（mono 改动前快照）
   - `<mono-path>.md`（mono 正在编辑的正式文件）
3. **决策 + 改 mono 正式文件**：每个 meta-only 段过 4 类淘汰 + 9 步 checklist + 4 killer questions
   - 迁的 → 直接写入 mono 正式文件合适位置（按现有结构定位，不新增章节）
   - 不迁的 → 在 PR description 记录 drop 注释，并在临时 diff 文件该段顶部标注（review 时方便检视）
4. **删 backup 副本**：sub-PR ship 前删 `<mono-path>.before-migration.md`；同 PR 内从 `.gitignore` 移除条目（避免长期残留）

## Sequencing + Dependency Graph

```text
Phase 1 (CLAUDE.md + @import 内容层)
  ├─ 子 PR 1.1 ~ 1.N: 每个 conventions/*.md 候选 1 sub-PR（颗粒细，回滚代价低）
  ├─ 子 PR 1.last: CLAUDE.md @import 链整合（如有新增 always-load）+ 按需 read 表 entry 增
  └─ Phase 1 验收：always-load total token < 5000 / 单文件 < 1500
       ↓ Phase 1 全 merged into main
Phase 2 (.claude/ 加载层)
  ├─ 子 PR 2.1: .claude/rules/<rule-X>.md 各 1 PR
  ├─ 子 PR 2.2: .claude/commands/<command-Y>.md 各 1 PR
  ├─ 子 PR 2.3: .claude/skills/<skill-Z>（多数预计跳）
  └─ 子 PR 2.4: .claude/settings.json allow 清单（必要时）
       ↓ Phase 2 全 merged into main
Phase 3 (PR / CI / lefthook 强制层)
  ├─ 子 PR 3.1: .github/pull_request_template.md 段增
  ├─ 子 PR 3.2: .github/workflows/<wf>.yml 段增（多数 DEFER plan3）
  └─ 子 PR 3.3: lefthook.yml hook 段增（少量补强）
       ↓ Phase 3 全 merged into main
```

**Phase 间严格串行**：每 phase 全部 sub-PR merge + master plan 勾掉 + 下一 phase 开 `/plan` 会话。  
**Phase 内允许多 sub-PR 并行**（每个 conventions 文件 1 PR；不同 rule 1 PR），但同一文件不并行避免冲突。

## 跨阶段决策（master 一次性锁定）

### 子 plan 文件命名 + 落点

| 文件 | scratch 路径 | ship 时 git mv 目标 |
|---|---|---|
| 本主 plan | `docs/plans/1-plan-05-22-test-infra-master-plan-2-s-breezy-patterson.md` | `docs/plans/2026-05/05-23-claude-config-meta-to-mono-master.md` |
| Sub-plan 1 | plan mode 分配 | `docs/plans/2026-05/05-23-claude-config-meta-to-mono-p1-claude-md-imports.md` |
| Sub-plan 2 | 同上 | `docs/plans/2026-05/05-23-claude-config-meta-to-mono-p2-claude-dir.md` |
| Sub-plan 3 | 同上 | `docs/plans/2026-05/05-23-claude-config-meta-to-mono-p3-automation.md` |

主 plan 跟随 Phase 1 第一个 sub-PR ship，不单独提 PR。

### 边界裁定（什么由 master 锁、什么留 sub-plan）

**Master 锁定**（sub-plan 不得改）：
- 3 阶段顺序 + scope 边界（内容层 / 加载层 / 强制层）
- Sub-plan 之间的接口契约（上面 § 跨阶段契约 部分）
- 4 类淘汰标准 + 4 个 drop 注释 token
- 接受标准（9 步 checklist 第 6 步 + 4 killer questions）
- 迁移操作 4 步流程 + `.before-migration.md` 后缀约定 + `.gitignore` 纪律
- 终局验收方法（claude-md-audit 4 项）

**留给 sub-plan 决策**（master 不锁）：
- Sub-plan 1：每个 conventions 候选文件的迁/转化/跳决策细节 + 转化时的 NestJS/Prisma/ESLint 映射（标 TRANSLATED-TO）
- Sub-plan 2：每个 rule / command / skill 候选的 path 触发条件 / settings.json allow 清单具体补哪些 / nativewind 等价物形式（Tailwind / nativewind / 其他）
- Sub-plan 3：lefthook hook 新增项的具体 regex / workflow 是否引入哪些 / PR template 段措辞

## Out of Scope（整体不做）

- ❌ 不迁回 mono 主动淘汰的项（spec-symlink 整套护栏 / 三仓 mirror / Java 编码规约 / speckit-git-* 5 个 skill / meta-root README 类按需文档等）
- ❌ 不修改 mono 独家增量（`pr-creation-protocol` / `docs-organization` / `mono-worktree` skill / 5 个新 hook / 3 hard-gate checkbox / nx-claude-plugins marketplace / extraKnownMarketplaces / preset-modification rule 等）
- ❌ 不做 `.specify/` 体例 / `constitution.md` 迁移（之前明示对比 scope 不含）
- ❌ 不做 `.github/CODEOWNERS` 迁移（meta 三仓全空 solo dev，mono 也空）
- ❌ 不写新的 ADR（meta 时代的 ADR-0010 / 0015 / 0017 / 0024 等已在 mono 复用 / 重写；新增 ADR 走业务 PR 各自决策）
- ❌ 不迁 `build-image.yml` / `deploy.yml` / `release-please.yml` 等 Plan 3 范围（DEFER plan3）
- ❌ 不动 mono 已有的 `.claude/settings.local.json`（个人本地状态，不参与跨仓 mirror）

## 终局验收（master plan 自身，3 phase 全 ship 后）

用 `claude-md-audit` skill 整体跑一遍 mono，4 项全过 = 验收通过：

1. **体积预算**: Always-load total token < 5000 / 单 convention 文件 < 1500 / `@import` 深度 ≤ 2 / 跨文件重复率 = 0  
   测：`for f in $(grep -oE '@\S+\.md' CLAUDE.md | sed 's/@//'); do wc -c "$f"; done | awk '{s+=$1} END {print s/4}'`
2. **反模式扫描**: `claude-md-audit` § 4 表 7 反模式整仓 0 命中（含 § 4.1 手写镜像深析）
3. **段级深挖**: § 3.1 跑每个新增 / 改动段，4 killer questions 无升级 finding
4. **行为层 sanity**: 起一个新 Claude session，问 5 个典型问题（如「mono 怎么创 PR」/「加新 module 路径在哪几处」/「per-feature 端口隔离怎么做」/「SDD 流程几步」/「commit message 体例」），全部 Claude 主动应用 mono 现状规范（不引 meta 三仓体例）

## Verification（master plan 自身）

- ☐ 3 sub-plans 各自完成 `/plan` 会话 + Accepted（user 在每个 sub-plan 单独 ExitPlanMode 批准）
- ☐ Phase 1 全部 sub-PR merge（phase 内顺序无锁）
- ☐ Phase 2 全部 sub-PR merge
- ☐ Phase 3 全部 sub-PR merge
- ☐ 终局验收 4 项全过
- ☐ 本主 plan + 3 sub-plans 全部 `git mv` 到 `docs/plans/2026-05/` 约定路径
- ☐ 所有 `.before-migration.md` backup 副本已删 + `.gitignore` entry 已清

## Risk + Rollback

| 风险 | 缓解 |
|---|---|
| 4 类淘汰标准在子 plan 内 ad-hoc 偏移（栈相关 → 转化迁移频次过高） | 子 plan 内每个 `TRANSLATED-TO` 注释必须显式列 Java→TS 映射理由；master plan reviewer 抽审；优先 DROP 而非 TRANSLATED-TO（per memory `feedback_pivot_skip_old_adr_binding`） |
| `.before-migration.md` backup 副本被误 commit | `.gitignore` 立 PR 前先加 `*.before-migration.md` glob；每 sub-PR 起手 `git status -s | grep before-migration` 自查 |
| Phase 1 段级迁移后 always-load token 超 5000（claude-md-audit 红线） | Phase 1 收尾必跑 token 估算；超限触发段级再深挖 + 二轮裁剪（不进 phase 2）；optional：拆 always-load → trigger-read |
| 子 plan 内发现 master plan 4 类淘汰标准不合理（如发现第 5 类） | 允许子 plan 反推改 master plan 4 类清单（显式 commit message + amend master plan + 在子 plan 顶部留 `<!-- AMENDS-MASTER -->` HTML 注释） |
| Phase 间 main drift 累积导致下一 phase sub-PR conflict | 每 phase 全 merged 后下一 phase 起手强制 `git rebase main`；并发开 sub-PR 时本地 `git pull --rebase` |
| Sub-plan 落细节时发现 master plan 接口契约不合理 | 子 plan 通过修改本主 plan「跨阶段契约」段反推（不允许默默偏离） |
| 临时 `.before-migration.md` 留存超 1 周不删 | 每 sub-PR 起手 find 整仓 `find . -name '*.before-migration.md' -mtime +7`，alert 后强制清 |

## On Ship 备注

本 plan 当前在 plan-mode scratch 路径 `docs/plans/1-plan-05-22-test-infra-master-plan-2-s-breezy-patterson.md`。

**Phase 1 第一个 sub-PR ship 时**同 PR 内 `git mv`：

```text
docs/plans/1-plan-05-22-test-infra-master-plan-2-s-breezy-patterson.md
  → docs/plans/2026-05/05-23-claude-config-meta-to-mono-master.md
```

子 plan 各自 PR 内同样按 [docs-organization](../conventions/docs-organization.md) 约定 `git mv`：

```text
docs/plans/2026-05/05-23-claude-config-meta-to-mono-p1-claude-md-imports.md
docs/plans/2026-05/05-23-claude-config-meta-to-mono-p2-claude-dir.md
docs/plans/2026-05/05-23-claude-config-meta-to-mono-p3-automation.md
```

## 前置：上轮对话 inventory 状态

本 plan 基于 2026-05-23 mono vs meta 三仓 Claude cwd 配置对比报告（chat 上一轮节点 + 2 个 Explore agent 输出）。每个子 plan 起手应：

1. 重跑该 dimension 的 Explore agent inventory（验证 chat context 中的数据仍 fresh）
2. 用本主 plan 的 4 类淘汰标准 + 接受标准做候选清单过滤
3. 逐文件走 4 步迁移操作流程

子 plan 不需要重复主 plan 的 4 类淘汰 / 接受标准 / 操作流程 — 直接引用即可。
