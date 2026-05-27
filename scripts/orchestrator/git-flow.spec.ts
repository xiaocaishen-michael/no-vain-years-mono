import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildCommitMsg,
  buildHookRetryPrompt,
  commitTask,
  FakeGit,
  filesToStage,
  GitCli,
  GitCommitError,
  type CommitTaskInput,
  type Git,
} from './git-flow.js';
import { FakeLlmClient, type LlmInvokeOptions, type LlmInvokeResult } from './llm-client.js';
import { PlanAnalyzer } from './parsers/plan.js';
import { SpecAnalyzer } from './parsers/spec.js';
import { TasksAnalyzer } from './parsers/tasks.js';
import { FakeShell, shellOk, shellFail } from './shell.js';

const FIXTURES_DIR = path.resolve(__dirname, '__fixtures__');
const INVOKE_OPTS: LlmInvokeOptions = { cwd: '/tmp/sandbox' };

function loadFixtures() {
  const spec = new SpecAnalyzer().parse(path.join(FIXTURES_DIR, 'spec-happy.md'));
  const plan = new PlanAnalyzer().parse(path.join(FIXTURES_DIR, 'plan-happy.md'));
  const tasks = new TasksAnalyzer().parse(path.join(FIXTURES_DIR, 'tasks-happy.md'), plan, spec);
  return { spec, plan, tasks };
}

function llmOk(stdout = ''): LlmInvokeResult {
  return { exitCode: 0, stdout, stderr: '', durationMs: 1 };
}

