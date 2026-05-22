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

// FR-005 deny-list: control chars (U+0000-U+001F + U+007F) + zero-width chars
// (U+200B-U+200F, U+FEFF) + line/paragraph separators (U+2028, U+2029).
// `new RegExp` with string literal escape preserves \xNN / \uXXXX as visible
// source characters (no invisible code points pasted into the file).
// `no-control-regex` is intentional — these code points are exactly what
// FR-005 must reject from user input (raw control bytes corrupt downstream
// rendering / logs).
/* eslint-disable no-control-regex */
const FORBIDDEN_CHARS = new RegExp('[\\x00-\\x1F\\x7F\\u200B-\\u200F\\uFEFF\\u2028\\u2029]');
/* eslint-enable no-control-regex */

export class DisplayName {
  private constructor(public readonly value: string) {}

  static create(raw: string): DisplayName {
    // Check forbidden chars on raw before trim: String.trim() strips U+FEFF (BOM is
    // ECMAScript WhiteSpace), so checking only the trimmed value silently accepts BOM
    // at leading/trailing position — contradicting FR-005 "禁字符 U+FEFF".
    if (FORBIDDEN_CHARS.test(raw)) {
      throw new Error(
        'INVALID_DISPLAY_NAME: contains forbidden characters (control chars, zero-width chars, or line separators)',
      );
    }

    const trimmed = raw.trim();
    const cpCount = [...trimmed].length;

    if (cpCount < MIN_CP || cpCount > MAX_CP) {
      throw new Error(
        `INVALID_DISPLAY_NAME: length must be ${MIN_CP}-${MAX_CP} Unicode code points after trim, got ${cpCount}`,
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
