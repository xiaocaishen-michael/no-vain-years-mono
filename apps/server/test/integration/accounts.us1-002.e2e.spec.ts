import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import {
  RedisContainer,
  type StartedRedisContainer,
} from '@testcontainers/redis';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test, type TestingModule } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { execFileSync } from 'node:child_process';
import { AppModule } from '../../src/app/app.module';
import { MockSmsGateway } from '../../src/auth/infrastructure/mock-sms.gateway';
import { Phone } from '../../src/auth/domain/phone.vo';
import { SMS_GATEWAY } from '../../src/auth/application/ports/sms-gateway.port';

const SERVER_DIR = process.cwd();

/**
 * US1 (002 spec) e2e — 新用户首登：GET /api/v1/accounts/me 返回 displayName=null。
 *
 * FR-001: response shape { accountId, phone, displayName, status, createdAt }
 * FR-002: missing / invalid token → unified 401 (anti-enumeration)
 * FR-007: new account auto-created with displayName = null
 */
describe('US1-002 e2e — 新用户首登 GET /me returns displayName=null (FR-001, FR-002, FR-007)', () => {
  let pgContainer: StartedPostgreSqlContainer;
  let redisContainer: StartedRedisContainer;
  let app: NestFastifyApplication;
  let mockSms: MockSmsGateway;

  beforeAll(async () => {
    pgContainer = await new PostgreSqlContainer('postgres:16-alpine')
      .withDatabase('test_mbw')
      .withUsername('test')
      .withPassword('test')
      .start();
    redisContainer = await new RedisContainer('redis:7-alpine').start();

    process.env.DATABASE_URL = pgContainer.getConnectionUri();
    process.env.REDIS_URL = redisContainer.getConnectionUrl();
    process.env.AUTH_JWT_SECRET =
      'us1-002-e2e-jwt-secret-min-32-bytes-pad-abc';
    process.env.SMS_CODE_HMAC_SECRET =
      'us1-002-e2e-hmac-secret-min-32-bytes-pad-zzz';

    execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
      cwd: SERVER_DIR,
      env: process.env,
      stdio: 'inherit',
    });

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    app.setGlobalPrefix('api');
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    mockSms = moduleRef.get<MockSmsGateway>(SMS_GATEWAY);
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
    const code = mockSms.getLastCode(Phone.create(phone));
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/accounts/phone-sms-auth',
      payload: { phone, code },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { accessToken: string };
    return body.accessToken;
  }

  it('新用户首登 GET /me → displayName: null (FR-007 主路径)', async () => {
    const phone = '+8613800140001';
    const token = await acquireToken(phone);

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/accounts/me',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { displayName: string | null; status: string; phone: string };
    expect(body.displayName).toBeNull();
    expect(body.phone).toBe(phone);
    expect(body.status).toBe('ACTIVE');
  });

  it('response 含全部 E1 字段且类型正确 (FR-001)', async () => {
    const phone = '+8613800140002';
    const token = await acquireToken(phone);

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/accounts/me',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;

    expect(body).toHaveProperty('accountId');
    expect(body).toHaveProperty('phone');
    expect(body).toHaveProperty('displayName');
    expect(body).toHaveProperty('status');
    expect(body).toHaveProperty('createdAt');

    expect(typeof body['accountId']).toBe('string');
    expect(body['phone']).toBe(phone);
    expect(body['displayName']).toBeNull();
    expect(body['status']).toBe('ACTIVE');
    expect(typeof body['createdAt']).toBe('string');
    expect(new Date(body['createdAt'] as string).getTime()).not.toBeNaN();
  });

  it('Authorization 头缺失 → 401 (FR-002)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/accounts/me',
    });

    expect(res.statusCode).toBe(401);
  });

  it('Authorization 头格式非法 → 401 (FR-002)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/accounts/me',
      headers: { authorization: 'Bearer invalid.garbage.token' },
    });

    expect(res.statusCode).toBe(401);
  });

  it('SC-003: displayName 不出现在 phone-sms-auth 响应（反枚举不变性）', async () => {
    const phone = '+8613800140003';
    await app.inject({
      method: 'POST',
      url: '/api/v1/accounts/sms-codes',
      payload: { phone },
    });
    const code = mockSms.getLastCode(Phone.create(phone));
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/accounts/phone-sms-auth',
      payload: { phone, code },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body).not.toHaveProperty('displayName');
  });
});
