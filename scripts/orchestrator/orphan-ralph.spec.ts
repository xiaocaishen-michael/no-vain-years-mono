import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FakeGit } from './git-flow.js';
import { FakeLlmClient, type LlmInvokeResult } from './llm-client.js';
import {
  applyExpand,
  buildOrphanRalphPrompt,
  extractIntent,
  OrphanIntentSchema,
  runOrphanRalph,
} from './orphan-ralph.js';
import type { ParsedTask, TaskKind } from './schemas/tasks.js';

const INVOKE_OPTS = { cwd: '/tmp/sandbox' };

function makeTask(opts: {
  id?: string;
  kind?: TaskKind;
  files?: string[];
} = {}): ParsedTask {
  return {
    id: opts.id ?? 'T001',
    workspace: 'ws',
    deps: [],
    trace_us: [],
    trace_fr: [],
    kind: opts.kind ?? 'impl',
    verify_kind: 'test',
    files: (opts.files ?? ['a.ts']).map((p) => ({
      path: p,
      op: 'modify' as const,
    })),
    parallel: false,
    status: 'pending',
    title: 'test',
  } as unknown as ParsedTask;
}

function llmJson(intentObj: unknown, ms = 1): LlmInvokeResult {
  return {
    exitCode: 0,
    stdout: JSON.stringify(intentObj),
    stderr: '',
    durationMs: ms,
  };
}

describe('OrphanIntentSchema', () => {
  it('accepts expand / revert / stuck with required fields', () => {
    expect(
      OrphanIntentSchema.safeParse({ action: 'expand', files: ['a.ts'] })
        .success,
    ).toBe(true);
    expect(
      OrphanIntentSchema.safeParse({ action: 'revert', files: ['a.ts'] })
        .success,
    ).toBe(true);
    expect(
      OrphanIntentSchema.safeParse({ action: 'stuck', reason: 'unsure' })
        .success,
    ).toBe(true);
  });

  it('rejects empty files arrays + missing required fields', () => {
    expect(
      OrphanIntentSchema.safeParse({ action: 'expand', files: [] }).success,
    ).toBe(false);
    expect(
      OrphanIntentSchema.safeParse({ action: 'stuck' }).success,
    ).toBe(false);
  });
});

describe('extractIntent', () => {
  it('parses raw JSON stdout', () => {
    const r = extractIntent({
      exitCode: 0,
      stdout: '{"action":"stuck","reason":"x"}',
      stderr: '',
      durationMs: 0,
    });
    expect('intent' in r).toBe(true);
    if ('intent' in r) expect(r.intent.action).toBe('stuck');
  });

  it('parses claude-cli wrapped {result: "<json>"} envelope', () => {
    const r = extractIntent({
      exitCode: 0,
      stdout: '',
      stderr: '',
      durationMs: 0,
      parsed: { result: '{"action":"revert","files":["x.ts"]}' },
    });
    expect('intent' in r).toBe(true);
  });

  it('strips ```json fences', () => {
    const r = extractIntent({
      exitCode: 0,
      stdout: '```json\n{"action":"stuck","reason":"x"}\n```',
      stderr: '',
      durationMs: 0,
    });
    expect('intent' in r).toBe(true);
  });

  it('returns error when stdout is not JSON', () => {
    const r = extractIntent({
      exitCode: 0,
      stdout: 'I think you should...',
      stderr: '',
      durationMs: 0,
    });
    expect('error' in r).toBe(true);
  });

  it('returns error when JSON is parseable but schema fails', () => {
    const r = extractIntent({
      exitCode: 0,
      stdout: '{"action":"explode"}',
      stderr: '',
      durationMs: 0,
    });
    expect('error' in r).toBe(true);
  });
});

