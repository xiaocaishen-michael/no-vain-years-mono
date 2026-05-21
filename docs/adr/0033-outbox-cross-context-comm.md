---
adr_id: ADR-0033
status: Proposed
applies_to: [apps/server]
sunset_trigger: |
  - 切真分布式 (Kafka / NATS / Pulsar) — Outbox 仍是入口但 publisher 切外部 broker
  - 业务 < 5 use case 跨 context (Outbox overhead > benefit)
  - bounded context 合并回单 context (per [ADR-0032](0032-backend-bounded-context.md) sunset)
---

# ADR-0033: Cross-Context Communication via Outbox (event metadata.trace_id 强制)

* Status: Proposed
* Deciders: project owner
* Tags: backend / architecture / messaging / cross-cutting

## Context

[ADR-0032](0032-backend-bounded-context.md) 拆 security / account / auth 3 bounded context 后,跨 context 通信选项:

| 选 | 优 | 劣 |
|---|---|---|
| (a) 同步 DI 调用 | 简单 | 强耦合;auth context 直接调 account 内部 → 跨 context boundary 漏 |
| (b) HTTP 内部调用 | 边界清 | 同进程内 HTTP overhead 不合理 |
| (c) **Outbox event** | 异步解耦,事务保证 | 复杂度 ↑;需 schema 治理 |

Plan 1 W2.4 已实装 `outbox_event` 表 + `OutboxPublisher` (per memory `feedback_transactional_outbox_port_shape` + `reference_mono_db_pull_modulith_event_publication`),复用之。

## Decision

### 跨 context 调用规则(强制层 → ADR-0034)

| 场景 | 路径 |
|---|---|
| Same context | DI 调用 use case (直 import 同 module application service) |
| Cross-context **sync**(同 tx 强需求) | 编排型 use case 内组合 (e.g. `phone-sms-auth.usecase` 直接调 `account.autoCreate` ),允许但显式注释 `// CROSS-CONTEXT-SYNC: <reason>` |
| Cross-context **async** (default) | **Outbox event**;publisher 一边写 outbox_event 一边业务写同 tx,后台 worker 消费 |

### Event payload schema 强制 `metadata.trace_id`

```ts
type OutboxEventPayload<T = unknown> = {
  metadata: {
    trace_id: string;        // ← 强制,联 [ADR-0036](0036-observability-logging-governance.md) trace 串联
    occurred_at: string;     // ISO 8601
    event_version: number;
    producer_context: "security" | "account" | "auth" | string;
  };
  data: T;
};
```

trace_id 来源:HTTP req header `x-trace-id` → AsyncLocalStorage → outbox publisher `publish` 时注入。

### consumer 端

* worker process (apps/server 内独立 NestJS module `OutboxWorkerModule`) tail outbox_event 表
* 处理时 hydrate trace_id 进 CLS → consumer 内业务调用 / log 全部继承同 trace_id
* idempotent by event_id (PK 在 outbox 表)

### outbox publisher port shape (per memory `feedback_transactional_outbox_port_shape`)

```ts
interface OutboxPublisher {
  publish(client: PrismaClient | PrismaTransactionClient, eventType: string, payload: OutboxEventPayload): Promise<void>;
}
```

caller 显式传 tx client → publish 与业务写共享 tx,无 CLS / new-in-tx 复杂度。

## Consequences

* security / account / auth 之间 default async,强解耦 + 自动 trace 串联
* `phone-sms-auth.usecase` 编排型保留同 tx 直 import (合规),其余跨 context 全走 outbox
* `outbox_event` table schema 加 `metadata.trace_id` column (or 进 payload jsonb) — Plan 1 实装无该字段,需 migration
* Worker module 跑独立 process / 同进程 ?— 起步同进程 (低成本),性能瓶颈触发再拆

## Open Questions

* Worker 失败重试策略(指数退避 / dead-letter)— 起步 N=3 简单重试,DLQ 留 Plan 3 ship
* event_version evolution (schema break 后旧 consumer)— Plan 3 真用户量起再设

## References

* memory `feedback_transactional_outbox_port_shape`
* memory `reference_mono_db_pull_modulith_event_publication`
* [ADR-0032](0032-backend-bounded-context.md)
* [ADR-0036](0036-observability-logging-governance.md) (trace 串联消费端)
