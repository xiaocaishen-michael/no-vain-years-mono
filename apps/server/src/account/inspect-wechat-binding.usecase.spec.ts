import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { execFileSync } from 'node:child_process';
import { PrismaService } from '../security/prisma.service';
import { InspectWechatBindingUseCase } from './inspect-wechat-binding.usecase';

const SERVER_DIR = process.cwd();

// T007: 微信绑定存在性只读探查 (两段式委托读半段)。
// run via `nx test server <file>` (cwd=apps/server)。
describe('InspectWechatBindingUseCase (Testcontainers PG)', () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaService;
  let usecase: InspectWechatBindingUseCase;
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
    usecase = new InspectWechatBindingUseCase(prisma);
  }, 120_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    await container?.stop();
  });

  const nextPhone = () => `+861380020${String(++seq).padStart(4, '0')}`;
  const nextOpenid = () => `oINSP${String(++seq).padStart(23, '0')}`;
  const newAccount = () =>
    prisma.account.create({ data: { phone: nextPhone(), status: 'ACTIVE' } });

  it('WECHAT 绑定存在 → bound:true', async () => {
    const acc = await newAccount();
    await prisma.wechatBinding.create({
      data: { accountId: acc.id, provider: 'WECHAT', openid: nextOpenid() },
    });
    expect(await usecase.execute(acc.id)).toEqual({ bound: true });
  });

  it('无绑定 → bound:false', async () => {
    const acc = await newAccount();
    expect(await usecase.execute(acc.id)).toEqual({ bound: false });
  });

  it('跨 provider 隔离: 仅有 OTHER provider 绑定 → WECHAT bound:false 不误判', async () => {
    const acc = await newAccount();
    await prisma.wechatBinding.create({
      data: { accountId: acc.id, provider: 'OTHER', openid: nextOpenid() },
    });
    expect(await usecase.execute(acc.id)).toEqual({ bound: false });
  });
});
