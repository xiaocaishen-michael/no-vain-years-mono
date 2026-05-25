import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test, type TestingModule } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { execFileSync } from 'node:child_process';
import type { Redis } from 'ioredis';
import { AppModule } from '../../src/app/app.module';
import { PrismaService } from '../../src/security/prisma.service';
import { JwtTokenService } from '../../src/security/jwt-token.service';
import { REDIS_CLIENT } from '../../src/security/redis.token';

const SERVER_DIR = process.cwd();

// US6 Independent Test (FR-S14, 纯验证 T012/T017 已加的限流 config):
// refresh per-token 5/60s + per-IP 100/60s; logout-all per-account 5/60s + per-IP 50/60s。
// beforeEach flushall 隔离各规则的 throttler 桶 (Redis storage, 同 loopback IP 否则跨测污染)。
describe('US6 限流 429 (Testcontainers PG + Redis + Fastify)', () => {
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
    process.env.AUTH_JWT_SECRET = 'us6-rate-jwt-secret-min-32-bytes-pad-abcde';
    process.env.SMS_CODE_HMAC_SECRET = 'us6-rate-hmac-secret-min-32-bytes-pad-zzz';

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

  const refresh = (refreshToken: string) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/accounts/refresh-token',
      payload: { refreshToken },
    });
  const logoutAll = (token: string) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/accounts/logout-all',
      headers: { authorization: `Bearer ${token}` },
    });

  it('refresh per-token 5/60s: 同 token 第 6 次 → 429', async () => {
    let last;
    for (let i = 0; i < 6; i++) last = await refresh('same-token-for-rate-limit');
    expect(last!.statusCode).toBe(429);
    // NOTE: ThrottlerException 的 Retry-After 头未经 ProblemDetailFilter 透出
    // (filter 仅在 body.retryAfterSeconds 存在时设头) → 全 throttler 429 (含 shipped SMS)
    // 都缺 Retry-After。pre-existing 跨切面 infra gap, 建议单独 fix ProblemDetailFilter。
  });

  it('refresh per-IP 100/60s: 同 IP 不同 token 第 101 次 → 429', async () => {
    let last;
    for (let i = 0; i < 101; i++) last = await refresh(`distinct-token-${i}`);
    expect(last!.statusCode).toBe(429);
  });

  it('logout-all per-account 5/60s: 同账号第 6 次 → 429', async () => {
    const token = jwt.signAccessToken({ accountId: 6001n });
    let last;
    for (let i = 0; i < 6; i++) last = await logoutAll(token);
    expect(last!.statusCode).toBe(429);
  });

  it('logout-all per-IP 50/60s: 同 IP 不同账号第 51 次 → 429', async () => {
    let last;
    for (let i = 0; i < 51; i++) {
      last = await logoutAll(jwt.signAccessToken({ accountId: 6100n + BigInt(i) }));
    }
    expect(last!.statusCode).toBe(429);
  });
});
