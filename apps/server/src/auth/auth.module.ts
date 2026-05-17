import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { Redis } from 'ioredis';
import { ACCOUNT_REPOSITORY } from './application/ports/account.repository.port';
import { OUTBOX_PUBLISHER } from './application/ports/outbox-publisher.port';
import { SMS_CODE_REPOSITORY } from './application/ports/sms-code.repository.port';
import { SMS_GATEWAY } from './application/ports/sms-gateway.port';
import { TIMING_DEFENSE_EXECUTOR } from './application/ports/timing-defense.port';
import { PhoneSmsAuthUseCase } from './application/phone-sms-auth.usecase';
import { RequestSmsCodeUseCase } from './application/request-sms-code.usecase';
import { AccountPrismaRepository } from './infrastructure/account.prisma.repository';
import { BcryptTimingDefenseExecutor } from './infrastructure/bcrypt-timing-defense.executor';
import { JwtTokenService } from './infrastructure/jwt-token.service';
import { MockSmsGateway } from './infrastructure/mock-sms.gateway';
import { OutboxEventCronPublisher } from './infrastructure/outbox-event-cron.publisher';
import { OutboxEventPrismaPublisher } from './infrastructure/outbox-event.prisma.publisher';
import { PrismaService } from './infrastructure/prisma.service';
import { ProblemDetailFilter } from './infrastructure/problem-detail.filter';
import { REDIS_CLIENT } from './infrastructure/redis.token';
import { SmsCodeRedisRepository } from './infrastructure/sms-code.redis.repository';
import { AccountPhoneSmsAuthController } from './web/account-phone-sms-auth.controller';
import { AccountSmsCodeController } from './web/account-sms-code.controller';

/**
 * NestJS Module: auth use case (phone-sms-auth).
 *
 * Per Constitution Principle IV — exports 显式声明 (跨 module 消费时只通过此 export，
 * 不直接 import internal service/repository).
 *
 * W2.4 implement 渐进填充:
 * - Phase 2 Foundational: VOs / ports / JwtTokenService / AccountCreatedEvent
 * - Phase 3 US1: AccountPrismaRepository + SmsCodeRedisRepository + MockSmsGateway +
 *   RequestSmsCodeUseCase + PhoneSmsAuthUseCase ACTIVE 路径 + 2 controllers
 * - Phase 4 US2: OutboxEventPrismaPublisher + 未注册路径 amend
 * - Phase 5 US3: BcryptTimingDefenseExecutor + AccountInFreezePeriodException
 *   filter + 反枚举 / FROZEN disclosure (CL-006)
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
  controllers: [AccountSmsCodeController, AccountPhoneSmsAuthController],
  providers: [
    {
      provide: PrismaService,
      useFactory: (config: ConfigService) =>
        new PrismaService(config.getOrThrow<string>('DATABASE_URL')),
      inject: [ConfigService],
    },
    {
      provide: REDIS_CLIENT,
      useFactory: (config: ConfigService) =>
        new Redis(config.getOrThrow<string>('REDIS_URL')),
      inject: [ConfigService],
    },
    { provide: ACCOUNT_REPOSITORY, useClass: AccountPrismaRepository },
    { provide: SMS_CODE_REPOSITORY, useClass: SmsCodeRedisRepository },
    { provide: SMS_GATEWAY, useClass: MockSmsGateway },
    { provide: OUTBOX_PUBLISHER, useClass: OutboxEventPrismaPublisher },
    { provide: TIMING_DEFENSE_EXECUTOR, useClass: BcryptTimingDefenseExecutor },
    JwtTokenService,
    RequestSmsCodeUseCase,
    PhoneSmsAuthUseCase,
    OutboxEventCronPublisher,
    { provide: APP_FILTER, useClass: ProblemDetailFilter },
  ],
  exports: [],
})
export class AuthModule {}
