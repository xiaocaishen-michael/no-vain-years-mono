import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { SwaggerModule, OpenAPIObject } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppModule } from './app/app.module';
import { PrismaService } from './auth/infrastructure/prisma.service';
import { buildOpenApiConfig } from './openapi.config';

/**
 * W4 V8 acceptance: @nestjs/swagger 产 OpenAPI 3.1 JSON,
 * 顶层 openapi: '3.1.0' + 含所有公开 endpoint + 含 schema 引用.
 *
 * Mock PrismaService so the test does not require a live PG connection in CI.
 * REDIS_URL / DATABASE_URL set via env defaults so ConfigService.getOrThrow
 * doesn't blow up during AppModule wiring (ioredis Redis() is lazy — no
 * actual TCP until first command).
 */
describe('OpenAPI document (W4 V8)', () => {
  let app: NestFastifyApplication;
  let document: OpenAPIObject;

  beforeAll(async () => {
    process.env.DATABASE_URL ??= 'postgresql://nobody@localhost:5432/none';
    process.env.REDIS_URL ??= 'redis://localhost:6379';
    process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-32-char-min-len-pad';
    process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-32-char-min-len-pa';

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({
        $connect: vi.fn().mockResolvedValue(undefined),
        $disconnect: vi.fn().mockResolvedValue(undefined),
      })
      .compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
      { logger: false },
    );
    app.setGlobalPrefix('api');
    await app.init();
    document = SwaggerModule.createDocument(app, buildOpenApiConfig());
  });

  afterAll(async () => {
    await app?.close();
  });

  it('uses OpenAPI 3.1.0', () => {
    expect(document.openapi).toBe('3.1.0');
  });

  it('declares accounts tag', () => {
    expect(document.tags?.map((t) => t.name)).toContain('accounts');
  });

  it('exposes POST /api/v1/accounts/sms-codes', () => {
    const path = document.paths['/api/v1/accounts/sms-codes'];
    expect(path).toBeDefined();
    expect(path.post).toBeDefined();
    expect(path.post?.tags).toContain('accounts');
    expect(path.post?.responses['200']).toBeDefined();
    expect(path.post?.responses['429']).toBeDefined();
  });

  it('exposes POST /api/v1/accounts/phone-sms-auth', () => {
    const path = document.paths['/api/v1/accounts/phone-sms-auth'];
    expect(path).toBeDefined();
    expect(path.post).toBeDefined();
    expect(path.post?.tags).toContain('accounts');
    expect(path.post?.responses['200']).toBeDefined();
    expect(path.post?.responses['401']).toBeDefined();
    expect(path.post?.responses['403']).toBeDefined();
    expect(path.post?.responses['429']).toBeDefined();
  });

  it('registers request + response DTO schemas', () => {
    const schemas = document.components?.schemas ?? {};
    expect(Object.keys(schemas)).toEqual(
      expect.arrayContaining([
        'PhoneSmsAuthRequest',
        'PhoneSmsAuthResponse',
        'RequestSmsCodeRequest',
        'RequestSmsCodeResponse',
        'ProblemDetailResponse',
      ]),
    );
  });

  it('PhoneSmsAuthRequest schema carries phone pattern + code pattern', () => {
    const schema = document.components?.schemas?.PhoneSmsAuthRequest as {
      properties?: Record<string, { pattern?: string }>;
    };
    expect(schema.properties?.phone?.pattern).toBe('^\\+861[3-9]\\d{9}$');
    expect(schema.properties?.code?.pattern).toBe('^\\d{6}$');
  });
});
