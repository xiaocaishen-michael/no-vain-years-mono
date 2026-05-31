import { randomUUID } from 'node:crypto';
import { Module, OnModuleDestroy } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { Redis } from 'ioredis';
import { ClsModule } from 'nestjs-cls';
import {
  appConfig,
  authConfig,
  dbConfig,
  redisConfig,
  smsConfig,
  wechatConfig,
  type AuthConfig,
  type DbConfig,
  type RedisConfig,
} from '../config/index.js';
import { JwtTokenService } from './jwt-token.service.js';
import { PrismaService } from './prisma.service.js';
import { RefreshTokenService } from './refresh-token.service.js';
import { IpGeoService } from './ip-geo.service.js';
import { ProblemDetailFilter } from './problem-detail.filter.js';
import { REDIS_CLIENT } from './redis.token.js';
import { OUTBOX_PUBLISHER } from './outbox/outbox-publisher.port.js';
import { OutboxEventPrismaPublisher } from './outbox/outbox-event.prisma.publisher.js';
import { OutboxEventCronPublisher } from './outbox/outbox-event-cron.publisher.js';

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
 *   - OUTBOX_PUBLISHER   cross-context Outbox publisher (per ADR-0033 +
 *                        ADR-0043; outbox/ subdir per ADR-0041 sunset) —
 *                        exported so any context can publish via shared tx
 *
 * "security" is intentionally broader than its original JWT-only scope —
 * it is the platform base layer where common platform infra lives.
 * Consumers MUST NOT bypass this module (no direct `import '../security/X'`
 * for class registration; always via SecurityModule import).
 */
@Module({
  imports: [
    // ConfigModule loads all 5 namespaced configs at boot. Each registerAs()
    // factory runs Zod parse → fail-fast on missing/invalid env *before* any
    // module initializes (no listen, no DB connect). cache: true memoizes
    // parsed values so the schema runs only once per process.
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, authConfig, dbConfig, redisConfig, smsConfig, wechatConfig],
      cache: true,
    }),
    JwtModule.registerAsync({
      inject: [authConfig.KEY],
      useFactory: (cfg: AuthConfig) => ({
        secret: cfg.jwtSecret,
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
        idGenerator: (req: { headers?: Record<string, string | string[] | undefined> }) => {
          const headerValue = req?.headers?.['x-trace-id'];
          const inbound = Array.isArray(headerValue) ? headerValue[0] : headerValue;
          return typeof inbound === 'string' && inbound.length > 0 ? inbound : randomUUID();
        },
      },
    }),
  ],
  providers: [
    JwtTokenService,
    RefreshTokenService,
    IpGeoService,
    {
      provide: PrismaService,
      useFactory: (cfg: DbConfig) => new PrismaService(cfg.url),
      inject: [dbConfig.KEY],
    },
    {
      provide: REDIS_LIFECYCLE,
      useFactory: (cfg: RedisConfig) => new RedisLifecycle(cfg.url),
      inject: [redisConfig.KEY],
    },
    {
      provide: REDIS_CLIENT,
      useFactory: (lifecycle: RedisLifecycle) => lifecycle.client,
      inject: [REDIS_LIFECYCLE],
    },
    { provide: APP_FILTER, useClass: ProblemDetailFilter },
    // Cross-context Outbox (per ADR-0033 + ADR-0043): publisher lives in the
    // platform base layer (security/outbox/) so account + auth — and any future
    // context — can publish without violating the single-direction import
    // boundary. OUTBOX_PUBLISHER is exported; the cron scanner is a placeholder
    // (W3+ dispatch hook) registered here but not yet exported.
    { provide: OUTBOX_PUBLISHER, useClass: OutboxEventPrismaPublisher },
    OutboxEventCronPublisher,
  ],
  exports: [
    JwtTokenService,
    RefreshTokenService,
    IpGeoService,
    JwtModule,
    PrismaService,
    REDIS_CLIENT,
    OUTBOX_PUBLISHER,
  ],
})
export class SecurityModule {}
