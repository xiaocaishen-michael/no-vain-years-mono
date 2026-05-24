# Sub-Plan P2: 干净 ADR 指导的代码 drift 重构 — 已退役（RETIRED）

> 隶属 [Master: ADR 基线重对齐](05-23-adr-realign-master.md)。
> **状态：`[Hinge 选型降级 → P2 无实质内容，已并入 P1 统一交付]`**（2026-05-24 退役）

## 为什么退役

P2 原本承载「代码缺失/违反一个仍保留的决策」的重构项。2026-05-23 审计实证：drift 以「ADR 错、代码对」为主（~80%），P2 候选本就极少，仅 2 项：

1. `CROSS-CONTEXT-*` 注释回填（依赖 ADR-0033/0034 是否保留"强制"）。
2. `apps/mobile/app.json` 版本 `0.0.0`→`0.0.1`（micro config）。

2026-05-24 owner 裁决 CROSS-CONTEXT hinge = **全生命周期软化为 SHOULD，本次不往代码补注释**（先退后进：现在退一步避免 0-sample 下 LLM 注水，Plan 2 锚 3 个 Golden Sample，Post-Plan-2 上独立 `ts-morph` 扫描器恢复 MUST — 详见 [P1 § CROSS-CONTEXT hinge](05-23-adr-realign-p1-adr-self-consistency.md) + ADR-0034 Evolutionary Path Stage A/B/C）。

裁决后 P2 仅剩 #2 这个 micro 项，单独成 Phase + 一次 PR review 不划算。故：

- **#1 CROSS-CONTEXT 代码任务**：撤销（不属本次范围，留给 Plan 2 Stage B 自然发生）。
- **#2 app.json 版本**：并入 P1（[PR-8](05-23-adr-realign-p1-adr-self-consistency.md)），先查 release-please 是否自动 reconcile，否则 1 行 bump。

整个 effort 因此坍缩为单 Phase（P1 改文档）。本文件留作决策留痕，不再有可执行内容。

## 何时可能"复活"

Plan 2 推进首个真实跨上下文复杂 feature（如 Account 跨域驱逐 Security Token）时，按 ADR-0034 Evolutionary Path **Stage B** 手写 Golden Samples、**Stage C** 上线扫描器恢复刚性——届时若涉及成规模代码改动，另起新 plan，不复用本退役壳。
