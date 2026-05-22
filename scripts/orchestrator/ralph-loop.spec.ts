import { describe, expect, it } from 'vitest';
import {
  FakeLlmClient,
  LlmInvokeError,
  type LlmInvokeOptions,
  type LlmInvokeResult,
} from './llm-client.js';
import { ralphLoop, RALPH_DEFAULT_MAX_RETRIES, type RalphAttemptOutcome } from './ralph-loop.js';

const INVOKE_OPTS: LlmInvokeOptions = { cwd: '/tmp/sandbox' };

interface RalphRoundCapture {
  n: number;
  hasError: boolean;
  hasOutcome: boolean;
}

function llmOk(stdout = 'patched'): LlmInvokeResult {
  return { exitCode: 0, stdout, stderr: '', durationMs: 1 };
}

function makeAttempts(outcomes: RalphAttemptOutcome[]): () => Promise<RalphAttemptOutcome> {
  let i = 0;
  return async () => {
    const next = outcomes[i++];
    if (!next)
      throw new Error(`attempt called ${i} times, only ${outcomes.length} outcomes scripted`);
    return next;
  };
}

describe('ralphLoop', () => {
  it('default max retries: verify-command=3, git-hook=2', () => {
    expect(RALPH_DEFAULT_MAX_RETRIES['verify-command']).toBe(3);
    expect(RALPH_DEFAULT_MAX_RETRIES['git-hook']).toBe(2);
  });

  it('returns ok=true on first successful attempt', async () => {
    const llm = new FakeLlmClient([llmOk()]);
    const attempt = makeAttempts([{ ok: true }]);
    const r = await ralphLoop({
      phase: 'verify-command',
      initialFailure: 'first failure',
      buildRetryPrompt: (fb, n) => `retry ${n}: ${fb}`,
      attempt,
      llm,
      llmInvokeOpts: INVOKE_OPTS,
    });
    expect(r.ok).toBe(true);
    expect(r.attempts).toBe(1);
    expect(r.reason).toBe('success');
    expect(llm.calls).toHaveLength(1);
    expect(llm.calls[0].prompt).toBe('retry 1: first failure');
  });

  it("threads each attempt's feedback into the next retry prompt", async () => {
    const llm = new FakeLlmClient([llmOk('fix-1'), llmOk('fix-2'), llmOk('fix-3')]);
    const attempt = makeAttempts([
      { ok: false, feedback: 'err A' },
      { ok: false, feedback: 'err B' },
      { ok: true },
    ]);
    const prompts: string[] = [];
    const r = await ralphLoop({
      phase: 'verify-command',
      initialFailure: 'INIT',
      buildRetryPrompt: (fb, n) => {
        const p = `[#${n}] ${fb}`;
        prompts.push(p);
        return p;
      },
      attempt,
      llm,
      llmInvokeOpts: INVOKE_OPTS,
    });
    expect(r.ok).toBe(true);
    expect(r.attempts).toBe(3);
    expect(prompts).toEqual(['[#1] INIT', '[#2] err A', '[#3] err B']);
  });

  it('stops at default maxRetries when attempts keep failing (verify-command=3)', async () => {
    const llm = new FakeLlmClient([llmOk(), llmOk(), llmOk()]);
    const attempt = makeAttempts([
      { ok: false, feedback: 'a' },
      { ok: false, feedback: 'b' },
      { ok: false, feedback: 'c' },
    ]);
    const r = await ralphLoop({
      phase: 'verify-command',
      initialFailure: 'INIT',
      buildRetryPrompt: (fb) => fb,
      attempt,
      llm,
      llmInvokeOpts: INVOKE_OPTS,
    });
    expect(r.ok).toBe(false);
    expect(r.attempts).toBe(3);
    expect(r.reason).toBe('max-retries-exceeded');
    expect(r.finalFeedback).toBe('c');
  });

  it('stops at git-hook default maxRetries=2', async () => {
    const llm = new FakeLlmClient([llmOk(), llmOk()]);
    const attempt = makeAttempts([
      { ok: false, feedback: 'lint err' },
      { ok: false, feedback: 'still lint err' },
    ]);
    const r = await ralphLoop({
      phase: 'git-hook',
      initialFailure: 'hook stderr',
      buildRetryPrompt: (fb) => `fix only lint: ${fb}`,
      attempt,
      llm,
      llmInvokeOpts: INVOKE_OPTS,
    });
    expect(r.ok).toBe(false);
    expect(r.attempts).toBe(2);
    expect(r.reason).toBe('max-retries-exceeded');
  });

  it('honors maxRetries override', async () => {
    const llm = new FakeLlmClient([llmOk()]);
    const attempt = makeAttempts([{ ok: false, feedback: 'still bad' }]);
    const r = await ralphLoop({
      phase: 'verify-command',
      maxRetries: 1,
      initialFailure: 'INIT',
      buildRetryPrompt: (fb) => fb,
      attempt,
      llm,
      llmInvokeOpts: INVOKE_OPTS,
    });
    expect(r.ok).toBe(false);
    expect(r.attempts).toBe(1);
  });

  it('returns reason=llm-error when LLM throws', async () => {
    const llm = new FakeLlmClient(); // empty queue → throws LlmInvokeError
    const attempt = makeAttempts([]); // should not be called
    const r = await ralphLoop({
      phase: 'verify-command',
      initialFailure: 'INIT',
      buildRetryPrompt: (fb) => fb,
      attempt,
      llm,
      llmInvokeOpts: INVOKE_OPTS,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('llm-error');
    expect(r.llmError).toBeInstanceOf(LlmInvokeError);
    expect(r.finalFeedback).toBe('INIT');
    expect(r.attempts).toBe(0);
  });

  it('history records prompt → llm-output → attempt for each round', async () => {
    const llm = new FakeLlmClient([llmOk('stdout-A')]);
    const attempt = makeAttempts([{ ok: true }]);
    const r = await ralphLoop({
      phase: 'verify-command',
      initialFailure: 'oops',
      buildRetryPrompt: (fb) => `please: ${fb}`,
      attempt,
      llm,
      llmInvokeOpts: INVOKE_OPTS,
    });
    expect(r.history).toHaveLength(3);
    expect(r.history[0]).toMatchObject({
      kind: 'retry-prompt',
      attemptNumber: 1,
      prompt: 'please: oops',
    });
    expect(r.history[1]).toMatchObject({
      kind: 'llm-output',
      attemptNumber: 1,
      stdout: 'stdout-A',
    });
    expect(r.history[2]).toMatchObject({ kind: 'attempt', attemptNumber: 1, ok: true });
  });

  it('fires onRound once per round with llmResult + outcome (success path)', async () => {
    const llm = new FakeLlmClient([llmOk('a'), llmOk('b')]);
    const attempt = makeAttempts([{ ok: false, feedback: 'err A' }, { ok: true }]);
    const rounds: Array<{
      n: number;
      ok: boolean | undefined;
      stdout: string | undefined;
      hasError: boolean;
    }> = [];
    await ralphLoop({
      phase: 'verify-command',
      initialFailure: 'INIT',
      buildRetryPrompt: (fb, n) => `r${n}:${fb}`,
      attempt,
      llm,
      llmInvokeOpts: INVOKE_OPTS,
      onRound: async (r) => {
        rounds.push({
          n: r.attemptNumber,
          ok: r.outcome?.ok,
          stdout: r.llmResult?.stdout,
          hasError: r.llmError !== undefined,
        });
      },
    });
    expect(rounds).toEqual([
      { n: 1, ok: false, stdout: 'a', hasError: false },
      { n: 2, ok: true, stdout: 'b', hasError: false },
    ]);
  });

  it('fires onRound on llm-error short-circuit with llmError set', async () => {
    const llm = new FakeLlmClient(); // empty queue → throws on first invoke
    const attempt = makeAttempts([]);
    const rounds: RalphRoundCapture[] = [];
    const r = await ralphLoop({
      phase: 'verify-command',
      initialFailure: 'INIT',
      buildRetryPrompt: (fb) => fb,
      attempt,
      llm,
      llmInvokeOpts: INVOKE_OPTS,
      onRound: async (round) => {
        rounds.push({
          n: round.attemptNumber,
          hasError: round.llmError !== undefined,
          hasOutcome: round.outcome !== undefined,
        });
      },
    });
    expect(r.reason).toBe('llm-error');
    expect(rounds).toEqual([{ n: 1, hasError: true, hasOutcome: false }]);
  });

  it('keeps last non-empty feedback when attempt omits feedback', async () => {
    const llm = new FakeLlmClient([llmOk(), llmOk()]);
    const attempt = makeAttempts([
      { ok: false, feedback: 'first err' },
      { ok: false }, // no feedback → ralph keeps "first err"
    ]);
    const prompts: string[] = [];
    await ralphLoop({
      phase: 'verify-command',
      maxRetries: 2,
      initialFailure: 'INIT',
      buildRetryPrompt: (fb, n) => {
        const p = `${n}:${fb}`;
        prompts.push(p);
        return p;
      },
      attempt,
      llm,
      llmInvokeOpts: INVOKE_OPTS,
    });
    expect(prompts).toEqual(['1:INIT', '2:first err']);
  });

  it('prepareRound fires once per round with (n, max) and merges opts', async () => {
    const llm = new FakeLlmClient([llmOk('a'), llmOk('b'), llmOk('c')]);
    const attempt = makeAttempts([
      { ok: false, feedback: 'e1' },
      { ok: false, feedback: 'e2' },
      { ok: true },
    ]);
    const calls: Array<{ n: number; max: number }> = [];
    const observedOpts: Array<LlmInvokeOptions> = [];
    const spyLlm = {
      invoke: async (prompt: string, opts: LlmInvokeOptions) => {
        observedOpts.push(opts);
        return llm.invoke(prompt, opts);
      },
    };
    await ralphLoop({
      phase: 'verify-command',
      maxRetries: 3,
      initialFailure: 'init',
      buildRetryPrompt: (fb, n) => `r${n}:${fb}`,
      attempt,
      llm: spyLlm,
      llmInvokeOpts: { cwd: '/base' },
      prepareRound: (n, max) => {
        calls.push({ n, max });
        return { allowedTools: [`Round-${n}`] };
      },
    });
    expect(calls).toEqual([
      { n: 1, max: 3 },
      { n: 2, max: 3 },
      { n: 3, max: 3 },
    ]);
    // base opts.cwd preserved; per-round override merged on top.
    expect(observedOpts.map((o) => o.cwd)).toEqual(['/base', '/base', '/base']);
    expect(observedOpts.map((o) => o.allowedTools)).toEqual([
      ['Round-1'],
      ['Round-2'],
      ['Round-3'],
    ]);
  });

  it('prepareRound omitted: opts equal llmInvokeOpts verbatim', async () => {
    const llm = new FakeLlmClient([llmOk()]);
    const attempt = makeAttempts([{ ok: true }]);
    let observed: LlmInvokeOptions | undefined;
    const spyLlm = {
      invoke: async (prompt: string, opts: LlmInvokeOptions) => {
        observed = opts;
        return llm.invoke(prompt, opts);
      },
    };
    const baseOpts: LlmInvokeOptions = { cwd: '/x', maxTurns: 5 };
    await ralphLoop({
      phase: 'verify-command',
      initialFailure: 'init',
      buildRetryPrompt: () => 'p',
      attempt,
      llm: spyLlm,
      llmInvokeOpts: baseOpts,
    });
    expect(observed).toEqual(baseOpts);
  });
});
