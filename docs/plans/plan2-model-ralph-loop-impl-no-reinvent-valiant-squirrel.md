# Plan 2 模型路由 + Ralph loop 执行方案(No reinventing the wheel)

> **Status**: drafted 2026-05-19 v3(per user input on clarify + orchestrator + /model 切换 + 前置章节拆 spec-kit preset 定制),plan-mode pending approval
> **Supersedes**: PR #34 amend 的"§ 2.2.5 + § 4 deferred"半决策状态
> **Trigger**: 架构师 input 提议 Bun orchestrator / LangGraph.js;Phase 1 exploration 发现 spec-kit Workflows YAML 已 vendored 但**缺 clarify / analyze step**,改变 calculation

## 0. 前置(独立 plan,不在本 plan scope)

**spec-kit preset 定制**(workflow.yml override + clarify/analyze step 补全 + `.specify/extensions.yml` 落地 + michael-speckit-presets 联动等)由**独立 plan 文件**承载,**不**在本 plan scope:

- **预计文件**: `docs/plans/plan2-spec-kit-preset-customization-<slug>.md`(slug 起 plan 时按现行 random 生成约定 assign)
- **scope 包括**:
  - `.specify/workflows/speckit/workflow.yml` 项目级 override(8 步流转,补 clarify / analyze)
  - `.specify/extensions.yml` `before_implement` / `after_implement` hook 落地(若 002 撞需求)
  - michael-speckit-presets 与项目 override 联动(task-closure / context7-injection / user-journey-mermaid 3 preset 已装,检查 hook 注入边界)
  - `speckit workflow run` CLI 命令可用性 fact-check + 降级路径
- **触发**: 本 plan ship 后立即起草独立 plan(在 002 feature 起步前 ship,否则 002 Stage 1 走手动 /speckit-X 不走 workflow run)
- **本 plan 与独立 plan 依赖关系**:
  - 本 plan **假设** 独立 plan 落 workflow.yml override 后,Stage 1 走 8 步 gated pipeline
  - 若独立 plan 延期或回滚,本 plan Stage 1 降级 manual `/speckit-X`(其余架构决策不受影响)

**本 plan 焦点**: Stage 2 implement 阶段的 model routing + halt-retry orchestration + 自写 orchestrator 边界。Stage 1 的 step 补全细节、CLI 调用、preset 联动等**全部移到独立 plan**。

---

## Context

PR #34 (2026-05-19) 把"Wiggum CLI + Bridge Adapter PoC"标 deferred,理由是"`/speckit-implement` 原生覆盖 + 002 起步实践驱动决"。架构师后提议双层架构(YAML 控制平面 + Bun/TS 执行平面)或 LangGraph.js。

Phase 1 exploration 揭示 4 个关键事实(2 项**改变**前次 calculation):

