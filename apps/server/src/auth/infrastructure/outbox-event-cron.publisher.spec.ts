import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { execFileSync } from 'node:child_process';
import { PrismaService } from './prisma.service';
import { OutboxEventCronPublisher } from './outbox-event-cron.publisher';

const SERVER_DIR = process.cwd();

describe('OutboxEventCronPublisher (Testcontainers PG) — T041 placeholder', () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaService;
  let cron: OutboxEventCronPublisher;

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
    cron = new OutboxEventCronPublisher(prisma);
  }, 120_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    await container?.stop();
  });

  it('scan() returns 0 published when outbox empty', async () => {
    const result = await cron.scan();
    expect(result.scanned).toBe(0);
    expect(result.published).toBe(0);
  });

  it('scan() marks unpublished rows as published (placeholder behavior)', async () => {
    await prisma.outbox_event.create({
      data: {
        event_type: 'auth.test.event',
        payload: { foo: 'bar' },
        published_at: null,
      },
    });

    const result = await cron.scan();
    expect(result.scanned).toBeGreaterThanOrEqual(1);
    expect(result.published).toBeGreaterThanOrEqual(1);

    const unpublished = await prisma.outbox_event.findMany({
      where: { event_type: 'auth.test.event', published_at: null },
    });
    expect(unpublished).toHaveLength(0);
  });
});
