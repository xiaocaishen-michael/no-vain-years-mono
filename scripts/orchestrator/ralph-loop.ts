import type {
  LlmClient,
  LlmInvokeOptions,
  LlmInvokeResult,
} from './llm-client.js';

/**
 * Per plan § 5.3.15.8.3:
 * - verify-command phase: LLM wrote code, verify_command failed; re-prompt
 *   with stderr up to 3 times.
 * - git-hook phase: code passed verify but `git commit` triggered a lefthook
 *   rejection; re-prompt with hook stderr up to 2 times. Lower cap because
 *   the issue is necessarily a small format/lint fix.
 */
export type RalphPhase = 'verify-command' | 'git-hook';

/** Per-phase max retry recommendation. Caller may override via params.maxRetries. */
export const RALPH_DEFAULT_MAX_RETRIES: Record<RalphPhase, number> = {
  'verify-command': 3,
  'git-hook': 2,
};

/** Outcome of one attempt of the underlying action (verify or commit). */
export interface RalphAttemptOutcome {
  ok: boolean;
  /** Feedback (typically stderr) handed to buildRetryPrompt on failure. */
  feedback?: string;
}

export interface RalphRoundEvent {
  phase: RalphPhase;
  attemptNumber: number;
  retryPrompt: string;
  /** Set when the LLM call succeeded. */
  llmResult?: LlmInvokeResult;
  /** Set when the LLM call threw (loop will short-circuit with reason='llm-error'). */
  llmError?: Error;
  /** Set after the action re-ran; undefined when the loop short-circuited on llm-error. */
  outcome?: RalphAttemptOutcome;
}

export interface RalphLoopParams {
  phase: RalphPhase;
  /** Override RALPH_DEFAULT_MAX_RETRIES[phase] if set. */
  maxRetries?: number;
  /**
   * Failure that triggered the loop. The first retry round uses this
   * as the feedback for buildRetryPrompt.
   */
  initialFailure: string;
  /** Build the LLM prompt for a given retry round (attemptNumber starts at 1). */
  buildRetryPrompt: (feedback: string, attemptNumber: number) => string;
  /** Re-run the underlying action (verify_command or git commit) after each LLM call. */
  attempt: () => Promise<RalphAttemptOutcome>;
  llm: LlmClient;
  llmInvokeOpts: LlmInvokeOptions;
  /**
   * Fires exactly once per round, after both the LLM call AND the action
   * have completed (or after the LLM call short-circuits the loop on
   * error). Lets callers archive each round without ralph-loop knowing
   * the archive type. Awaited — failures propagate.
   */
  onRound?: (round: RalphRoundEvent) => Promise<void>;
  /**
   * Called just before each round's LLM invocation. The returned partial
   * options are merged into `llmInvokeOpts` for that round only — used by
   * callers to wire per-round live observability (e.g. `onEvent` /
   * `streamStdout`) for UI narration without ralph-loop knowing about
   * progress sinks.
   */
  prepareRound?: (
    attemptNumber: number,
    maxRetries: number,
  ) => Partial<LlmInvokeOptions>;
}

/** A single entry in the retry timeline; useful for diagnostics + tests. */
export type RalphHistoryEntry =
  | { kind: 'retry-prompt'; attemptNumber: number; prompt: string }
  | {
      kind: 'llm-output';
      attemptNumber: number;
      exitCode: number;
      stdout: string;
      stderr: string;
      durationMs: number;
    }
  | { kind: 'attempt'; attemptNumber: number; ok: boolean; feedback?: string };

export type RalphTerminalReason =
  | 'success'
  | 'max-retries-exceeded'
  | 'llm-error';

export interface RalphLoopResult {
  ok: boolean;
  phase: RalphPhase;
  attempts: number;
  reason: RalphTerminalReason;
  history: RalphHistoryEntry[];
  /** Populated when reason='llm-error'; the underlying error. */
  llmError?: Error;
  /** Final feedback string at termination (last failure, or undefined on success). */
  finalFeedback?: string;
}

/**
 * Generic retry loop. Owns the count + history; defers action shape
 * (re-running verify vs. re-running git commit) to the caller via
 * `attempt` + `buildRetryPrompt`.
 *
 * Time complexity: O(N) LLM calls + O(N) attempts where N <= maxRetries.
 */
export async function ralphLoop(
  params: RalphLoopParams,
): Promise<RalphLoopResult> {
  const max = params.maxRetries ?? RALPH_DEFAULT_MAX_RETRIES[params.phase];
  const history: RalphHistoryEntry[] = [];
  let feedback = params.initialFailure;
  let attempts = 0;

  for (let i = 1; i <= max; i++) {
    const retryPrompt = params.buildRetryPrompt(feedback, i);
    history.push({ kind: 'retry-prompt', attemptNumber: i, prompt: retryPrompt });

    let llmResult: LlmInvokeResult;
    const roundOpts: LlmInvokeOptions = params.prepareRound
      ? { ...params.llmInvokeOpts, ...params.prepareRound(i, max) }
      : params.llmInvokeOpts;
    try {
      llmResult = await params.llm.invoke(retryPrompt, roundOpts);
    } catch (e) {
      const llmError = e instanceof Error ? e : new Error(String(e));
      if (params.onRound) {
        await params.onRound({
          phase: params.phase,
          attemptNumber: i,
          retryPrompt,
          llmError,
        });
      }
      return {
        ok: false,
        phase: params.phase,
        attempts,
        reason: 'llm-error',
        history,
        llmError,
        finalFeedback: feedback,
      };
    }
    history.push({
      kind: 'llm-output',
      attemptNumber: i,
      exitCode: llmResult.exitCode,
      stdout: llmResult.stdout,
      stderr: llmResult.stderr,
      durationMs: llmResult.durationMs,
    });

    attempts = i;

    const outcome = await params.attempt();
    history.push({
      kind: 'attempt',
      attemptNumber: i,
      ok: outcome.ok,
      feedback: outcome.feedback,
    });

    if (params.onRound) {
      await params.onRound({
        phase: params.phase,
        attemptNumber: i,
        retryPrompt,
        llmResult,
        outcome,
      });
    }

    if (outcome.ok) {
      return {
        ok: true,
        phase: params.phase,
        attempts,
        reason: 'success',
        history,
      };
    }

    feedback = outcome.feedback ?? feedback;
  }

  return {
    ok: false,
    phase: params.phase,
    attempts,
    reason: 'max-retries-exceeded',
    history,
    finalFeedback: feedback,
  };
}
