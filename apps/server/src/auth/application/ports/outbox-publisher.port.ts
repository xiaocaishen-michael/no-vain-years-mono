/**
 * OutboxPublisher port (FR-S11 outbox pattern).
 *
 * 在业务 transaction 内调 publish() 把 domain event 写入 `event_publication` 表
 * (published_at = null); 后台 cron job 异步分发 (T041 placeholder; 真消费方
 * 由后续 use case 加).
 *
 * Implementation: EventPublicationPrismaPublisher (T029).
 */
export const OUTBOX_PUBLISHER = Symbol('OUTBOX_PUBLISHER');

export interface OutboxPublisher {
  /**
   * 写 domain event 到 outbox 表. Caller 必须确保此 publish 与业务写 1 起在外层
   * transaction 内 (避免 outbox 写成功而业务 rollback 不一致).
   */
  publish(eventType: string, payload: Record<string, unknown>): Promise<void>;
}
