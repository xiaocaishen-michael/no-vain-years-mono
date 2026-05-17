import { describe, it, expect } from 'vitest';
import { Account, AccountStatus } from './account.aggregate';
import { Phone } from './phone.vo';

describe('Account aggregate', () => {
  const phone = Phone.create('+8613800138000');

  it('createNew(): ACTIVE status, no lastLoginAt', () => {
    const account = Account.createNew(1n, phone);
    expect(account.id).toBe(1n);
    expect(account.phone.equals(phone)).toBe(true);
    expect(account.status).toBe(AccountStatus.ACTIVE);
    expect(account.lastLoginAt).toBeNull();
    expect(account.isActive()).toBe(true);
    expect(account.isFrozen()).toBe(false);
    expect(account.isAnonymized()).toBe(false);
  });

  it('fromPrisma(): builds aggregate from db row', () => {
    const row = {
      id: 42n,
      phone: '+8615900159000',
      status: 'FROZEN' as const,
      created_at: new Date('2026-01-01'),
      last_login_at: new Date('2026-05-01'),
    };
    const account = Account.fromPrisma(row);
    expect(account.id).toBe(42n);
    expect(account.phone.value).toBe('+8615900159000');
    expect(account.status).toBe(AccountStatus.FROZEN);
    expect(account.lastLoginAt).toEqual(new Date('2026-05-01'));
    expect(account.isFrozen()).toBe(true);
  });

  it('markLoggedIn(): updates lastLoginAt to now (UTC)', async () => {
    const account = Account.createNew(1n, phone);
    const before = Date.now();
    account.markLoggedIn();
    const after = Date.now();
    expect(account.lastLoginAt).toBeInstanceOf(Date);
    expect(account.lastLoginAt!.getTime()).toBeGreaterThanOrEqual(before);
    expect(account.lastLoginAt!.getTime()).toBeLessThanOrEqual(after);
  });

  it('isActive() / isFrozen() / isAnonymized() reflect status enum', () => {
    expect(Account.fromPrisma({ id: 1n, phone: '+8613800138000', status: 'ACTIVE', created_at: new Date(), last_login_at: null }).isActive()).toBe(true);
    expect(Account.fromPrisma({ id: 1n, phone: '+8613800138000', status: 'FROZEN', created_at: new Date(), last_login_at: null }).isFrozen()).toBe(true);
    expect(Account.fromPrisma({ id: 1n, phone: '+8613800138000', status: 'ANONYMIZED', created_at: new Date(), last_login_at: null }).isAnonymized()).toBe(true);
  });
});
