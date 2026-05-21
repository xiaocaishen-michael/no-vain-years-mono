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
      created_at: row.created_at,
      last_login_at: row.last_login_at,
      freeze_until: row.freeze_until,
      display_name: row.display_name ?? null,
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
      created_at: row.created_at,
      last_login_at: row.last_login_at,
      freeze_until: row.freeze_until,
      display_name: row.display_name ?? null,
    });
  }

  async save(account: Account): Promise<void> {
    // Note: aggregate.id is currently disregarded — DB BIGSERIAL autogens.
    // US2 transactional auto-register path may refine to expose the generated id.
    await this.prisma.account.create({
      data: {
        phone: account.phone.value,
        status: account.status as AccountStatus,
        last_login_at: account.lastLoginAt,
      },
    });
  }

  async updateLastLoginAt(id: bigint, at: Date): Promise<void> {
    await this.prisma.account.update({
      where: { id },
      data: { last_login_at: at },
    });
  }

  async updateDisplayName(id: bigint, displayName: DisplayName | null): Promise<void> {
    await this.prisma.account.update({
      where: { id },
      data: { display_name: displayName?.value ?? null },
    });
  }
}