describe('applyExpand', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });

  function makeTasksMd(taskMeta: Record<string, unknown>): {
    tasksMdPath: string;
  } {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orphan-expand-'));
    dirs.push(root);
    const featureDir = path.join(root, 'specs', '999-demo');
    fs.mkdirSync(featureDir, { recursive: true });
    const tasksMdPath = path.join(featureDir, 'tasks.md');
    const frontmatter = [
      '---',
      'feature_id: 999-demo',
      'spec_ref: spec.md',
      'plan_ref: plan.md',
      'status: in-progress',
      'created_at: "2026-05-21T00:00:00.000Z"',
      'updated_at: "2026-05-21T00:00:00.000Z"',
      'orchestrator_compat: ">=0.1.0"',
      '---',
      '',
      `- [ ] ${taskMeta.id as string} A demo task`,
      `  <!-- task-meta: ${JSON.stringify(taskMeta)} -->`,
      '',
    ].join('\n');
    fs.writeFileSync(tasksMdPath, frontmatter);
    return { tasksMdPath };
  }

  it('appends new files to task-meta files array as op:modify', async () => {
    const { tasksMdPath } = makeTasksMd({
      id: 'T001',
      workspace: 'ws',
      deps: [],
      trace_us: [],
      trace_fr: [],
      kind: 'impl',
      verify_kind: 'test',
      files: [{ path: 'a.ts', op: 'modify' }],
      parallel: false,
    });

    const r = await applyExpand({
      tasksMdPath,
      taskId: 'T001',
      newFiles: ['b.ts', 'c.ts'],
    });

    expect(r.declared).toEqual(['a.ts', 'b.ts', 'c.ts']);
    const persisted = fs.readFileSync(tasksMdPath, 'utf-8');
    expect(persisted).toMatch(/"path":"b\.ts","op":"modify"/);
    expect(persisted).toMatch(/"path":"c\.ts","op":"modify"/);
  });

  it('dedupes files already in declared list', async () => {
    const { tasksMdPath } = makeTasksMd({
      id: 'T001',
      workspace: 'ws',
      deps: [],
      trace_us: [],
      trace_fr: [],
      kind: 'impl',
      verify_kind: 'test',
      files: [{ path: 'a.ts', op: 'modify' }],
      parallel: false,
    });

    const r = await applyExpand({
      tasksMdPath,
      taskId: 'T001',
      newFiles: ['a.ts', 'a.ts', 'b.ts'],
    });

    expect(r.declared).toEqual(['a.ts', 'b.ts']);
  });

  it('throws when task-meta block not found', async () => {
    const { tasksMdPath } = makeTasksMd({
      id: 'T001',
      workspace: 'ws',
      deps: [],
      trace_us: [],
      trace_fr: [],
      kind: 'impl',
      verify_kind: 'test',
      files: [{ path: 'a.ts', op: 'modify' }],
      parallel: false,
    });

    await expect(
      applyExpand({ tasksMdPath, taskId: 'T999', newFiles: ['x.ts'] }),
    ).rejects.toThrow(/not found/);
  });
});

describe('buildOrphanRalphPrompt', () => {
  it('includes declared + orphans + intent schema instructions', () => {
    const task = makeTask({ id: 'T042', kind: 'impl', files: ['a.ts'] });
    const prompt = buildOrphanRalphPrompt({
      task,
      declared: ['a.ts'],
      orphans: ['b.ts', 'c.ts'],
      attemptNumber: 1,
    });
    expect(prompt).toContain('T042');
    expect(prompt).toContain('a.ts');
    expect(prompt).toContain('b.ts');
    expect(prompt).toContain('c.ts');
    expect(prompt).toMatch(/expand/);
    expect(prompt).toMatch(/revert/);
    expect(prompt).toMatch(/stuck/);
    expect(prompt).toMatch(/DO NOT edit code/i);
  });

  it('surfaces previous error to the LLM on retry', () => {
    const task = makeTask();
    const prompt = buildOrphanRalphPrompt({
      task,
      declared: ['a.ts'],
      orphans: ['b.ts'],
      attemptNumber: 2,
      previousError: 'revert.files outside orphans: c.ts',
    });
    expect(prompt).toContain('c.ts');
    expect(prompt).toMatch(/Previous attempt failed/);
  });
});

