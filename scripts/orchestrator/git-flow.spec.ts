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
} from './git-flow.js';
import {
  FakeLlmClient,
  type LlmInvokeOptions,
  type LlmInvokeResult,
} from './llm-client.js';
import { PlanAnalyzer } from './parsers/plan.js';
import { SpecAnalyzer } from './parsers/spec.js';
import { TasksAnalyzer } from './parsers/tasks.js';
import { FakeShell, shellOk, shellFail } from './shell.js';

const FIXTURES_DIR = path.resolve(__dirname, '__fixtures__');
const INVOKE_OPTS: LlmInvokeOptions = { cwd: '/tmp/sandbox' };

function loadFixtures() {
  const spec = new SpecAnalyzer().parse(path.join(FIXTURES_DIR, 'spec-happy.md'));
  const plan = new PlanAnalyzer().parse(path.join(FIXTURES_DIR, 'plan-happy.md'));
  const tasks = new TasksAnalyzer().parse(
    path.join(FIXTURES_DIR, 'tasks-happy.md'),
    plan,
    spec,
  );
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
    expect(filesToStage(task as never)).toEqual([
      'keep.ts',
      'new.ts',
      'fresh.ts',
    ]);
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
    await expect(git.commit('msg', { cwd: '/repo' })).rejects.toBeInstanceOf(
      GitCommitError,
    );
  });

  it('builds `git restore --staged` for rollback', async () => {
    const sh = new FakeShell([shellOk()]);
    const git = new GitCli(sh);
    await git.restoreStaged(['a.ts', 'tasks.md'], { cwd: '/repo' });
    expect(sh.calls[0].command).toBe(
      'git restore --staged "a.ts" "tasks.md"',
    );
  });

  it('add() noops for empty files list', async () => {
    const sh = new FakeShell();
    const git = new GitCli(sh);
    await git.add([], { cwd: '/repo' });
    expect(sh.calls).toHaveLength(0);
  });

  it('revParseHead returns trimmed stdout SHA', async () => {
    const sh = new FakeShell([
      shellOk('deadbeefcafef00d1234567890abcdef12345678\n'),
    ]);
    const git = new GitCli(sh);
    const sha = await git.revParseHead({ cwd: '/repo' });
    expect(sh.calls[0].command).toBe('git rev-parse HEAD');
    expect(sha).toBe('deadbeefcafef00d1234567890abcdef12345678');
  });

  it('revParseHead throws on non-zero exit', async () => {
    const sh = new FakeShell([shellFail('not a git repo', 128)]);
    const git = new GitCli(sh);
    await expect(git.revParseHead({ cwd: '/repo' })).rejects.toThrow(
      /git rev-parse HEAD failed/,
    );
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
    await expect(git.commit('msg', { cwd: '/r' })).rejects.toBeInstanceOf(
      GitCommitError,
    );
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
    const repoRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'orchestrator-commit-'),
    );
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
    const workspace = plan.config.workspaces.find(
      (w) => w.id === task.workspace,
    )!;
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
      'add',
      'commit',
    ]);
    expect(git.calls[2].args[0]).toMatch(/^feat\(account\): .* \(T001\)$/);
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

    // Sequence: revParseHead, add, commit (fail), restoreStaged, [LLM retry], add, commit (ok)
    expect(git.calls.map((c) => c.method)).toEqual([
      'revParseHead',
      'add',
      'commit',
      'restoreStaged',
      'add',
      'commit',
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
    // Only revParseHead was called; no add/commit/restoreStaged.
    expect(git.calls.map((c) => c.method)).toEqual(['revParseHead']);
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
      'add',
      'commit',
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
    await expect(
      commitTask(makeInput(failingAddGit, llm, tasksMdPath, repoRoot)),
    ).rejects.toThrow(/git add catastrophe/);
    // tasks.md should have been reverted
    expect(fs.readFileSync(tasksMdPath, 'utf-8')).toBe(initial);
  });
});

describe('buildHookRetryPrompt', () => {
  it('includes the task id, staged files, and hook stderr', () => {
    const task = {
      id: 'T042',
      files: [],
    } as never;
    const p = buildHookRetryPrompt(
      task,
      ['a.ts', 'tasks.md'],
      'eslint: no-unused-vars',
    );
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
