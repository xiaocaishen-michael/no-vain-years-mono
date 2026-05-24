# 改造计划：spec-kit preset + orchestrator 对齐 ADR-0043 扁平+贫血范式

> 主计划 + 两子计划（PRESET / MONO），合一文件内分 § 主计划 / § 子计划 A PRESET /
> § 子计划 B MONO（单日工作量不另拆 3 文件，避免过度工程）。

## Context（为什么做）

服务端架构已 pivot 到 **ADR-0043 扁平 + 贫血范式**（flat module / 裸 Prisma row +
`@map` / `*.rules.ts` 纯函数 / 无 repository / 跨 ctx 调 UseCase + 两段式
Inspect+Commit saga / 零-class），ADR-0020（hexagonal 四层 + repository）已
Superseded。但驱动 SDD 的两套工具链仍残留旧范式：

1. **spec-kit preset `mono-orchestrator-ready`**（vendored 自 `michael-speckit-presets`）
   的模板里有 DDD entity 字段（`aggregate_root` / `domain` DDD subdomain）、错路径
   `src/modules/<module>`（实际是扁平 `apps/server/src/<module>/`，已 `ls` 验证无
   `modules/` 目录）、废 ADR 引用 + 错插件名 `@nx/enforce-module-boundaries (per
   ADR-0020)`（实际 `eslint-plugin-boundaries` per ADR-0032/0043）、`Repository`
   生命周期残留、`libs/db` 不存在 import。
2. **orchestrator**（`scripts/orchestrator/`，mono 自有非 preset）的 `EntitySchema`
   把 `aggregate_root` 设为**必填但全仓零消费**；fixture 的 `graphify_scope` 用
   stale 错路径 → 跑 graphify 拉空 code context（静默降级无报错）。

更关键：**新范式当前对 implement-loop 完全隐形**——preset 模板和 orchestrator
prompt 都不主动喂 ADR-0043；无头 `claude -p` 跑在 mono 根虽自动加载 CLAUDE.md，但
ADR-0043 只在「按需 read」表里（不 push），~5 turns 限制下 LLM 基本不会主动去读。

**意图结果**：把两套工具链从「旧范式默认引力」翻转为「新范式默认引力」，赶在
Plan 2 批 B（下一个 orchestrator-驱动 feature）起手前完成，避免生成回 hexagonal
味道的代码。今天不着火（orchestrator 至今只跑过 A-002 PoC，批 A 是交互式手做），
但这是下一个 feature 起手就会踩的地雷。

## 调研结论（已验真）

| 子系统 | 受影响 | 证据 |
|---|---|---|
| orchestrator 代码逻辑 | ❌ 架构无关 | prompt 数据驱动自 plan.md（`prompt-assembler.ts:33-45`）；cwd=repoRoot（`run-feature.ts:347-353`） |
| orchestrator `EntitySchema` | ⚠️ 局部 | `aggregate_root` 必填零消费（仅 schema+1 fixture+1 test）；`graphify_scope` fixture stale |
| preset `constitution.md` | ✅ 已对齐 | v1.1.0 已重写为扁平+贫血+零-class |
| preset frontmatter `spec.zod.ts` | ✅ 干净 | 无 DDD 字段（entities 块由 orchestrator 校验，非此处） |
| preset `mono-orchestrator-ready` 模板 | 🔴 13 处 stale | 见各子计划清单 |
| 其他 4 个 preset | ✅ 干净 | adr-governance / context7-injection / user-journey-mermaid / task-closure 无 stale |
| 历史 specs/001+002 | ⚠️ stale 引用 | 001 plan.md hexagonal 四层；002 spec.md `src/modules/account` + ADR-0020 链 |

**基线**：upstream `michael-speckit-presets` main 在 **0.3.1**，mono vendored 也是
**0.3.1** → 无 install drift，干净基线。其他 preset 全清。

---

## 主计划：执行序 + 治理边界

子计划拆成 PRESET / MONO 两条**因治理机制不同**（非随意切分）：

- **PRESET 改动**走上游仓 `~/Documents/projects/michael-speckit-presets`（`.specify/presets/<id>/`
  是 install 复制来的快照，**禁止在 mono 直接改**，per `.claude/rules/preset-modification.md`）。
