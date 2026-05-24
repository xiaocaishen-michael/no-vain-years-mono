import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../security/prisma.service';
import { AccountStatus } from '../domain/account.rules';

export interface AccountProfileResult {
  accountId: bigint;
  phone: string;
  displayName: string | null;
  status: AccountStatus;
  createdAt: Date;
}

@Injectable()
export class GetAccountProfileUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async execute(accountId: bigint): Promise<AccountProfileResult> {
    const account = await this.prisma.account.findUnique({ where: { id: accountId } });

    // phone-null row 视为 not-found (沿用旧 repository 守卫语义)。
    if (!account || account.phone === null) {
      throw new NotFoundException('ACCOUNT_NOT_FOUND');
    }

    return {
      accountId: account.id,
      phone: account.phone,
      displayName: account.displayName,
      status: account.status as AccountStatus,
      createdAt: account.createdAt,
    };
  }
}
