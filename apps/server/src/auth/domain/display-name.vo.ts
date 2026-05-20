/**
 * DisplayName Value Object — FR-005 validation rules.
 *
 * Immutable, equality by value. Validates display name:
 * - trim input, then measure by Unicode code points (handles emoji/surrogate pairs)
 * - code point count in [1, 32]
 * - forbidden: control chars (U+0000-U+001F, U+007F), zero-width chars
 *   (U+200B-U+200F, U+FEFF), line separators (U+2028, U+2029)
 * - stores trimmed value
 *
 * Violation throws Error('INVALID_DISPLAY_NAME: ...'), mapped to HTTP 400 by ProblemDetailFilter.
 */

const MIN_CP = 1;
const MAX_CP = 32;

// Deny-list: control chars + zero-width chars + line/paragraph separators (FR-005)
// Using RegExp constructor keeps all code points as readable \uXXXX escape sequences.
const FORBIDDEN_CHARS = new RegExp(
  '[\\x00-\\x1F\\x7F\\u200B-\\u200F\\uFEFF\\u2028\\u2029]',
);

export class DisplayName {
  private constructor(public readonly value: string) {}

  static create(raw: string): DisplayName {
    const trimmed = raw.trim();
    const cpCount = [...trimmed].length;

    if (cpCount < MIN_CP || cpCount > MAX_CP) {
      throw new Error(
        `INVALID_DISPLAY_NAME: length must be ${MIN_CP}-${MAX_CP} Unicode code points after trim, got ${cpCount}`,
      );
    }

    if (FORBIDDEN_CHARS.test(trimmed)) {
      throw new Error(
        'INVALID_DISPLAY_NAME: contains forbidden characters (control chars, zero-width chars, or line separators)',
      );
    }

    return new DisplayName(trimmed);
  }

  equals(other: DisplayName): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
