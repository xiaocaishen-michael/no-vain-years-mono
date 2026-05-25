import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { execFileSync } from 'node:child_process';
import { PrismaService } from './prisma.service';
import { RefreshTokenService } from './refresh-token.service';
import { hashRefreshToken } from './refresh-token-hasher';

const SERVER_DIR = process.cwd();
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('RefreshTokenService.persist (Testcontainers PG)', () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaService;
  let service: RefreshTokenService;

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
    service = new RefreshTokenService(prisma);
  }, 120_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    await container?.stop();
  });

  it('显式 deviceId + 私网 IP: 落 active 行,tokenHash=hash(raw),deviceType 归一 PHONE,私网 IP → null,expiresAt≈+30d', async () => {
    const accountId = 1001n;
    const rawToken = 'raw-refresh-token-abc';
    const before = Date.now();
    await service.persist(accountId, rawToken, {
      deviceId: 'device-fixed-1',
      deviceName: 'Pixel 8',
      deviceType: 'mobile',
      clientIp: '192.168.1.50',
      loginMethod: 'PHONE_SMS',
    });

    const rows = await prisma.refreshToken.findMany({ where: { accountId } });
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.tokenHash).toBe(hashRefreshToken(rawToken));
    expect(row.revokedAt).toBeNull();
    expect(row.deviceId).toBe('device-fixed-1');
    expect(row.deviceName).toBe('Pixel 8');
    expect(row.deviceType).toBe('PHONE');
    expect(row.ipAddress).toBeNull();
    expect(row.loginMethod).toBe('PHONE_SMS');
    const expiresMs = row.expiresAt.getTime();
    expect(expiresMs).toBeGreaterThanOrEqual(before + 30 * 24 * 60 * 60 * 1000 - 5_000);
    expect(expiresMs).toBeLessThanOrEqual(Date.now() + 30 * 24 * 60 * 60 * 1000 + 5_000);
  });

  it('无 deviceId → 回退 uuid v4; 公网 IP 原样落库; 无 deviceType → UNKNOWN; 无 deviceName → null', async () => {
    const accountId = 1002n;
    await service.persist(accountId, 'another-raw-token', {
      clientIp: '203.0.113.7',
      loginMethod: 'PHONE_SMS',
    });

    const rows = await prisma.refreshToken.findMany({ where: { accountId } });
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.deviceId).toMatch(UUID_V4);
    expect(row.ipAddress).toBe('203.0.113.7');
    expect(row.deviceType).toBe('UNKNOWN');
    expect(row.deviceName).toBeNull();
  });
});
