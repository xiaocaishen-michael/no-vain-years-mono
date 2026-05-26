# Master：双流对齐 —— orchestrator 流 ↔ 手动 command 流

> 独立 plan。承 [guardrails p3-dogfood](05-26-feature-impl-guardrails-p3-dogfood.md) 跑全端测试刨出的根因（[guardrails master](05-26-feature-impl-guardrails-master.md) 的 p1/p2/p3 已完结）。主-子结构，2 子 plan：**p1 消费契约重组 → p2 impl 双流质量对比**。

## 1. 问题总结（dogfood 深挖出的根因，全代码 + git 实证）

1. **orchestrator 是 impl-only consumer**：不生成 spec/plan/tasks，只用 Zod 解析现成 `.md` 跑 Ralph loop（`index.ts`→`run-feature.ts`）。「双流」只有 **impl 阶段**才真有两条流；specify→tasks 阶段只有命令流，orchestrator 不参与。
2. **spec.md 喂不进 orchestrator —— 双层 gap**：
   - **Layer 0（命令接 resolver 不对称）**：`/speckit-specify` SKILL 硬编码 `cp .specify/templates/spec-template.md`（P4 vanilla）、不经 resolver → 干净命令流产**零 metadata 的 vanilla spec**；`/speckit-plan`·`tasks` 经 `setup-*.sh`→`resolve_template`→**P2 烘焙模板**（正常）。上游 spec-kit v0.8+ 故意设计（specify script-free）。详见 [[reference_speckit_template_resolver_and_command_asymmetry]] / `.claude/rules/preset-modification.md`。
   - **Layer 2（template ↔ schema drift）**：即便用上 P2 orchestrator 模板，模板格式引导与 orchestrator Zod schema 已漂（dogfood 撞 5 点）；连唯一黄金参照 `002-account-profile`（A-002 PoC，曾实跑 30 task）也被无关 PR（#77 往 `module_boundaries` 塞 `_note` 字符串）弄到**现在 parse 失败**。
   - **根因**：**无任何 CI gate 把制品钉死到 orchestrator schema** —— 唯一校验器是「跑 orchestrator」，不在 CI、没人常做 → 任何制品一被编辑就静默漂。当前仓内**零** feature 能被 orchestrator 端到端 parse。
3. **meta 需求实证（决定修复方向）**：Ralph-loop task 的**执行必需 meta 全在 `tasks.md` + `plan.md` + graphify，零来自 `spec.md`**。spec.md 只供 prompt 的「需求文本」（US/FR/SC text + entities）+ 一道 `trace_fr ∈ spec` 完整性校验；而这些文本大部分在 **vanilla prose** 里就有，metadata 独有的只剩 FR 三档优先级 + entities 结构。orchestrator 匹配用 `TASK.trace_*`，spec 内部 `us-meta.trace_*` 等富字段是 **parsed-but-unused 死重量**。

## 2. 两个正交子问题

| 子 plan | 解什么 |
|---|---|
| **p1 消费契约重组** | 让命令流产出能被 orchestrator 可靠端到端 parse + 让 `spec.md` 回归上游 prose-only。含 spec（prose-tolerant + entities 迁 plan）+ plan/tasks schema 对齐 + 钉死 CI gate + 前向兼容。 |
| **p2 impl 双流质量对比** | 同一份 `tasks.md`，manual `/speckit-implement` vs orchestrator `--live`，**两者均切 Sonnet + 都自治**，做质量差异根因分析 + 把 orchestrator 优化到向 manual gold-standard 靠拢。 |

**依赖**：p1 → p2（p2 需 orchestrator 能 parse 命令流 feature 才能对比 impl）。两者正交但有序。

## 3. 子 plan 索引

| 子 plan | 范围 | 依赖 | 状态 |
|---|---|---|---|
| [p1](05-26-orchestrator-command-parity-p1-consumption-contract.md) | 消费契约重组（spec→prose / entities→plan / plan·tasks schema 对齐 / 钉死 gate / 前向兼容） | 无（承 dogfood 根因） | ✅ ship（2026-05-26，4 PR，见下） |
| [p2](05-26-orchestrator-command-parity-p2-impl-flow-compare.md) | impl 双流质量对比实验（both Sonnet + 都自治，8 维，N 组模拟真实业务 feature） | p1 | ⬜ 待（下一步） |

### p1 落地记录（2026-05-26）

| PR | 仓 | 内容 |
|---|---|---|
| #209 | mono | spec→prose 抽取（去 us/fr/cl-meta 硬依赖，向后兼容）+ `SpecFrontmatterSchema` 放宽（feature_id+治理四件套必需、version 字段 optional、非 strict）+ entities 迁 `OrchestratorConfig` + `module_boundaries` `_`-前缀豁免 + `parse-gate`（lefthook + CI；plan 含 `orchestrator_config` 即强制，manual-SDD 自动豁免） |
| #210 | mono | **计划外**：tasks-template 在 0.2.2 就用 `kind:verification`/空 files/省 parallel，但 `TaskKindSchema` 从未跟上 → 新模板产物会被 #209 gate 拒。修 `schemas/tasks.ts`（加 verification + parallel optional + files 去 blanket min(1)，parser 守「非 verification 必 ≥1 file」） |
| [presets#19](https://github.com/xiaocaishen-michael/michael-speckit-presets/pull/19) | preset | `mono-orchestrator-ready` 0.5.0→0.6.0：spec prose-only / plan 加 `entities[]` + 修 auth enum(`user\|admin`→`public\|bearer\|api_key`)·status 注释 / tasks 注释补全 |
| #211 | mono | install 0.6.0 同步 |

**gate 收获**：parse-gate 跑通时刨出 002 第二处 drift（除 master §1.2 记的 `_note`，`tasks.md` 还有 `status: complete` 应为 `completed`）；两处都修，002 黄金参照复活并端到端 parse。

## 4. 全局原则（两子 plan 遵守）

1. **spec.md 回归上游 prose-only** —— 不再带 orchestrator metadata；机读结构归 plan（HOW 工件）。
2. **前向兼容** —— analyzer/schema 对 additive 变更不炸（未知 key 忽略、`_`-前缀豁免、新字段 optional）。详 p1 §2.1。
3. **impl 对比 both Sonnet + 都自治** —— 消 model + human-in-loop 双混淆，只留结构差异。详 p2 §2.1。
4. **manual 流作 gold-standard** —— 目标不是分胜负，是把 orchestrator 优化到向 manual 靠拢；优化项可回灌 guardrails p1/p2 的 template/rule（双流共享底座闭环）。
5. **改 `.specify/` 模板走 preset 库 roundtrip** —— per `.claude/rules/preset-modification.md`。
