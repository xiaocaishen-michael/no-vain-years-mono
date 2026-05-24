/**
 * Phone Value Object — E.164 +86 CN mobile only (FR-S01).
 *
 * Immutable, equality by value. Validates 中国大陆手机号 (`+86 1[3-9] xxx xxxx xxx`).
 */
const CN_MOBILE_REGEX = /^\+861[3-9]\d{9}$/;

export class Phone {
  private constructor(public readonly value: string) {}

  static create(raw: string): Phone {
    const trimmed = raw.trim();
    if (!CN_MOBILE_REGEX.test(trimmed)) {
      throw new Error(`Invalid phone: ${raw}`);
    }
    return new Phone(trimmed);
  }

  equals(other: Phone): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
