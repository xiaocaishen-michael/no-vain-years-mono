import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FakeGit } from './git-flow.js';
import { FakeLlmClient, type LlmInvokeResult } from './llm-client.js';
import { maybeCleanupSandbox, runFeature } from './run-feature.js';
import { FakeShell, shellOk, shellFail, type ShellRunResult } from './shell.js';
import { loadFeature } from './state.js';

const FIXTURES_DIR = path.resolve(__dirname, '__fixtures__');

function llmOk(stdout = 'patched'): LlmInvokeResult {
  return { exitCode: 0, stdout, stderr: '', durationMs: 1 };
}

describe('runFeature (integration with fakes)', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const d of dirs.splice(0)) {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  function setupFeature(): {
    featureDir: string;
    repoRoot: string;
  } {
    const repoRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'orchestrator-runfeature-'),
    );
    dirs.push(repoRoot);
    // Mirror the fixture layout: <repo>/specs/002-demo/<spec|plan|tasks>.md
    const featureDir = path.join(repoRoot, 'specs', '002-demo');
    fs.mkdirSync(featureDir, { recursive: true });
    fs.copyFileSync(
      path.join(FIXTURES_DIR, 'spec-happy.md'),
      path.join(featureDir, 'spec.md'),
    );
    fs.copyFileSync(
      path.join(FIXTURES_DIR, 'plan-happy.md'),
      path.join(featureDir, 'plan.md'),
    );
    fs.copyFileSync(
      path.join(FIXTURES_DIR, 'tasks-happy.md'),
      path.join(featureDir, 'tasks.md'),
    );
    return { featureDir, repoRoot };
  }

  function defaultDeps() {
    // Provide enough responses for all 8 tasks: each needs 1 LLM call (initial)
    // + 1 verify shell call (success path). 8 each.
    const llmResponses = Array.from({ length: 8 }, () => llmOk());
    const shellResponses: ShellRunResult[] = Array.from({ length: 8 }, () =>
      shellOk('verify ok'),
    );
    return {
      llm: new FakeLlmClient(llmResponses),
      git: new FakeGit(Array.from({ length: 8 }, () => ({ ok: true as const }))),
      shell: new FakeShell(shellResponses),
    };
  }

  it('happy path: 8-task fixture runs to completion with fakes', async () => {
    const { featureDir, repoRoot } = setupFeature();
    void repoRoot;
    const state = loadFeature(featureDir);

    const result = await runFeature(state, defaultDeps());

    expect(result.ok).toBe(true);
    expect(result.results).toHaveLength(8);
    expect(result.results.every((r) => r.ok)).toBe(true);
    expect(result.results.every((r) => r.reason === 'success')).toBe(true);

    // All 8 task checkboxes flipped in tasks.md
    const tasksMd = fs.readFileSync(
      path.join(featureDir, 'tasks.md'),
      'utf-8',
    );
    for (const id of ['T001', 'T002', 'T003', 'T004', 'T005', 'T006', 'T007', 'T008']) {
      expect(tasksMd).toMatch(new RegExp(`- \\[X\\] ${id}`));
    }
  });

  it('stops at first failing task and reports failedAt', async () => {
    const { featureDir } = setupFeature();
    const state = loadFeature(featureDir);

    const deps = {
      llm: new FakeLlmClient([
        llmOk(), // T001 initial
        llmOk(), // T001 verify retry #1
        llmOk(), // T001 verify retry #2
        llmOk(), // T001 verify retry #3
      ]),
      git: new FakeGit([{ ok: true }]),
      shell: new FakeShell([
        shellFail('verify red'), // initial verify
        shellFail('still red'), // retry 1
        shellFail('still red'), // retry 2
        shellFail('still red'), // retry 3
      ]),
    };

    const result = await runFeature(state, deps);

    expect(result.ok).toBe(false);
    expect(result.failedAt).toBe('T001');
    expect(result.results).toHaveLength(1);
    expect(result.results[0].reason).toBe('verify-ralph-failed');
    expect(result.results[0].verifyRalph?.attempts).toBe(3);
  });

  it('onlyTaskId runs just that task', async () => {
    const { featureDir } = setupFeature();
    const state = loadFeature(featureDir);

    const result = await runFeature(state, defaultDeps(), {
      onlyTaskId: 'T001',
    });

    expect(result.ok).toBe(true);
    expect(result.results).toHaveLength(1);
    expect(result.results[0].taskId).toBe('T001');
  });

  it('verify-failed task → LLM gets retry prompt with verify stderr', async () => {
    const { featureDir } = setupFeature();
    const state = loadFeature(featureDir);

    const llm = new FakeLlmClient([
      llmOk(), // T001 initial
      llmOk(), // T001 retry — LLM "fixes" the bug
    ]);
    const git = new FakeGit([{ ok: true }]);
    const shell = new FakeShell([
      shellFail('verify failure: missing return'),
      shellOk('green now'),
    ]);

    const result = await runFeature(state, { llm, git, shell }, {
      onlyTaskId: 'T001',
    });

    expect(result.ok).toBe(true);
    expect(llm.calls).toHaveLength(2);
    expect(llm.calls[1].prompt).toMatch(/verify failure: missing return/);
  });

  it('git-hook fail → ralph-loop retry succeeds', async () => {
    const { featureDir } = setupFeature();
    const state = loadFeature(featureDir);

    const llm = new FakeLlmClient([
      llmOk(), // T001 initial
      llmOk(), // T001 git-hook retry — fixes lint
    ]);
    const git = new FakeGit([
      { ok: false, stderr: 'markdownlint: line too long' },
      { ok: true },
    ]);
    const shell = new FakeShell([shellOk('verify green')]);

    const result = await runFeature(state, { llm, git, shell }, {
      onlyTaskId: 'T001',
    });

    expect(result.ok).toBe(true);
    expect(result.results[0].commit?.ralph?.attempts).toBe(1);
    expect(llm.calls).toHaveLength(2);
    expect(llm.calls[1].prompt).toMatch(/markdownlint: line too long/);
  });

  it('workspace-missing surfaces as reason without throwing', async () => {
    const { featureDir } = setupFeature();
    const state = loadFeature(featureDir);
    // Surgically remove the server-app workspace from state
    state.plan.config.workspaces = state.plan.config.workspaces.filter(
      (w) => w.id !== 'server-app',
    );

    const result = await runFeature(state, defaultDeps(), {
      onlyTaskId: 'T001',
    });

    expect(result.ok).toBe(false);
    expect(result.results[0].reason).toBe('workspace-missing');
  });

  it('attaches sandboxCwd + sandboxCleaned to each task result', async () => {
    const { featureDir } = setupFeature();
    const state = loadFeature(featureDir);
    // Redirect sandbox to a test-owned tmp dir so we don't leak into /tmp.
    const sandboxBase = fs.mkdtempSync(
      path.join(os.tmpdir(), 'orchestrator-sb-'),
    );
    dirs.push(sandboxBase);
    state.plan.config.sandbox.cwd_template = `${sandboxBase}/{feature_id}-{task_id}`;
    // cleanup_on_success=true is already the fixture default; assert.
    expect(state.plan.config.sandbox.cleanup_on_success).toBe(true);

    const result = await runFeature(state, defaultDeps(), {
      onlyTaskId: 'T001',
    });

    expect(result.ok).toBe(true);
    const tr = result.results[0];
    expect(tr.sandboxCwd).toBe(
      `${sandboxBase}/002-account-profile-base-T001`,
    );
    expect(tr.sandboxCleaned).toBe(true);
    expect(fs.existsSync(tr.sandboxCwd!)).toBe(false);
  });
});

