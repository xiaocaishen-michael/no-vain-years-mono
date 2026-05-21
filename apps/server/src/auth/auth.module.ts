import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { Redis } from 'ioredis';
import { SecurityModule } from '../security/security.module.js';
import { AccountModule } from '../account/account.module.js';
import { REDIS_CLIENT } from '../security/redis.token.js';
import { OUTBOX_PUBLISHER } from './application/ports/outbox-publisher.port.js';
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
import { OutboxEventCronPublisher } from './infrastructure/outbox-event-cron.publisher.js';
import { OutboxEventPrismaPublisher } from './infrastructure/outbox-event.prisma.publisher.js';
import { ProblemDetailFilter } from './infrastructure/problem-detail.filter.js';
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
 *   - Cross-context Outbox publisher (FR-S05/CL-008 — eventual account
 *     auto-create propagation)
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
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
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
                return Promise.resolve(
                  `ip:${typeof ip === 'string' ? ip : 'unknown'}`,
                );
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
          storage: new ThrottlerStorageRedisService(config.getOrThrow<string>('REDIS_URL')),
        };
      },
    }),
  ],
  controllers: [AccountSmsCodeController, AccountPhoneSmsAuthController],
  providers: [
    {
      // Per ADR-0023: HMAC-SHA256 + timingSafeEqual 替换 bcrypt cost=12.
      // SMS_CODE_HMAC_SECRET fail-fast,与 AUTH_JWT_SECRET 同管理面.
      provide: SMS_CODE_REPOSITORY,
      useFactory: (redis: Redis, config: ConfigService) =>
        new SmsCodeRedisRepository(
          redis,
          config.getOrThrow<string>('SMS_CODE_HMAC_SECRET'),
        ),
      inject: [REDIS_CLIENT, ConfigService],
    },
    {
      // SMS_GATEWAY=aliyun → AliyunSmsGateway (要求 ALIYUN_* env 全配, fail-fast)
      // SMS_GATEWAY=mock | undefined → MockSmsGateway (dev/test 默认)
      provide: SMS_GATEWAY,
      useFactory: (config: ConfigService, retryExecutor: RetryExecutor) => {
        const gatewayKind = config.get<string>('SMS_GATEWAY', 'mock');
        if (gatewayKind === 'aliyun') {
          const accessKeyId = config.getOrThrow<string>(
            'ALIYUN_ACCESS_KEY_ID',
          );
          const accessKeySecret = config.getOrThrow<string>(
            'ALIYUN_ACCESS_KEY_SECRET',
          );
          const signName = config.getOrThrow<string>('ALIYUN_SMS_SIGN_NAME');
          const templateCode = config.getOrThrow<string>(
            'ALIYUN_SMS_TEMPLATE_CODE',
          );
          const client = AliyunSmsGateway.createClient({
            accessKeyId,
            accessKeySecret,
            signName,
            templateCode,
          });
          return new AliyunSmsGateway(
            client,
            signName,
            templateCode,
            retryExecutor,
          );
        }
        return new MockSmsGateway();
      },
      inject: [ConfigService, RETRY_EXECUTOR],
    },
    { provide: OUTBOX_PUBLISHER, useClass: OutboxEventPrismaPublisher },
    { provide: TIMING_DEFENSE_EXECUTOR, useClass: BcryptTimingDefenseExecutor },
    { provide: RETRY_EXECUTOR, useClass: CockatielRetryExecutor },
    AuthFailureLockService,
    RequestSmsCodeUseCase,
    PhoneSmsAuthUseCase,
    OutboxEventCronPublisher,
    SmsPhoneThrottlerGuard,
    { provide: APP_FILTER, useClass: ProblemDetailFilter },
  ],
})
export class AuthModule {}
