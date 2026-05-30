import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test, type TestingModule } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { execFileSync } from 'node:child_process';
import { AppModule } from '../../src/app/app.module';
import { MockSmsGateway } from '../../src/auth/mock-sms.gateway';
import { SMS_GATEWAY } from '../../src/auth/sms-gateway.port';

const SERVER_DIR = process.cwd();

/**
 * 008 US1 e2e — 性别设置：PATCH /api/v1/accounts/me/gender 设置 / 清空 gender。
 *
 * SC-001 / FR-S01..S06:
 *  - PATCH 合法 4 枚举 → 200 + 持久化 + GET /me 回读 (FR-S02, FR-S06)
 *  - null → 清空 gender (200，回读 null) (FR-S03 允许清空)
 *  - 非法枚举值 → 400 (FR-S03)
 *  - 缺 / 失效 token → 401 (FR-S04，沿用既有 authed 守卫)
 *  - GET /me 响应含 gender：已设回读、未设为 null (FR-S06 / T004)
 */
describe('008 gender e2e — PATCH /me/gender + GET /me 回读 (FR-S02..S06, SC-001)', () => {
  let pgContainer: StartedPostgreSqlContainer;
  let redisContainer: StartedRedisContainer;
  let app: NestFastifyApplication;
  let mockSms: MockSmsGateway;
  // Pre-acquired once; reused across the FR-S03 validation battery (< me-patch limit of 10)
  let validationToken: string;

  beforeAll(async () => {
    pgContainer = await new PostgreSqlContainer('postgres:16-alpine')
      .withDatabase('test_mbw')
      .withUsername('test')
      .withPassword('test')
      .start();
    redisContainer = await new RedisContainer('redis:7-alpine').start();

    process.env.DATABASE_URL = pgContainer.getConnectionUri();
    process.env.REDIS_URL = redisContainer.getConnectionUrl();
    process.env.AUTH_JWT_SECRET = 'gender-008-e2e-jwt-secret-min-32-bytes-pad-abc';
    process.env.SMS_CODE_HMAC_SECRET = 'gender-008-e2e-hmac-secret-min-32-bytes-pad-zz';

    execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
      cwd: SERVER_DIR,
      env: process.env,
      stdio: 'inherit',
    });

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    app.setGlobalPrefix('api');
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    mockSms = moduleRef.get<MockSmsGateway>(SMS_GATEWAY);

    validationToken = await acquireToken('+8613800170010');
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await pgContainer?.stop();
    await redisContainer?.stop();
  });

  async function acquireToken(phone: string): Promise<string> {
    await app.inject({
      method: 'POST',
      url: '/api/v1/accounts/sms-codes',
      payload: { phone },
    });
    const code = mockSms.getLastCode(phone);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/accounts/phone-sms-auth',
      payload: { phone, code },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { accessToken: string };
    return body.accessToken;
  }

  // ── Happy path + persistence (FR-S02, FR-S06) ──────────────────────────────

  it('PATCH /me/gender 成功设置 gender → 200 + 更新后 profile (含 gender)', async () => {
    const phone = '+8613800170001';
    const token = await acquireToken(phone);

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/accounts/me/gender',
      headers: { authorization: `Bearer ${token}` },
      payload: { gender: 'MALE' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body['gender']).toBe('MALE');
    expect(body['phone']).toBe(phone);
    expect(body['status']).toBe('ACTIVE');
    expect(typeof body['accountId']).toBe('string');
    expect(body).toHaveProperty('displayName');
  });

  it('PATCH 后 GET /me 回读已更新的 gender（FR-S06 持久化 + 回读）', async () => {
    const token = await acquireToken('+8613800170002');

    await app.inject({
      method: 'PATCH',
      url: '/api/v1/accounts/me/gender',
      headers: { authorization: `Bearer ${token}` },
      payload: { gender: 'NON_BINARY' },
    });

    const getRes = await app.inject({
      method: 'GET',
      url: '/api/v1/accounts/me',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(getRes.statusCode).toBe(200);
    const getBody = getRes.json() as { gender: string };
    expect(getBody.gender).toBe('NON_BINARY');
  });

  it('GET /me gender 为 null 当未设置（FR-S06 默认）', async () => {
    const token = await acquireToken('+8613800170003');

    const getRes = await app.inject({
      method: 'GET',
      url: '/api/v1/accounts/me',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(getRes.statusCode).toBe(200);
    const getBody = getRes.json() as { gender: string | null };
    expect(getBody.gender).toBeNull();
  });

  // ── Clear gender (FR-S03 允许清空) ─────────────────────────────────────────

  it('null 清空 gender → 200 + gender 回读 null（FR-S03 允许清空）', async () => {
    const token = await acquireToken('+8613800170005');

    // 先设
    await app.inject({
      method: 'PATCH',
      url: '/api/v1/accounts/me/gender',
      headers: { authorization: `Bearer ${token}` },
      payload: { gender: 'FEMALE' },
    });
    // 再清空
    const clearRes = await app.inject({
      method: 'PATCH',
      url: '/api/v1/accounts/me/gender',
      headers: { authorization: `Bearer ${token}` },
      payload: { gender: null },
    });
    expect(clearRes.statusCode).toBe(200);
    expect((clearRes.json() as { gender: string | null }).gender).toBeNull();

    const getRes = await app.inject({
      method: 'GET',
      url: '/api/v1/accounts/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect((getRes.json() as { gender: string | null }).gender).toBeNull();
  });

  // ── Auth guard (FR-S04) ────────────────────────────────────────────────────

  it('无 Authorization 头 → 401（FR-S04）', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/accounts/me/gender',
      payload: { gender: 'MALE' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('非法 Authorization token → 401（FR-S04）', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/accounts/me/gender',
      headers: { authorization: 'Bearer invalid.garbage.token' },
      payload: { gender: 'MALE' },
    });
    expect(res.statusCode).toBe(401);
  });

  // ── FR-S03 validation battery（reuse validationToken）──────────────────────

  it.each(['MALE', 'FEMALE', 'NON_BINARY', 'PRIVATE'])(
    'FR-S03 — 合法枚举 %s → 200 + 回读',
    async (g) => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/v1/accounts/me/gender',
        headers: { authorization: `Bearer ${validationToken}` },
        payload: { gender: g },
      });
      expect(res.statusCode).toBe(200);
      expect((res.json() as { gender: string }).gender).toBe(g);
    },
  );

  it('FR-S03 — 非法枚举值 (OTHER) → 400', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/accounts/me/gender',
      headers: { authorization: `Bearer ${validationToken}` },
      payload: { gender: 'OTHER' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('FR-S03 — 小写 (male) → 400（严格枚举）', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/accounts/me/gender',
      headers: { authorization: `Bearer ${validationToken}` },
      payload: { gender: 'male' },
    });
    expect(res.statusCode).toBe(400);
  });
});
