import { Module, OnModuleDestroy } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { Redis } from 'ioredis';
import { JwtTokenService } from './jwt-token.service.js';
import { PrismaService } from './prisma.service.js';
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
 * Security / platform infra base layer (per ADR-0032 + post-A-002 retro).
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
  ],
  exports: [JwtTokenService, JwtModule, PrismaService, REDIS_CLIENT],
})
export class SecurityModule {}
