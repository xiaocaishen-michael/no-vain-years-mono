import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test, type TestingModule } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { execFileSync } from 'node:child_process';
import { AppModule } from '../../src/app/app.module';
import { PrismaService } from '../../src/security/prisma.service';
import { MockSmsGateway } from '../../src/auth/infrastructure/mock-sms.gateway';
import { Phone } from '../../src/account/domain/phone.vo';
import { SMS_GATEWAY } from '../../src/auth/application/ports/sms-gateway.port';

const SERVER_DIR = process.cwd();

describe('US1 e2e smoke (Testcontainers PG + Redis + Fastify)', () => {
  let pgContainer: StartedPostgreSqlContainer;
  let redisContainer: StartedRedisContainer;
  let app: NestFastifyApplication;
  let prisma: PrismaService;
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
    process.env.AUTH_JWT_SECRET = 'e2e-test-jwt-secret-min-32-bytes-pad-abcdef';
    process.env.SMS_CODE_HMAC_SECRET = 'us1-e2e-hmac-secret-min-32-bytes-pad-zzzzzz';

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

    prisma = moduleRef.get(PrismaService);
    mockSms = moduleRef.get<MockSmsGateway>(SMS_GATEWAY);
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await pgContainer?.stop();
    await redisContainer?.stop();
  });

  it('POST /api/v1/accounts/sms-codes → 200 + ttlSec=300 + mock gateway saw code', async () => {
    const phone = '+8613800138501';
    await prisma.account.create({ data: { phone, status: 'ACTIVE' } });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/accounts/sms-codes',
      payload: { phone },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ttlSec: 300 });
    expect(mockSms.getLastCode(Phone.create(phone))).toMatch(/^\d{6}$/);
  });

  it('US1 happy path: request SMS → submit auth → 200 + tokens + DB last_login_at updated', async () => {
    const phone = '+8613800138502';
    const acc = await prisma.account.create({
      data: { phone, status: 'ACTIVE' },
    });

    const reqRes = await app.inject({
      method: 'POST',
      url: '/api/v1/accounts/sms-codes',
      payload: { phone },
    });
    expect(reqRes.statusCode).toBe(200);

    const code = mockSms.getLastCode(Phone.create(phone));
    expect(code).toMatch(/^\d{6}$/);

    const authRes = await app.inject({
      method: 'POST',
      url: '/api/v1/accounts/phone-sms-auth',
      payload: { phone, code },
    });

    expect(authRes.statusCode).toBe(200);
    const body = authRes.json();
    expect(body.accountId).toBe(acc.id.toString());
    expect(body.accessToken).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(body.refreshToken).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const updated = await prisma.account.findUnique({ where: { id: acc.id } });
    expect(updated?.last_login_at).not.toBeNull();
  });

  it('code mismatch returns 401', async () => {
    const phone = '+8613800138503';
    await prisma.account.create({ data: { phone, status: 'ACTIVE' } });

    await app.inject({
      method: 'POST',
      url: '/api/v1/accounts/sms-codes',
      payload: { phone },
    });

    const authRes = await app.inject({
      method: 'POST',
      url: '/api/v1/accounts/phone-sms-auth',
      payload: { phone, code: '999999' },
    });
    expect(authRes.statusCode).toBe(401);
  });

  it('invalid phone format returns 400 (ValidationPipe)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/accounts/sms-codes',
      payload: { phone: 'not-a-phone' },
    });
    expect(res.statusCode).toBe(400);
  });
});
