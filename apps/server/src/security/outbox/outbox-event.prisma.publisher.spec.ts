import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { execFileSync } from 'node:child_process';
import type { ClsService } from 'nestjs-cls';
import { PrismaService } from '../prisma.service';
import { OutboxEventPrismaPublisher } from './outbox-event.prisma.publisher';

const SERVER_DIR = process.cwd();

// Plain object double for ClsService — only getId() is exercised by the
// publisher. `as unknown as ClsService` avoids needing the full NestJS DI
// container in this Testcontainers-only test.
const makeCls = (traceId: string | undefined): ClsService =>
  ({
    getId: () => traceId,
  }) as unknown as ClsService;

describe('OutboxEventPrismaPublisher (Testcontainers PG)', () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaService;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine')
      .withDatabase('test_mbw')
      .withUsername('test')
      .withPassword('test')
      .start();

    const url = container.getConnectionUri();

    execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
      cwd: SERVER_DIR,
      env: { ...process.env, DATABASE_URL: url },
      stdio: 'inherit',
    });

    prisma = new PrismaService(url);
  }, 120_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    await container?.stop();
  });

  it('publish(prisma, ...) wraps data in ADR-0033 envelope + uses CLS trace_id', async () => {
    const traceId = '11111111-2222-3333-4444-555555555555';
    const publisher = new OutboxEventPrismaPublisher(makeCls(traceId));
    const eventType = 'auth.account.created';
    const data = {
      accountId: '42',
      phone: '+8613800139001',
      createdAt: '2026-05-17T12:00:00.000Z',
    };

    await publisher.publish(prisma, eventType, data);

    const rows = await prisma.outboxEvent.findMany({
      where: { eventType },
    });
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.eventType).toBe(eventType);
    expect(row.publishedAt).toBeNull();
    expect(row.createdAt).toBeInstanceOf(Date);
    expect(row.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

    const payload = row.payload as {
      metadata: {
        trace_id: string;
        occurred_at: string;
        event_version: number;
        producer_context: string;
      };
      data: Record<string, unknown>;
    };
    expect(payload.metadata.trace_id).toBe(traceId);
    expect(payload.metadata.event_version).toBe(1);
    expect(payload.metadata.producer_context).toBe('auth');
    expect(payload.metadata.occurred_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(payload.data).toEqual(data);
  });

  it('publish without ClsService → synthesizes out-of-request-* trace_id fallback', async () => {
    const publisher = new OutboxEventPrismaPublisher();
    const eventType = 'auth.outbox.fallback';

    await publisher.publish(prisma, eventType, { x: 1 });

    const row = (await prisma.outboxEvent.findMany({ where: { eventType } }))[0]!;
    const payload = row.payload as { metadata: { trace_id: string } };
    expect(payload.metadata.trace_id).toMatch(
      /^out-of-request-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it('publish(tx, ...) inside $transaction is included in commit', async () => {
    const publisher = new OutboxEventPrismaPublisher(makeCls('tx-commit-trace'));
    const eventType = 'auth.tx.committed';
    await prisma.$transaction(async (tx) => {
      await publisher.publish(tx, eventType, { foo: 'bar' });
    });

    const rows = await prisma.outboxEvent.findMany({
      where: { eventType },
    });
    expect(rows).toHaveLength(1);
    const payload = rows[0]!.payload as {
      metadata: { trace_id: string };
      data: Record<string, unknown>;
    };
    expect(payload.metadata.trace_id).toBe('tx-commit-trace');
    expect(payload.data).toEqual({ foo: 'bar' });
  });

  it('publish(tx, ...) inside $transaction is rolled back when business throws', async () => {
    const publisher = new OutboxEventPrismaPublisher(makeCls('tx-rollback-trace'));
    const eventType = 'auth.tx.rolled-back';
    await expect(
      prisma.$transaction(async (tx) => {
        await publisher.publish(tx, eventType, { x: 1 });
        throw new Error('simulated business failure');
      }),
    ).rejects.toThrow('simulated business failure');

    const rows = await prisma.outboxEvent.findMany({
      where: { eventType },
    });
    expect(rows).toHaveLength(0);
  });
});
