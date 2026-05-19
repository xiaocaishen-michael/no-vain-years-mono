/**
 * OutboxPublisher port (FR-S11 outbox pattern).
 *
 * publish() 把 domain event 写入 outbox 表 (published_at = null); 后台 cron job
 * 异步分发 (T041 placeholder; 真消费方由后续 use case 加).
 *
 * Implementation: OutboxEventPrismaPublisher (T029) — 写 `outbox_event` 表
 * (Plan 2 Phase 0 § 2.2.1: Spring Modulith 老 `event_publication` 已 drop).
 *
 * Transaction model: caller MUST pass the Prisma client (or TransactionClient
 * from $transaction) as `client` so publish 与业务写共享同一 tx, 避免
 * 业务 rollback 后 outbox row 残留. Port 用 `unknown` 不泄露 Prisma 到 domain;
 * infra impl 内 narrow 到具体 Prisma 类型.
 */
export const OUTBOX_PUBLISHER = Symbol('OUTBOX_PUBLISHER');

export interface OutboxPublisher {
  publish(
    client: unknown,
    eventType: string,
    payload: Record<string, unknown>,
  ): Promise<void>;
}
