import { Module } from '@nestjs/common';

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
 * - Phase 4 US2: EventPublicationPrismaPublisher + 未注册路径 amend
 * - Phase 5 US3: 反枚举 + timing defense
 */
@Module({
  imports: [],
  controllers: [],
  providers: [],
  exports: [],
})
export class AuthModule {}
