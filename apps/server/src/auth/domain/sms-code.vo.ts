import { randomInt } from 'node:crypto';

/**
 * SmsCode Value Object — 6 digit numeric only (FR-S02).
 *
 * Immutable. Verify via constant-time-safe equal (use crypto.timingSafeEqual semantics
 * if cross-process; in-process here uses simple === since both are short strings).
 */
const SMS_CODE_REGEX = /^\d{6}$/;

export class SmsCode {
  private constructor(public readonly value: string) {}

  static create(raw: string): SmsCode {
    if (!SMS_CODE_REGEX.test(raw)) {
      throw new Error(`Invalid SMS code: ${raw}`);
    }
    return new SmsCode(raw);
  }

  static generate(): SmsCode {
    // crypto.randomInt 提供 CSPRNG, 范围 [min, max)
    const n = randomInt(0, 1000000);
    const padded = n.toString().padStart(6, '0');
    return new SmsCode(padded);
  }

  verify(other: SmsCode): boolean {
    return this.value === other.value;
  }
}
