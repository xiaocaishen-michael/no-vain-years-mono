import { describe, expect, it } from 'vitest';
import { parseArgs } from './index.js';

describe('parseArgs', () => {
  it('requires a feature path', () => {
    expect(() => parseArgs([])).toThrowError(/feature path is required/);
  });

  it('rejects multiple positional args', () => {
    expect(() => parseArgs(['a', 'b', '--dry-run'])).toThrowError(
      /exactly 1 feature path/,
    );
  });

  it('parses positional + --dry-run', () => {
    expect(parseArgs(['specs/002-foo', '--dry-run'])).toEqual({
      featurePath: 'specs/002-foo',
      dryRun: true,
      live: false,
      only: null,
      parallel: false,
    });
  });

  it('parses positional + --live', () => {
    expect(parseArgs(['specs/002-foo', '--live'])).toEqual({
      featurePath: 'specs/002-foo',
      dryRun: false,
      live: true,
      only: null,
      parallel: false,
    });
  });

  it('rejects --dry-run + --live together', () => {
    expect(() =>
      parseArgs(['specs/002-foo', '--dry-run', '--live']),
    ).toThrowError(/both --dry-run and --live/);
  });

  it('rejects neither --dry-run nor --live', () => {
    expect(() => parseArgs(['specs/002-foo'])).toThrowError(
      /must pass either --dry-run or --live/,
    );
  });

  it('parses --only=T012', () => {
    expect(
      parseArgs(['specs/002-foo', '--dry-run', '--only=T012']),
    ).toMatchObject({ only: 'T012' });
  });

  it('parses --only T012 (space form)', () => {
    expect(
      parseArgs(['specs/002-foo', '--dry-run', '--only', 'T012']),
    ).toMatchObject({ only: 'T012' });
  });

  it('rejects bad --only value', () => {
    expect(() =>
      parseArgs(['specs/002-foo', '--dry-run', '--only=foo']),
    ).toThrowError(/T\\d/);
  });

  it('parses --parallel', () => {
    expect(
      parseArgs(['specs/002-foo', '--live', '--parallel']),
    ).toMatchObject({ parallel: true });
  });

  it('rejects unknown flag', () => {
    expect(() =>
      parseArgs(['specs/002-foo', '--dry-run', '--nope']),
    ).toThrowError(/unknown flag/);
  });
});
