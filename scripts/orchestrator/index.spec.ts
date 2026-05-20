import { describe, expect, it } from 'vitest';
import { parseArgs } from './index.js';

describe('parseArgs', () => {
  it('requires a feature path', () => {
    expect(() => parseArgs([])).toThrowError(/feature path is required/);
  });

  it('rejects multiple positional args', () => {
    expect(() => parseArgs(['a', 'b'])).toThrowError(/exactly 1 feature path/);
  });

  it('parses positional + --dry-run', () => {
    expect(parseArgs(['specs/002-foo', '--dry-run'])).toEqual({
      featurePath: 'specs/002-foo',
      dryRun: true,
      only: null,
      parallel: false,
    });
  });

  it('parses --only=T012', () => {
    expect(parseArgs(['specs/002-foo', '--only=T012'])).toMatchObject({
      only: 'T012',
    });
  });

  it('parses --only T012 (space form)', () => {
    expect(parseArgs(['specs/002-foo', '--only', 'T012'])).toMatchObject({
      only: 'T012',
    });
  });

  it('rejects bad --only value', () => {
    expect(() => parseArgs(['specs/002-foo', '--only=foo'])).toThrowError(
      /T\\d/,
    );
  });

  it('parses --parallel', () => {
    expect(parseArgs(['specs/002-foo', '--parallel'])).toMatchObject({
      parallel: true,
    });
  });

  it('rejects unknown flag', () => {
    expect(() => parseArgs(['specs/002-foo', '--nope'])).toThrowError(
      /unknown flag/,
    );
  });
});
