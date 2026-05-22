# Server Bounded Context Operation Catalog

> 跨 context 操作的传播规则 + 决策路径 + 已知 operations 清单。**新 server use case ship 时必须在本文件 § Operation Catalog 加一行**（PR review check）。

## 为什么有这个文档

[ADR-0032](../adr/0032-backend-bounded-context.md) 拆 `security / account / auth` 3 bounded context 之后，新 use case 落地时 LLM agent + 人脑都易踩 3 类雷：

1. **位置选错** — `change-phone` 放到 `auth/` 而非 `account/`（aggregate root 在 account）
2. **Side effect 漏** — 改 `account.status` 没通知 `security` 撤销 session / 没通知 audit
3. **传播方式选错** — 用 sync DI 调（本该 Outbox async）/ 反过来

本 catalog 用 **3 传播规则 + 7 决策问题 + Operation 表** 把这 3 类雷的判断显式化为可机械执行的步骤。`/speckit-specify` / `/speckit-plan` 阶段路径触发的 `.claude/rules/server-bounded-context-decision.md` 自动加载本目录摘要。

## 3 传播规则

### R1 — SAME-CTX (intra-context DI)

**场景**：use case 内部业务调同 context 的另一个 use case / domain service / repository。

**实现**：直接 `@Inject()` 或 import；无注释要求。

```ts
// account/application/update-display-name.usecase.ts
@Injectable()
export class UpdateDisplayNameUseCase {
  constructor(@Inject(ACCOUNT_REPOSITORY) private readonly repo: AccountRepository) {}
  // 调 same-context AccountRepository, R1, 无注释
}
```

### R2 — CROSS-CTX-SYNC (orchestration, same tx)

**场景**：编排型 use case 跨 context 调用 callee，且 caller 失败时**必须** rollback callee（事务一致性强需求）。

**实现**：编排型 use case 物理放 `auth/`（编排层），跨 context import 上方 **必加注释**：

```ts
// auth/application/phone-sms-auth.usecase.ts
await prisma.$transaction(async (tx) => {
  // CROSS-CONTEXT-SYNC: 同 tx 注册 account + 发 outbox event,失败时整 tx rollback
  const created = await tx.account.create({ ... });
  await this.outboxPublisher.publish(tx, ACCOUNT_CREATED_EVENT_TYPE, event.payload);
});
```

**判断**：99% 的 cross-context call **不是** R2。只有「业务正确性要求 caller / callee 共享 tx」才走 R2 — auto-create-or-get / 同步两表 update 等。

### R3 — CROSS-CTX-ASYNC (default for side effects via Outbox)

**场景**：side effect / 通知 / audit / 风控 / search reindex / push notification — 一切 caller 不需要等 callee 结果的 cross-context 通信。

**实现**：通过 `OutboxPublisher.publish(tx, eventType, data)` 写 outbox event。trace_id / occurred_at / event_version / producer_context 由 publisher 自动封 envelope（per ADR-0033）。caller 上方 **必加注释**：

```ts
// account/application/change-phone.usecase.ts (anticipated)
await this.prisma.$transaction(async (tx) => {
  await this.accountRepo.updatePhone(tx, accountId, newPhone);
  // CROSS-CONTEXT-ASYNC: account.phone-changed → security 撤旧 session + audit 留痕
  await this.outboxPublisher.publish(tx, 'account.phone-changed', { accountId, newPhone });
});
```

**Default**：任何「需要通知其他 context」的场景 default 走 R3。R2 是 R3 的退化版本（仅当事务一致性强需求）。

### Platform infra 例外

`PrismaService` / `REDIS_CLIENT` / `ProblemDetailFilter` / `FormValidationException` 等从 `security/` export 的 **不是** cross-context business call，是 **platform base layer** infrastructure（per [ADR-0041](../adr/0041-server-common-directory-policy.md)）。`account` / `auth` 通过 `SecurityModule` import 这些 infra 时**不需要** R2/R3 注释。

判断标准：被 import 的 symbol 是「业务 use case / domain service」还是「DB client / cache client / 通用 exception / 框架 wrapper」。后者无注释要求。

## LLM 决策树（7 questions）

新 use case 起手 `/speckit-specify` 或 `/speckit-plan` 之前跑一遍：

