---
adr_id: ADR-0034
status: Proposed
applies_to: [apps/server]
sunset_trigger: |
  - 业务 < 5 use case (catalog 反而 overhead)
  - LLM agent 演化到能 derive 传播规则不需要显式 decision tree
  - bounded context 合并回单 context (per [ADR-0032](0032-backend-bounded-context.md) sunset)
---

# ADR-0034: Auth/Account Operation Catalog — 3 传播规则 + LLM decision tree

* Status: Proposed
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

### LLM decision tree (YAML, 落在 `docs/conventions/`)

```yaml
new_use_case_decision_tree:
  - q: "use case 是否直接改某 context 的 aggregate root state?"
    yes: "放该 context (account / security / auth)"
    no: "进 q2"
  - q: "use case 是否编排多 context 共同完成 user-facing 业务?"
    yes: "放 auth context (编排层),内部按 R2/R3 区分"
    no: "进 q3"
  - q: "use case 是否纯技术/底层 (token issue / pwd hash)?"
    yes: "放 security context"
    no: "ask user — 可能需新 bounded context"

cross_ctx_propagation_decision_tree:
  - q: "callee 失败必须回滚 caller?"
    yes: "R2 CROSS-CTX-SYNC (同 tx 内调用)"
    no: "R3 CROSS-CTX-ASYNC (Outbox event)"
```

### Operation Catalog (`docs/conventions/operation-catalog.md` — PR-7 写)

列已知跨 context 操作 + 应用规则:

| Operation | Context | Side effects (传播规则) |
|---|---|---|
| phone-sms-auth | auth | R2 → account.autoCreate-or-get;R2 → security.issueTokens |
| changePhone | account | R3 → security.revokeAllSessionsForAccount |
| freezeAccount | account | R3 → security.revokeAllSessionsForAccount;R3 → audit.recordFreeze |
| refreshToken | auth | R2 → security.rotateRefreshToken |

新 use case ship 时必加一行进 catalog (PR review check)。

## Consequences

* LLM agent prompt 加 decision tree 摘要 → 新 use case 上手时定位准
* ESLint custom rule (PR-1 / PR-4 可选):cross-context import 必须前 1-3 行有 `CROSS-CONTEXT-(SYNC|ASYNC):` 注释
* PR-7 写 operation-catalog.md v1 + 4 已知 operations

## Trade-offs

* 注释 overhead — 但 LLM 命中率 + 人脑追踪 side effect 链收益大
* Catalog 维护需 PR review 配合 — 由 PR template checklist 兜底

## References

* [ADR-0032](0032-backend-bounded-context.md)
* [ADR-0033](0033-outbox-cross-context-comm.md)
* memory `feedback_orchestrator_llm_cwd_must_match_target_paths` (LLM ergonomics 同源思考)
