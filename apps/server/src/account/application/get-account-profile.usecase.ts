import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ACCOUNT_REPOSITORY, type AccountRepository } from './ports/account.repository.port';
import { AccountStatus } from '../domain/account.aggregate';

export interface AccountProfileResult {
  accountId: bigint;
  phone: string;
  displayName: string | null;
  status: AccountStatus;
  createdAt: Date;
}

@Injectable()
export class GetAccountProfileUseCase {
  constructor(
    @Inject(ACCOUNT_REPOSITORY)
    private readonly accountRepo: AccountRepository,
  ) {}

  async execute(accountId: bigint): Promise<AccountProfileResult> {
    const account = await this.accountRepo.findById(accountId);

    if (!account) {
      throw new NotFoundException('ACCOUNT_NOT_FOUND');
    }

    return {
      accountId: account.id,
      phone: account.phone.value,
      displayName: account.displayName?.value ?? null,
      status: account.status,
      createdAt: account.createdAt,
    };
  }
}
