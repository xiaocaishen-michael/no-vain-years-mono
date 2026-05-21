import { Module } from '@nestjs/common';
import { SecurityModule } from '../security/security.module.js';
import { ACCOUNT_REPOSITORY } from './application/ports/account.repository.port.js';
import { GetAccountProfileUseCase } from './application/get-account-profile.usecase.js';
import { UpdateDisplayNameUseCase } from './application/update-display-name.usecase.js';
import { AccountStateMachine } from './domain/account-state-machine.js';
import { AccountPrismaRepository } from './infrastructure/account.prisma.repository.js';
import { AccountProfileController } from './web/account-profile.controller.js';
import { AccountIdThrottlerGuard } from './web/account-id-throttler.guard.js';
import { JwtAuthGuard } from './web/jwt-auth.guard.js';

/**
 * Account bounded context (per ADR-0032 + post-A-002 retro).
 *
 * Owns the Account aggregate, profile read/write use cases, and the
 * account-bound auth artefacts (JwtAuthGuard performs token verify *plus*
 * Account.isActive() lookup — that hybrid nature is why it lives in
 * account/ not security/; AccountIdThrottlerGuard tracks by accountId).
 *
 * Depends on SecurityModule for PrismaService (account.prisma.repository)
 * and JwtModule (JwtAuthGuard injects JwtService).
 *
 * Exports ACCOUNT_REPOSITORY + JwtAuthGuard + AccountIdThrottlerGuard so
 * AuthModule (the编排 layer) can compose phone-sms-auth use case + reuse
 * the guards on its own controllers.
 */
@Module({
  imports: [SecurityModule],
  controllers: [AccountProfileController],
  providers: [
    { provide: ACCOUNT_REPOSITORY, useClass: AccountPrismaRepository },
    AccountStateMachine,
    GetAccountProfileUseCase,
    UpdateDisplayNameUseCase,
    JwtAuthGuard,
    AccountIdThrottlerGuard,
  ],
  exports: [ACCOUNT_REPOSITORY, JwtAuthGuard, AccountIdThrottlerGuard],
})
export class AccountModule {}
