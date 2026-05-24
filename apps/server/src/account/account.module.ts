import { Module } from '@nestjs/common';
import { SecurityModule } from '../security/security.module.js';
import { GetAccountProfileUseCase } from './application/get-account-profile.usecase.js';
import { UpdateDisplayNameUseCase } from './application/update-display-name.usecase.js';
import { AccountProfileController } from './web/account-profile.controller.js';
import { AccountIdThrottlerGuard } from './web/account-id-throttler.guard.js';
import { JwtAuthGuard } from './web/jwt-auth.guard.js';

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
 * can reuse the guards on its own controllers.
 */
@Module({
  imports: [SecurityModule],
  controllers: [AccountProfileController],
  providers: [
    GetAccountProfileUseCase,
    UpdateDisplayNameUseCase,
    JwtAuthGuard,
    AccountIdThrottlerGuard,
  ],
  exports: [JwtAuthGuard, AccountIdThrottlerGuard],
})
export class AccountModule {}
