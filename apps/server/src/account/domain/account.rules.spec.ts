import { describe, it, expect } from 'vitest';
import { AccountStatus, isActive, isAnonymized, isFrozen } from './account.rules';
import type { Account } from '../../generated/prisma/client';

// Minimal raw `Account` row — rules only read `.status`, rest is padding to
// satisfy the generated type shape (per ADR-0043 贫血: data = Prisma row).
const row = (status: string): Account =>
  ({
    id: 1n,
    phone: '+8613800138000',
    status,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastLoginAt: null,
    displayName: null,
    freezeUntil: null,
    previousPhoneHash: null,
  }) as Account;

describe('account.rules — 纯函数不变量 (per ADR-0043 §2)', () => {
  it('isActive true only for ACTIVE', () => {
    expect(isActive(row(AccountStatus.ACTIVE))).toBe(true);
    expect(isActive(row(AccountStatus.FROZEN))).toBe(false);
    expect(isActive(row(AccountStatus.ANONYMIZED))).toBe(false);
  });

  it('isFrozen true only for FROZEN', () => {
    expect(isFrozen(row(AccountStatus.FROZEN))).toBe(true);
    expect(isFrozen(row(AccountStatus.ACTIVE))).toBe(false);
    expect(isFrozen(row(AccountStatus.ANONYMIZED))).toBe(false);
  });

  it('isAnonymized true only for ANONYMIZED', () => {
    expect(isAnonymized(row(AccountStatus.ANONYMIZED))).toBe(true);
    expect(isAnonymized(row(AccountStatus.ACTIVE))).toBe(false);
    expect(isAnonymized(row(AccountStatus.FROZEN))).toBe(false);
  });

  it('unknown status → all predicates false (贫血 row 容错)', () => {
    const unknown = row('PENDING_DELETION');
    expect(isActive(unknown)).toBe(false);
    expect(isFrozen(unknown)).toBe(false);
    expect(isAnonymized(unknown)).toBe(false);
  });
});
