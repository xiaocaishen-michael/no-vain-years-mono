# p1 — orchestrator 消费契约重组（spec→prose / entities→plan / schema 对齐 / 钉死 gate）

> 隶属 [双流对齐 master](05-26-orchestrator-command-parity-master.md)。解 master § 1 的 Layer 0 + Layer 2 + 根因（无钉死 gate）。**目标导向**：让命令流产出的 feature 能被 orchestrator 端到端 parse，同时让 `spec.md` 回归上游 prose-only。**p2 的前置**。

## 1. 目标（Why）

- 当前仓内**零** feature 能被 orchestrator 完整 parse（连黄金参照 002 都因 `_note` 炸）。
- `spec.md` 带 orchestrator metadata 是迁移 PoC 的产物，逆上游「spec=prose」设计，且 `/speckit-specify` 根本不经 resolver 产不出它。
- meta 需求实证（master § 1.3）：执行必需 meta 全在 tasks/plan/graphify，spec 只供 prompt 需求文本（大部分在 prose 里）。

→ **把 orchestrator 对 spec.md 的机读依赖降到「prose 可满足」，结构化数据归位 plan，并加 gate 防再漂。**

## 2. 设计取舍（先定方向，再细化）

| 维度 | 选择 | 备选 |
|---|---|---|
| spec.md 形态 | **回归上游 prose-only**（无 us-meta/fr-meta/cl-meta/entities JSON） | 保留 metadata（逆上游、specify 产不出，**否决**） |
| US/FR/SC 来源 | SpecAnalyzer **prose-tolerant**：从 `### User Story N …(Priority: Px)` / `- **FR-NNN**: text` / `- **SC-NNN**: text` 抽 id+text+priority | 移到 plan（需求文本进 HOW 工件，语义错位，**否决**） |
| entities（数据模型） | **完全迁入 plan.md，spec 侧不留任何 entities**（以终为始、一步到位；plan 本就经 resolver、endpoint 本就以 `E-id` 引、属 HOW 工件） | spec 留轻量 entities 段（半吊子，**否决**）/ 砍掉（endpoint 引不到，**否决**） |
| FR 优先级（must/should/may） | prose 无 → 缺省 `should`，或 plan 侧可选标注 | 强制 spec 写（又退回 metadata，**否决**） |
| trace 完整性校验 | `task.trace_fr ∈` prose 抽出的 FR id；`feature_id` 三处相等保留 | 取消校验（丢一致性 gate，**否决**） |
| 钉死 gate | **CI 跑 orchestrator parser × `specs/*`**（改动即扫），不过即红 | 只人工 dry-run（= 现状，静默漂，**否决**） |

## 2.1 前向兼容设计原则（关键，per 用户 2026-05-26 —— 「meta 多一个元素 analyzer 不能炸」）

analyzer / schema 必须对 **additive 变更前向兼容**：

- **未知 key 默认忽略不报错**：Zod `z.object` 默认 strip 未知键（**不要** `.strict()`）；新增字段一律 `.optional()` → 老 parser 读新文件不炸、新 parser 读老文件不炸。
- **`z.record` 处加 `_`-前缀豁免**：人读注释（如 002 炸点 `module_boundaries._note`）不当数据条目 —— record parse 前过滤 `_`-前缀 key。
- **prose 抽取同理**：正则只认目标 pattern，spec 多写段落 / 加字段不影响抽取。
- **gate 含 additive 回归测试**：「往 spec/plan 注入一个未声明新字段 → parse 仍通过」钉成不变量。

## 3. 交付物（file-by-file，待细化）

| 文件 | 动作 | 要点 |
|---|---|---|
| `scripts/orchestrator/parsers/spec.ts` | 改 | `extractUserStories`/`extractFunctionalRequirements`/`extractClarifications` 去掉对 `<!-- *-meta -->` 的硬依赖，改 prose 抽取；US 优先级读 heading；FR 优先级缺省 |
| `scripts/orchestrator/schemas/spec.ts` | 改 | `UsMeta`/`FrMeta`/`ClMeta` 退化/移除；`SpecFrontmatterSchema` 评估保留字段（feature_id 匹配等仍需）；移除 entity 相关（迁 plan） |
| `scripts/orchestrator/schemas/plan.ts` + `parsers/plan.ts` | 改 | `OrchestratorConfig` 加 `entities`（迁自 spec `EntitiesBlockSchema`）；prompt-assembler 改从 plan 取 entities；修 `module_boundaries` 容忍 `_note`（或挪注释出 JSON）；api `auth` enum 已是 `public|bearer|api_key`（核对模板注释） |
| `scripts/orchestrator/prompt-assembler.ts` | 改 | `specSection` 改从 prose-parsed 结构取；entities 改从 plan 取 |
| preset 仓 3 template | 改（走 [preset-modification](../../.claude/rules/preset-modification.md) roundtrip） | spec-template 去 metadata 脚手架回 prose；plan-template 加 entities 块 + 修 §4 5 点 drift（task-meta `parallel`/`kind` 加 `verification`、cl-meta、entity relations 注释）；bump version |
| `scripts/checks/` + lefthook/CI | 新增 | **orchestrator-parse-gate**：对 staged/`specs/*` 跑 parser，fail → red（钉死契约，per [[reference_scripts_checks_vs_preset_pinned]]） |
| `scripts/orchestrator/schemas/spec.ts` 校验脚本 | 顺带 | 002 等历史 spec 一并对齐到新契约（或标 archived 不强求） |

## 4. 已定决策（2026-05-26）+ 剩余开放

**已定**：

- entities **完全迁入 plan.md，spec 侧不留**（§2，以终为始一步到位）。
- 钉死 gate **扫 staged + nx affected 的 `specs/*`**；历史 off-schema spec（001/003/004/005）走 **ignore-list / `status: archived` 豁免**，不强制补齐（设计须配合 §2.1 前向兼容，避免新增 meta 元素就炸）。
- 前向兼容为硬不变量（§2.1）。

**剩余开放（细化时定）**：

1. spec.md frontmatter 哪些字段 orchestrator parse 仍需（`feature_id` 必需；其余进 orchestrator 还是只 lefthook 用）？
2. FR 优先级缺省 `should` 对 prompt 质量的影响（p2 可量化）？

## 5. 验收（✅ 全达成，2026-05-26 — mono #209/#210/#211 + presets#19）

- ✅ 干净跑一个命令流 feature（spec 为 prose）→ 端到端 parse 通过：黄金参照 **002 复活**（`pnpm tsx scripts/orchestrator/parse-gate.ts` → `✅ 002-account-profile`），001/003/004/005（manual-SDD，无 `orchestrator_config`）自动豁免。
- ✅ orchestrator-parse-gate 在 lefthook + CI 生效；「往 orchestrator-shaped feature 注入 drift → red」钉成 `parse-gate.spec.ts` 不变量。
- ✅ `nx affected -t lint typecheck test build runtime-smoke` 绿（orchestrator 342 测，含 §2.1 前向兼容 + 向后兼容 + gate 红绿）。
- ✅ spec-template（presets 0.6.0）回 prose 后，prose 抽取 + 放宽 frontmatter schema 使无-metadata spec 可被消费（Layer 0 消解）。

> **实施偏差记录**：原 §3 把「task-meta `parallel`/`kind` 加 `verification`」归在 preset 模板侧；实证发现是 **mono schema 侧**（`schemas/tasks.ts`）—— 模板早有、schema 从未跟上。拆为 **PR1.5（#210）** 单独落地（详见 [master § p1 落地记录](05-26-orchestrator-command-parity-master.md)）。
