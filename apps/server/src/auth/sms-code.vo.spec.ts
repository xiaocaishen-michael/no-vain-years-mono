import { describe, it, expect } from 'vitest';
import { SmsCode } from './sms-code.vo';

describe('SmsCode VO', () => {
  it('accepts 6-digit code', () => {
    expect(SmsCode.create('123456').value).toBe('123456');
    expect(SmsCode.create('000000').value).toBe('000000');
    expect(SmsCode.create('999999').value).toBe('999999');
  });

  it('rejects non-6-digit', () => {
    expect(() => SmsCode.create('12345')).toThrow(/Invalid SMS code/i);
    expect(() => SmsCode.create('1234567')).toThrow(/Invalid SMS code/i);
    expect(() => SmsCode.create('12345a')).toThrow(/Invalid SMS code/i);
    expect(() => SmsCode.create('')).toThrow(/Invalid SMS code/i);
  });

  it('verify(other) returns true on equal', () => {
    expect(SmsCode.create('123456').verify(SmsCode.create('123456'))).toBe(true);
  });

  it('verify(other) returns false on differ', () => {
    expect(SmsCode.create('123456').verify(SmsCode.create('123457'))).toBe(false);
  });

  it('generate(): random 6-digit', () => {
    for (let i = 0; i < 100; i++) {
      const c = SmsCode.generate();
      expect(c.value).toMatch(/^\d{6}$/);
    }
  });
});