describe('runOrphanRalph', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });

  function makeTasksMdFor(task: ParsedTask): {
    tasksMdPath: string;
    root: string;
  } {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orphan-ralph-'));
    dirs.push(root);
    const featureDir = path.join(root, 'specs', '999-demo');
    fs.mkdirSync(featureDir, { recursive: true });
    const tasksMdPath = path.join(featureDir, 'tasks.md');
    const meta = {
      id: task.id,
      workspace: task.workspace,
      deps: task.deps,
      trace_us: task.trace_us,
      trace_fr: task.trace_fr,
      kind: task.kind,
      verify_kind: task.verify_kind,
      files: task.files,
      parallel: task.parallel,
    };
    const content = [
      '---',
      'feature_id: 999-demo',
      'spec_ref: spec.md',
      'plan_ref: plan.md',
      'status: in-progress',
      'created_at: "2026-05-21T00:00:00.000Z"',
      'updated_at: "2026-05-21T00:00:00.000Z"',
      'orchestrator_compat: ">=0.1.0"',
      '---',
      '',
      `- [ ] ${task.id} demo`,
      `  <!-- task-meta: ${JSON.stringify(meta)} -->`,
      '',
    ].join('\n');
    fs.writeFileSync(tasksMdPath, content);
    return { tasksMdPath, root };
  }

  it('stuck intent → ok:false, reason:stuck, no further LLM calls', async () => {
    const task = makeTask({ files: ['a.ts'] });
    const { tasksMdPath, root } = makeTasksMdFor(task);
    const git = new FakeGit();
    const llm = new FakeLlmClient([
      llmJson({ action: 'stuck', reason: "can't decide" }),
    ]);

    const r = await runOrphanRalph({
      task,
      declared: ['a.ts'],
      orphans: ['b.ts'],
      headBefore: 'sha0',
      llm,
      llmInvokeOpts: INVOKE_OPTS,
      git,
      repoRoot: root,
      tasksMdPath,
    });

    expect(r.ok).toBe(false);
    expect(r.reason).toBe('stuck');
    expect(r.attempts).toBe(1);
    expect(llm.calls).toHaveLength(1);
  });

  it('expand intent + drift clears → ok:true, reason:resolved-expand, tasks.md updated', async () => {
    const task = makeTask({ files: ['a.ts'] });
    const { tasksMdPath, root } = makeTasksMdFor(task);
    const git = new FakeGit();
    git.enqueueDiffNameOnly(['a.ts', 'b.ts']); // post-expand, declared now = [a.ts, b.ts] → orphans = ∅
    const llm = new FakeLlmClient([
      llmJson({ action: 'expand', files: ['b.ts'] }),
    ]);

    const r = await runOrphanRalph({
      task,
      declared: ['a.ts'],
      orphans: ['b.ts'],
      headBefore: 'sha0',
      llm,
      llmInvokeOpts: INVOKE_OPTS,
      git,
      repoRoot: root,
      tasksMdPath,
    });

    expect(r.ok).toBe(true);
    expect(r.reason).toBe('resolved-expand');
    expect(r.finalDeclared).toContain('b.ts');
    const persisted = fs.readFileSync(tasksMdPath, 'utf-8');
    expect(persisted).toMatch(/"path":"b\.ts"/);
  });

  it('revert intent + drift clears → ok:true, reason:resolved-revert, git.restore called', async () => {
    const task = makeTask({ files: ['a.ts'] });
    const { tasksMdPath, root } = makeTasksMdFor(task);
    const git = new FakeGit();
    git.enqueueDiffNameOnly(['a.ts']); // post-revert, b.ts gone
    const llm = new FakeLlmClient([
      llmJson({ action: 'revert', files: ['b.ts'] }),
    ]);

    const r = await runOrphanRalph({
      task,
      declared: ['a.ts'],
      orphans: ['b.ts'],
      headBefore: 'sha0',
      llm,
      llmInvokeOpts: INVOKE_OPTS,
      git,
      repoRoot: root,
      tasksMdPath,
    });

    expect(r.ok).toBe(true);
    expect(r.reason).toBe('resolved-revert');
    const restoreCalls = git.calls.filter((c) => c.method === 'restore');
    expect(restoreCalls).toHaveLength(1);
    expect(restoreCalls[0].args[0]).toEqual(['b.ts']);
  });

  it('revert.files outside orphans → semantic-error, retry, no restore call', async () => {
    const task = makeTask({ files: ['a.ts'] });
    const { tasksMdPath, root } = makeTasksMdFor(task);
    const git = new FakeGit();
    git.enqueueDiffNameOnly(['a.ts', 'b.ts']); // attempt-2 recompute
    const llm = new FakeLlmClient([
      llmJson({ action: 'revert', files: ['a.ts'] }), // a.ts is declared, NOT orphan → reject
      llmJson({ action: 'stuck', reason: 'giving up' }),
    ]);

    const r = await runOrphanRalph({
      task,
      declared: ['a.ts'],
      orphans: ['b.ts'],
      headBefore: 'sha0',
      llm,
      llmInvokeOpts: INVOKE_OPTS,
      git,
      repoRoot: root,
      tasksMdPath,
    });

    expect(r.ok).toBe(false);
    expect(r.reason).toBe('stuck');
    expect(llm.calls).toHaveLength(2);
    expect(llm.calls[1].prompt).toMatch(/Previous attempt failed/);
    const restoreCalls = git.calls.filter((c) => c.method === 'restore');
    expect(restoreCalls).toHaveLength(0);
  });

  it('max retries exhausted with no resolution → max-retries-exceeded', async () => {
    const task = makeTask({ files: ['a.ts'] });
    const { tasksMdPath, root } = makeTasksMdFor(task);
    const git = new FakeGit();
    git.enqueueDiffNameOnly(['a.ts', 'b.ts'], ['a.ts', 'b.ts']); // drift persists each round
    const llm = new FakeLlmClient([
      llmJson({ action: 'expand', files: ['z.ts'] }), // expand the wrong file; drift still has b.ts
      llmJson({ action: 'expand', files: ['y.ts'] }), // same again
    ]);

    const r = await runOrphanRalph({
      task,
      declared: ['a.ts'],
      orphans: ['b.ts'],
      headBefore: 'sha0',
      llm,
      llmInvokeOpts: INVOKE_OPTS,
      git,
      repoRoot: root,
      tasksMdPath,
      maxRetries: 2,
    });

    expect(r.ok).toBe(false);
    expect(r.reason).toBe('max-retries-exceeded');
    expect(r.attempts).toBe(2);
    expect(r.finalOrphans).toContain('b.ts');
  });

  it('invalid JSON 2 in a row → invalid-intent-budget-exhausted', async () => {
    const task = makeTask();
    const { tasksMdPath, root } = makeTasksMdFor(task);
    const git = new FakeGit();
    const llm = new FakeLlmClient([
      { exitCode: 0, stdout: 'I think we should...', stderr: '', durationMs: 0 },
      { exitCode: 0, stdout: 'hmm let me consider', stderr: '', durationMs: 0 },
    ]);

    const r = await runOrphanRalph({
      task,
      declared: ['a.ts'],
      orphans: ['b.ts'],
      headBefore: 'sha0',
      llm,
      llmInvokeOpts: INVOKE_OPTS,
      git,
      repoRoot: root,
      tasksMdPath,
      maxRetries: 5,
    });

    expect(r.ok).toBe(false);
    expect(r.reason).toBe('invalid-intent-budget-exhausted');
  });

  it('LLM physical lockdown: allowedTools=["Read"] + maxTurns:1 passed to llm.invoke', async () => {
    const task = makeTask();
    const { tasksMdPath, root } = makeTasksMdFor(task);
    const git = new FakeGit();
    const llm = new FakeLlmClient([
      llmJson({ action: 'stuck', reason: 'check opts' }),
    ]);

    await runOrphanRalph({
      task,
      declared: ['a.ts'],
      orphans: ['b.ts'],
      headBefore: 'sha0',
      llm,
      llmInvokeOpts: INVOKE_OPTS,
      git,
      repoRoot: root,
      tasksMdPath,
    });

    expect(llm.calls[0].opts.allowedTools).toEqual(['Read']);
    expect(llm.calls[0].opts.maxTurns).toBe(1);
  });
});
