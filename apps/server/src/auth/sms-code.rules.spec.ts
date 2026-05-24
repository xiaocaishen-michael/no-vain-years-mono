import { describe, it, expect } from 'vitest';
import { assertValidSmsCode, generateSmsCode } from './sms-code.rules';

describe('sms-code.rules — assertValidSmsCode (原 SmsCode VO 校验,R-VO 拍平)', () => {
  it('accepts 6-digit code (no throw)', () => {
    expect(() => assertValidSmsCode('123456')).not.toThrow();
    expect(() => assertValidSmsCode('000000')).not.toThrow();
    expect(() => assertValidSmsCode('999999')).not.toThrow();
  });

  it('rejects non-6-digit', () => {
    expect(() => assertValidSmsCode('12345')).toThrow(/Invalid SMS code/i);
    expect(() => assertValidSmsCode('1234567')).toThrow(/Invalid SMS code/i);
    expect(() => assertValidSmsCode('12345a')).toThrow(/Invalid SMS code/i);
    expect(() => assertValidSmsCode('')).toThrow(/Invalid SMS code/i);
  });
});

describe('sms-code.rules — generateSmsCode', () => {
  it('produces random 6-digit string (CSPRNG)', () => {
    for (let i = 0; i < 100; i++) {
      const c = generateSmsCode();
      expect(c).toMatch(/^\d{6}$/);
    }
  });

  it('output passes assertValidSmsCode', () => {
    expect(() => assertValidSmsCode(generateSmsCode())).not.toThrow();
  });
});
