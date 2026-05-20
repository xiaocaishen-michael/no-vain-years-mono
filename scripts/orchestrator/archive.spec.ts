import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { TaskArchive } from './archive.js';

const dirs: string[] = [];

function makeDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'orchestrator-archive-'));
  dirs.push(d);
  return d;
}

afterEach(() => {
  for (const d of dirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

describe('TaskArchive.create', () => {
  it('creates the archive directory recursively', async () => {
    const base = makeDir();
    const dir = path.join(base, '.spec-kit', 'runs', '002-demo', 'T001');
    const a = await TaskArchive.create(dir, {
      featureId: '002-demo',
      taskId: 'T001',
    });
    expect(fs.existsSync(dir)).toBe(true);
    expect(a.dir).toBe(dir);
    expect(a.featureId).toBe('002-demo');
    expect(a.taskId).toBe('T001');
  });
});

describe('AttemptHandle.finish', () => {
  it('writes prompt + llm-stdout + llm-stderr + action-stdout + action-stderr + diff', async () => {
    const dir = makeDir();
    const a = await TaskArchive.create(dir, { featureId: 'f1', taskId: 'T001' });
    const att = a.reserveAttempt('initial');

    await att.finish({
      prompt: 'PROMPT BODY',
      llmResult: { exitCode: 0, stdout: 'LLM-STDOUT', stderr: 'LLM-STDERR', durationMs: 42 },
      actionStdout: 'ACT-STDOUT',
      actionStderr: 'ACT-STDERR',
      actionExitCode: 0,
      diff: 'diff --git a/foo b/foo\n',
      ok: true,
    });

    expect(fs.readFileSync(path.join(dir, 'attempt-0-prompt.md'), 'utf-8')).toBe('PROMPT BODY');
    expect(fs.readFileSync(path.join(dir, 'attempt-0-llm-stdout.log'), 'utf-8')).toBe('LLM-STDOUT');
    expect(fs.readFileSync(path.join(dir, 'attempt-0-llm-stderr.log'), 'utf-8')).toBe('LLM-STDERR');
    expect(fs.readFileSync(path.join(dir, 'attempt-0-action-stdout.log'), 'utf-8')).toBe('ACT-STDOUT');
    expect(fs.readFileSync(path.join(dir, 'attempt-0-action-stderr.log'), 'utf-8')).toBe('ACT-STDERR');
    expect(fs.readFileSync(path.join(dir, 'attempt-0-diff.patch'), 'utf-8')).toBe('diff --git a/foo b/foo\n');
  });

  it('writes llm-error.log when llmError provided', async () => {
    const dir = makeDir();
    const a = await TaskArchive.create(dir, { featureId: 'f1', taskId: 'T001' });
    const att = a.reserveAttempt('initial');

    const err = new Error('boom');
    err.name = 'LlmInvokeError';
    await att.finish({ prompt: 'p', llmError: err, ok: false });

    const body = fs.readFileSync(path.join(dir, 'attempt-0-llm-error.log'), 'utf-8');
    expect(body).toMatch(/LlmInvokeError: boom/);
  });

  it('reserveAttempt increments attempt number across calls', async () => {
    const dir = makeDir();
    const a = await TaskArchive.create(dir, { featureId: 'f1', taskId: 'T001' });

    const att0 = a.reserveAttempt('initial');
    await att0.finish({ prompt: 'p0', ok: true });
    const att1 = a.reserveAttempt('verify-ralph');
    await att1.finish({ prompt: 'p1', ok: false });
    const att2 = a.reserveAttempt('hook-ralph');
    await att2.finish({ prompt: 'p2', ok: true });

    expect(fs.existsSync(path.join(dir, 'attempt-0-prompt.md'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'attempt-1-prompt.md'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'attempt-2-prompt.md'))).toBe(true);
  });

  it('throws if finish() is called twice on the same handle', async () => {
    const dir = makeDir();
    const a = await TaskArchive.create(dir, { featureId: 'f1', taskId: 'T001' });
    const att = a.reserveAttempt('initial');
    await att.finish({ prompt: 'p', ok: true });
    await expect(att.finish({ prompt: 'p', ok: true })).rejects.toThrow(/already called/);
  });

  it('throws if openLlmStreams() is called twice on the same handle', async () => {
    const dir = makeDir();
    const a = await TaskArchive.create(dir, { featureId: 'f1', taskId: 'T001' });
    const att = a.reserveAttempt('initial');
    att.openLlmStreams();
    expect(() => att.openLlmStreams()).toThrow(/already opened/);
    // close the streams openLlmStreams() spawned so afterEach can rm the tmpdir
    // without racing the underlying fs.open() that WriteStream queues.
    await att.finish({ prompt: 'p', ok: true });
  });

  it('openLlmStreams writes are visible via tail (before finish)', async () => {
    const dir = makeDir();
    const a = await TaskArchive.create(dir, { featureId: 'f1', taskId: 'T001' });
    const att = a.reserveAttempt('initial');
    const { stdout, stderr } = att.openLlmStreams();
    stdout.write('mid-run chunk\n');
    stderr.write('mid-run err\n');
    // flush + close so we can read
    await new Promise<void>((r) => stdout.end(() => r()));
    await new Promise<void>((r) => stderr.end(() => r()));

    expect(fs.readFileSync(path.join(dir, 'attempt-0-llm-stdout.log'), 'utf-8')).toBe('mid-run chunk\n');
    expect(fs.readFileSync(path.join(dir, 'attempt-0-llm-stderr.log'), 'utf-8')).toBe('mid-run err\n');
  });
});

describe('TaskArchive.finalize', () => {
  it('writes summary.json with shape: feature_id / task_id / timings / attempts / file_ops / commit / errors', async () => {
    const dir = makeDir();
    const a = await TaskArchive.create(dir, { featureId: '002-demo', taskId: 'T003' });

    a.setHeadBefore('abc123');
    a.setHeadAfter('def456');
    a.setSandbox('/tmp/sb', true);
    a.setCommit({ message: 'feat: foo (T003)', sha: 'def456', ralph_attempts: 1 });
    a.recordFileOps([
      { op: 'create', path: 'apps/server/src/x.ts' },
      { op: 'modify', path: 'apps/server/src/y.ts' },
    ]);
    a.pushError('one error noted');

    const att0 = a.reserveAttempt('initial');
    await att0.finish({
      prompt: 'p0',
      llmResult: { exitCode: 0, stdout: 'o', stderr: 'e', durationMs: 100 },
      actionExitCode: 1,
      ok: false,
    });
    const att1 = a.reserveAttempt('verify-ralph');
    await att1.finish({
      prompt: 'p1',
      llmResult: { exitCode: 0, stdout: 'o', stderr: 'e', durationMs: 200 },
      actionExitCode: 0,
      ok: true,
    });

    await a.finalize({ ok: true, reason: 'success' });

    const summary = JSON.parse(
      fs.readFileSync(path.join(dir, 'summary.json'), 'utf-8'),
    );

    expect(summary.feature_id).toBe('002-demo');
    expect(summary.task_id).toBe('T003');
    expect(summary.ok).toBe(true);
    expect(summary.reason).toBe('success');
    expect(summary.sandbox_cwd).toBe('/tmp/sb');
    expect(summary.sandbox_cleaned).toBe(true);
    expect(summary.head_before).toBe('abc123');
    expect(summary.head_after).toBe('def456');

    expect(summary.file_ops.create).toBe(1);
    expect(summary.file_ops.modify).toBe(1);
    expect(summary.file_ops.delete).toBe(0);
    expect(summary.file_ops.rename).toBe(0);
    expect(summary.file_ops.files).toEqual([
      { op: 'create', path: 'apps/server/src/x.ts' },
      { op: 'modify', path: 'apps/server/src/y.ts' },
    ]);

    expect(summary.attempts).toHaveLength(2);
    expect(summary.attempts[0]).toMatchObject({
      n: 0,
      phase: 'initial',
      llm: { exit_code: 0, duration_ms: 100 },
      action: { exit_code: 1 },
      ok: false,
    });
    expect(summary.attempts[1]).toMatchObject({
      n: 1,
      phase: 'verify-ralph',
      llm: { exit_code: 0, duration_ms: 200 },
      action: { exit_code: 0 },
      ok: true,
    });

    expect(summary.commit).toMatchObject({
      message: 'feat: foo (T003)',
      sha: 'def456',
      ralph_attempts: 1,
    });
    expect(summary.errors).toEqual(['one error noted']);

    // sanity: timings populated and finished_at ≥ started_at
    expect(typeof summary.elapsed_ms).toBe('number');
    expect(Date.parse(summary.finished_at) >= Date.parse(summary.started_at)).toBe(true);
  });

  it('persists llmResult.metrics (cost/usage/denials/turns) into attempt.llm', async () => {
    const dir = makeDir();
    const a = await TaskArchive.create(dir, { featureId: 'f', taskId: 'T01' });
    const att = a.reserveAttempt('initial');
    await att.finish({
      prompt: 'p',
      llmResult: {
        exitCode: 0,
        stdout: 'o',
        stderr: 'e',
        durationMs: 100,
        metrics: {
          cost_usd: 0.96,
          num_turns: 28,
          permission_denials: 1,
          usage: {
            input_tokens: 89,
            output_tokens: 10824,
            cache_read_input_tokens: 717343,
            cache_creation_input_tokens: 52972,
          },
        },
      },
      ok: true,
    });
    await a.finalize({ ok: true, reason: 'success' });
    const s = JSON.parse(
      fs.readFileSync(path.join(dir, 'summary.json'), 'utf-8'),
    );
    expect(s.attempts[0].llm).toMatchObject({
      exit_code: 0,
      duration_ms: 100,
      cost_usd: 0.96,
      num_turns: 28,
      permission_denials: 1,
      usage: {
        input_tokens: 89,
        output_tokens: 10824,
        cache_read_input_tokens: 717343,
        cache_creation_input_tokens: 52972,
      },
    });
  });

  it('leaves attempt.llm.cost_usd/usage absent when metrics undefined', async () => {
    const dir = makeDir();
    const a = await TaskArchive.create(dir, { featureId: 'f', taskId: 'T02' });
    const att = a.reserveAttempt('initial');
    await att.finish({
      prompt: 'p',
      llmResult: { exitCode: 0, stdout: 'o', stderr: 'e', durationMs: 50 },
      ok: true,
    });
    await a.finalize({ ok: true, reason: 'success' });
    const s = JSON.parse(
      fs.readFileSync(path.join(dir, 'summary.json'), 'utf-8'),
    );
    expect(s.attempts[0].llm).toEqual({ exit_code: 0, duration_ms: 50 });
  });

  it('summary.json finalizes with empty attempts when no work happened', async () => {
    const dir = makeDir();
    const a = await TaskArchive.create(dir, { featureId: 'f1', taskId: 'T001' });
    await a.finalize({ ok: false, reason: 'workspace-missing' });
    const s = JSON.parse(
      fs.readFileSync(path.join(dir, 'summary.json'), 'utf-8'),
    );
    expect(s.ok).toBe(false);
    expect(s.reason).toBe('workspace-missing');
    expect(s.attempts).toEqual([]);
    expect(s.errors).toEqual([]);
  });
});
