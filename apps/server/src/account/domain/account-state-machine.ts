import { Injectable } from '@nestjs/common';
import { Account } from './account.aggregate';
import { DisplayName } from './display-name.vo';

/**
 * Domain facade for Account aggregate state transitions.
 *
 * Guards each transition with the required invariant checks before delegating
 * to the aggregate method — mirrors the markLoggedIn call-site pattern in
 * PhoneSmsAuthUseCase (status check + timestamp injection).
 */
@Injectable()
export class AccountStateMachine {
  changeDisplayName(account: Account, displayName: DisplayName, at: Date): void {
    if (!account.isActive()) {
      throw new Error('ACCOUNT_NOT_ACTIVE: only ACTIVE accounts may update display name');
    }
    account.changeDisplayName(displayName, at);
  }
}
