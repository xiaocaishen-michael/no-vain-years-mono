import { randomUUID } from 'node:crypto';
import { Module, OnModuleDestroy } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { Redis } from 'ioredis';
import { ClsModule } from 'nestjs-cls';
import { JwtTokenService } from './jwt-token.service.js';
import { PrismaService } from './prisma.service.js';
import { ProblemDetailFilter } from './problem-detail.filter.js';
import { REDIS_CLIENT } from './redis.token.js';

const REDIS_LIFECYCLE = Symbol('REDIS_LIFECYCLE');

class RedisLifecycle implements OnModuleDestroy {
  readonly client: Redis;
  constructor(url: string) {
    this.client = new Redis(url);
  }
  onModuleDestroy(): void {
    this.client.disconnect();
  }
}

/**
 * Security / platform infra base layer (per ADR-0032 + ADR-0036 + ADR-0038).
 *
 * Owns + exports cross-cutting infrastructure that account + auth contexts
 * depend on without violating the single-direction `auth → account → security`
 * import boundary:
 *   - JwtTokenService    pure JWT issuance/verify (no business state)
 *   - JwtModule          re-exported so JwtService is DI-resolvable in
 *                        consumers (e.g. JwtAuthGuard in account/web)
 *   - PrismaService      single DB client instance (consumed by account
 *                        + auth repositories)
 *   - REDIS_CLIENT       ioredis singleton with module lifecycle hook
 *   - ClsModule          AsyncLocalStorage trace_id (per ADR-0036) —
 *                        interceptor-mode for Fastify compat, idGenerator
 *                        honors inbound x-trace-id header for cross-service
 *                        propagation
 *   - APP_FILTER ProblemDetailFilter (RFC 9457 + business extension fields
 *                        per ADR-0038; injects traceId from ClsService)
 *
 * "security" is intentionally broader than its original JWT-only scope —
 * it is the platform base layer where common platform infra lives.
 * Consumers MUST NOT bypass this module (no direct `import '../security/X'`
 * for class registration; always via SecurityModule import).
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('AUTH_JWT_SECRET'),
        signOptions: { expiresIn: '15m' },
      }),
    }),
    ClsModule.forRoot({
      global: true,
      // middleware mode (per nestjs-cls docs) covers full request lifecycle —
      // Guards / Interceptors / Pipes / Controller / Filters all see the
      // same CLS context. Interceptor mode (prior) ran its run() wrapper
      // around only the controller phase, so JwtAuthGuard rejections and
      // ProblemDetailFilter both saw `cls.getId() === undefined`.
      // useEnterWith is required for Fastify because Fastify's request
      // lifecycle drops AsyncLocalStorage context across hooks otherwise.
      middleware: {
        mount: true,
        generateId: true,
        useEnterWith: true,
        idGenerator: (req: {
          headers?: Record<string, string | string[] | undefined>;
        }) => {
          const headerValue = req?.headers?.['x-trace-id'];
          const inbound = Array.isArray(headerValue)
            ? headerValue[0]
            : headerValue;
          return typeof inbound === 'string' && inbound.length > 0
            ? inbound
            : randomUUID();
        },
      },
    }),
  ],
  providers: [
    JwtTokenService,
    {
      provide: PrismaService,
      useFactory: (config: ConfigService) =>
        new PrismaService(config.getOrThrow<string>('DATABASE_URL')),
      inject: [ConfigService],
    },
    {
      provide: REDIS_LIFECYCLE,
      useFactory: (config: ConfigService) =>
        new RedisLifecycle(config.getOrThrow<string>('REDIS_URL')),
      inject: [ConfigService],
    },
    {
      provide: REDIS_CLIENT,
      useFactory: (lifecycle: RedisLifecycle) => lifecycle.client,
      inject: [REDIS_LIFECYCLE],
    },
    { provide: APP_FILTER, useClass: ProblemDetailFilter },
  ],
  exports: [JwtTokenService, JwtModule, PrismaService, REDIS_CLIENT],
})
export class SecurityModule {}
