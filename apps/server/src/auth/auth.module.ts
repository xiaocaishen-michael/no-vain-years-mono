import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { Redis } from 'ioredis';
import {
  authConfig,
  redisConfig,
  smsConfig,
  type AuthConfig,
  type RedisConfig,
  type SmsConfig,
} from '../config/index.js';
import { SecurityModule } from '../security/security.module.js';
import { AccountModule } from '../account/account.module.js';
import { REDIS_CLIENT } from '../security/redis.token.js';
import { RETRY_EXECUTOR, type RetryExecutor } from './application/ports/retry-executor.port.js';
import { SMS_CODE_REPOSITORY } from './application/ports/sms-code.repository.port.js';
import { SMS_GATEWAY } from './application/ports/sms-gateway.port.js';
import { TIMING_DEFENSE_EXECUTOR } from './application/ports/timing-defense.port.js';
import { PhoneSmsAuthUseCase } from './application/phone-sms-auth.usecase.js';
import { RequestSmsCodeUseCase } from './application/request-sms-code.usecase.js';
import { AliyunSmsGateway } from './infrastructure/aliyun-sms.gateway.js';
import { AuthFailureLockService } from './infrastructure/auth-failure-lock.service.js';
import { BcryptTimingDefenseExecutor } from './infrastructure/bcrypt-timing-defense.executor.js';
import { CockatielRetryExecutor } from './infrastructure/cockatiel-retry.executor.js';
import { MockSmsGateway } from './infrastructure/mock-sms.gateway.js';
import { SmsCodeRedisRepository } from './infrastructure/sms-code.redis.repository.js';
import { AccountPhoneSmsAuthController } from './web/account-phone-sms-auth.controller.js';
import { AccountSmsCodeController } from './web/account-sms-code.controller.js';
import { SmsPhoneThrottlerGuard } from './web/sms-phone-throttler.guard.js';

/**
 * Auth bounded context (per ADR-0032 + post-A-002 retro).
 *
 * The编排 layer — composes SecurityModule (token + DB + Redis) + AccountModule
 * (account aggregate + JwtAuthGuard) to implement the phone-sms-auth use case
 * (login = register, SMS-code based, anti-enumeration timing defense).
 *
 * Owns:
 *   - SMS code domain (sms-code.vo) + ports + infra (Redis-backed repository,
 *     Aliyun/mock gateway, bcrypt-timing-defense)
 *   - phone-sms-auth + request-sms-code use cases (编排 — calls
 *     AccountRepository (via DI from AccountModule) + JwtTokenService
 *     (via SecurityModule))
 *   - phone/sms throttler guards (FR-S07)
 *   - ProblemDetailFilter (global APP_FILTER; PR-5 will refactor with
 *     traceId / invalidAttributes per ADR-0038)
 *   - Global ThrottlerModule with 5 throttlers (sms-* + me-* mixed —
 *     me-* registration stays here because the storage layer is shared
 *     across all controllers; AccountModule consumes via @Throttle()
 *     decorators from the global instance)
 */
@Module({
  imports: [
    SecurityModule,
    AccountModule,
    ThrottlerModule.forRootAsync({
      inject: [redisConfig.KEY],
      useFactory: (cfg: RedisConfig) => {
        return {
          throttlers: [
            // FR-S07 第 1 条: sms:<phone> 60s 1 次 (default → 标准 Retry-After)
            { limit: 1, ttl: 60_000 },
            // FR-S07 第 2 条: sms:<phone> 24h 10 次 (复用 guard phone tracker)
            { name: 'sms-phone-24h', limit: 10, ttl: 86_400_000 },
            // FR-S07 第 3 条: sms:<ip> 24h 50 次 (per-throttler getTracker = IP)
            {
              name: 'sms-ip-24h',
              limit: 50,
              ttl: 86_400_000,
              getTracker: (req: Record<string, unknown>) => {
                const ip = req['ip'];
                return Promise.resolve(`ip:${typeof ip === 'string' ? ip : 'unknown'}`);
              },
            },
            // FR-008: GET /me 60s 60 次, tracker = accountId (JwtAuthGuard 先行，req.user 已填)
            {
              name: 'me-get',
              limit: 60,
              ttl: 60_000,
              getTracker: (req: Record<string, unknown>) => {
                const user = req['user'] as { accountId?: string } | undefined;
                return Promise.resolve(`me:${user?.accountId ?? 'unauthenticated'}`);
              },
            },
            // FR-008: PATCH /me 60s 10 次, tracker = accountId
            {
              name: 'me-patch',
              limit: 10,
              ttl: 60_000,
              getTracker: (req: Record<string, unknown>) => {
                const user = req['user'] as { accountId?: string } | undefined;
                return Promise.resolve(`me:${user?.accountId ?? 'unauthenticated'}`);
              },
            },
          ],
          storage: new ThrottlerStorageRedisService(cfg.url),
        };
      },
    }),
  ],
  controllers: [AccountSmsCodeController, AccountPhoneSmsAuthController],
  providers: [
    {
      // Per ADR-0023: HMAC-SHA256 + timingSafeEqual 替换 bcrypt cost=12.
      // SMS_CODE_HMAC_SECRET fail-fast at boot via authConfig Zod schema.
      provide: SMS_CODE_REPOSITORY,
      useFactory: (redis: Redis, cfg: AuthConfig) =>
        new SmsCodeRedisRepository(redis, cfg.smsCodeHmacSecret),
      inject: [REDIS_CLIENT, authConfig.KEY],
    },
    {
      // smsConfig is a discriminated union: kind='mock' (default) or
      // kind='aliyun' (Aliyun creds validated at boot — partial config rejected).
      provide: SMS_GATEWAY,
      useFactory: (cfg: SmsConfig, retryExecutor: RetryExecutor) => {
        if (cfg.kind === 'aliyun') {
          const client = AliyunSmsGateway.createClient({
            accessKeyId: cfg.accessKeyId,
            accessKeySecret: cfg.accessKeySecret,
            signName: cfg.signName,
            templateCode: cfg.templateCode,
          });
          return new AliyunSmsGateway(client, cfg.signName, cfg.templateCode, retryExecutor);
        }
        return new MockSmsGateway();
      },
      inject: [smsConfig.KEY, RETRY_EXECUTOR],
    },
    { provide: TIMING_DEFENSE_EXECUTOR, useClass: BcryptTimingDefenseExecutor },
    { provide: RETRY_EXECUTOR, useClass: CockatielRetryExecutor },
    AuthFailureLockService,
    RequestSmsCodeUseCase,
    PhoneSmsAuthUseCase,
    SmsPhoneThrottlerGuard,
    // ProblemDetailFilter (APP_FILTER) moved to SecurityModule in PR-5a —
    // it's a cross-context concern, owned by the platform infra layer.
  ],
})
export class AuthModule {}
