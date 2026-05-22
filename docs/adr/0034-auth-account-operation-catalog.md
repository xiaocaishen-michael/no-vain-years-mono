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

* Status: Accepted (2026-05-22) — shipped via [05-22 bounded context governance plan](../plans/2026-05/05-22-server-bounded-context-governance.md) **O2 work unit**
* Deciders: project owner
* Tags: backend / architecture / llm-ergonomics / cross-cutting

## Context

[ADR-0032](0032-backend-bounded-context.md) 拆 3 context + [ADR-0033](0033-outbox-cross-context-comm.md) Outbox 规则后,新 use case 加在何处 + 跨 context 怎么调,LLM agent 仍易选错。例:

* "加 changePhone use case" — 应放 account context (改 Account.phone),但需通知 security 撤销旧 token + 通知风控 audit
* "加 freezeAccount use case" — 应放 account context,但需通知 security 撤销当前 session

每个跨 context 操作的传播路径若不显式 catalog,LLM 容易:

1. 把通知 security/audit 的 side effect 漏掉
2. 把通知方式选错 (sync DI 调而非 async Outbox)
3. 把 use case 放错 context

## Decision

### 3 传播规则(强制注释)

| Rule ID | 场景 | 路径 |
|---|---|---|
| **R1: SAME-CTX** | use case 内部业务调同 context use case | DI 调用,无注释要求 |
| **R2: CROSS-CTX-SYNC** | 必同 tx 强需求 (e.g. phone-sms-auth → account.autoCreate-or-get) | 编排型 use case 内组合,**必加注释** `// CROSS-CONTEXT-SYNC: <reason>` |
| **R3: CROSS-CTX-ASYNC** | side effect / 通知 / audit / 风控 (default 跨 context 路径) | Outbox event,**必加注释** `// CROSS-CONTEXT-ASYNC: <event-type>` |

### LLM decision tree + Operation Catalog

完整 **7-question decision tree** + **Operation Catalog** + **维护流程** 落在 [`docs/conventions/server-bounded-context-catalog.md`](../conventions/server-bounded-context-catalog.md)。本 ADR 仅保留决策骨架，不重复实施细节（避免 ADR-impl drift）。

`.claude/rules/server-bounded-context-decision.md` 是 path-triggered 自动加载摘要，在 LLM agent 触及 `specs/**/spec.md` / `apps/server/src/**/*.usecase.ts` / `apps/server/src/**/*.module.ts` 时自动 surface 简版决策路径 + 注释规则。

## Consequences

* LLM agent 触及 server use case / module / spec 时, `.claude/rules/server-bounded-context-decision.md` 自动 surface 简版决策树 + 注释规则
* `docs/conventions/server-bounded-context-catalog.md` 是 PR review 单一权威 — 4 现有 use case 已 backfill; Plan 2 anticipated 4 候选预占位
* ESLint custom rule (defer 到 hexagonal layer ESLint re-add PR, per 05-22 governance plan O3): cross-context import 必前 1-3 行有 `CROSS-CONTEXT-(SYNC|ASYNC|READ):` 注释 — 当前 PR review 人工兜底, 未来上 lint rule

## Trade-offs

* 注释 overhead — 但 LLM 命中率 + 人脑追踪 side effect 链收益大
* Catalog 维护需 PR review 配合 — 由 PR template checklist + path-triggered rule 双层兜底
* 决策树 7 questions 比原 2 questions 长 — 但覆盖 cross-context 读 + 新 bounded context evaluation 两个原版漏洞

## References

* [ADR-0032](0032-backend-bounded-context.md) bounded context 拆分本体
* [ADR-0033](0033-outbox-cross-context-comm.md) Outbox envelope (R3 实装基础)
* [ADR-0041](0041-server-common-directory-policy.md) `src/common/` 不引入 / Platform infra 例外
* [`docs/conventions/server-bounded-context-catalog.md`](../conventions/server-bounded-context-catalog.md) — 本 ADR 的运营文档落地
* `.claude/rules/server-bounded-context-decision.md` — path-triggered LLM 摘要
* memory `feedback_orchestrator_llm_cwd_must_match_target_paths` (LLM ergonomics 同源思考)
