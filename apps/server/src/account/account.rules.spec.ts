import { describe, it, expect } from 'vitest';
import {
  AccountStatus,
  isActive,
  isAnonymized,
  isFrozen,
  normalizeDisplayName,
  normalizePhone,
} from './account.rules';
import type { Account } from '../generated/prisma/client';

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

describe('account.rules — normalizePhone (原 Phone VO,R-VO 拍平)', () => {
  it('accepts valid CN mobile, returns trimmed', () => {
    expect(normalizePhone('+8613800138000')).toBe('+8613800138000');
    expect(normalizePhone('+8615912345678')).toBe('+8615912345678');
    expect(normalizePhone('+8619987654321')).toBe('+8619987654321');
  });

  it('trims whitespace before validation', () => {
    expect(normalizePhone('  +8613800138000  ')).toBe('+8613800138000');
  });

  it('rejects missing +86 prefix / trailing junk', () => {
    expect(() => normalizePhone('13800138000')).toThrow(/Invalid phone/i);
    expect(() => normalizePhone('+8613800138000a')).toThrow(/Invalid phone/i);
  });

  it('rejects non-CN mobile prefixes (1[3-9])', () => {
    expect(() => normalizePhone('+8612345678901')).toThrow(/Invalid phone/i);
    expect(() => normalizePhone('+8610000000000')).toThrow(/Invalid phone/i);
  });

  it('rejects wrong length', () => {
    expect(() => normalizePhone('+86138001380')).toThrow(/Invalid phone/i);
    expect(() => normalizePhone('+861380013800099')).toThrow(/Invalid phone/i);
  });
});

describe('account.rules — normalizeDisplayName (原 DisplayName VO,R-VO 拍平)', () => {
  it('returns trimmed value', () => {
    expect(normalizeDisplayName('  Alice  ')).toBe('Alice');
    expect(normalizeDisplayName('你好世界')).toBe('你好世界');
  });

  it('accepts single emoji (1 code point) + 32-cp upper boundary', () => {
    expect(normalizeDisplayName(String.fromCodePoint(0x1f60a))).toBe(String.fromCodePoint(0x1f60a));
    expect(normalizeDisplayName('a'.repeat(32))).toBe('a'.repeat(32));
  });

  it('counts by Unicode code points, not UTF-16 units', () => {
    const four = String.fromCodePoint(0x1f60a, 0x1f60a, 0x1f60a, 0x1f60a);
    expect(normalizeDisplayName(four)).toBe(four);
  });

  it('rejects empty / whitespace-only / 33 cp', () => {
    expect(() => normalizeDisplayName('')).toThrow(/INVALID_DISPLAY_NAME/);
    expect(() => normalizeDisplayName('   ')).toThrow(/INVALID_DISPLAY_NAME/);
    expect(() => normalizeDisplayName('a'.repeat(33))).toThrow(/INVALID_DISPLAY_NAME/);
  });

  it('rejects forbidden chars (control / zero-width / BOM / line separator)', () => {
    expect(() => normalizeDisplayName('abc\x01def')).toThrow(/INVALID_DISPLAY_NAME/);
    expect(() => normalizeDisplayName('abc' + String.fromCodePoint(0x200b) + 'def')).toThrow(
      /INVALID_DISPLAY_NAME/,
    );
    expect(() => normalizeDisplayName(String.fromCodePoint(0xfeff) + 'name')).toThrow(
      /INVALID_DISPLAY_NAME/,
    );
    expect(() => normalizeDisplayName('abc' + String.fromCodePoint(0x2028) + 'def')).toThrow(
      /INVALID_DISPLAY_NAME/,
    );
  });
});
