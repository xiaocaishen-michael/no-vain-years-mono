import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { execFileSync } from 'node:child_process';
import { PrismaService } from '../security/prisma.service';
import { CommitWechatUnbindUseCase } from './commit-wechat-unbind.usecase';

const SERVER_DIR = process.cwd();

// T006: 删微信绑定写半段 (account 持 tx 参与, 镜像 CommitAccountFreeze)。并发裁决
// = 条件 deleteMany WHERE accountId AND provider 的 affected-count。
// run via `nx test server <file>` (cwd=apps/server)。
describe('CommitWechatUnbindUseCase (Testcontainers PG)', () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaService;
  let usecase: CommitWechatUnbindUseCase;
  let seq = 0;

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
    usecase = new CommitWechatUnbindUseCase();
  }, 120_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    await container?.stop();
  });

  const nextPhone = () => `+861380019${String(++seq).padStart(4, '0')}`;
  const nextOpenid = () => `oUNBD${String(++seq).padStart(23, '0')}`;
  const newAccount = () =>
    prisma.account.create({ data: { phone: nextPhone(), status: 'ACTIVE' } });
  // tx 参与: 包一层 $transaction 模拟 auth 的 unbind-wechat 持 tx。
  const unbind = (accountId: bigint) => prisma.$transaction((tx) => usecase.execute(tx, accountId));

  it('有绑定 → won + 行删除', async () => {
    const acc = await newAccount();
    await prisma.wechatBinding.create({
      data: { accountId: acc.id, provider: 'WECHAT', openid: nextOpenid() },
    });

    const { won } = await unbind(acc.id);
    expect(won).toBe(true);

    const rows = await prisma.wechatBinding.findMany({ where: { accountId: acc.id } });
    expect(rows).toHaveLength(0);
  });

  it('无绑定 → won:false lost', async () => {
    const acc = await newAccount();
    const { won } = await unbind(acc.id);
    expect(won).toBe(false);
  });

  it('跨 provider 不误删 (仅删 WECHAT)', async () => {
    const acc = await newAccount();
    // 直插一条非 WECHAT provider 绑定 (模拟未来 provider 共表)
    await prisma.wechatBinding.create({
      data: { accountId: acc.id, provider: 'OTHER', openid: nextOpenid() },
    });

    const { won } = await unbind(acc.id);
    expect(won).toBe(false); // 无 WECHAT 绑定 → lost

    const rows = await prisma.wechatBinding.findMany({ where: { accountId: acc.id } });
    expect(rows).toHaveLength(1); // OTHER 行未被误删
    expect(rows[0]?.provider).toBe('OTHER');
  });
});
