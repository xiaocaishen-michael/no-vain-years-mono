---
adr_id: ADR-0034
status: Accepted
applies_to: [apps/server]
sunset_trigger: |
  - 业务 < 5 use case (catalog 反而 overhead)
  - LLM agent 演化到能 derive 传播规则不需要显式 decision tree
  - bounded context 合并回单 context (per [ADR-0032](0032-backend-bounded-context.md) sunset)
  - 跨 context 操作 > 30 entries (catalog 维护成本超过 LLM 命中率收益, 拆 sub-catalog 或转 codegen)
---

# ADR-0034: Auth/Account Operation Catalog — 3 传播规则 + LLM decision tree

- Status: Accepted (2026-05-22) — shipped via [05-22 bounded context governance plan](../plans/2026-05/05-22-server-bounded-context-governance.md) **O2 work unit**
- Deciders: project owner
- Tags: backend / architecture / llm-ergonomics / cross-cutting

## Context

[ADR-0032](0032-backend-bounded-context.md) 拆 3 context + [ADR-0033](0033-outbox-cross-context-comm.md) Outbox 规则后,新 use case 加在何处 + 跨 context 怎么调,LLM agent 仍易选错。例:

- "加 changePhone use case" — 应放 account context (改 Account.phone),但需通知 security 撤销旧 token + 通知风控 audit
- "加 freezeAccount use case" — 应放 account context,但需通知 security 撤销当前 session

每个跨 context 操作的传播路径若不显式 catalog,LLM 容易:

1. 把通知 security/audit 的 side effect 漏掉
2. 把通知方式选错 (sync DI 调而非 async Outbox)
3. 把 use case 放错 context

## Decision

### 3 传播规则(注释为建议项，渐进式强制)

| Rule ID                 | 场景                                                             | 路径                                                                      |
| ----------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------- |
| **R1: SAME-CTX**        | use case 内部业务调同 context use case                           | DI 调用,无注释要求                                                        |
| **R2: CROSS-CTX-SYNC**  | 必同 tx 强需求 (e.g. phone-sms-auth → account.autoCreate-or-get) | 编排型 use case 内组合,**建议添加**注释 `// CROSS-CONTEXT-SYNC: <reason>` |
| **R3: CROSS-CTX-ASYNC** | side effect / 通知 / audit / 风控 (default 跨 context 路径)      | Outbox event,**建议添加**注释 `// CROSS-CONTEXT-ASYNC: <event-type>`      |

> **渐进式强制定位**（per § 落地演进路径）：当前阶段注释为 **SHOULD**（物理越界由 Nx 标签电网 `@nx/enforce-module-boundaries` 硬卡；注释靠人工 / AI CR 引导）。待 Golden Samples 沉淀 + 独立 `ts-morph` 扫描器上线后恢复 **MUST**。

### LLM decision tree + Operation Catalog

完整 **7-question decision tree** + **Operation Catalog** + **维护流程** 落在 [`docs/conventions/server-bounded-context-catalog.md`](../conventions/server-bounded-context-catalog.md)。本 ADR 仅保留决策骨架，不重复实施细节（避免 ADR-impl drift）。

`.claude/rules/server-bounded-context-decision.md` 是 path-triggered 自动加载摘要，在 LLM agent 触及 `specs/**/spec.md` / `apps/server/src/**/*.usecase.ts` / `apps/server/src/**/*.module.ts` 时自动 surface 简版决策路径 + 注释规则。

## Consequences

- LLM agent 触及 server use case / module / spec 时, `.claude/rules/server-bounded-context-decision.md` 自动 surface 简版决策树 + 注释规则
- `docs/conventions/server-bounded-context-catalog.md` 是 PR review 单一权威 — 4 现有 use case 已 backfill; Plan 2 anticipated 4 候选预占位
- 注释门禁分阶段（详 § 落地演进路径）：当前 **SHOULD**（PR review / AI CR 人工兜底），Plan 2 沉淀 Golden Samples，Post-Plan-2 上线**独立 `ts-morph` 注释扫描器**（与已退役的 hexagonal layer ESLint 完全解耦、正交）挂 lefthook，恢复 **MUST** + status 翻 `Enforced via CI`

## Trade-offs

- 注释 overhead — 但 LLM 命中率 + 人脑追踪 side effect 链收益大
- Catalog 维护需 PR review 配合 — 由 PR template checklist + path-triggered rule 双层兜底
- 决策树 7 questions 比原 2 questions 长 — 但覆盖 cross-context 读 + 新 bounded context evaluation 两个原版漏洞

## 落地演进路径 (Evolutionary Path)

CROSS-CONTEXT 注释从 SHOULD 渐进到 MUST，避免 0 Golden Sample 下开 CI 刚性拦截逼 LLM 因无模仿对象而注水幻觉（per realign hinge 裁决 2026-05-24）：

1. **Stage A（M1.1 现在）→ SHOULD**：物理边界（`account ↛ auth` 等 import 方向）由 Nx 标签电网 `@nx/enforce-module-boundaries` 硬卡；`// CROSS-CONTEXT-*` 注释为建议项，靠人工 / AI CR 引导，不阻 merge。
2. **Stage B（Plan 2 首个跨域 feature）→ 锚 Golden Samples**：人类 / AI 手写 3 个 Golden Sample（R2 / R3 / R-READ 各一），让全仓长出 few-shot 模仿对象。
3. **Stage C（Post-Plan-2）→ 恢复 MUST**：上线**独立 `ts-morph` 注释扫描器**（与已退役的 hexagonal layer ESLint **完全解耦、正交** —— 不以其为活跃前提），挂 lefthook，注释从 SHOULD 翻 MUST，本 ADR status → `Enforced via CI`。

## References

- [ADR-0032](0032-backend-bounded-context.md) bounded context 拆分本体
- [ADR-0033](0033-outbox-cross-context-comm.md) Outbox envelope (R3 实装基础)
- [ADR-0041](0041-server-common-directory-policy.md) `src/common/` 不引入 / Platform infra 例外
- [`docs/conventions/server-bounded-context-catalog.md`](../conventions/server-bounded-context-catalog.md) — 本 ADR 的运营文档落地
- `.claude/rules/server-bounded-context-decision.md` — path-triggered LLM 摘要
- memory `feedback_orchestrator_llm_cwd_must_match_target_paths` (LLM ergonomics 同源思考)