| #                               | Question                                                                                                                        | Yes →                                                                                                                                                                                                                                                                                                                                    | No →                                            |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| **Q1**                          | 本 use case 直接改某 aggregate root 的 state？（e.g. `account.phone` / `credential.password_hash`）                             | **放该 aggregate 所在 context** （account / security / auth domain object 的归属决定 context）                                                                                                                                                                                                                                           | Q2                                              |
| **Q2**                          | 本 use case 是编排多 context 共同完成 user-facing 业务流程？（e.g. login = verify code + create-or-get account + issue tokens） | **放 `auth/` 编排层** ；内部跨 context call 按 Q5-Q7 区分 R2/R3                                                                                                                                                                                                                                                                          | Q3                                              |
| **Q3**                          | 本 use case 是纯 platform infra（token issue / pwd hash / 通用 crypto / generic event bus）？                                   | **放 `security/`**（per ADR-0041）                                                                                                                                                                                                                                                                                                       | Q4                                              |
| **Q4**                          | 本 use case 引入完全新业务领域，3 现 context 都不沾（e.g. notification / pkm / search / 实名认证）？                            | **STOP — 走 [ADR-0032](../adr/0032-backend-bounded-context.md) sunset trigger 评估新 bounded context**，触发条件含 spec User Scenarios 行数 ≥ 阈值 / 跨已有 module 边界数 ≥ 2                                                                                                                                                            | Q5                                              |
| **Q5** _(只在跨 ctx call 时问)_ | callee 失败必须 rollback caller？（事务一致性强需求）                                                                           | **R2 CROSS-CTX-SYNC**：同 tx + `// CROSS-CONTEXT-SYNC: <reason>` 注释                                                                                                                                                                                                                                                                    | Q6                                              |
| **Q6** _(只在跨 ctx call 时问)_ | 调用是 side-effect notification（audit / SMS push / search reindex / 撤 session / ...）？                                       | **R3 CROSS-CTX-ASYNC**：Outbox publish + `// CROSS-CONTEXT-ASYNC: <event-type>` 注释                                                                                                                                                                                                                                                     | Q7                                              |
| **Q7** _(只在跨 ctx 读时问)_    | caller 需要**读** callee 的 aggregate state（不是改）？                                                                         | **A. 优先**：调 caller 自己的 context 已 sync 进来的本地副本（典型 = Outbox event replay 维护的物化视图）<br>**B. 临时**：通过 `SecurityModule` export 的共享读服务（如 `PrismaService` 直查 callee table — 但仅限**只读** + 在 catalog 标记 `// CROSS-CONTEXT-READ:`）<br>**C. 禁**：cross-context use case / repository 直 `@Inject()` | （回 Q5 — 跨 ctx call 必走 sync or async 之一） |

### 决策树死角

- **同时是 R2 + R3 的 case** — 编排 use case 在 `$transaction` 内同时 `account.create()` (R2) + `outboxPublisher.publish('auth.account.created')` (R3)。这是正常的，两条注释都写。参 `phone-sms-auth.usecase.ts`。
- **跨 ctx 但不在 use case 层** — 比如 Guard / Filter 跨 module 引用。这是 platform infra 例外的扩展场景，看 [ADR-0032](../adr/0032-backend-bounded-context.md) 实装注 — guards/filters 大多归 `security/` 或 `account/web/`。

## Operation Catalog

### 已实装（截至 2026-05-22）

| Operation             | Context | Side effects / Propagation                                                                                                    | Source PR           |
| --------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| `request-sms-code`    | auth    | (intra; sms gateway external infra; no cross-context)                                                                         | PR #7 (Plan 1 W2.4) |
| `phone-sms-auth`      | auth    | **R2** → `account.autoCreate-or-get` (同 tx); **R2** → `security.issueTokens`; **R3** → outbox publish `auth.account.created` | PR #7               |
| `get-account-profile` | account | (intra; read-only)                                                                                                            | PR #65 (A-002)      |
| `update-display-name` | account | (intra; write Account.display_name)                                                                                           | PR #65              |

### Plan 2 anticipated（示例，非实装承诺）

| Operation         | Context               | Predicted Propagation                                                     |
| ----------------- | --------------------- | ------------------------------------------------------------------------- |
| `change-phone`    | account               | **R3** → `account.phone-changed`（→ security 撤旧 session + audit 留痕）  |
| `freeze-account`  | account               | **R3** → `account.frozen`（→ security 撤 session + audit）                |
| `refresh-token`   | auth                  | **R2** → `security.rotate-refresh-token`（rotation 失败必须 rollback）    |
| `verify-realname` | account               | **R3** → `account.realname-verified`（→ notification 发成功短信 + audit） |
| `create-note`     | **新 context** `pkm/` | Q4 → 触发新 bounded context 评估                                          |

Anticipated 条目当 spec 启动时迁入「已实装」表，并按真实实装路径校正 propagation。

## 维护流程（PR review check）

新 use case ship 时，PR 必同时改：

1. **`spec.md` `modules:` frontmatter** — 与 catalog 中该 operation 的 context 字段一致
2. **本 catalog 的 Operation Catalog 表** — 加一行（operation / context / propagation / source PR）
3. **use case 实装** — 任何 cross-context import 上方 1-3 行有 `// CROSS-CONTEXT-(SYNC|ASYNC|READ):` 注释
4. **tasks.md** — 对应 task ship 后 `[X]` 翻

PR review 拒条件（任一不满足）：

- 实装含 cross-context import 但无对应注释
- spec `modules:` 与 catalog 不一致
- catalog 表无新行（除非该 use case 不跨 context 且不引入新 operation 概念）

## 参考

- [ADR-0032](../adr/0032-backend-bounded-context.md) bounded context 拆分本体（决策起源）
- [ADR-0033](../adr/0033-outbox-cross-context-comm.md) Outbox envelope + trace_id（R3 实装基础）
- [ADR-0034](../adr/0034-auth-account-operation-catalog.md) 本目录的决策记录
- [ADR-0041](../adr/0041-server-common-directory-policy.md) `src/common/` 不引入 / platform infra 进 `security/`
- [05-22 bounded context governance plan](../plans/2026-05/05-22-server-bounded-context-governance.md) — O2 work unit 落地的 plan 入口
- `.claude/rules/server-bounded-context-decision.md` — path-triggered 自动加载摘要