- **MONO 改动**直接编辑（orchestrator 代码 + 历史 specs 不属 preset），唯一例外是
  preset 的「re-install 同步 commit」必须是纯 sync 不含 ad-hoc 编辑。

执行顺序（有依赖）：

1. **PRESET 子计划** → 上游 PR + auto-merge 到 main（0.3.1 → 0.4.0）。
2. **MONO 子计划 Part 1（orchestrator 代码）** → 与 PRESET 并行无依赖。
3. **MONO 子计划 Part 2（re-install 0.4.0）** → 必须在 PRESET merge 到 upstream main **之后**。
4. **MONO 子计划 Part 3（历史 specs banner + 硬伤）** → 独立，任意时机。

---

## 子计划 A — PRESET（上游 `michael-speckit-presets`）

> 从 upstream `main`（@0.3.1）切分支；只动 `presets/mono-orchestrator-ready/`，其余 4 preset 不碰。

### A.1 `templates/spec-template.md`（Key Entities 块）

| 行 | 现状 | 改成 |
|---|---|---|
| L128 | `aggregate_root: required boolean; guides NestJS Service-layer codegen` | **删整行**（字段移除） |
| L129 | `domain: optional DDD subdomain (decoupled from modules frontmatter)` | `domain: optional — owning business module this entity lives in (free-form label, NOT a DDD subdomain)` |
| L140 | 示例 JSON `"aggregate_root": true,` | **删该行** |
| L139 | 示例 JSON `"domain": "<module>",` | 保留（改义后仍有效，被 prompt 渲染为模块标签） |

### A.2 `templates/plan-template.md`

| 行 | 现状 | 改成 |
|---|---|---|
| L44 | `module_boundaries enforces ESLint @nx/enforce-module-boundaries (per ADR-0020)` | `module_boundaries enforces eslint-plugin-boundaries at module level (per ADR-0032 / ADR-0043; ADR-0020 superseded)` |
| L56 | `"module_path": "src/modules/<module>"` | `"module_path": "src/<module>"` |
| L64 | `"graphify_scope": "apps/server/src/modules/<module>/**/*"` | `"apps/server/src/<module>/**/*"` |
| L70 | `"allowed_imports": ["@nestjs/*", "libs/db"]` | `"allowed_imports": ["@nestjs/*"]`（删不存在的 `libs/db`） |
| L231 / L237 | 生命周期 anti-mock 清单含 `Repository` | 从 `Guard/Interceptor/Filter/Pipe/Repository` **删 `Repository`**（ADR-0043 无 repository class） |
| L245 | 示例 `...not at the entity layer` | `...in the *.rules.ts pure-function helper, not inline in the controller`（换扁平范式示例） |
| L19 | `adr_refs ... (e.g., ["0019", "0020"])` | `(e.g., ["0019", "0043"])`（去废 ADR） |

**A.2-NEW（正向 steering，fierce CRITICAL callout）**：把 `### General Architecture Notes`
（~L241-245）的占位示例改为**常驻 banner + 填空区**结构。用 fierce 风格（复用本模板
L226-239 `### 🚨 Testing Invariants` 已确立的 `绝对禁令` 先例，per [[feedback_llm_steering_text_fierce_critical_callout]]）。**此文案与 MONO Part 1-NEW orchestrator 静态段逐字同文**：

```markdown
### General Architecture Notes

> ⚠️ **CRITICAL ARCHITECTURE PARADIGM (ADR-0043 — ENFORCED)**
> The implementer LLM MUST strictly follow the "Flat + Anemic + Moat" paradigm:
> - **Flat Module**: ALL files live flatly in `apps/server/src/<module>/`. NEVER generate `domain/`, `application/`, `infrastructure/`, or `web/` subdirectories.
> - **Anemic Data & Zero-Class**: Data equals raw Prisma rows (snake_case handled by `@map` in schema.prisma). NEVER generate Domain Classes or Entity Mappers.
> - **No Repositories**: NEVER create Repository interfaces/adapters for your own tables. Inject `PrismaService` directly into UseCases. Put business invariants in pure functions (`*.rules.ts`).
> - **The Moat**: NEVER write `tx.<otherTable>.*`. Cross-context access MUST go through the target module's UseCase (use the Two-step Inspect+Commit saga only when caller validation must sit between read and write).

(Write any feature-specific architecture notes here — reuse decisions, schema state, masking points, etc.)
```