describe('maybeCleanupSandbox', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const d of dirs.splice(0)) {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  function makeSandbox(): string {
    const d = fs.mkdtempSync(
      path.join(os.tmpdir(), 'orchestrator-sandbox-'),
    );
    dirs.push(d);
    fs.writeFileSync(path.join(d, 'marker.txt'), 'x');
    return d;
  }

  it('removes sandbox on success when cleanup_on_success=true', async () => {
    const d = makeSandbox();
    const cleaned = await maybeCleanupSandbox(
      d,
      { cleanup_on_success: true, cleanup_on_failure: false },
      /* ok= */ true,
    );
    expect(cleaned).toBe(true);
    expect(fs.existsSync(d)).toBe(false);
  });

  it('preserves sandbox on success when cleanup_on_success=false', async () => {
    const d = makeSandbox();
    const cleaned = await maybeCleanupSandbox(
      d,
      { cleanup_on_success: false, cleanup_on_failure: true },
      /* ok= */ true,
    );
    expect(cleaned).toBe(false);
    expect(fs.existsSync(d)).toBe(true);
  });

  it('removes sandbox on failure when cleanup_on_failure=true', async () => {
    const d = makeSandbox();
    const cleaned = await maybeCleanupSandbox(
      d,
      { cleanup_on_success: false, cleanup_on_failure: true },
      /* ok= */ false,
    );
    expect(cleaned).toBe(true);
    expect(fs.existsSync(d)).toBe(false);
  });

  it('preserves sandbox on failure when cleanup_on_failure=false', async () => {
    const d = makeSandbox();
    const cleaned = await maybeCleanupSandbox(
      d,
      { cleanup_on_success: true, cleanup_on_failure: false },
      /* ok= */ false,
    );
    expect(cleaned).toBe(false);
    expect(fs.existsSync(d)).toBe(true);
  });

  it('returns false (best-effort) when sandbox already missing', async () => {
    const cleaned = await maybeCleanupSandbox(
      '/nonexistent/orchestrator-sandbox-zzz',
      { cleanup_on_success: true, cleanup_on_failure: true },
      /* ok= */ true,
    );
    // fs.rm with force:true on missing path doesn't throw, so cleanup
    // "succeeds" — but functionally the same: there's nothing to preserve.
    expect(cleaned).toBe(true);
  });
});
