import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test, type TestingModule } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { execFileSync } from 'node:child_process';
import type { Redis } from 'ioredis';
import { AppModule } from '../../src/app/app.module';
import { JwtTokenService } from '../../src/security/jwt-token.service';
import { REDIS_CLIENT } from '../../src/security/redis.token';

const SERVER_DIR = process.cwd();

// US4 Independent Test (FR-S13): 4 桶各超限 → 429。list account 第 31 / IP 第 101;
// revoke account 第 6 / IP 第 21。per-account 桶用同一 token; per-IP 桶用不同 account
// (同 loopback IP) 使 account 桶不先 trip。beforeEach flushall 隔离各桶。
//
// NOTE (同 tokens.us6 既有): ThrottlerException 的 Retry-After 头未经 ProblemDetailFilter
// 透出 (filter 仅在 body.retryAfterSeconds 存在时设头) → throttler 429 缺 Retry-After。
// pre-existing 跨切面 infra gap (非 005 引入),故仅断 429 状态。
// "无公网 IP 跳过 IP 桶" 既有 throttler 均未实现 (loopback 按 ip 入桶),本批沿用,不另测。
describe('US4 设备端点限流 429 (Testcontainers PG + Redis + Fastify)', () => {
  let pgContainer: StartedPostgreSqlContainer;
  let redisContainer: StartedRedisContainer;
  let app: NestFastifyApplication;
  let jwt: JwtTokenService;
  let redis: Redis;

  beforeAll(async () => {
    pgContainer = await new PostgreSqlContainer('postgres:16-alpine')
      .withDatabase('test_mbw')
      .withUsername('test')
      .withPassword('test')
      .start();
    redisContainer = await new RedisContainer('redis:7-alpine').start();

    process.env.DATABASE_URL = pgContainer.getConnectionUri();
    process.env.REDIS_URL = redisContainer.getConnectionUrl();
    process.env.AUTH_JWT_SECRET = 'us4-dev-rate-jwt-secret-min-32-bytes-pad-a';
    process.env.SMS_CODE_HMAC_SECRET = 'us4-dev-rate-hmac-secret-min-32-bytes-pad';

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
    jwt = moduleRef.get(JwtTokenService);
    redis = moduleRef.get(REDIS_CLIENT);
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await pgContainer?.stop();
    await redisContainer?.stop();
  });

  beforeEach(async () => {
    await redis.flushall(); // 隔离每条规则的 throttler 桶
  });

  const listDevices = (token: string) =>
    app.inject({
      method: 'GET',
      url: '/api/v1/auth/devices',
      headers: { authorization: `Bearer ${token}`, 'x-device-id': 'dev-x' },
    });
  // 不存在 recordId → 404 (throttler guard 在 handler 前已计数); x-device-id 避 usecase 401。
  const revokeDevice = (token: string) =>
    app.inject({
      method: 'DELETE',
      url: '/api/v1/auth/devices/888888888',
      headers: { authorization: `Bearer ${token}`, 'x-device-id': 'dev-x' },
    });

  it('list per-account 30/60s: 同账号第 31 次 → 429', async () => {
    const token = jwt.signAccessToken({ accountId: 8001n });
    let last;
    for (let i = 0; i < 31; i += 1) last = await listDevices(token);
    expect(last!.statusCode).toBe(429);
  });

  it('list per-IP 100/60s: 同 IP 不同账号第 101 次 → 429', async () => {
    let last;
    for (let i = 0; i < 101; i += 1) {
      last = await listDevices(jwt.signAccessToken({ accountId: 8100n + BigInt(i) }));
    }
    expect(last!.statusCode).toBe(429);
  });

  it('revoke per-account 5/60s: 同账号第 6 次 → 429', async () => {
    const token = jwt.signAccessToken({ accountId: 8002n });
    let last;
    for (let i = 0; i < 6; i += 1) last = await revokeDevice(token);
    expect(last!.statusCode).toBe(429);
  });

  it('revoke per-IP 20/60s: 同 IP 不同账号第 21 次 → 429', async () => {
    let last;
    for (let i = 0; i < 21; i += 1) {
      last = await revokeDevice(jwt.signAccessToken({ accountId: 8200n + BigInt(i) }));
    }
    expect(last!.statusCode).toBe(429);
  });
});