### A.3 `templates/tasks-template.md`

- L48 / L51：task-meta 路径示例 `src/modules/<module>` → `src/<module>`。

### A.4 `preset.yml`

- `version: 0.3.1` → `0.4.0`（模板语义变更，minor bump）。
- `description:` 加 changelog 行：`0.4.0 — ADR-0043 alignment: drop DDD entity vocabulary (aggregate_root), fix flat src/<module> paths, eslint-plugin-boundaries (ADR-0032/0043), + flat/anemic positive steering in plan-template`。

### A.5 上游验证 + 合入

- 跑上游 `scripts/verify.sh` + CI `verify-presets.yml`（preset.yml 解析 + 模板有效）。
- PR + auto-merge 到 main。

---

## 子计划 B — MONO（`no-vain-years-mono`）

### Part 1 — orchestrator 代码（直接编辑，mono 自有）

| 文件 | 改动 |
|---|---|
| `scripts/orchestrator/schemas/spec.ts` | L67 删 `aggregate_root: z.boolean()`；`domain`（L66）保留为 `z.string().optional()`（schema 本就是裸 string，DDD 仅在注释/模板，无需动） |
| `scripts/orchestrator/__fixtures__/spec-happy.md` | L65 删 `"aggregate_root": true`（`domain` 保留） |
| `scripts/orchestrator/parsers/spec.spec.ts` | L31 删/改 `expect(...entities[0].aggregate_root).toBe(true)` 断言 |
| `scripts/orchestrator/__fixtures__/plan-happy.md` | L28 `module_path: src/modules/account` → `src/account`；L36 `graphify_scope: apps/server/src/modules/account/**/*` → `apps/server/src/account/**/*` |

**Part 1-NEW（正向 steering，Option A）**：`scripts/orchestrator/prompt-assembler.ts`

- 加 `function paradigmSection(): string`，返回静态段，标题 `## Architecture Paradigm (ADR-0043 — ENFORCED)`，body 用 **A.2-NEW 逐字同文的 4 条 fierce bullet**（Flat Module / Anemic Data & Zero-Class / No Repositories / The Moat）。两层都会 fire = 故意 defense-in-depth（plan 期 + implement 期），per [[feedback_llm_steering_text_fierce_critical_callout]]。
- `buildPrompt`（L37 之后）插 `sections.push(paradigmSection());`——置于
  `architectureNotesSection(plan)`（通用范式）与 `techConstraintsSection` 之间，使
  「静态范式 → plan 特定 notes」由通到专。
- `scripts/orchestrator/prompt-assembler.spec.ts`：happy-path 测试（L48-73）加
  `expect(prompt).toMatch(/## Architecture Paradigm/)` + 关键 bullet 断言。

> 设计依据：Agent 实证 `aggregate_root` blast radius 仅 3 处；`graphify_scope` 是唯一
> 功能 bug（stale 路径 → 空 code context）；prompt 不读任何 convention/ADR 文件，静态段是
> 让新范式必达 implement LLM 的唯一可靠注入点。

### Part 2 — preset re-install（纯 sync commit）

1. PRESET 子计划 merge 到 upstream main **后**，跑：
   `~/Documents/projects/michael-speckit-presets/scripts/install.sh --repo . --preset mono-orchestrator-ready`
2. 覆盖 `.specify/presets/mono-orchestrator-ready/*`（+ vendored `spec.zod.ts` / `check-spec-frontmatters.ts`）到 0.4.0。
3. commit「chore(repo): install mono-orchestrator-ready 0.4.0」——**纯同步，不含 ad-hoc 编辑**（per preset-modification.md）。

> 注：preset 改的是 entities **示例**；frontmatter schema（`spec.zod.ts` / lefthook
> `check-spec-frontmatters`）无 `aggregate_root`（它在 entities 块，归 orchestrator
> 校验），故 re-install 不会破现有 spec 的 frontmatter 校验。

