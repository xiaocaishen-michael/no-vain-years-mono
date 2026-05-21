import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../security/prisma.service';

/**
 * OutboxEventCronPublisher placeholder (T041, W2 polish scope).
 *
 * 提供 `scan()` method 给 W3+ 真 cron infra (e.g. @nestjs/schedule `@Cron`
 * decorator / external scheduler) 调度. W2 阶段不自动起,避免 test 干扰.
 *
 * 当前行为: 扫 `outbox_event` 中 `published_at IS NULL` 行, 直接标 published
 * (不分发到任何真消费方). 真消费方 (search-index / welcome SMS 等) W3+ use
 * case 引入时, 把分发逻辑插入此处.
 *
 * Hook reserved 意图: 让 W3+ 加 subscriber 时, hook 点已存在 (avoid 'where to
 * trigger from' 决策延迟).
 */
@Injectable()
export class OutboxEventCronPublisher {
  private readonly logger = new Logger(OutboxEventCronPublisher.name);

  constructor(private readonly prisma: PrismaService) {}

  async scan(): Promise<{ scanned: number; published: number }> {
    const unpublished = await this.prisma.outbox_event.findMany({
      where: { published_at: null },
      take: 100,
    });

    let published = 0;
    for (const row of unpublished) {
      // TODO W3+: dispatch to real subscriber (search-index / welcome SMS / etc.)
      // 当前 placeholder 直接 mark published; W3+ 替换为:
      //   try { await dispatcher.dispatch(row.event_type, row.payload); }
      //   catch (e) { logger.error('dispatch failed', e); continue; }
      await this.prisma.outbox_event.update({
        where: { id: row.id },
        data: { published_at: new Date() },
      });
      published += 1;
    }

    if (unpublished.length > 0) {
      this.logger.debug(
        `outbox scan: ${unpublished.length} unpublished, ${published} marked published`,
      );
    }
    return { scanned: unpublished.length, published };
  }
}
