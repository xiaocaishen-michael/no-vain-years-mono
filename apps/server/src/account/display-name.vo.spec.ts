import { describe, it, expect } from 'vitest';
import { DisplayName } from './display-name.vo';

describe('DisplayName VO — FR-005', () => {
  // SC-006 case 1: empty string
  it('rejects empty string', () => {
    expect(() => DisplayName.create('')).toThrow(/INVALID_DISPLAY_NAME/);
  });

  // SC-006 case 2: only whitespace (trim → 0 code points)
  it('rejects whitespace-only input', () => {
    expect(() => DisplayName.create('   ')).toThrow(/INVALID_DISPLAY_NAME/);
    expect(() => DisplayName.create('\t\n')).toThrow(/INVALID_DISPLAY_NAME/);
  });

  // SC-006 case 3: control characters
  it('rejects control characters (U+0000-U+001F, U+007F)', () => {
    expect(() => DisplayName.create('hello\x00world')).toThrow(/INVALID_DISPLAY_NAME/);
    expect(() => DisplayName.create('hello\x1Fworld')).toThrow(/INVALID_DISPLAY_NAME/);
    expect(() => DisplayName.create('hello\x7Fworld')).toThrow(/INVALID_DISPLAY_NAME/);
  });

  // SC-006 case 4: zero-width characters
  it('rejects zero-width characters (U+200B-U+200F, U+FEFF)', () => {
    expect(() => DisplayName.create('hello​world')).toThrow(/INVALID_DISPLAY_NAME/);
    expect(() => DisplayName.create('hello‌world')).toThrow(/INVALID_DISPLAY_NAME/);
    expect(() => DisplayName.create('hello‍world')).toThrow(/INVALID_DISPLAY_NAME/);
    expect(() => DisplayName.create('hello‎world')).toThrow(/INVALID_DISPLAY_NAME/);
    expect(() => DisplayName.create('hello‏world')).toThrow(/INVALID_DISPLAY_NAME/);
    // U+FEFF embedded in middle (not at edges — trim() strips leading/trailing FEFF as whitespace)
    expect(() => DisplayName.create('hel﻿lo')).toThrow(/INVALID_DISPLAY_NAME/);
  });

  // SC-006 case 4 (continued): line separators
  it('rejects line separators (U+2028, U+2029)', () => {
    expect(() => DisplayName.create('hello world')).toThrow(/INVALID_DISPLAY_NAME/);
    expect(() => DisplayName.create('hello world')).toThrow(/INVALID_DISPLAY_NAME/);
  });

  // SC-006 case 5: 33 code points — exceeds max
  it('rejects input with 33 Unicode code points after trim', () => {
    const thirtyThreeChars = 'a'.repeat(33);
    expect(() => DisplayName.create(thirtyThreeChars)).toThrow(/INVALID_DISPLAY_NAME/);
    // 33 CJK chars also over limit
    const thirtyThreeCJK = '字'.repeat(33);
    expect(() => DisplayName.create(thirtyThreeCJK)).toThrow(/INVALID_DISPLAY_NAME/);
  });

  // SC-006 case 6: CJK 32 characters — exactly at max boundary
  it('accepts CJK 32 characters (max boundary)', () => {
    const thirtyCJK = '字'.repeat(32);
    const dn = DisplayName.create(thirtyCJK);
    expect(dn.value).toBe(thirtyCJK);
    expect([...dn.value].length).toBe(32);
  });

  // SC-006 case 7: emoji-only (multi-byte Unicode code points)
  it('accepts emoji-only display names', () => {
    // Each emoji = 1 Unicode code point but typically 2 UTF-16 code units
    const dn = DisplayName.create('🎉🔥✨');
    expect(dn.value).toBe('🎉🔥✨');
    expect([...dn.value].length).toBe(3);
  });

  // SC-006 case 8: mixed valid (CJK + latin + digits + emoji + punctuation)
  it('accepts mixed valid characters', () => {
    const mixed = '不虚此生 no-vain-years 2026 🎯';
    const dn = DisplayName.create(mixed);
    expect(dn.value).toBe(mixed);
  });

  describe('trim behavior', () => {
    it('trims leading/trailing whitespace before validation and storage', () => {
      const dn = DisplayName.create('  Alice  ');
      expect(dn.value).toBe('Alice');
    });

    it('counts code points after trim (whitespace padding does not inflate length)', () => {
      // 32 chars padded with spaces → still valid
      const padded = '  ' + 'a'.repeat(32) + '  ';
      const dn = DisplayName.create(padded);
      expect([...dn.value].length).toBe(32);
    });

    it('rejects 33 code points even when trimmed (no padding loophole)', () => {
      const padded = ' ' + 'a'.repeat(33) + ' ';
      expect(() => DisplayName.create(padded)).toThrow(/INVALID_DISPLAY_NAME/);
    });
  });

  describe('boundary conditions', () => {
    it('accepts minimum length of 1 code point', () => {
      expect(DisplayName.create('A').value).toBe('A');
      expect(DisplayName.create('字').value).toBe('字');
      expect(DisplayName.create('🎉').value).toBe('🎉');
    });

    it('accepts maximum length of 32 code points (latin)', () => {
      const thirtyTwo = 'a'.repeat(32);
      const dn = DisplayName.create(thirtyTwo);
      expect(dn.value).toBe(thirtyTwo);
    });

    it('rejects 0 code points after trim', () => {
      expect(() => DisplayName.create('')).toThrow(/INVALID_DISPLAY_NAME/);
    });
  });

  describe('value object semantics', () => {
    it('stores trimmed value as read-only', () => {
      const dn = DisplayName.create('  Michael  ');
      expect(dn.value).toBe('Michael');
    });

    it('equals() returns true for same value', () => {
      const a = DisplayName.create('Alice');
      const b = DisplayName.create('Alice');
      expect(a.equals(b)).toBe(true);
    });

    it('equals() returns false for different value', () => {
      const a = DisplayName.create('Alice');
      const b = DisplayName.create('Bob');
      expect(a.equals(b)).toBe(false);
    });

    it('toString() returns the trimmed value', () => {
      const dn = DisplayName.create('  Hello  ');
      expect(dn.toString()).toBe('Hello');
    });
  });
});
