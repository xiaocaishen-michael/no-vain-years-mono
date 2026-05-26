import { Module } from '@nestjs/common';
import { SecurityModule } from '../security/security.module.js';
import { GetAccountProfileUseCase } from './get-account-profile.usecase.js';
import { UpdateDisplayNameUseCase } from './update-display-name.usecase.js';
import { InspectAccountStatusUseCase } from './inspect-account-status.usecase.js';
import { InspectAccountStatusByIdUseCase } from './inspect-account-status-by-id.usecase.js';
import { CommitPhoneLoginUseCase } from './commit-phone-login.usecase.js';
import { CommitAccountFreezeUseCase } from './commit-account-freeze.usecase.js';
import { CommitAccountCancellationUseCase } from './commit-account-cancellation.usecase.js';
import { CommitAccountAnonymizationUseCase } from './commit-account-anonymization.usecase.js';
import { AccountProfileController } from './account-profile.controller.js';
import { AccountIdThrottlerGuard } from './account-id-throttler.guard.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';

/**
 * Account bounded context (per ADR-0032 + post-A-002 retro + ADR-0043 扁平贫血).
 *
 * Owns the Account profile read/write use cases (anemic — operate on raw
 * Prisma `Account` rows + `account.rules.ts` pure helpers, no aggregate class /
 * repository port per ADR-0043) and the account-bound auth artefacts
 * (JwtAuthGuard performs token verify *plus* an isActive() row lookup — that
 * hybrid nature is why it lives in account/ not security/; AccountIdThrottlerGuard
 * tracks by accountId).
 *
 * Depends on SecurityModule for PrismaService (use cases + guard inject it
 * directly) and JwtModule (JwtAuthGuard injects JwtService).
 *
 * Exports JwtAuthGuard + AccountIdThrottlerGuard so AuthModule (the编排 layer)
 * can reuse the guards on its own controllers; also exports the two cross-ctx
 * login use cases (Inspect read + Commit write, per ADR-0043 两段式委托) so
 * AuthModule's phone-sms-auth orchestrator never touches `prisma.account.*`.
 */
@Module({
  imports: [SecurityModule],
  controllers: [AccountProfileController],
  providers: [
    GetAccountProfileUseCase,
    UpdateDisplayNameUseCase,
    InspectAccountStatusUseCase,
    InspectAccountStatusByIdUseCase,
    CommitPhoneLoginUseCase,
    CommitAccountFreezeUseCase,
    CommitAccountCancellationUseCase,
    CommitAccountAnonymizationUseCase,
    JwtAuthGuard,
    AccountIdThrottlerGuard,
  ],
  exports: [
    JwtAuthGuard,
    AccountIdThrottlerGuard,
    InspectAccountStatusUseCase,
    InspectAccountStatusByIdUseCase,
    CommitPhoneLoginUseCase,
    CommitAccountFreezeUseCase,
    CommitAccountCancellationUseCase,
  ],
})
export class AccountModule {}
