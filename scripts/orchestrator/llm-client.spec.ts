import { describe, expect, it } from 'vitest';
import {
  buildClaudeArgs,
  ClaudeCliClient,
  FakeLlmClient,
  LlmInvokeError,
  type LlmInvokeOptions,
  type LlmInvokeResult,
} from './llm-client.js';

const BASE_OPTS: LlmInvokeOptions = { cwd: '/tmp/sandbox' };

describe('buildClaudeArgs', () => {
  it('emits the canonical flag sequence with defaults', () => {
    const args = buildClaudeArgs('hello', BASE_OPTS);
    expect(args).toEqual([
      '-p',
      '--bare',
      '--permission-mode',
      'dontAsk',
      '--allowedTools',
      'Read,Edit,Write,Bash(pnpm *),Bash(git *),Glob,Grep',
      '--output-format',
      'json',
      '--max-turns',
      '5',
      'hello',
    ]);
  });

  it('honors custom allowedTools / maxTurns / outputFormat', () => {
    const args = buildClaudeArgs('x', {
      ...BASE_OPTS,
      allowedTools: ['Read', 'Glob'],
      maxTurns: 8,
      outputFormat: 'text',
    });
    expect(args).toContain('Read,Glob');
    expect(args.indexOf('--max-turns')).toBeGreaterThan(-1);
    expect(args[args.indexOf('--max-turns') + 1]).toBe('8');
    expect(args[args.indexOf('--output-format') + 1]).toBe('text');
  });

  it('places extraArgs before the prompt and prompt is last', () => {
    const args = buildClaudeArgs('the prompt', {
      ...BASE_OPTS,
      extraArgs: ['--verbose', '--debug'],
    });
    expect(args[args.length - 1]).toBe('the prompt');
    expect(args).toContain('--verbose');
    expect(args).toContain('--debug');
  });

  it('honors permissionMode override', () => {
    const args = buildClaudeArgs('x', { ...BASE_OPTS, permissionMode: 'plan' });
    expect(args[args.indexOf('--permission-mode') + 1]).toBe('plan');
  });
});

describe('FakeLlmClient', () => {
  function ok(stdout: string): LlmInvokeResult {
    return { exitCode: 0, stdout, stderr: '', durationMs: 1 };
  }

  it('returns enqueued responses in order', async () => {
    const fake = new FakeLlmClient([ok('one'), ok('two')]);
    const r1 = await fake.invoke('p1', BASE_OPTS);
    const r2 = await fake.invoke('p2', BASE_OPTS);
    expect(r1.stdout).toBe('one');
    expect(r2.stdout).toBe('two');
  });

  it('records each call with prompt + opts', async () => {
    const fake = new FakeLlmClient([ok('x'), ok('y')]);
    await fake.invoke('first', { cwd: '/a' });
    await fake.invoke('second', { cwd: '/b' });
    expect(fake.calls).toEqual([
      { prompt: 'first', opts: { cwd: '/a' } },
      { prompt: 'second', opts: { cwd: '/b' } },
    ]);
  });

  it('supports function responses receiving prompt + opts', async () => {
    const fake = new FakeLlmClient([
      (prompt, opts) =>
        ({ exitCode: 0, stdout: `${prompt}@${opts.cwd}`, stderr: '', durationMs: 0 }) satisfies LlmInvokeResult,
    ]);
    const r = await fake.invoke('hi', { cwd: '/z' });
    expect(r.stdout).toBe('hi@/z');
  });

  it('enqueue() appends additional responses', async () => {
    const fake = new FakeLlmClient([]);
    fake.enqueue(ok('late'));
    const r = await fake.invoke('p', BASE_OPTS);
    expect(r.stdout).toBe('late');
  });

  it('throws LlmInvokeError when queue is exhausted', async () => {
    const fake = new FakeLlmClient([ok('only')]);
    await fake.invoke('p1', BASE_OPTS);
    await expect(fake.invoke('p2', BASE_OPTS)).rejects.toBeInstanceOf(
      LlmInvokeError,
    );
  });
});

describe('ClaudeCliClient (live; env-gated)', () => {
  // Default-skipped so CI / dev runs don't burn Claude tokens.
  // Set LIVE_LLM=1 in the env to exercise the real subprocess.
  const enabled = process.env.LIVE_LLM === '1';
  it.skipIf(!enabled)('spawns claude -p and returns its output', async () => {
    const client = new ClaudeCliClient();
    const r = await client.invoke(
      'reply with the single word "ok" and nothing else',
      { cwd: process.cwd(), maxTurns: 1, timeoutMs: 60_000 },
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout.length).toBeGreaterThan(0);
  });
});
