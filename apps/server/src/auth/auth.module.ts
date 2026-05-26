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
import { hashRefreshToken } from '../security/refresh-token-hasher.js';
import { RETRY_EXECUTOR, type RetryExecutor } from './retry-executor.port.js';
import { SMS_GATEWAY } from './sms-gateway.port.js';
import { TIMING_DEFENSE_EXECUTOR } from './timing-defense.port.js';
import { PhoneSmsAuthUseCase } from './phone-sms-auth.usecase.js';
import { RequestSmsCodeUseCase } from './request-sms-code.usecase.js';
import { AliyunSmsGateway, type SmsTemplateOverrides } from './aliyun-sms.gateway.js';
import { SmsPurpose } from './deletion-code.rules.js';
import { DeletionCodeStore } from './deletion-code.store.js';
import { SendDeletionCodeUseCase } from './send-deletion-code.usecase.js';
import { DeleteAccountUseCase } from './delete-account.usecase.js';
import { AccountDeletionController } from './account-deletion.controller.js';
import { AuthFailureLockService } from './auth-failure-lock.service.js';
import { BcryptTimingDefenseExecutor } from './bcrypt-timing-defense.executor.js';
import { CockatielRetryExecutor } from './cockatiel-retry.executor.js';
import { MockSmsGateway } from './mock-sms.gateway.js';
import { SmsCodeStore } from './sms-code.store.js';
import { AccountPhoneSmsAuthController } from './account-phone-sms-auth.controller.js';
import { AccountSmsCodeController } from './account-sms-code.controller.js';
import { AccountTokenController } from './account-token.controller.js';
import { RefreshTokenUseCase } from './refresh-token.usecase.js';
import { LogoutAllUseCase } from './logout-all.usecase.js';
import { JwtAccessGuard } from './jwt-access.guard.js';
import { SmsPhoneThrottlerGuard } from './sms-phone-throttler.guard.js';

