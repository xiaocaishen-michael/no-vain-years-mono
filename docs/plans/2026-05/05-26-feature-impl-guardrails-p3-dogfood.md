# p3 — dogfood：sacrificial mini-feature 跑完整 SDD 验全流程有效

> 隶属 [master](05-26-feature-impl-guardrails-master.md)。本子 plan = **整体有效性验收**（非单元/渲染级）。**依赖 p1 + p2**。一次性 sacrificial feature，验完即弃、**不 merge**。

## 步骤

1. **造 sacrificial feature**（故意**非迁移** + 命中最丰富后端 guardrail）：throwaway 分支起 `999-guardrail-smoke`（**刻意脱离 sequential 编号占高位,避免撞业务 feature 序号**）。设计「登录活动计数」小 server use case：
   - 原子自增计数（→ 触发 conditional UPDATE affected-count）
   - 同 tx 发 outbox 事件（→ 触发 `publish(tx,…)` 同 tx 原子）
   - 查询端点（→ 触发反枚举折叠）
   - 跨 ctx 读（→ 触发 moat CROSS-CONTEXT-* 注释）
2. **跑完整手动 SDD**（command 流）：`/speckit-specify → clarify → plan → tasks → analyze → implement`。

## 断言（全流程吸纳有效，pass = 全绿）

| # | 断言 | 验证层 |
|---|---|---|
| a | **spec 烘焙**：spec.md `state_branches` 自动含并发/反枚举枚举提示（WHAT，**无 HOW 泄漏**）| p2 spec-template |
| b | **plan 烘焙**：plan.md § Architecture Notes 自带 Impl Guardrails callout | p2 plan-template |
| c | **tasks 烘焙**：tasks.md 出独立并发 IT + 反枚举 IT task | p2 tasks-template |
| d | **command 流路径触发**：建 `*.usecase.ts` 时 `.claude/rules/server-impl-playbook.md` 自动进 context | p1 rule |
| e | **orchestrator 流注入**：`pnpm tsx scripts/orchestrator/index.ts specs/999-guardrail-smoke --dry-run` → prompt 的 `specSection` + `architectureNotesSection` 含精华 | p2 template→orchestrator |
| f | **塑形产出**：impl 真守 guardrail —— affected-count（非 `FOR UPDATE`）/ outbox 同 tx / moat 0 违规（`check-server-moat.ts` + 人工复核）| p1 详版 |
| g | **去 Java**：全程无旧 Java 仓 / meta 依赖（**本 master 核心目标**）| 全局 |

## 清理

- sacrificial 分支**不 merge**；验完 `git branch -D` + 删 `specs/999-guardrail-smoke/`。

## 后续：根因深挖 + 独立 plan（2026-05-26）

本 dogfood「副产发现」（orchestrator dry-run 撞 5 处 schema drift）跑全端后深挖，刨到根因：

- **orchestrator 是 impl-only consumer**（只 Zod 解析现成 spec/plan/tasks，不生成）。
- **Layer 0**：`/speckit-specify` 硬编码 P4 vanilla、不经 resolver → 干净命令流产零-metadata spec；plan/tasks 经 resolver→P2 烘焙（正常）。上游 v0.8+ 设计如此。
- **Layer 2**：template ↔ orchestrator Zod schema 无钉死 gate → 静默漂，连黄金参照 `002`（A-002 PoC）都已 parse 失败（#77 往 `module_boundaries` 塞 `_note`）。
- **meta 实证**：Ralph-loop task 的执行必需 meta 全在 plan/tasks/graphify，**零需 spec.md**；spec 只供 prompt 需求文本（大部分在 prose 里）。

完整根因 + 修复（消费契约重组 + impl 双流质量对齐）已拆为独立 plan：

→ **[双流对齐 master：orchestrator 流 ↔ 手动 command 流](05-26-orchestrator-command-parity-master.md)**

至此本 [guardrails master](05-26-feature-impl-guardrails-master.md) 的 p1 / p2 / p3 全部完结。
