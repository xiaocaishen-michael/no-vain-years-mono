import { Injectable } from '@nestjs/common';
import type { OutboxPublisher } from '../application/ports/outbox-publisher.port';

/**
 * OutboxEventPrismaPublisher — writes domain events to `outbox_event` (FR-S11).
 *
 * `publish` 接 Prisma client (or $transaction-bound TransactionClient) 作首参 —
 * 让 caller 显式将 publish 纳入业务 tx, 失败时整 tx (含 outbox 行) 一起 rollback.
 *
 * Port 用 unknown 不泄露 Prisma 类型到 domain; 内部 narrow 到 outbox_event.create
 * 形状即可 (任何 Prisma{Client,TransactionClient} 都满足).
 */
type PrismaOutboxClient = {
  outbox_event: {
    create: (args: {
      data: {
        event_type: string;
        payload: unknown;
        published_at: Date | null;
      };
    }) => Promise<unknown>;
  };
};

@Injectable()
export class OutboxEventPrismaPublisher implements OutboxPublisher {
  async publish(
    client: unknown,
    eventType: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const c = client as PrismaOutboxClient;
    await c.outbox_event.create({
      data: {
        event_type: eventType,
        payload,
        published_at: null,
      },
    });
  }
}