1. **spec-kit Workflows YAML 已 vendored** at `.specify/workflows/speckit/workflow.yml`,upstream 含 6 步:`specify → review-spec(gate) → plan → review-plan(gate) → tasks → implement`。**缺 user 必需的 `clarify` step**,缺 `analyze` step。
2. **`/speckit-implement`** 原生走 tasks.md 全 `[ ]` task,**halt on test-fail 不自动 retry**(SKILL.md L168);LLM 自己 flip `[X]` + 每 task commit。
3. **`/model sonnet` 是 user-only 交互命令**,LLM **无法**通过 Skill / SlashCommand 工具调用切换(per claude-mem cache changelog 验证);workaround 仅有 spawn 新 Claude Code subprocess `claude --model sonnet`(创建新 session,**非**切换当前 session)。
4. **`/loop` skill** 是 Claude Code built-in,dynamic mode 让 model 通过 ScheduleWakeup 自定下次唤起延迟;preserve context;只重投同 prompt(不带 task-#)。

架构师的"YAML 不能表 while-loop"判断正确,但 YAML **本就不应**表;`/loop` / orchestrator 才是 loop 层。

**Plan v1 决策**:reject 自写 orchestrator,纯 `/speckit-implement` + `/loop`。
**Plan v2 user 调整**:接受自写 orchestrator(为 flexibility/扩展性),但保留 2a 作 baseline,数据驱动升 2b。

## Recommended approach

### Stage 1: spec → implement gate-pipeline(Opus 主导,gate 驱动)

**目标 workflow 形态**(8 步流转,✦ 标新增):

```
specify → ✦clarify → review-spec → plan → review-plan → tasks → ✦analyze → implement
```

| # | step | rationale |
|---|---|---|
| 1 | specify | upstream 沿用 |
| 2 | **clarify** | **user 明确需要;消除 spec 歧义后再 review** |
| 3 | review-spec | upstream 沿用,扫 spec + clarify 联合 |
| 4 | plan | upstream 沿用 |
| 5 | review-plan | upstream 沿用 |
| 6 | tasks | upstream 沿用 |
| 7 | **analyze** | **跨 spec/plan/tasks 一致性扫描,implement 前必跑** |
| 8 | implement | upstream 沿用,切到 Sonnet 后跑;**analyze 与 implement 之间无显式 YAML gate**,user 读 analysis.md 自主决断 + 同步敲 `/model sonnet` |

**实施载体**: 见 § 0 前置 — **`.specify/workflows/speckit/workflow.yml` 项目 override 由独立 plan 承载**,本 plan 仅声明目标形态。

**调用方式**(由独立 plan 实测决):
- 优先尝试 `speckit workflow run speckit` CLI 命令
- 若不可,降级手动 `/speckit-X` 逐步;本 plan 其余架构决策不受影响

**为什么不 fork SKILL.md**:per memory `feedback_speckit_native_extension_over_skill_fork`,workflow.yml 是 spec-kit 显式 stable extension API,override 不破升级路径。

### Stage 2: implement(Sonnet,渐进自动化,扩展性优先)

**核心约束**: `/model sonnet` 是**user-only 命令**,LLM 无法自动切。Stage 1 → Stage 2 必须**user 介入 1 次**:
1. Stage 1 `analyze` step 跑完,产出 `analysis.md`(无显式 gate,user 自主决)
2. user 读 `analysis.md` 觉 OK,**在 prompt 框敲 `/model sonnet`** — 切到 Sonnet
3. user 启动 Stage 2(手动 `/speckit-implement` 或 `pnpm orchestrate <feature>`,见下)

#### 2a baseline(002 默认路径)

```
[user: /model sonnet]
[user: /speckit-implement]
  ↓
/speckit-implement 内部 phase batching (Setup/Tests/Core/Integration/Polish)
  ↓
per task: 红 → 绿 → typecheck/lint → flip [X] → git add → commit
  ↓
halt-on-fail (e.g. test 失败 / typecheck error)
  ↓
[user: 手动修 → /speckit-implement 重投(skip 已 [X] 行,自动从断点继续)]
```

**触发 2b 升级的数据**(在 `.specify/implement-halts.log` 采):
- ≥ 3 halt 同形态(e.g. 3 次 lint-error-self-recoverable)
- ≥ 1 unrecoverable halt(spec gap / infra 红线)
- user 主观体感差(无 quantitative 阈值,主观决断)

#### 2b 自写 orchestrator(扩展性优先,user 决择)

新建 `scripts/orchestrator/run-implement.ts`(~150-250 LoC,Node 22 + tsx,**非 Bun**)。

**接口契约**:
```bash
pnpm orchestrate <feature-NNN> [--max-retries 3] [--halt-on unrecoverable]
# 例:pnpm orchestrate 003 --max-retries 5
```

**职责边界**(only what /speckit-implement 不做):
- ✅ **halt-retry**: 解析 Claude Code subprocess exit code + stderr,识别 halt 形态,**有限 retry**(默认 3 次,可参数化)
- ✅ **halt 自动 log**: 写 `.specify/implement-halts.log` 替代 user 手动 append
- ✅ **TDD 内层循环占位**: retry 时把 test 错信息作 prompt context 注入(为未来 LangGraph-style 扩展留口)
- ✅ **可选 model spawn**: `--model sonnet` flag 给 `claude` subprocess(per fact-check workaround),**non-default**,留作未来 unattended job 用

**职责外**(不做):
- ❌ **不**重写 `/speckit-implement` phase batching — 把 Claude Code subprocess 当黑盒,只看 exit code + 文件状态
- ❌ **不**做跨 session 状态 persistence(per `reference_claude_code_clear_resets_cwd` `/clear` 重置 cwd bug,跨 session 假设危险);tasks.md `[X]` 是唯一 checkpoint
- ❌ **不**做 model 切换决策 — 由 user 在 invoke orchestrator 前手动 `/model sonnet`
- ❌ **不**做 Stage 1 自动化 — Stage 1 由 workflow.yml gate 主导,人工 review 不可省

**实施时机**:
- **本 plan ship 后不写**(只标 "数据驱动后写")
- 002 跑完 2a baseline → 看 halt-log → 触发条件满足才动 003+ 时手写
- 写完 003 跑一遍后实测 vs 2a 体感对比,若收益 < 30% → 回滚 2a

**为什么不一步到位写**:CLAUDE.md "Don't design for hypothetical future requirements";002 真实数据来之前任何 orchestrator 复杂度都是猜测。

### Model switching: 全程 user 主导(operational reality)

| 阶段 | 模型 | 切换方式 |
|---|---|---|
| Stage 1 全程 | Opus | session 默认或 user 启动时设 |
| Stage 1 → Stage 2 | Opus → Sonnet | **user 读完 analysis.md 自主决断后手敲 `/model sonnet`**(LLM 无法自切;无显式 YAML gate) |
| Stage 2 全程 | Sonnet | 持续 |
| Feature 结束 | 任意 | user 决定下 feature 起步前是否 `/clear` |

**per-task 切换**: ❌ 不做。`/clear` 已知 cwd reset bug + `/speckit-implement` 内部 phase batching 依赖连续 context。

### 上下文与 checkpoint

**tasks.md `[X]` flip 就是 checkpoint** — git-tracked / human-readable / `/speckit-implement` 重投时 skip `[X]` 自动从断点继续。**不**引入额外 JSON state file。

架构师 LangGraph.js checkpointing 需求**已被现有设计满足**,REJECT。

## 永久 drop / reject

| 工具 | 原状态 | 新状态 | 理由 |
|---|---|---|---|
| **Wiggum CLI** | deferred | **DROPPED** | npm `wiggum-cli` solo maintainer + 9 stars + alpha;`/speckit-implement` + orchestrator 覆盖职责 |
| **LangGraph.js** | 架构师建议 | **REJECTED** | 1000+ LoC 框架 vs 50-250 LoC 自写;solo dev mono PoC 不需要 multi-agent fan-out;Plan 3 若引入并行 agent 再评估 |
| **xState** | 架构师建议 | **REJECTED** | 同上 |
| **Bun runtime** | 架构师建议 | **REJECTED** | Plan 1 锁 Node 22 LTS,无 use case;orchestrator 用 tsx |

**注**:原 plan2 § 2.2.5 "Bridge Adapter PoC" 名称改用更直接的 "orchestrator(self-written)";职责 = 2b 升级路径,scope 仅 Stage 2 halt-retry,不跨 Stage。

## Critical files

```
docs/plans/plan2-plan3-clever-sutherland.md                              # Plan 主文件,本 plan ship 后 amend
docs/plans/plan2-model-ralph-loop-impl-no-reinvent-valiant-squirrel.md   # 本 plan(archive)
docs/plans/plan2-spec-kit-preset-customization-<slug>.md                 # § 0 前置,独立 plan,起草中
.specify/implement-halts.log                                             # 2a baseline 起首次 halt 时新建(本 plan scope)
scripts/orchestrator/run-implement.ts                                    # 2b 触发后新建,~150-250 LoC tsx(本 plan scope)
scripts/orchestrator/package.json                                        # 子 package 或 mono root scripts 字段二选一
.claude/skills/speckit-implement/SKILL.md                                # 只读 reference
.claude/skills/speckit-analyze/SKILL.md                                  # 只读 reference

# 以下文件由 § 0 前置独立 plan 拥有,本 plan 不动:
.specify/workflows/speckit/workflow.yml (vendored upstream)              # 只读
.specify/workflows/speckit/workflow.yml (项目 override)                   # 由独立 plan 落
.specify/extensions.yml                                                  # 由独立 plan 落(若 002 撞 hook 需求)
```

## 实施步骤

### Phase 0 收尾(本 plan ship)

**PR 1: 本 plan 文件 ship**(独立 PR `docs/plan2-impl-arch-no-reinvent`)
- 落 `docs/plans/plan2-model-ralph-loop-impl-no-reinvent-valiant-squirrel.md`(本文件)
- 在 commit message + PR description 明确 reference § 0 前置独立 plan(尚未起草)

**PR 2: plan2 主文件 amend**(分独立 PR 或同 PR 都可)
- § 2.2.5 改 "deferred" → "DROPPED + 改名 orchestrator(self-written,见本 plan § Stage 2 2b)"
- § 4 工具链表:Wiggum CLI 行 DROP / Bridge Adapter 行改名 + status "data-driven";Workflows YAML 行改 "scope 移交独立 plan(spec-kit preset 定制),本 plan 声明目标形态"
- § 2.4 Stage 2 工作流 box 重写,补 `/model` 手动切换 + orchestrator 触发条件
- 新建 § 2.4.1 "implement 升级策略 + halt-log 规范"

**PR 3: workflow.yml override / 独立 plan 起草**(由 § 0 前置独立 plan 承载,**不**在本 plan PR scope)
- 本 plan ship 后立即起草 `docs/plans/plan2-spec-kit-preset-customization-<slug>.md`
- 独立 plan 自带 ExitPlanMode + 独立 PR ship 路径
- 完成时机:002 feature 起步前(否则 002 Stage 1 走 manual fallback)

### 002 feature 起步(下 session,本 plan ship 后)

per 已落 [[project-plan2-spec-merge-user-gate]] memory:
- **user 给 server+app spec 合并约束**
- Stage 1: workflow run 或手动 `/speckit-specify` → `/speckit-clarify` → review-spec → `/speckit-plan` → review-plan → `/speckit-tasks` → `/speckit-analyze`(无 review-tasks gate,user 读 analysis.md 自决)
- Stage 2 manual switch: **user 敲 `/model sonnet`**
- Stage 2 baseline: `/speckit-implement` + 手动 append halt 到 `.specify/implement-halts.log`
- 002 ship 后看 log 决 003+ 升级 2b

### 003+ 决断点

- halt-log ≥ 3 同形态 OR ≥ 1 unrecoverable → **写 `scripts/orchestrator/run-implement.ts`**(本 plan §"2b" 接口契约)
- 否则维持 2a manual

## Verification

### Plan ship 验证(本 plan)
- [x] Phase 1 Explore 验 workflow.yml 缺 clarify / analyze / review-tasks gate
- [x] Phase 1 Explore 验 `/model sonnet` LLM 无法自切
- [x] Phase 2 Plan agent 独立验证架构选择
- [x] user 修订 2b 路线后 fact-check 二次 confirm

### Plan 实施验证(002 ship)
- workflow.yml override 实测 `speckit workflow run speckit` 命令通(若 spec-kit 0.8.7 CLI 不支,降级手动)
- 002 全程 `.specify/implement-halts.log` ≥ 5 行采样(or 0 halt = 数据)
- 002 通过 SDD 6 步闭环全绿 + Per-feature PR 边界
- 002 工时 vs 估算 3-5 天对比;偏差 > 50% → calibrate

### orchestrator 实施验证(2b 触发后,003+)
- `pnpm orchestrate 003 --max-retries 3` 跑通完整 implement
- vs 2a 体感对比,收益 ≥ 30% 维持,否则回滚

### Stop signals
- workflow.yml override 写完跑不通 + 手动 fallback 也卡 → 重启 plan
- 002 halt 数据触发 2b 但 orchestrator 实测 worse 于 2a → 重启 plan
- `/model sonnet` user 漏切 → CI 中无法验证(spec-kit-tasks-verify 不查 model),只能靠 user discipline + retrospective

## Open questions(本 plan ship 前不必 close)

1. `.specify/extensions.yml` `before_implement` / `after_implement` hook 是否需要?**defer 到 002 撞具体 hook 需求时决**
2. `claude-mem:do` skill 与 `/speckit-implement` 关系?**defer 到 claude-mem 2-day A/B 决断后再评估**
3. orchestrator 是否做"自动 commit on halt-recover"?**defer 到 2b 触发时决**(可能"红测期间不 commit,绿后 commit" 比当前每 task 不变 commit 更干净)