### Part 3 — 历史 specs banner + 硬伤（per Q3 历史隔离带方案）

1. **挂 Deprecation Banner**（`specs/001-phone-sms-auth/spec.md` + `specs/002-account-profile/spec.md`
   顶部；001 的 hexagonal 散文在 `plan.md`，故 `001/plan.md` 也挂一份）：

   ```markdown
   > ⚠️ **[ARCHITECTURE GOVERNANCE NOTE (2026-05-24)]**
   > This spec was implemented under the legacy Hexagonal/DDD architecture.
   > The narrative (e.g., "aggregate root", "hexagonal layers") is preserved for historical record.
   > However, future implementations MUST follow the **Flat + Anemic + Moat** paradigm defined in **[ADR-0043](../../docs/adr/0043-server-flat-module-paradigm.md)**.
   ```

2. **修物理硬伤**：`specs/002-account-profile/spec.md` 全局 `src/modules/account` → `apps/server/src/account`（Agent 命中 L36，执行时 grep 全文兜底）。
3. **修权威死链**：`specs/002-account-profile/spec.md` L439（`per ADR-0020）仍 0 violation`）+ L679（链接 `[ADR-0020](../../docs/adr/0020-module-boundary-nestjs.md)`）→ 改指 ADR-0032/0043。
4. **留存散文**：001/002 里讨论 `domain` / `aggregate` / hexagonal 的纯文字段落不动（banner 下的历史留痕）。

---

## 关键文件清单（按子计划）

- **PRESET（上游仓）**：`presets/mono-orchestrator-ready/{templates/spec-template.md, templates/plan-template.md, templates/tasks-template.md, preset.yml}`
- **MONO orchestrator**：`scripts/orchestrator/{schemas/spec.ts, prompt-assembler.ts, prompt-assembler.spec.ts, parsers/spec.spec.ts, __fixtures__/spec-happy.md, __fixtures__/plan-happy.md}`
- **MONO 同步**：`.specify/presets/mono-orchestrator-ready/**`（由 install.sh 覆盖，勿手改）
- **MONO 历史 specs**：`specs/001-phone-sms-auth/{spec.md, plan.md}`、`specs/002-account-profile/spec.md`

## Verification（端到端验证）

1. **PRESET**：上游 `scripts/verify.sh` 绿 + `verify-presets.yml` CI 绿；`preset.yml` version=0.4.0。
2. **orchestrator 单测**：`pnpm nx test orchestrator --skip-nx-cache`（首跑带 `--skip-nx-cache`
   防 cache 假绿，per 经验）→ `spec.spec.ts` + `prompt-assembler.spec.ts` 改后断言全绿；
   新 `paradigmSection` 被 happy-path 断言命中。
3. **re-install 后**：`git diff .specify/presets/mono-orchestrator-ready/` 显示 0.4.0 内容 +
   version 已 bump；跑 `pnpm tsx scripts/check-spec-frontmatters.ts specs/001*/spec.md specs/002*/spec.md`
   确认现有 spec frontmatter 仍过。
4. **历史 specs**：commit 前跑 markdownlint pre-flight（per 经验）；`rg 'src/modules/account|0020-module-boundary' specs/002*` 归零。
5. **范式可达性 sanity**：检查 re-install 后的 `.specify/presets/mono-orchestrator-ready/templates/plan-template.md`
   确含 ADR-0043 引导段；orchestrator 静态段经 #2 单测确认进 prompt。

## 风险 / 注意

- `.specify/presets/` 禁直接改——Part 2 走 install.sh，违反会被下次 install 静默覆盖。
- orchestrator `domain` 字段保留：schema 是裸 string，改义只在 preset 模板注释，无需动 schema/fixture（spec-happy.md 已有 `"domain": "account"`）。
- 历史 specs 改动是文档级、低风险，但属本轮 scope 边缘（Q3 已确认纳入「硬伤+banner」最小集）。
- 本计划合一文件交付（master + PRESET + MONO 三段），未拆 3 文件 —— 单日工作量，3 文件交叉引用属过度工程（senior-engineer-test）。
