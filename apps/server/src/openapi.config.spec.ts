import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { SwaggerModule, OpenAPIObject } from '@nestjs/swagger';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from './app/app.module';
import { buildOpenApiConfig } from './openapi.config';

/**
 * W4 V8 acceptance: @nestjs/swagger 产 OpenAPI 3.1 JSON,
 * 顶层 openapi: '3.1.0' + 含所有公开 endpoint + 含 schema 引用.
 *
 * 不 listen — 仅装配 AppModule 后 createDocument,避免 Fastify 端口冲突.
 */
describe('OpenAPI document (W4 V8)', () => {
  let app: NestFastifyApplication;
  let document: OpenAPIObject;

  beforeAll(async () => {
    app = await NestFactory.create<NestFastifyApplication>(
      AppModule,
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
