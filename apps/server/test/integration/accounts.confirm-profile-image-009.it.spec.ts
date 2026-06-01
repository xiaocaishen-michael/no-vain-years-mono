import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test, type TestingModule } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { execFileSync } from 'node:child_process';
import { AppModule } from '../../src/app/app.module';
import { MockSmsGateway } from '../../src/auth/mock-sms.gateway';
import { SMS_GATEWAY } from '../../src/auth/sms-gateway.port';
import {
  OBJECT_EXISTS_PROBE,
  type ObjectExistsProbe,
  type ObjectHeadResult,
} from '../../src/account/object-exists.probe';

const SERVER_DIR = process.cwd();

/**
 * 009 US2 IT — PATCH /me/profile-image (EP2 confirm) + GET /me 扩字段 (T007).
 *
 * SC-002 / FR-S03/S04/S05: authed 合法 own-prefix key + HEAD 命中 → 200 +
 * avatarUrl/backgroundImageUrl 持久化 + GET /me 回读; 越权 key → 4xx 不落库;
 * HEAD 未命中 → 拒; 缺 token → 401; GET /me 未设为 null.
 *
 * The HEAD probe is stubbed (overrideProvider) — no real OSS round-trip. OSS
 * creds are deterministic fakes; signing/URL composition is pure code.
 */
let stubHead: ObjectHeadResult = { exists: true, contentType: 'image/jpeg' };
const stubProbe: ObjectExistsProbe = {
  head: () => Promise.resolve(stubHead),
};

describe('009 confirm-profile-image IT — EP2 + GET /me (SC-002, FR-S03/S04/S05)', () => {
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
    process.env.AUTH_JWT_SECRET = 'confirm-009-it-jwt-secret-min-32-bytes-pad-ab';
    process.env.SMS_CODE_HMAC_SECRET = 'confirm-009-it-hmac-secret-min-32-bytes-pad-z';
    process.env.OSS_REGION = 'oss-cn-shanghai';
    process.env.OSS_BUCKET = 'mbw-profile-images';
    process.env.OSS_ACCESS_KEY_ID = 'LTAI-it-fake-ak';
    process.env.OSS_ACCESS_KEY_SECRET = 'it-fake-sk';

    execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
      cwd: SERVER_DIR,
      env: process.env,
      stdio: 'inherit',
    });

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(OBJECT_EXISTS_PROBE)
      .useValue(stubProbe)
      .compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
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

  beforeEach(() => {
    stubHead = { exists: true, contentType: 'image/jpeg' };
  });

  async function acquireToken(phone: string): Promise<{ token: string; accountId: string }> {
    await app.inject({ method: 'POST', url: '/api/v1/accounts/sms-codes', payload: { phone } });
    const code = mockSms.getLastCode(phone);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/accounts/phone-sms-auth',
      payload: { phone, code },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { accessToken: string };
    const sub = JSON.parse(Buffer.from(body.accessToken.split('.')[1]!, 'base64').toString('utf8'))
      .sub as string;
    return { token: body.accessToken, accountId: sub };
  }

  async function issueKey(token: string, target: 'avatar' | 'background'): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/accounts/me/profile-image/upload-credential',
      headers: { authorization: `Bearer ${token}` },
      payload: { target, contentType: 'image/jpeg' },
    });
    expect(res.statusCode).toBe(200);
    return (res.json() as { objectKey: string }).objectKey;
  }

  it('full flow: issue → confirm avatar → 200 + persisted + GET /me reads back', async () => {
    const { token } = await acquireToken('+8613800191001');
    const objectKey = await issueKey(token, 'avatar');

    const confirmRes = await app.inject({
      method: 'PATCH',
      url: '/api/v1/accounts/me/profile-image',
      headers: { authorization: `Bearer ${token}` },
      payload: { target: 'avatar', objectKey },
    });
    expect(confirmRes.statusCode).toBe(200);
    const confirmBody = confirmRes.json() as {
      avatarUrl: string;
      backgroundImageUrl: string | null;
    };
    expect(confirmBody.avatarUrl).toBe(
      `https://mbw-profile-images.oss-cn-shanghai.aliyuncs.com/${objectKey}`,
    );
    expect(confirmBody.backgroundImageUrl).toBeNull();

    const getRes = await app.inject({
      method: 'GET',
      url: '/api/v1/accounts/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(getRes.statusCode).toBe(200);
    const getBody = getRes.json() as { avatarUrl: string | null };
    expect(getBody.avatarUrl).toContain(objectKey);
  });

  it('confirm background writes backgroundImageUrl, avatar stays null', async () => {
    const { token } = await acquireToken('+8613800191002');
    const objectKey = await issueKey(token, 'background');
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/accounts/me/profile-image',
      headers: { authorization: `Bearer ${token}` },
      payload: { target: 'background', objectKey },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { avatarUrl: string | null; backgroundImageUrl: string };
    expect(body.backgroundImageUrl).toContain(objectKey);
    expect(body.avatarUrl).toBeNull();
  });

  it('cross-account prefix key → 400, not persisted', async () => {
    const { token, accountId } = await acquireToken('+8613800191003');
    const foreignKey = `avatar/${BigInt(accountId) + 1n}/uuid/img`;
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/accounts/me/profile-image',
      headers: { authorization: `Bearer ${token}` },
      payload: { target: 'avatar', objectKey: foreignKey },
    });
    expect(res.statusCode).toBe(400);

    const getRes = await app.inject({
      method: 'GET',
      url: '/api/v1/accounts/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect((getRes.json() as { avatarUrl: string | null }).avatarUrl).toBeNull();
  });

  it('HEAD miss (object absent) → 400, not persisted', async () => {
    const { token } = await acquireToken('+8613800191004');
    const objectKey = await issueKey(token, 'avatar');
    stubHead = { exists: false, contentType: null };

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/accounts/me/profile-image',
      headers: { authorization: `Bearer ${token}` },
      payload: { target: 'avatar', objectKey },
    });
    expect(res.statusCode).toBe(400);

    const getRes = await app.inject({
      method: 'GET',
      url: '/api/v1/accounts/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect((getRes.json() as { avatarUrl: string | null }).avatarUrl).toBeNull();
  });

  it('missing token → 401 (FR-S05)', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/accounts/me/profile-image',
      payload: { target: 'avatar', objectKey: 'avatar/1/uuid/img' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('GET /me returns null avatarUrl/backgroundImageUrl when unset (T007/FR-S04)', async () => {
    const { token } = await acquireToken('+8613800191005');
    const getRes = await app.inject({
      method: 'GET',
      url: '/api/v1/accounts/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(getRes.statusCode).toBe(200);
    const body = getRes.json() as { avatarUrl: string | null; backgroundImageUrl: string | null };
    expect(body.avatarUrl).toBeNull();
    expect(body.backgroundImageUrl).toBeNull();
  });
});
