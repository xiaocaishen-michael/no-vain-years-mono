import { describe, it, expect } from 'vitest';
import { Phone } from './phone.vo';

describe('Phone VO', () => {
  it('accepts valid CN mobile (+86 1[3-9]xxx xxxx xxx)', () => {
    expect(Phone.create('+8613800138000').value).toBe('+8613800138000');
    expect(Phone.create('+8615912345678').value).toBe('+8615912345678');
    expect(Phone.create('+8619987654321').value).toBe('+8619987654321');
  });

  it('trims whitespace before validation', () => {
    expect(Phone.create('  +8613800138000  ').value).toBe('+8613800138000');
  });

  it('rejects missing +86 prefix', () => {
    expect(() => Phone.create('13800138000')).toThrow(/Invalid phone/i);
    expect(() => Phone.create('+8613800138000a')).toThrow(/Invalid phone/i);
  });

  it('rejects non-CN mobile prefixes (1[3-9])', () => {
    expect(() => Phone.create('+8612345678901')).toThrow(/Invalid phone/i);
    expect(() => Phone.create('+8610000000000')).toThrow(/Invalid phone/i);
  });

  it('rejects wrong length', () => {
    expect(() => Phone.create('+86138001380')).toThrow(/Invalid phone/i);
    expect(() => Phone.create('+861380013800099')).toThrow(/Invalid phone/i);
  });

  it('is immutable + equality by value', () => {
    const a = Phone.create('+8613800138000');
    const b = Phone.create('+8613800138000');
    expect(a.equals(b)).toBe(true);
    expect(a.value).toBe(b.value);
  });
});
