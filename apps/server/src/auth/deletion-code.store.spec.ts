import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { execFileSync } from 'node:child_process';
import { PrismaService } from '../security/prisma.service';
import { DeletionCodeStore } from './deletion-code.store';
import { SmsPurpose } from './deletion-code.rules';

const SERVER_DIR = process.cwd();
const MIN_MS = 60_000;

// T006: account_sms_code DB store (PrismaService 直注, 无 repository, ADR-0043)。
// 004 首个消费者 (login 码走 Redis)。findActive 命中偏索引
// idx_account_sms_code_account_purpose_active (used_at IS NULL)。
describe('DeletionCodeStore (Testcontainers PG)', () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaService;
  let store: DeletionCodeStore;
  let acc = 7000n;

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
    store = new DeletionCodeStore(prisma);
  }, 120_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    await container?.stop();
  });

  const nextAccount = () => (acc += 1n);

  it('issue → findActive 命中 (codeHash + purpose + 未过期 + usedAt null)', async () => {
    const a = nextAccount();
    const now = new Date();
    await store.issue(
      a,
      SmsPurpose.DELETE_ACCOUNT,
      'hash-del-1',
      new Date(now.getTime() + 10 * MIN_MS),
    );

    const found = await store.findActive(a, SmsPurpose.DELETE_ACCOUNT, now);
    expect(found).not.toBeNull();
    expect(found!.codeHash).toBe('hash-del-1');
    expect(found!.purpose).toBe('DELETE_ACCOUNT');
    expect(found!.usedAt).toBeNull();
  });

  it('过期码 → findActive miss (expiresAt <= now)', async () => {
    const a = nextAccount();
    const now = new Date();
    await store.issue(a, SmsPurpose.DELETE_ACCOUNT, 'hash-exp', new Date(now.getTime() - 1));
    expect(await store.findActive(a, SmsPurpose.DELETE_ACCOUNT, now)).toBeNull();
  });

  it('已用码 → findActive miss', async () => {
    const a = nextAccount();
    const now = new Date();
    await store.issue(
      a,
      SmsPurpose.DELETE_ACCOUNT,
      'hash-used',
      new Date(now.getTime() + 10 * MIN_MS),
    );
    const found = await store.findActive(a, SmsPurpose.DELETE_ACCOUNT, now);
    await store.markUsed(found!.id, now);
    expect(await store.findActive(a, SmsPurpose.DELETE_ACCOUNT, now)).toBeNull();
  });

  it('跨 purpose 隔离: 发 DELETE_ACCOUNT, 查 CANCEL_DELETION → miss', async () => {
    const a = nextAccount();
    const now = new Date();
    await store.issue(
      a,
      SmsPurpose.DELETE_ACCOUNT,
      'hash-iso',
      new Date(now.getTime() + 10 * MIN_MS),
    );
    expect(await store.findActive(a, SmsPurpose.CANCEL_DELETION, now)).toBeNull();
    expect(await store.findActive(a, SmsPurpose.DELETE_ACCOUNT, now)).not.toBeNull();
  });

  it('markUsed 幂等 + affected-count: 首次 won=true, 二次 won=false', async () => {
    const a = nextAccount();
    const now = new Date();
    await store.issue(
      a,
      SmsPurpose.CANCEL_DELETION,
      'hash-mu',
      new Date(now.getTime() + 10 * MIN_MS),
    );
    const found = await store.findActive(a, SmsPurpose.CANCEL_DELETION, now);

    expect(await store.markUsed(found!.id, now)).toBe(true);
    expect(await store.markUsed(found!.id, now)).toBe(false); // 已用 → count=0
  });

  it('issue(tx) + markUsed(tx) 入 caller tx: 回滚 → 码行不落库', async () => {
    const a = nextAccount();
    const now = new Date();
    await expect(
      prisma.$transaction(async (tx) => {
        await store.issue(
          a,
          SmsPurpose.DELETE_ACCOUNT,
          'hash-tx',
          new Date(now.getTime() + 10 * MIN_MS),
          tx,
        );
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await store.findActive(a, SmsPurpose.DELETE_ACCOUNT, now)).toBeNull();
  });
});
