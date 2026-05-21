import { describe, it, expect } from 'vitest';
import { Account, AccountStatus } from './account.aggregate';
import { DisplayName } from './display-name.vo';
import { Phone } from './phone.vo';

describe('Account aggregate', () => {
  const phone = Phone.create('+8613800138000');

  it('createNew(): ACTIVE status, no lastLoginAt, displayName null (FR-007)', () => {
    const account = Account.createNew(1n, phone);
    expect(account.id).toBe(1n);
    expect(account.phone.equals(phone)).toBe(true);
    expect(account.status).toBe(AccountStatus.ACTIVE);
    expect(account.lastLoginAt).toBeNull();
    expect(account.displayName).toBeNull();
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
      freeze_until: new Date('2026-06-01'),
      display_name: null,
    };
    const account = Account.fromPrisma(row);
    expect(account.id).toBe(42n);
    expect(account.phone.value).toBe('+8615900159000');
    expect(account.status).toBe(AccountStatus.FROZEN);
    expect(account.lastLoginAt).toEqual(new Date('2026-05-01'));
    expect(account.freezeUntil).toEqual(new Date('2026-06-01'));
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
    expect(Account.fromPrisma({ id: 1n, phone: '+8613800138000', status: 'ACTIVE', created_at: new Date(), last_login_at: null, freeze_until: null, display_name: null }).isActive()).toBe(true);
    expect(Account.fromPrisma({ id: 1n, phone: '+8613800138000', status: 'FROZEN', created_at: new Date(), last_login_at: null, freeze_until: null, display_name: null }).isFrozen()).toBe(true);
    expect(Account.fromPrisma({ id: 1n, phone: '+8613800138000', status: 'ANONYMIZED', created_at: new Date(), last_login_at: null, freeze_until: null, display_name: null }).isAnonymized()).toBe(true);
  });

  describe('changeDisplayName()', () => {
    it('sets displayName from null to provided VO', () => {
      const account = Account.createNew(1n, phone);
      const dn = DisplayName.create('Alice');
      account.changeDisplayName(dn, new Date());
      expect(account.displayName).toBe(dn);
      expect(account.displayName!.value).toBe('Alice');
    });

    it('overwrites an existing displayName', () => {
      const account = Account.fromPrisma({
        id: 1n, phone: '+8613800138000', status: 'ACTIVE',
        created_at: new Date(), last_login_at: null, freeze_until: null,
        display_name: 'OldName',
      });
      const next = DisplayName.create('NewName');
      account.changeDisplayName(next, new Date());
      expect(account.displayName!.value).toBe('NewName');
    });

    it('does not mutate id, status, phone, or lastLoginAt', () => {
      const account = Account.createNew(2n, phone);
      const at = new Date('2026-05-21T00:00:00Z');
      account.changeDisplayName(DisplayName.create('TestUser'), at);
      expect(account.id).toBe(2n);
      expect(account.phone.equals(phone)).toBe(true);
      expect(account.status).toBe(AccountStatus.ACTIVE);
      expect(account.lastLoginAt).toBeNull();
    });

    it('accepts Unicode / CJK / emoji displayName', () => {
      const account = Account.createNew(3n, phone);
      const dn = DisplayName.create('不虚此生🌱');
      account.changeDisplayName(dn, new Date());
      expect(account.displayName!.value).toBe('不虚此生🌱');
    });
  });

  describe('fromPrisma() — display_name column', () => {
    it('hydrates non-null display_name into DisplayName VO', () => {
      const account = Account.fromPrisma({
        id: 1n, phone: '+8613800138000', status: 'ACTIVE',
        created_at: new Date(), last_login_at: null, freeze_until: null,
        display_name: '不虚此生',
      });
      expect(account.displayName).not.toBeNull();
      expect(account.displayName!.value).toBe('不虚此生');
    });

    it('keeps displayName null when db column is null (FR-007 invariant)', () => {
      const account = Account.fromPrisma({
        id: 1n, phone: '+8613800138000', status: 'ACTIVE',
        created_at: new Date(), last_login_at: null, freeze_until: null,
        display_name: null,
      });
      expect(account.displayName).toBeNull();
    });
  });
});
