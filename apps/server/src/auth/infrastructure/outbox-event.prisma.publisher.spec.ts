import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { execFileSync } from 'node:child_process';
import { PrismaService } from './prisma.service';
import { OutboxEventPrismaPublisher } from './outbox-event.prisma.publisher';

const SERVER_DIR = process.cwd();

describe('OutboxEventPrismaPublisher (Testcontainers PG)', () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaService;
  let publisher: OutboxEventPrismaPublisher;

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
    publisher = new OutboxEventPrismaPublisher();
  }, 120_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    await container?.stop();
  });

  it('publish(prisma, ...) writes row with event_type + payload + published_at=null', async () => {
    const eventType = 'auth.account.created';
    const payload = {
      accountId: '42',
      phone: '+8613800139001',
      createdAt: '2026-05-17T12:00:00.000Z',
    };

    await publisher.publish(prisma, eventType, payload);

    const rows = await prisma.outbox_event.findMany({
      where: { event_type: eventType },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.event_type).toBe(eventType);
    expect(rows[0]!.payload).toEqual(payload);
    expect(rows[0]!.published_at).toBeNull();
    expect(rows[0]!.created_at).toBeInstanceOf(Date);
    expect(rows[0]!.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it('publish(tx, ...) inside $transaction is included in commit', async () => {
    const eventType = 'auth.tx.committed';
    await prisma.$transaction(async (tx) => {
      await publisher.publish(tx, eventType, { foo: 'bar' });
    });

    const rows = await prisma.outbox_event.findMany({
      where: { event_type: eventType },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.payload).toEqual({ foo: 'bar' });
  });

  it('publish(tx, ...) inside $transaction is rolled back when business throws', async () => {
    const eventType = 'auth.tx.rolled-back';
    await expect(
      prisma.$transaction(async (tx) => {
        await publisher.publish(tx, eventType, { x: 1 });
        throw new Error('simulated business failure');
      }),
    ).rejects.toThrow('simulated business failure');

    const rows = await prisma.outbox_event.findMany({
      where: { event_type: eventType },
    });
    expect(rows).toHaveLength(0);
  });
});
