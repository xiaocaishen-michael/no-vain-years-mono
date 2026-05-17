import { Phone } from './phone.vo';

export enum AccountStatus {
  ACTIVE = 'ACTIVE',
  FROZEN = 'FROZEN',
  ANONYMIZED = 'ANONYMIZED',
}

/**
 * Account aggregate (FR-S05 + FR-S08).
 *
 * Business invariants:
 * - phone unique
 * - status state machine: ACTIVE ↔ FROZEN ↔ ANONYMIZED (转移 use case 由其它 module 处理)
 * - lastLoginAt updated on successful auth (FR-S05 ACTIVE 路径)
 *
 * Prisma → Account adapter: Account.fromPrisma(row).
 */
export interface AccountPrismaRow {
  id: bigint;
  phone: string;
  status: 'ACTIVE' | 'FROZEN' | 'ANONYMIZED';
  created_at: Date;
  last_login_at: Date | null;
  freeze_until: Date | null;
}

export class Account {
  private constructor(
    public readonly id: bigint,
    public readonly phone: Phone,
    public status: AccountStatus,
    public readonly createdAt: Date,
    public lastLoginAt: Date | null,
    public readonly freezeUntil: Date | null,
  ) {}

  static createNew(id: bigint, phone: Phone): Account {
    return new Account(id, phone, AccountStatus.ACTIVE, new Date(), null, null);
  }

  static fromPrisma(row: AccountPrismaRow): Account {
    return new Account(
      row.id,
      Phone.create(row.phone),
      row.status as AccountStatus,
      row.created_at,
      row.last_login_at,
      row.freeze_until,
    );
  }

  markLoggedIn(): void {
    this.lastLoginAt = new Date();
  }

  isActive(): boolean {
    return this.status === AccountStatus.ACTIVE;
  }

  isFrozen(): boolean {
    return this.status === AccountStatus.FROZEN;
  }

  isAnonymized(): boolean {
    return this.status === AccountStatus.ANONYMIZED;
  }
}
