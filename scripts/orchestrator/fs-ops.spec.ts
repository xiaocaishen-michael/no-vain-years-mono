import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyFileOpPlan,
  FileOpApplyError,
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
    const files: TaskFileOp[] = [{ path: 'src/new.ts', op: 'create' }];
    const r = planFileOps(cwd, files, 'T001');
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0].action).toBe('create');
    expect(r.entries[0].path).toBe(path.join(cwd, 'src/new.ts'));
    expect(r.warnings).toEqual([]);
    expect(fs.existsSync(path.join(cwd, 'src/new.ts'))).toBe(false);
  });

  it('create: noop when target already exists', () => {
    const cwd = makeCwd({ 'src/already.ts': 'old content' });
    const files: TaskFileOp[] = [{ path: 'src/already.ts', op: 'create' }];
    const r = planFileOps(cwd, files, 'T002');
    expect(r.entries[0].action).toBe('noop');
    expect(r.entries[0].reason).toBe('already exists');
    expect(fs.readFileSync(path.join(cwd, 'src/already.ts'), 'utf-8')).toBe('old content');
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
    const files: TaskFileOp[] = [{ path: 'old/a.ts', op: 'rename', rename_to: 'new/a.ts' }];
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

  it('throws FileOpPathEscapeError when path escapes base dir', () => {
    const cwd = makeCwd();
    const files: TaskFileOp[] = [{ path: '../outside.ts', op: 'create' }];
    expect(() => planFileOps(cwd, files, 'T009')).toThrow(FileOpPathEscapeError);
  });

  it('resolves repo-root-relative task paths inside nested workspace dirs', () => {
    // Mirrors the canonical convention: baseDir is repoRoot and
    // task.files[].path is e.g. "apps/server/src/x.ts".
    const repoRoot = makeCwd({
      'apps/server/src/existing.ts': 'pre',
    });
    const files: TaskFileOp[] = [
      { path: 'apps/server/src/new.ts', op: 'create' },
      { path: 'apps/server/src/existing.ts', op: 'modify' },
    ];
    const r = planFileOps(repoRoot, files, 'T020');
    expect(r.entries[0].action).toBe('create');
    expect(r.entries[0].path).toBe(path.join(repoRoot, 'apps/server/src/new.ts'));
    expect(r.entries[1].action).toBe('modify');
    expect(r.warnings).toEqual([]);
  });

  it('throws FileOpPathEscapeError when rename_to escapes workspace cwd', () => {
    const cwd = makeCwd({ 'inside.ts': 'x' });
    const files: TaskFileOp[] = [{ path: 'inside.ts', op: 'rename', rename_to: '../outside.ts' }];
    expect(() => planFileOps(cwd, files, 'T010')).toThrow(FileOpPathEscapeError);
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
    expect(fs.readFileSync(path.join(cwd, 'keep.ts'), 'utf-8')).toBe('untouched');
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

describe('applyFileOpPlan', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const d of dirs.splice(0)) {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  function makeCwd(seed: Record<string, string> = {}): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orchestrator-fsops-apply-'));
    dirs.push(dir);
    for (const [rel, content] of Object.entries(seed)) {
      const abs = path.join(dir, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content);
    }
    return dir;
  }

  it('create: creates empty file + intermediate dirs', () => {
    const cwd = makeCwd();
    const plan = planFileOps(cwd, [{ path: 'a/b/c.ts', op: 'create' }], 'T100');
    const r = applyFileOpPlan(plan);
    expect(r.applied).toHaveLength(1);
    expect(fs.existsSync(path.join(cwd, 'a/b/c.ts'))).toBe(true);
    expect(fs.readFileSync(path.join(cwd, 'a/b/c.ts'), 'utf-8')).toBe('');
  });

  it('create: skips when file already exists (no truncation)', () => {
    const cwd = makeCwd({ 'keep.ts': 'precious' });
    const plan = planFileOps(cwd, [{ path: 'keep.ts', op: 'create' }], 'T101');
    applyFileOpPlan(plan);
    expect(fs.readFileSync(path.join(cwd, 'keep.ts'), 'utf-8')).toBe('precious');
  });

  it('delete: removes existing file', () => {
    const cwd = makeCwd({ 'gone.ts': 'bye' });
    const plan = planFileOps(cwd, [{ path: 'gone.ts', op: 'delete' }], 'T102');
    applyFileOpPlan(plan);
    expect(fs.existsSync(path.join(cwd, 'gone.ts'))).toBe(false);
  });

  it('delete: no-op when already absent', () => {
    const cwd = makeCwd();
    const plan = planFileOps(cwd, [{ path: 'never.ts', op: 'delete' }], 'T103');
    expect(() => applyFileOpPlan(plan)).not.toThrow();
  });

  it('rename: moves file + creates target dir', () => {
    const cwd = makeCwd({ 'src/a.ts': 'x' });
    const plan = planFileOps(
      cwd,
      [{ path: 'src/a.ts', op: 'rename', rename_to: 'dest/b.ts' }],
      'T104',
    );
    applyFileOpPlan(plan);
    expect(fs.existsSync(path.join(cwd, 'src/a.ts'))).toBe(false);
    expect(fs.readFileSync(path.join(cwd, 'dest/b.ts'), 'utf-8')).toBe('x');
  });

  it('modify: succeeds on existing file (no-op write)', () => {
    const cwd = makeCwd({ 'here.ts': 'before' });
    const plan = planFileOps(cwd, [{ path: 'here.ts', op: 'modify' }], 'T105');
    applyFileOpPlan(plan);
    expect(fs.readFileSync(path.join(cwd, 'here.ts'), 'utf-8')).toBe('before');
  });

  it('modify-missing: throws FileOpApplyError in strict mode (default)', () => {
    const cwd = makeCwd();
    const plan = planFileOps(cwd, [{ path: 'absent.ts', op: 'modify' }], 'T106');
    expect(() => applyFileOpPlan(plan)).toThrow(FileOpApplyError);
  });

  it('modify-missing: skips silently when strict=false', () => {
    const cwd = makeCwd();
    const plan = planFileOps(cwd, [{ path: 'absent.ts', op: 'modify' }], 'T107');
    expect(() => applyFileOpPlan(plan, { strictModifyMissing: false })).not.toThrow();
  });

  it('mixed plan applies in order', () => {
    const cwd = makeCwd({ 'old.ts': 'v1', 'tomove.ts': 'mover' });
    const plan = planFileOps(
      cwd,
      [
        { path: 'old.ts', op: 'delete' },
        { path: 'new.ts', op: 'create' },
        { path: 'tomove.ts', op: 'rename', rename_to: 'moved.ts' },
      ],
      'T108',
    );
    applyFileOpPlan(plan);
    expect(fs.existsSync(path.join(cwd, 'old.ts'))).toBe(false);
    expect(fs.existsSync(path.join(cwd, 'new.ts'))).toBe(true);
    expect(fs.existsSync(path.join(cwd, 'moved.ts'))).toBe(true);
    expect(fs.existsSync(path.join(cwd, 'tomove.ts'))).toBe(false);
  });
});