/**
 * Auth bounded context (per ADR-0032 + post-A-002 retro).
 *
 * The编排 layer — composes SecurityModule (token + DB + Redis) + AccountModule
 * (account aggregate + JwtAuthGuard) to implement the phone-sms-auth use case
 * (login = register, SMS-code based, anti-enumeration timing defense).
 *
 * Owns:
 *   - SMS code domain (sms-code.vo) + SmsCodeStore (Redis-backed concrete
 *     service per ADR-0043 §4) + Aliyun/mock gateway + bcrypt-timing-defense
 *   - phone-sms-auth + request-sms-code use cases (编排 — 直注 PrismaService
 *     读写 account 表 + JwtTokenService (via SecurityModule), per ADR-0043
 *     扁平贫血: 无 repository port)
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
            // FR-S14: refresh-token EP per-IP 100/60s
            {
              name: 'refresh-ip',
              limit: 100,
              ttl: 60_000,
              getTracker: (req: Record<string, unknown>) => {
                const ip = req['ip'];
                return Promise.resolve(`refresh-ip:${typeof ip === 'string' ? ip : 'unknown'}`);
              },
            },
            // FR-S14: refresh-token EP per-token-hash 5/60s (键 = refresh:<sha256(token)>)
            {
              name: 'refresh-token',
              limit: 5,
              ttl: 60_000,
              getTracker: (req: Record<string, unknown>) => {
                const body = req['body'] as { refreshToken?: unknown } | undefined;
                const raw = body && typeof body.refreshToken === 'string' ? body.refreshToken : '';
                return Promise.resolve(`refresh:${raw ? hashRefreshToken(raw) : 'empty'}`);
              },
            },
            // FR-S14: logout-all EP per-IP 50/60s
            {
              name: 'logout-all-ip',
              limit: 50,
              ttl: 60_000,
              getTracker: (req: Record<string, unknown>) => {
                const ip = req['ip'];
                return Promise.resolve(`logout-all-ip:${typeof ip === 'string' ? ip : 'unknown'}`);
              },
            },
            // FR-S14: logout-all EP per-account 5/60s (JwtAccessGuard 先填 req.user)
            {
              name: 'logout-all-account',
              limit: 5,
              ttl: 60_000,
              getTracker: (req: Record<string, unknown>) => {
                const user = req['user'] as { accountId?: unknown } | undefined;
                return Promise.resolve(
                  `logout-all-account:${user?.accountId ?? 'unauthenticated'}`,
                );
              },
            },
            // FR-S18 (004 EP1 注销发码): per-account 1/60s (JwtAuthGuard 先填 req.user)
            {
              name: 'del-code-account',
              limit: 1,
              ttl: 60_000,
              getTracker: (req: Record<string, unknown>) => {
                const user = req['user'] as { accountId?: unknown } | undefined;
                return Promise.resolve(`del-code-account:${user?.accountId ?? 'unauthenticated'}`);
              },
            },
            // FR-S18 (004 EP1 注销发码): per-IP 5/60s
            {
              name: 'del-code-ip',
              limit: 5,
              ttl: 60_000,
              getTracker: (req: Record<string, unknown>) => {
                const ip = req['ip'];
                return Promise.resolve(`del-code-ip:${typeof ip === 'string' ? ip : 'unknown'}`);
              },
            },
            // FR-S18 (004 EP2 注销提交): per-account 5/60s (JwtAuthGuard 先填 req.user)
            {
              name: 'del-submit-account',
              limit: 5,
              ttl: 60_000,
              getTracker: (req: Record<string, unknown>) => {
                const user = req['user'] as { accountId?: unknown } | undefined;
                return Promise.resolve(
                  `del-submit-account:${user?.accountId ?? 'unauthenticated'}`,
                );
              },
            },
            // FR-S18 (004 EP2 注销提交): per-IP 10/60s
            {
              name: 'del-submit-ip',
              limit: 10,
              ttl: 60_000,
              getTracker: (req: Record<string, unknown>) => {
                const ip = req['ip'];
                return Promise.resolve(`del-submit-ip:${typeof ip === 'string' ? ip : 'unknown'}`);
              },
            },
          ],
          storage: new ThrottlerStorageRedisService(cfg.url),
        };
      },
    }),
  ],
  controllers: [
    AccountSmsCodeController,
    AccountPhoneSmsAuthController,
    AccountTokenController,
    AccountDeletionController,
  ],
  providers: [
    {
      // Per ADR-0023: HMAC-SHA256 + timingSafeEqual 替换 bcrypt cost=12.
      // SMS_CODE_HMAC_SECRET fail-fast at boot via authConfig Zod schema.
      // Concrete service (no port) per ADR-0043 §4 — 自有非 DB 基建。
      provide: SmsCodeStore,
      useFactory: (redis: Redis, cfg: AuthConfig) => new SmsCodeStore(redis, cfg.smsCodeHmacSecret),
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
          // purpose → 模板覆盖 (注销/撤销码独立模板, FR-S05/S08); 缺配置 → 回退默认。
          const templateOverrides: SmsTemplateOverrides = {};
          if (cfg.deleteAccountTemplateCode) {
            templateOverrides[SmsPurpose.DELETE_ACCOUNT] = cfg.deleteAccountTemplateCode;
          }
          if (cfg.cancelDeletionTemplateCode) {
            templateOverrides[SmsPurpose.CANCEL_DELETION] = cfg.cancelDeletionTemplateCode;
          }
          return new AliyunSmsGateway(
            client,
            cfg.signName,
            cfg.templateCode,
            retryExecutor,
            templateOverrides,
          );
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
    RefreshTokenUseCase,
    LogoutAllUseCase,
    DeletionCodeStore,
    SendDeletionCodeUseCase,
    DeleteAccountUseCase,
    JwtAccessGuard,
    SmsPhoneThrottlerGuard,
    // ProblemDetailFilter (APP_FILTER) moved to SecurityModule in PR-5a —
    // it's a cross-context concern, owned by the platform infra layer.
  ],
})
export class AuthModule {}
