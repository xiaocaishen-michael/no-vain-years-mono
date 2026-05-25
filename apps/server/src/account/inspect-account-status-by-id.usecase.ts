import { Injectable } from '@nestjs/common';
import { PrismaService } from '../security/prisma.service';
import { isAnonymized, isFrozen } from './account.rules';
import type { AccountStatusInspection } from './inspect-account-status.usecase';

/**
 * 按 accountId 探查账户状态 (per ADR-0043 两段式委托 — read-only)。
 *
 * 既有 `InspectAccountStatusUseCase` 按 phone 查; refresh 流只持有 accountId
 * (来自 refresh-token row), 故需 by-id 变体。返回同一 `AccountStatusInspection`
 * kind 联合 (复用,不另造类型)。auth refresh 编排经它做账号可登录判定 (R2 只读);
 * 非 ACTIVE → auth 折叠成反枚举 401 (refresh 无 FROZEN 披露语义,与登录不同)。
 */
@Injectable()
export class InspectAccountStatusByIdUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async execute(accountId: bigint): Promise<AccountStatusInspection> {
    const account = await this.prisma.account.findUnique({ where: { id: accountId } });
    // phone-null row 视为 not-found (沿用旧 repository 守卫语义)。
    if (!account || account.phone === null) {
      return { kind: 'NOT_FOUND' };
    }
    if (isFrozen(account)) {
      return { kind: 'FROZEN', freezeUntil: account.freezeUntil };
    }
    if (isAnonymized(account)) {
      return { kind: 'ANONYMIZED' };
    }
    return { kind: 'ACTIVE' };
  }
}
