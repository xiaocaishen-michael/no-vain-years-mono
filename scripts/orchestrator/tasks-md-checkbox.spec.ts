import { describe, expect, it } from 'vitest';
import {
  CheckboxNotFoundError,
  flipCheckbox,
  getCheckboxState,
  revertCheckbox,
} from './tasks-md-checkbox.js';

const SAMPLE = [
  '# Tasks',
  '',
  '## Server',
  '',
  '- [ ] T001 First task',
  '  <!-- task-meta: {"id":"T001","workspace":"server-app"} -->',
  '',
  '- [ ] T002 Second task',
  '  <!-- task-meta: {"id":"T002","workspace":"server-app"} -->',
  '',
  '- [X] T003 Already completed',
  '  <!-- task-meta: {"id":"T003","workspace":"server-app"} -->',
  '',
].join('\n');

describe('flipCheckbox', () => {
  it('flips pending to completed', () => {
    const out = flipCheckbox(SAMPLE, 'T001');
    expect(out).toMatch(/- \[X\] T001 First task/);
    expect(out).not.toMatch(/- \[ \] T001/);
  });

  it('only affects the matched task line', () => {
    const out = flipCheckbox(SAMPLE, 'T001');
    expect(out).toMatch(/- \[ \] T002/); // unchanged
    expect(out).toMatch(/- \[X\] T003/); // unchanged
  });

  it('normalizes lowercase [x] to [X]', () => {
    const content = '- [x] T010 lowercase\n';
    const out = flipCheckbox(content, 'T010');
    expect(out).toMatch(/- \[X\] T010/);
    expect(out).not.toMatch(/- \[x\]/);
  });

  it('idempotent when already completed', () => {
    const once = flipCheckbox(SAMPLE, 'T003'); // already [X]
    const twice = flipCheckbox(once, 'T003');
    expect(once).toBe(twice);
  });

  it('throws CheckboxNotFoundError when task missing', () => {
    expect(() => flipCheckbox(SAMPLE, 'T999')).toThrow(CheckboxNotFoundError);
  });

  it('preserves indentation', () => {
    const content = '  - [ ] T020 indented task\n';
    const out = flipCheckbox(content, 'T020');
    expect(out).toBe('  - [X] T020 indented task\n');
  });

  it('does not match a task id inside prose mentions', () => {
    const content = ['See task T001 for context.', '- [ ] T001 Real task line'].join('\n');
    const out = flipCheckbox(content, 'T001');
    expect(out).toMatch(/See task T001 for context\./); // unchanged
    expect(out).toMatch(/- \[X\] T001 Real task line/);
  });
});

describe('revertCheckbox', () => {
  it('flips completed to pending', () => {
    const flipped = flipCheckbox(SAMPLE, 'T001');
    const reverted = revertCheckbox(flipped, 'T001');
    expect(reverted).toBe(SAMPLE); // exact roundtrip
  });

  it('idempotent when already pending', () => {
    const once = revertCheckbox(SAMPLE, 'T001');
    const twice = revertCheckbox(once, 'T001');
    expect(once).toBe(twice);
  });

  it('throws when task missing', () => {
    expect(() => revertCheckbox(SAMPLE, 'T999')).toThrow(CheckboxNotFoundError);
  });
});

describe('getCheckboxState', () => {
  it('returns pending for [ ]', () => {
    expect(getCheckboxState(SAMPLE, 'T001')).toBe('pending');
  });
  it('returns completed for [X]', () => {
    expect(getCheckboxState(SAMPLE, 'T003')).toBe('completed');
  });
  it('returns completed for [x] (lowercase)', () => {
    expect(getCheckboxState('- [x] T010 x\n', 'T010')).toBe('completed');
  });
  it('throws when task missing', () => {
    expect(() => getCheckboxState(SAMPLE, 'T999')).toThrow(CheckboxNotFoundError);
  });
});
