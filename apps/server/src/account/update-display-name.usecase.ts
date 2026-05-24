import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../security/prisma.service';
import { DisplayName } from './display-name.vo';
import { AccountStatus, isActive } from './account.rules';

export interface UpdateDisplayNameResult {
  accountId: bigint;
  phone: string;
  displayName: string | null;
  status: AccountStatus;
  createdAt: Date;
}

@Injectable()
export class UpdateDisplayNameUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async execute(accountId: bigint, rawDisplayName: string): Promise<UpdateDisplayNameResult> {
    const account = await this.prisma.account.findUnique({ where: { id: accountId } });

    // phone-null row 视为 not-found (沿用旧 repository 守卫语义)。
    if (!account || account.phone === null) {
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

    // 仅 ACTIVE 账号可改 display name (纵深防御 — JwtAuthGuard 已 isActive 拦一道)。
    if (!isActive(account)) {
      throw new Error('ACCOUNT_NOT_ACTIVE: only ACTIVE accounts may update display name');
    }

    await this.prisma.account.update({
      where: { id: accountId },
      data: { displayName: displayName.value },
    });

    return {
      accountId: account.id,
      phone: account.phone,
      displayName: displayName.value,
      status: account.status as AccountStatus,
      createdAt: account.createdAt,
    };
  }
}
