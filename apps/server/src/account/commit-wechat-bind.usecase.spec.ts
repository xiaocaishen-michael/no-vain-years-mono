import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { execFileSync } from 'node:child_process';
import { PrismaService } from '../security/prisma.service';
import { CommitWechatBindUseCase } from './commit-wechat-bind.usecase';

const SERVER_DIR = process.cwd();

// T005: 微信绑定写半段 (account 独占 wechat_binding 写)。4 态判别 (CREATED/
// IDEMPOTENT/SELF_DIFFERENT/CONFLICT), READ COMMITTED + P2002 冲突闸。
// run via `nx test server <file>` (cwd=apps/server)。
describe('CommitWechatBindUseCase (Testcontainers PG)', () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaService;
  let usecase: CommitWechatBindUseCase;
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
    usecase = new CommitWechatBindUseCase(prisma);
  }, 120_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    await container?.stop();
  });

  const nextPhone = () => `+861380018${String(++seq).padStart(4, '0')}`;
  const nextOpenid = () => `oUNIT${String(++seq).padStart(23, '0')}`;
  const newAccount = () =>
    prisma.account.create({ data: { phone: nextPhone(), status: 'ACTIVE' } });

  it('新建 → CREATED + 落库逐字段 (provider/openid/boundAt; profile 不回填)', async () => {
    const acc = await newAccount();
    const openid = nextOpenid();

    const result = await usecase.execute(acc.id, openid);
    expect(result).toBe('CREATED');

    const row = await prisma.wechatBinding.findFirstOrThrow({ where: { accountId: acc.id } });
    expect(row.provider).toBe('WECHAT');
    expect(row.openid).toBe(openid);
    expect(row.unionid).toBeNull();
    expect(row.boundAt).toBeInstanceOf(Date);
    // profile 不被绑定改写
    const reloaded = await prisma.account.findUniqueOrThrow({ where: { id: acc.id } });
    expect(reloaded.displayName).toBeNull();
  });

  it('本账号同 openid 重绑 → IDEMPOTENT 无重复行', async () => {
    const acc = await newAccount();
    const openid = nextOpenid();
    await usecase.execute(acc.id, openid);

    const result = await usecase.execute(acc.id, openid);
    expect(result).toBe('IDEMPOTENT');

    const rows = await prisma.wechatBinding.findMany({ where: { accountId: acc.id } });
    expect(rows).toHaveLength(1);
  });

  it('本账号绑不同 openid → SELF_DIFFERENT (R2) 无副作用 (原绑定不变)', async () => {
    const acc = await newAccount();
    const first = nextOpenid();
    await usecase.execute(acc.id, first);

    const result = await usecase.execute(acc.id, nextOpenid());
    expect(result).toBe('SELF_DIFFERENT');

    const rows = await prisma.wechatBinding.findMany({ where: { accountId: acc.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.openid).toBe(first); // 原 openid 未被替换
  });

  it('他账号已占同 openid → CONFLICT (不泄露他账号)', async () => {
    const owner = await newAccount();
    const other = await newAccount();
    const openid = nextOpenid();
    await usecase.execute(owner.id, openid);

    const result = await usecase.execute(other.id, openid);
    expect(result).toBe('CONFLICT');

    // other 账号无绑定行
    const otherRows = await prisma.wechatBinding.findMany({ where: { accountId: other.id } });
    expect(otherRows).toHaveLength(0);
  });
});
