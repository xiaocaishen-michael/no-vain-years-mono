import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  FileOpPathEscapeError,
  planFileOps,
  summarizePlan,
} from './fs-ops.js';
import type { TaskFileOp } from './schemas/tasks.js';

describe('planFileOps', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const d of dirs.splice(0)) {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  function makeCwd(seed: Record<string, string> = {}): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orchestrator-fsops-'));
    dirs.push(dir);
    for (const [rel, content] of Object.entries(seed)) {
      const abs = path.join(dir, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content);
    }
    return dir;
  }

  it('create: plans create when target missing', () => {
    const cwd = makeCwd();
    const files: TaskFileOp[] = [
      { path: 'src/new.ts', op: 'create' },
    ];
    const r = planFileOps(cwd, files, 'T001');
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0].action).toBe('create');
    expect(r.entries[0].path).toBe(path.join(cwd, 'src/new.ts'));
    expect(r.warnings).toEqual([]);
    expect(fs.existsSync(path.join(cwd, 'src/new.ts'))).toBe(false);
  });

  it('create: noop when target already exists', () => {
    const cwd = makeCwd({ 'src/already.ts': 'old content' });
    const files: TaskFileOp[] = [
      { path: 'src/already.ts', op: 'create' },
    ];
    const r = planFileOps(cwd, files, 'T002');
    expect(r.entries[0].action).toBe('noop');
    expect(r.entries[0].reason).toBe('already exists');
    expect(fs.readFileSync(path.join(cwd, 'src/already.ts'), 'utf-8')).toBe(
      'old content',
    );
  });

  it('delete: plans delete when target exists', () => {
    const cwd = makeCwd({ 'src/gone.ts': 'bye' });
    const files: TaskFileOp[] = [{ path: 'src/gone.ts', op: 'delete' }];
    const r = planFileOps(cwd, files, 'T003');
    expect(r.entries[0].action).toBe('delete');
    expect(fs.existsSync(path.join(cwd, 'src/gone.ts'))).toBe(true);
  });

  it('delete: noop when target already absent', () => {
    const cwd = makeCwd();
    const files: TaskFileOp[] = [{ path: 'src/gone.ts', op: 'delete' }];
    const r = planFileOps(cwd, files, 'T004');
    expect(r.entries[0].action).toBe('noop');
    expect(r.entries[0].reason).toBe('already absent');
  });

  it('rename: plans rename when source exists', () => {
    const cwd = makeCwd({ 'old/a.ts': 'x' });
    const files: TaskFileOp[] = [
      { path: 'old/a.ts', op: 'rename', rename_to: 'new/a.ts' },
    ];
    const r = planFileOps(cwd, files, 'T005');
    expect(r.entries[0].action).toBe('rename');
    expect(r.entries[0].renameTo).toBe(path.join(cwd, 'new/a.ts'));
    expect(r.warnings).toEqual([]);
  });

  it('rename: warns + noop when source missing', () => {
    const cwd = makeCwd();
    const files: TaskFileOp[] = [
      { path: 'old/missing.ts', op: 'rename', rename_to: 'new/missing.ts' },
    ];
    const r = planFileOps(cwd, files, 'T006');
    expect(r.entries[0].action).toBe('noop');
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toMatch(/op=rename but source missing/);
  });

  it('modify: plans modify when target exists', () => {
    const cwd = makeCwd({ 'src/here.ts': 'before' });
    const files: TaskFileOp[] = [{ path: 'src/here.ts', op: 'modify' }];
    const r = planFileOps(cwd, files, 'T007');
    expect(r.entries[0].action).toBe('modify');
    expect(r.warnings).toEqual([]);
  });

  it('modify: warns + noop when target missing', () => {
    const cwd = makeCwd();
    const files: TaskFileOp[] = [{ path: 'src/missing.ts', op: 'modify' }];
    const r = planFileOps(cwd, files, 'T008');
    expect(r.entries[0].action).toBe('noop');
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toMatch(/op=modify but file missing/);
  });

  it('throws FileOpPathEscapeError when path escapes workspace cwd', () => {
    const cwd = makeCwd();
    const files: TaskFileOp[] = [
      { path: '../outside.ts', op: 'create' },
    ];
    expect(() => planFileOps(cwd, files, 'T009')).toThrow(
      FileOpPathEscapeError,
    );
  });

  it('throws FileOpPathEscapeError when rename_to escapes workspace cwd', () => {
    const cwd = makeCwd({ 'inside.ts': 'x' });
    const files: TaskFileOp[] = [
      { path: 'inside.ts', op: 'rename', rename_to: '../outside.ts' },
    ];
    expect(() => planFileOps(cwd, files, 'T010')).toThrow(
      FileOpPathEscapeError,
    );
  });

  it('accumulates entries and warnings across multiple files in one task', () => {
    const cwd = makeCwd({ 'a.ts': '1', 'b.ts': '2' });
    const files: TaskFileOp[] = [
      { path: 'a.ts', op: 'delete' },
      { path: 'c.ts', op: 'modify' }, // missing → warning
      { path: 'd.ts', op: 'create' },
    ];
    const r = planFileOps(cwd, files, 'T011');
    expect(r.entries).toHaveLength(3);
    expect(r.warnings).toHaveLength(1);
    const summary = summarizePlan(r);
    expect(summary).toEqual({
      create: 1,
      delete: 1,
      rename: 0,
      modify: 0,
      noop: 1,
      warnings: 1,
    });
  });

  it('does not mutate filesystem at all (read-only PR-B contract)', () => {
    const cwd = makeCwd({ 'keep.ts': 'untouched' });
    const files: TaskFileOp[] = [
      { path: 'new.ts', op: 'create' },
      { path: 'keep.ts', op: 'delete' },
      { path: 'keep.ts', op: 'rename', rename_to: 'renamed.ts' },
    ];
    planFileOps(cwd, files, 'T012');
    expect(fs.existsSync(path.join(cwd, 'new.ts'))).toBe(false);
    expect(fs.existsSync(path.join(cwd, 'keep.ts'))).toBe(true);
    expect(fs.existsSync(path.join(cwd, 'renamed.ts'))).toBe(false);
    expect(fs.readFileSync(path.join(cwd, 'keep.ts'), 'utf-8')).toBe(
      'untouched',
    );
  });
});

describe('summarizePlan', () => {
  it('returns zeros for empty result', () => {
    expect(summarizePlan({ entries: [], warnings: [] })).toEqual({
      create: 0,
      delete: 0,
      rename: 0,
      modify: 0,
      noop: 0,
      warnings: 0,
    });
  });
});
