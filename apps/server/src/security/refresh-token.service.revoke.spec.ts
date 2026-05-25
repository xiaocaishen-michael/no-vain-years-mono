import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { execFileSync } from 'node:child_process';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from './prisma.service';
import { RefreshTokenService } from './refresh-token.service';
import { JwtTokenService } from './jwt-token.service';

const SERVER_DIR = process.cwd();
const DAY_MS = 24 * 60 * 60 * 1000;

describe('RefreshTokenService.revokeAllForAccount (Testcontainers PG)', () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaService;
  let service: RefreshTokenService;
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
    service = new RefreshTokenService(prisma, new JwtTokenService(new JwtService({ secret: 's' })));
  }, 120_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    await container?.stop();
  });

  async function seedRow(accountId: bigint, revokedAt: Date | null) {
    seq += 1;
    return prisma.refreshToken.create({
      data: {
        tokenHash: `revoke${seq}`.padEnd(64, '0'),
        accountId,
        expiresAt: new Date(Date.now() + 30 * DAY_MS),
        revokedAt,
        deviceId: `dev-rev-${seq}`,
        loginMethod: 'PHONE_SMS',
      },
    });
  }

  it('撤账号全部 active + 隔离: A 3 active + 1 已撤 → A 全撤 (已撤时间戳不变), B 不受影响', async () => {
    const A = 5001n;
    const B = 5002n;
    const alreadyRevokedAt = new Date('2026-01-01T00:00:00Z');
    const preRevoked = await seedRow(A, alreadyRevokedAt);
    await seedRow(A, null);
    await seedRow(A, null);
    await seedRow(A, null);
    await seedRow(B, null);
    await seedRow(B, null);

    const now = new Date();
    await service.revokeAllForAccount(A, now);

    const aActive = await prisma.refreshToken.count({ where: { accountId: A, revokedAt: null } });
    expect(aActive).toBe(0); // A 全撤
    const preRow = await prisma.refreshToken.findUnique({ where: { id: preRevoked.id } });
    expect(preRow!.revokedAt!.getTime()).toBe(alreadyRevokedAt.getTime()); // 已撤时间戳不变 (幂等过滤)
    const bActive = await prisma.refreshToken.count({ where: { accountId: B, revokedAt: null } });
    expect(bActive).toBe(2); // B 不受影响
  });

  it('幂等: 0 active 行也不报错 (count 忽略)', async () => {
    const C = 5003n;
    await expect(service.revokeAllForAccount(C, new Date())).resolves.toBeUndefined();
  });
});
