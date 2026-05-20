import { describe, expect, it } from 'vitest';
import {
  buildClaudeArgs,
  buildSpawnEnv,
  ClaudeCliClient,
  describeClaudeError,
  extractClaudeMetrics,
  FakeLlmClient,
  isClaudeJsonError,
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
      '--permission-mode',
      'dontAsk',
      '--allowedTools',
      'Read,Edit,Write,Bash(pnpm *),Bash(git *),Glob,Grep',
      '--output-format',
      'json',
      '--max-turns',
      '30',
      'hello',
    ]);
  });

  it('does NOT pass --bare (which would force ANTHROPIC_API_KEY-only auth)', () => {
    // Regression guard: 2026-05-20 dropped --bare to let Max-subscription
    // OAuth users run the orchestrator without an API key. See PR for
    // tradeoff (subprocess now runs hooks / plugins / auto-memory).
    const args = buildClaudeArgs('hello', BASE_OPTS);
    expect(args).not.toContain('--bare');
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

describe('buildSpawnEnv', () => {
  it('strips CLAUDECODE so the claude subprocess does not see the nested-session gate', () => {
    const parent: NodeJS.ProcessEnv = {
      CLAUDECODE: '1',
      CLAUDE_CODE_SESSION_ID: 'abc',
      PATH: '/usr/bin',
    };
    const env = buildSpawnEnv(parent);
    expect(env.CLAUDECODE).toBeUndefined();
    // Other CLAUDE_CODE_* vars are kept — they're not gates and may be
    // useful telemetry for the subprocess.
    expect(env.CLAUDE_CODE_SESSION_ID).toBe('abc');
    expect(env.PATH).toBe('/usr/bin');
  });

  it('returns a copy — does not mutate the parent env', () => {
    const parent: NodeJS.ProcessEnv = { CLAUDECODE: '1', FOO: 'bar' };
    buildSpawnEnv(parent);
    expect(parent.CLAUDECODE).toBe('1');
  });

  it('is a no-op when CLAUDECODE is already absent', () => {
    const env = buildSpawnEnv({ FOO: 'bar' });
    expect(env).toEqual({ FOO: 'bar' });
  });
});

describe('isClaudeJsonError', () => {
  it('returns true for {is_error: true} payloads', () => {
    expect(isClaudeJsonError({ is_error: true, result: 'Not logged in' })).toBe(
      true,
    );
  });

  it('returns false for success payloads', () => {
    expect(
      isClaudeJsonError({ is_error: false, subtype: 'success', result: 'ok' }),
    ).toBe(false);
  });

  it('returns false when parsed is missing / not an object', () => {
    expect(isClaudeJsonError(undefined)).toBe(false);
    expect(isClaudeJsonError(null)).toBe(false);
    expect(isClaudeJsonError('a string')).toBe(false);
    expect(isClaudeJsonError(42)).toBe(false);
  });
});

describe('describeClaudeError', () => {
  it('extracts result + subtype + stop_reason', () => {
    const msg = describeClaudeError({
      is_error: true,
      subtype: 'success',
      result: 'Not logged in · Please run /login',
      stop_reason: 'stop_sequence',
    });
    expect(msg).toContain('Not logged in');
    expect(msg).toContain('stop=stop_sequence');
  });

  it('falls back when no result text', () => {
    const msg = describeClaudeError({ is_error: true });
    expect(msg).toMatch(/no result/);
  });
});

describe('extractClaudeMetrics', () => {
  // Realistic shape captured from a live A-002 T003 run, 2026-05-20.
  const FULL_PAYLOAD = {
    type: 'result',
    subtype: 'success',
    is_error: false,
    duration_ms: 172695,
    num_turns: 28,
    total_cost_usd: 0.9607915,
    usage: {
      input_tokens: 89,
      output_tokens: 10824,
      cache_read_input_tokens: 717343,
      cache_creation_input_tokens: 52972,
      server_tool_use: { web_search_requests: 0 },
    },
    permission_denials: [
      { tool_name: 'Bash', tool_use_id: 'toolu_x', tool_input: {} },
    ],
  };

  it('extracts cost / num_turns / denials count / usage', () => {
    const m = extractClaudeMetrics(FULL_PAYLOAD);
    expect(m).toBeDefined();
    expect(m?.cost_usd).toBeCloseTo(0.9607915, 6);
    expect(m?.num_turns).toBe(28);
    expect(m?.permission_denials).toBe(1);
    expect(m?.usage).toEqual({
      input_tokens: 89,
      output_tokens: 10824,
      cache_read_input_tokens: 717343,
      cache_creation_input_tokens: 52972,
    });
  });

  it('returns undefined for non-claude payloads', () => {
    expect(extractClaudeMetrics(undefined)).toBeUndefined();
    expect(extractClaudeMetrics(null)).toBeUndefined();
    expect(extractClaudeMetrics(42)).toBeUndefined();
    expect(extractClaudeMetrics('string')).toBeUndefined();
    expect(extractClaudeMetrics({ unrelated: true })).toBeUndefined();
  });

  it('tolerates partial payloads — only populates known fields', () => {
    const m = extractClaudeMetrics({ total_cost_usd: 0.5 });
    expect(m?.cost_usd).toBe(0.5);
    expect(m?.num_turns).toBeUndefined();
    expect(m?.usage).toBeUndefined();
    expect(m?.permission_denials).toBeUndefined();
  });

  it('handles empty permission_denials array as 0, not undefined', () => {
    const m = extractClaudeMetrics({ permission_denials: [] });
    expect(m?.permission_denials).toBe(0);
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
