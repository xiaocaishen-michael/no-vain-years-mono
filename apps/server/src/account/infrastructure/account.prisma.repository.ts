import { Injectable } from '@nestjs/common';
import { Account, AccountStatus } from '../domain/account.aggregate';
import { DisplayName } from '../domain/display-name.vo';
import { Phone } from '../domain/phone.vo';
import type { AccountRepository } from '../application/ports/account.repository.port';
import { PrismaService } from '../../security/prisma.service';

@Injectable()
export class AccountPrismaRepository implements AccountRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: bigint): Promise<Account | null> {
    const row = await this.prisma.account.findUnique({ where: { id } });
    if (!row || row.phone === null) return null;
    return Account.fromPrisma({
      id: row.id,
      phone: row.phone,
      status: row.status as 'ACTIVE' | 'FROZEN' | 'ANONYMIZED',
      created_at: row.createdAt,
      last_login_at: row.lastLoginAt,
      freeze_until: row.freezeUntil,
      display_name: row.displayName ?? null,
    });
  }

  async findByPhone(phone: Phone): Promise<Account | null> {
    const row = await this.prisma.account.findUnique({
      where: { phone: phone.value },
    });
    if (!row || row.phone === null) return null;
    return Account.fromPrisma({
      id: row.id,
      phone: row.phone,
      status: row.status as 'ACTIVE' | 'FROZEN' | 'ANONYMIZED',
      created_at: row.createdAt,
      last_login_at: row.lastLoginAt,
      freeze_until: row.freezeUntil,
      display_name: row.displayName ?? null,
    });
  }

  async save(account: Account): Promise<void> {
    // Note: aggregate.id is currently disregarded — DB BIGSERIAL autogens.
    // US2 transactional auto-register path may refine to expose the generated id.
    await this.prisma.account.create({
      data: {
        phone: account.phone.value,
        status: account.status as AccountStatus,
        lastLoginAt: account.lastLoginAt,
      },
    });
  }

  async updateLastLoginAt(id: bigint, at: Date): Promise<void> {
    await this.prisma.account.update({
      where: { id },
      data: { lastLoginAt: at },
    });
  }

  async updateDisplayName(id: bigint, displayName: DisplayName | null): Promise<void> {
    await this.prisma.account.update({
      where: { id },
      data: { displayName: displayName?.value ?? null },
    });
  }
}