describe('buildCommitMsg', () => {
  it('maps impl → feat with module_boundaries first module', () => {
    const { spec, plan, tasks } = loadFixtures();
    void spec;
    const task = tasks.tasks.find((t) => t.id === 'T001')!; // impl
    const ws = plan.config.workspaces.find((w) => w.id === task.workspace)!;
    const msg = buildCommitMsg(task, plan, ws);
    expect(msg).toMatch(/^feat\(account\): .* \(T001\)$/);
  });

  it('maps test-unit / test-integration / test-e2e → test', () => {
    const { plan, tasks } = loadFixtures();
    const t2 = tasks.tasks.find((t) => t.id === 'T002')!; // test-unit
    const t4 = tasks.tasks.find((t) => t.id === 'T004')!; // test-integration
    const t8 = tasks.tasks.find((t) => t.id === 'T008')!; // test-e2e
    const ws = plan.config.workspaces.find((w) => w.id === t2.workspace)!;
    expect(buildCommitMsg(t2, plan, ws)).toMatch(/^test\(/);
    expect(buildCommitMsg(t4, plan, ws)).toMatch(/^test\(/);
    expect(buildCommitMsg(t8, plan, ws)).toMatch(/^test\(/);
  });

  it('maps gen → chore', () => {
    const { plan, tasks } = loadFixtures();
    const t = tasks.tasks.find((task) => task.id === 'T005')!; // gen
    const ws = plan.config.workspaces.find((w) => w.id === t.workspace)!;
    expect(buildCommitMsg(t, plan, ws)).toMatch(/^chore\(/);
  });

  it('falls back to workspace id when module_boundaries empty for workspace', () => {
    const { plan, tasks } = loadFixtures();
    const t = tasks.tasks.find((task) => task.id === 'T001')!;
    const ws = plan.config.workspaces.find((w) => w.id === t.workspace)!;
    const planNoBoundary = {
      ...plan,
      config: { ...plan.config, module_boundaries: {} },
    };
    expect(buildCommitMsg(t, planNoBoundary, ws)).toMatch(/\(server-app\):/);
  });
});

describe('filesToStage', () => {
  it('omits delete ops and uses rename_to for renames', () => {
    const task = {
      files: [
        { path: 'keep.ts', op: 'modify' as const },
        { path: 'gone.ts', op: 'delete' as const },
        { path: 'old.ts', op: 'rename' as const, rename_to: 'new.ts' },
        { path: 'fresh.ts', op: 'create' as const },
      ],
    };
    expect(filesToStage(task as never)).toEqual(['keep.ts', 'new.ts', 'fresh.ts']);
  });
});

describe('GitCli', () => {
  it('builds `git add` command with quoted files', async () => {
    const sh = new FakeShell([shellOk()]);
    const git = new GitCli(sh);
    await git.add(['a.ts', 'b c.ts'], { cwd: '/repo' });
    expect(sh.calls[0].command).toBe('git add "a.ts" "b c.ts"');
  });

  it('builds `git commit -m "<msg>"` with escaped quotes', async () => {
    const sh = new FakeShell([shellOk()]);
    const git = new GitCli(sh);
    await git.commit('feat(x): say "hi"', { cwd: '/repo' });
    expect(sh.calls[0].command).toBe('git commit -m "feat(x): say \\"hi\\""');
  });

  it('throws GitCommitError on non-zero commit exit', async () => {
    const sh = new FakeShell([shellFail('hook rejected', 1)]);
    const git = new GitCli(sh);
    await expect(git.commit('msg', { cwd: '/repo' })).rejects.toBeInstanceOf(GitCommitError);
  });

  it('builds `git restore --staged` for rollback', async () => {
    const sh = new FakeShell([shellOk()]);
    const git = new GitCli(sh);
    await git.restoreStaged(['a.ts', 'tasks.md'], { cwd: '/repo' });
    expect(sh.calls[0].command).toBe('git restore --staged "a.ts" "tasks.md"');
  });

  it('add() noops for empty files list', async () => {
    const sh = new FakeShell();
    const git = new GitCli(sh);
    await git.add([], { cwd: '/repo' });
    expect(sh.calls).toHaveLength(0);
  });

  it('revParseHead returns trimmed stdout SHA', async () => {
    const sh = new FakeShell([shellOk('deadbeefcafef00d1234567890abcdef12345678\n')]);
    const git = new GitCli(sh);
    const sha = await git.revParseHead({ cwd: '/repo' });
    expect(sh.calls[0].command).toBe('git rev-parse HEAD');
    expect(sha).toBe('deadbeefcafef00d1234567890abcdef12345678');
  });

  it('revParseHead throws on non-zero exit', async () => {
    const sh = new FakeShell([shellFail('not a git repo', 128)]);
    const git = new GitCli(sh);
    await expect(git.revParseHead({ cwd: '/repo' })).rejects.toThrow(/git rev-parse HEAD failed/);
  });

  describe('diffWorkingTree', () => {
    it('runs `git diff HEAD` and returns stdout when no intent-to-add paths', async () => {
      const sh = new FakeShell([shellOk('diff content')]);
      const git: Git = new GitCli(sh);
      const r = await git.diffWorkingTree({ cwd: '/r' });
      expect(r).toBe('diff content');
      expect(sh.calls).toHaveLength(1);
      expect(sh.calls[0].command).toBe('git diff HEAD');
    });

    it('returns empty string when git diff exits non-zero (best-effort)', async () => {
      const sh = new FakeShell([shellFail('broken repo', 128)]);
      const git: Git = new GitCli(sh);
      const r = await git.diffWorkingTree({ cwd: '/r' });
      expect(r).toBe('');
    });

    it('intent-to-adds new file paths before diff, resets after (capture untracked)', async () => {
      // PoC blind spot #10: bare `git diff HEAD` misses untracked files.
      // intent-to-add registers them in the index as "new file mode" so
      // the diff captures full content; reset undoes the intent so the
      // index isn't left polluted for the subsequent commitTask.
      const sh = new FakeShell([
        shellOk(''), // git add --intent-to-add
        shellOk('+new file diff'), // git diff HEAD
        shellOk(''), // git reset HEAD
      ]);
      const git: Git = new GitCli(sh);
      const r = await git.diffWorkingTree({
        cwd: '/r',
        intentToAddPaths: ['packages/x/index.ts', 'apps/y/main.ts'],
      });
      expect(r).toBe('+new file diff');
      expect(sh.calls.map((c) => c.command)).toEqual([
        'git add --intent-to-add -- "packages/x/index.ts" "apps/y/main.ts"',
        'git diff HEAD',
        'git reset HEAD -- "packages/x/index.ts" "apps/y/main.ts"',
      ]);
    });

    it('still resets intent-to-add when diff fails (try/finally)', async () => {
      const sh = new FakeShell([shellOk(''), shellFail('boom', 1), shellOk('')]);
      const git: Git = new GitCli(sh);
      const r = await git.diffWorkingTree({ cwd: '/r', intentToAddPaths: ['a.ts'] });
      expect(r).toBe('');
      expect(sh.calls.map((c) => c.command)).toEqual([
        'git add --intent-to-add -- "a.ts"',
        'git diff HEAD',
        'git reset HEAD -- "a.ts"',
      ]);
    });

    it('skips intent-to-add stage when paths empty', async () => {
      const sh = new FakeShell([shellOk('plain diff')]);
      const git: Git = new GitCli(sh);
      const r = await git.diffWorkingTree({ cwd: '/r', intentToAddPaths: [] });
      expect(r).toBe('plain diff');
      expect(sh.calls).toHaveLength(1);
    });
  });
});

describe('FakeGit', () => {
  it('records each call with method + args', async () => {
    const git = new FakeGit([{ ok: true }]);
    await git.add(['a'], { cwd: '/r' });
    await git.commit('msg', { cwd: '/r' });
    await git.restoreStaged(['a'], { cwd: '/r' });
    await git.revParseHead({ cwd: '/r' });
    expect(git.calls.map((c) => c.method)).toEqual([
      'add',
      'commit',
      'restoreStaged',
      'revParseHead',
    ]);
  });

  it('throws GitCommitError when next response is ok:false', async () => {
    const git = new FakeGit([{ ok: false, stderr: 'lint fail' }]);
    await expect(git.commit('msg', { cwd: '/r' })).rejects.toBeInstanceOf(GitCommitError);
  });

  it('revParseHead returns enqueued SHAs in order then falls back to default', async () => {
    const git = new FakeGit();
    git.enqueueHeadSha('sha-a', 'sha-b');
    expect(await git.revParseHead({ cwd: '/r' })).toBe('sha-a');
    expect(await git.revParseHead({ cwd: '/r' })).toBe('sha-b');
    // Default is a non-empty deterministic SHA so tests don't see empty strings.
    expect(await git.revParseHead({ cwd: '/r' })).toMatch(/^fakehead/);
  });
});

describe('commitTask', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const d of dirs.splice(0)) {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  function makeRepo(tasksContent: string): {
    repoRoot: string;
    tasksMdPath: string;
  } {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'orchestrator-commit-'));
    dirs.push(repoRoot);
    const featureDir = path.join(repoRoot, 'specs', '002-demo');
    fs.mkdirSync(featureDir, { recursive: true });
    const tasksMdPath = path.join(featureDir, 'tasks.md');
    fs.writeFileSync(tasksMdPath, tasksContent);
    return { repoRoot, tasksMdPath };
  }

  function makeInput(
    git: FakeGit,
    llm: FakeLlmClient,
    tasksMdPath: string,
    repoRoot: string,
    overrides: Partial<CommitTaskInput> = {},
  ): CommitTaskInput {
    const { spec, plan, tasks } = loadFixtures();
    void spec;
    const task = tasks.tasks.find((t) => t.id === 'T001')!;
    const workspace = plan.config.workspaces.find((w) => w.id === task.workspace)!;
    return {
      task,
      plan,
      workspace,
      tasksMdPath,
      repoRoot,
      git,
      llm,
      llmInvokeOpts: INVOKE_OPTS,
      headBefore: 'fakehead00000000000000000000000000000000',
      ...overrides,
    };
  }

  it('happy path: flips tasks.md, calls add + commit, returns ok=true', async () => {
    const initial = '- [ ] T001 Hello\n';
    const { repoRoot, tasksMdPath } = makeRepo(initial);
    const git = new FakeGit([{ ok: true }]);
    const llm = new FakeLlmClient();
    const r = await commitTask(makeInput(git, llm, tasksMdPath, repoRoot));

    expect(r.ok).toBe(true);
    expect(r.reason).toBe('success');
    expect(fs.readFileSync(tasksMdPath, 'utf-8')).toBe('- [X] T001 Hello\n');
    expect(git.calls.map((c) => c.method)).toEqual([
      'revParseHead',
      'diffNameOnly',
      'add',
      'commit',
      'statusPorcelain',
    ]);
    expect(git.calls[3].args[0]).toMatch(/^feat\(account\): .* \(T001\)$/);
    expect(llm.calls).toHaveLength(0); // ralph-loop not engaged
  });

  it('hook fail → rolls back tasks.md + unstages, then ralph-loop succeeds on retry', async () => {
    const initial = '- [ ] T001 Hello\n';
    const { repoRoot, tasksMdPath } = makeRepo(initial);
    const git = new FakeGit([
      { ok: false, stderr: 'markdownlint: line too long' },
      { ok: true }, // retry succeeds
    ]);
    const llm = new FakeLlmClient([llmOk('lint fixed')]);
    const r = await commitTask(makeInput(git, llm, tasksMdPath, repoRoot));

    expect(r.ok).toBe(true);
    expect(r.reason).toBe('success');
    expect(r.ralph?.attempts).toBe(1);
    expect(fs.readFileSync(tasksMdPath, 'utf-8')).toBe('- [X] T001 Hello\n');

    // Sequence: revParseHead (Step C'), diffNameOnly (Step B), add, commit
    // (fail), restoreStaged, [LLM retry], revParseHead (F5 self-commit
    // reconcile check — HEAD unchanged here so orchestrator commits),
    // diffNameOnly (F5 governance re-scan), add, commit (ok), statusPorcelain
    expect(git.calls.map((c) => c.method)).toEqual([
      'revParseHead',
      'diffNameOnly',
      'add',
      'commit',
      'restoreStaged',
      'revParseHead',
      'diffNameOnly',
      'add',
      'commit',
      'statusPorcelain',
    ]);
    expect(llm.calls).toHaveLength(1);
    expect(llm.calls[0].prompt).toMatch(/markdownlint: line too long/);
  });

  it('hook fail past ralph-loop max → ok=false, tasks.md restored', async () => {
    const initial = '- [ ] T001 Hello\n';
    const { repoRoot, tasksMdPath } = makeRepo(initial);
    const git = new FakeGit([
      { ok: false, stderr: 'err 1' },
      { ok: false, stderr: 'err 2' },
      { ok: false, stderr: 'err 3' },
    ]);
    const llm = new FakeLlmClient([llmOk(), llmOk()]);
    const r = await commitTask(makeInput(git, llm, tasksMdPath, repoRoot));

    expect(r.ok).toBe(false);
    expect(r.reason).toBe('hook-ralph-failed');
    expect(r.ralph?.attempts).toBe(2); // git-hook default max
    expect(r.lastStderr).toBe('err 3');
    expect(fs.readFileSync(tasksMdPath, 'utf-8')).toBe(initial);
  });

  it('HEAD shift (LLM self-commit) short-circuits: no add/commit, tasks.md untouched, ok=true', async () => {
    const initial = '- [ ] T001 Hello\n';
    const { repoRoot, tasksMdPath } = makeRepo(initial);
    const git = new FakeGit([]); // no commit responses scripted — must not be called
    git.enqueueHeadSha('sha-after-llm-commit'); // headBefore != headNow → shift
    const llm = new FakeLlmClient();
    const r = await commitTask(
      makeInput(git, llm, tasksMdPath, repoRoot, {
        headBefore: 'sha-before-llm',
      }),
    );

    expect(r.ok).toBe(true);
    expect(r.reason).toBe('llm-self-committed');
    // tasks.md unchanged: orchestrator does NOT flip when LLM owns the commit.
    expect(fs.readFileSync(tasksMdPath, 'utf-8')).toBe(initial);
    // revParseHead + statusPorcelain (post-#22 orphan assert); no add/commit/restoreStaged.
    expect(git.calls.map((c) => c.method)).toEqual(['revParseHead', 'statusPorcelain']);
    expect(llm.calls).toHaveLength(0);
  });

  it('HEAD unchanged → normal flip+add+commit path runs', async () => {
    const initial = '- [ ] T001 Hello\n';
    const { repoRoot, tasksMdPath } = makeRepo(initial);
    const git = new FakeGit([{ ok: true }]);
    git.enqueueHeadSha('same-sha');
    const llm = new FakeLlmClient();
    const r = await commitTask(
      makeInput(git, llm, tasksMdPath, repoRoot, { headBefore: 'same-sha' }),
    );

    expect(r.ok).toBe(true);
    expect(r.reason).toBe('success');
    expect(fs.readFileSync(tasksMdPath, 'utf-8')).toBe('- [X] T001 Hello\n');
    expect(git.calls.map((c) => c.method)).toEqual([
      'revParseHead',
      'diffNameOnly',
      'add',
      'commit',
      'statusPorcelain',
    ]);
  });

  it('non-hook git error (e.g. add fail) reverts tasks.md and rethrows', async () => {
    const initial = '- [ ] T001 Hello\n';
    const { repoRoot, tasksMdPath } = makeRepo(initial);
    const failingAddGit: FakeGit = new FakeGit();
    // Replace add to throw a non-GitCommitError
    failingAddGit.add = async () => {
      throw new Error('git add catastrophe');
    };
    const llm = new FakeLlmClient();
    await expect(commitTask(makeInput(failingAddGit, llm, tasksMdPath, repoRoot))).rejects.toThrow(
      /git add catastrophe/,
    );
    // tasks.md should have been reverted
    expect(fs.readFileSync(tasksMdPath, 'utf-8')).toBe(initial);
  });

  // PoC blind spot #22: commit succeeded by orchestrator's contract (declared
  // task.files staged + committed), but the LLM left undeclared files dirty
  // in the worktree. These would silently contaminate the next task's baseline
  // (cf. T027 / T023 ralph runs) — assert turns the silent leak into a hard
  // failure visible in run-report.
  it('orphan files after first-commit success → ok=false, reason=orphan-after-commit', async () => {
    const initial = '- [ ] T001 Hello\n';
    const { repoRoot, tasksMdPath } = makeRepo(initial);
    const git = new FakeGit([{ ok: true }]);
    git.enqueueStatus(['?? packages/api-client/src/gen/index.ts', ' M apps/server/src/foo.ts']);
    const llm = new FakeLlmClient();
    const r = await commitTask(makeInput(git, llm, tasksMdPath, repoRoot));

    expect(r.ok).toBe(false);
    expect(r.reason).toBe('orphan-after-commit');
    expect(r.lastStderr).toMatch(/Orphan files in worktree after commit/);
    expect(r.lastStderr).toMatch(/packages\/api-client\/src\/gen\/index\.ts/);
    expect(r.lastStderr).toMatch(/apps\/server\/src\/foo\.ts/);
    // commit itself ran (the assert is post-commit, not pre-commit)
    expect(git.calls.map((c) => c.method)).toEqual([
      'revParseHead',
      'diffNameOnly',
      'add',
      'commit',
      'statusPorcelain',
    ]);
  });

  it('orphan files after ralph-recovered commit → ok=false, reason=orphan-after-commit, ralph kept', async () => {
    const initial = '- [ ] T001 Hello\n';
    const { repoRoot, tasksMdPath } = makeRepo(initial);
    const git = new FakeGit([
      { ok: false, stderr: 'markdownlint: line too long' },
      { ok: true }, // retry succeeds
    ]);
    git.enqueueStatus(['?? leftover.ts']);
    const llm = new FakeLlmClient([llmOk('lint fixed')]);
    const r = await commitTask(makeInput(git, llm, tasksMdPath, repoRoot));

    expect(r.ok).toBe(false);
    expect(r.reason).toBe('orphan-after-commit');
    expect(r.ralph?.attempts).toBe(1); // ralph still attempted
    expect(r.lastStderr).toMatch(/leftover\.ts/);
  });

  it('orphan files on LLM self-commit path → ok=false, reason=orphan-after-commit', async () => {
    const initial = '- [ ] T001 Hello\n';
    const { repoRoot, tasksMdPath } = makeRepo(initial);
    const git = new FakeGit([]); // no commit responses scripted — must not be called
    git.enqueueHeadSha('sha-after-llm-commit');
    git.enqueueStatus(['?? llm-forgot-to-add.ts']);
    const llm = new FakeLlmClient();
    const r = await commitTask(
      makeInput(git, llm, tasksMdPath, repoRoot, {
        headBefore: 'sha-before-llm',
      }),
    );

    expect(r.ok).toBe(false);
    expect(r.reason).toBe('orphan-after-commit');
    expect(r.lastStderr).toMatch(/llm-forgot-to-add\.ts/);
    expect(fs.readFileSync(tasksMdPath, 'utf-8')).toBe(initial); // tasks.md still untouched
    expect(git.calls.map((c) => c.method)).toEqual(['revParseHead', 'statusPorcelain']);
  });

  it('clean worktree on LLM self-commit path → ok=true, reason=llm-self-committed (regression: existing #9 path)', async () => {
    const initial = '- [ ] T001 Hello\n';
    const { repoRoot, tasksMdPath } = makeRepo(initial);
    const git = new FakeGit([]);
    git.enqueueHeadSha('sha-after-llm-commit');
    // No enqueueStatus → FakeGit returns [] (clean) by default
    const llm = new FakeLlmClient();
    const r = await commitTask(
      makeInput(git, llm, tasksMdPath, repoRoot, {
        headBefore: 'sha-before-llm',
      }),
    );

    expect(r.ok).toBe(true);
    expect(r.reason).toBe('llm-self-committed');
    expect(git.calls.map((c) => c.method)).toEqual(['revParseHead', 'statusPorcelain']);
  });

  // F1 (p2 §7) regression: the LLM touched a cross-cutting governance file
  // (check-server-moat.ts — registering a new model's owner) outside its
  // declared task.files. This is a legitimate ripple, not a hallucination.
  // It must NOT trip the orphan scope-gate (which would revert it and deadlock
  // against the very lefthook that requires it — 999 orch run1: $2.25/47 turns).
  // Instead it's folded into `declared`, staged, and committed; orphan-ralph
  // never engages. See drift-classifier.GOVERNANCE_ALLOWLIST.
  it('governance-file drift is folded into declared + staged (no orphan-ralph)', async () => {
    const initial = '- [ ] T001 Hello\n';
    const { repoRoot, tasksMdPath } = makeRepo(initial);
    const git = new FakeGit([{ ok: true }]);
    git.enqueueDiffNameOnly(['scripts/checks/check-server-moat.ts']);
    const llm = new FakeLlmClient(); // no orphan-ralph response scripted — must NOT be invoked
    const r = await commitTask(makeInput(git, llm, tasksMdPath, repoRoot));

    expect(r.ok).toBe(true);
    expect(r.reason).toBe('success'); // no-drift, NOT orphan-resolved-*
    expect(llm.calls).toHaveLength(0); // orphan-ralph never engaged
    // The governance file is staged into THIS task's commit (allStaged includes it).
    const addCall = git.calls.find((c) => c.method === 'add')!;
    expect(addCall.args[0]).toContain('scripts/checks/check-server-moat.ts');
    // Drift telemetry reflects the fold: declared grew, zero orphans.
    expect(r.drift?.resolution).toBe('no-drift');
    expect(r.drift?.declared).toContain('scripts/checks/check-server-moat.ts');
    expect(r.drift?.orphans).toEqual([]);
  });

  // F1-b (p2 §7): when orphan-ralph CANNOT resolve a (non-governance) orphan,
  // the old behavior halted the whole feature run (orphan-stuck) with a dirty
  // tree. Per the industry verdict, a scope-gate miss is not a hard halt — we
  // stage the orphans, record a drift warning, and continue; downstream gates
  // (lefthook / IT / lint) are the real safety net. Here orphan-ralph errors
  // (empty LLM queue → llm-error), which must now drift-warn, not halt.
  it('orphan-ralph failure (llm-error) → drift-warned: stages orphans + continues (F1-b)', async () => {
    const initial = '- [ ] T001 Hello\n';
    const { repoRoot, tasksMdPath } = makeRepo(initial);
    const git = new FakeGit([{ ok: true }]);
    git.enqueueDiffNameOnly(['apps/server/src/unrelated/random-orphan.ts']);
    const llm = new FakeLlmClient(); // empty queue → orphan-ralph's invoke throws → reason='llm-error'
    const r = await commitTask(makeInput(git, llm, tasksMdPath, repoRoot));

    expect(r.ok).toBe(true);
    expect(r.reason).toBe('orphan-drift-warned');
    expect(r.orphanRalph?.reason).toBe('llm-error');
    expect(r.drift?.resolution).toBe('orphan-drift-warned');
    expect(r.drift?.orphans).toContain('apps/server/src/unrelated/random-orphan.ts');
    // The orphan is staged into THIS task's commit (so the worktree is clean
    // afterward → no orphan-after-commit).
    const addCall = git.calls.find((c) => c.method === 'add')!;
    expect(addCall.args[0]).toContain('apps/server/src/unrelated/random-orphan.ts');
  });

  // F1-b keeps exactly ONE hard halt: the LLM explicitly returning `stuck`
  // ("I cannot decide, need a human"). That still stops the run.
  it('orphan-ralph stuck (LLM asks for a human) → still a hard halt (orphan-stuck)', async () => {
    const initial = '- [ ] T001 Hello\n';
    const { repoRoot, tasksMdPath } = makeRepo(initial);
    const git = new FakeGit([]); // commit must NOT be reached
    git.enqueueDiffNameOnly(['apps/server/src/unrelated/random-orphan.ts']);
    const llm = new FakeLlmClient([
      llmOk(JSON.stringify({ action: 'stuck', reason: 'cannot decide' })),
    ]);
    const r = await commitTask(makeInput(git, llm, tasksMdPath, repoRoot));

    expect(r.ok).toBe(false);
    expect(r.reason).toBe('orphan-stuck');
    expect(r.orphanRalph?.reason).toBe('stuck');
    expect(git.calls.some((c) => c.method === 'commit')).toBe(false);
  });

  // F5 (p2 §7) — "ralph 做好兼容": the hook-ralph agent is allowed to commit
  // its own fix (it wrote the code; the lefthook ran on ITS commit). When it
  // does, HEAD moves DURING a hook-ralph round (not at Step C'). The
  // orchestrator must reconcile — accept that commit (llm-self-committed)
  // rather than blindly re-committing, which would desync → spurious
  // hook-ralph-failed even though the work landed (999 run4 T002 = 28b39a9, a
  // complete commit: moat registered, tasks.md flipped, conventional message).
  it('F5: agent self-commit DURING hook-ralph is reconciled (llm-self-committed, no re-commit)', async () => {
    const initial = '- [ ] T001 Hello\n';
    const { repoRoot, tasksMdPath } = makeRepo(initial);
    // Only ONE commit response: the orchestrator's first (failing) commit. If
    // the reconcile path wrongly re-committed, FakeGit would throw (no scripted
    // response left) — so this also asserts performCommit is NOT re-run.
    const git = new FakeGit([{ ok: false, stderr: 'check-server-moat: model unmapped' }]);
    // Step C' sees HEAD unchanged (h0); the hook-ralph round sees it moved (h1)
    // because the agent committed its fix.
    git.enqueueHeadSha('h0', 'h1');
    const llm = new FakeLlmClient([llmOk('fixed + committed myself')]);
    const r = await commitTask(makeInput(git, llm, tasksMdPath, repoRoot, { headBefore: 'h0' }));

    expect(r.ok).toBe(true);
    expect(r.reason).toBe('llm-self-committed');
    expect(llm.calls).toHaveLength(1); // one hook-ralph round
    // Exactly one commit attempt (the orchestrator's first, which failed); the
    // reconcile path did NOT add/commit again.
    expect(git.calls.filter((c) => c.method === 'commit')).toHaveLength(1);
    // Reconcile ran a HEAD check then the post-commit orphan assert.
    const methods = git.calls.map((c) => c.method);
    expect(methods.filter((m) => m === 'revParseHead')).toHaveLength(2); // Step C' + hook-ralph reconcile
    expect(methods).toContain('statusPorcelain');
  });

  // F5 (p2 §7): a governance file the agent touches DURING hook-ralph (after
  // the Step-B `actual` snapshot) must be re-scanned and staged into this
  // commit. Otherwise it's left orphaned post-commit (orphan-after-commit)
  // even though it's the required ripple that clears the hook (999 run4 T002:
  // moat rejection → agent registers loginActivityCounter in check-server-moat.ts).
  it('F5: governance file touched during hook-ralph is re-scanned + staged (no orphan)', async () => {
    const initial = '- [ ] T001 Hello\n';
    const { repoRoot, tasksMdPath } = makeRepo(initial);
    const git = new FakeGit([
      { ok: false, stderr: 'check-server-moat: loginActivityCounter unmapped' },
      { ok: true }, // hook-ralph retry succeeds once the moat file is registered
    ]);
    // Step B: LLM touched only declared files (no governance yet → no drift).
    git.enqueueDiffNameOnly([]);
    // hook-ralph round: agent reactively registers the model in the moat file.
    git.enqueueDiffNameOnly(['scripts/checks/check-server-moat.ts']);
    const llm = new FakeLlmClient([llmOk('registered loginActivityCounter')]);
    const r = await commitTask(makeInput(git, llm, tasksMdPath, repoRoot));

    expect(r.ok).toBe(true);
    expect(r.reason).toBe('success');
    const addCalls = git.calls.filter((c) => c.method === 'add');
    expect(addCalls).toHaveLength(2);
    // The hook-ralph commit re-staged the governance file the agent just touched.
    expect(addCalls[1].args[0]).toContain('scripts/checks/check-server-moat.ts');
    // The first (happy-path) add did NOT include it — it wasn't touched yet.
    expect(addCalls[0].args[0]).not.toContain('scripts/checks/check-server-moat.ts');
  });
});

describe('buildHookRetryPrompt', () => {
  it('includes the task id, staged files, and hook stderr', () => {
    const task = {
      id: 'T042',
      files: [],
    } as never;
    const p = buildHookRetryPrompt(task, ['a.ts', 'tasks.md'], 'eslint: no-unused-vars');
    expect(p).toMatch(/T042/);
    expect(p).toMatch(/a\.ts, tasks\.md/);
    expect(p).toMatch(/eslint: no-unused-vars/);
    expect(p).toMatch(/Do NOT change business logic/);
  });

  it('handles empty stderr gracefully', () => {
    const task = { id: 'T001', files: [] } as never;
    const p = buildHookRetryPrompt(task, ['x'], '   ');
    expect(p).toMatch(/\(empty stderr\)/);
  });
});

// Use fsp to silence unused-import lint in older toolchains
void fsp;
