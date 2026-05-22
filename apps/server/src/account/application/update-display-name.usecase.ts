import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ACCOUNT_REPOSITORY, type AccountRepository } from './ports/account.repository.port';
import { AccountStateMachine } from '../domain/account-state-machine';
import { DisplayName } from '../domain/display-name.vo';
import { AccountStatus } from '../domain/account.aggregate';

export interface UpdateDisplayNameResult {
  accountId: bigint;
  phone: string;
  displayName: string | null;
  status: AccountStatus;
  createdAt: Date;
}

@Injectable()
export class UpdateDisplayNameUseCase {
  constructor(
    @Inject(ACCOUNT_REPOSITORY)
    private readonly accountRepo: AccountRepository,
    private readonly stateMachine: AccountStateMachine,
  ) {}

  async execute(accountId: bigint, rawDisplayName: string): Promise<UpdateDisplayNameResult> {
    const account = await this.accountRepo.findById(accountId);

    if (!account) {
      throw new NotFoundException('ACCOUNT_NOT_FOUND');
    }

    let displayName: DisplayName;
    try {
      displayName = DisplayName.create(rawDisplayName);
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('INVALID_DISPLAY_NAME')) {
        throw new BadRequestException(err.message);
      }
      throw err;
    }
    this.stateMachine.changeDisplayName(account, displayName, new Date());
    await this.accountRepo.updateDisplayName(accountId, account.displayName);

    return {
      accountId: account.id,
      phone: account.phone.value,
      displayName: account.displayName?.value ?? null,
      status: account.status,
      createdAt: account.createdAt,
    };
  }
}
