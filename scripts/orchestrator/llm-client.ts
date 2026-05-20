import { spawn } from 'node:child_process';

/**
 * Port for the LLM call. The live impl shells out to `claude -p`;
 * tests inject a FakeLlmClient with a scripted response queue.
 *
 * Per plan § 11.1 + Q-O2: live invocation passes the prompt inline
 * (NOT a file path) — `claude -p` expects the prompt as a positional
 * string argument.
 */
export interface LlmClient {
  invoke(prompt: string, opts: LlmInvokeOptions): Promise<LlmInvokeResult>;
}

export interface LlmInvokeOptions {
  /** Working directory for the subprocess (typically the sandbox cwd). */
  cwd: string;
  /** Bash-style allowed-tool spec for `claude -p --allowedTools`. */
  allowedTools?: string[];
  /** Cap LLM turns; matches plan recommendation of 5. */
  maxTurns?: number;
  /** Output format flag. Defaults to 'json'. */
  outputFormat?: 'json' | 'text';
  /** Hard timeout for the subprocess (ms). */
  timeoutMs?: number;
  /** Permission mode; defaults to 'dontAsk'. */
  permissionMode?: 'dontAsk' | 'plan' | 'default';
  /** Extra args passed verbatim before the prompt argument. Escape hatch. */
  extraArgs?: string[];
}

export interface LlmInvokeResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  /** Parsed JSON payload when outputFormat='json' and stdout was valid JSON. */
  parsed?: unknown;
  /** Wall-clock duration in ms. */
  durationMs: number;
}

export class LlmInvokeError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'LlmInvokeError';
  }
}

const DEFAULT_ALLOWED_TOOLS = [
  'Read',
  'Edit',
  'Write',
  'Bash(pnpm *)',
  'Bash(git *)',
  'Glob',
  'Grep',
];

// 2026-05-20 A-002 PoC surfaced: 5 was too tight — non-trivial config / impl
// tasks (Expo init = 6 files + research SDK 54 patterns; Prisma migration;
// multi-file controllers) hit max_turns before completing. Bumped to 30
// covering 1-file simple write/typecheck (~3 turns) up to multi-file config
// (~15-25 turns including research). Future: per-task override via tasks-meta.
const DEFAULT_MAX_TURNS = 30;
// 2026-05-20 A-002 PoC surfaced blind spot 7: 5min wall-clock is too tight
// when max_turns=30 and each turn takes 10-30s. T001 (Expo workspace bootstrap)
// timed out mid-stream after burning research turns + file writes. Bumped to
// 20min. Future: per-task timeout override via tasks-meta + env var.
const DEFAULT_TIMEOUT_MS = 20 * 60 * 1000;

/**
 * Build the argv vector for the live `claude -p` invocation. Exported
 * so tests can assert flag composition without spawning a subprocess.
 */
export function buildClaudeArgs(
  prompt: string,
  opts: LlmInvokeOptions,
): string[] {
  const allowed = (opts.allowedTools ?? DEFAULT_ALLOWED_TOOLS).join(',');
  // NB: --bare was dropped 2026-05-20. It restricts auth to
  // ANTHROPIC_API_KEY only (OAuth / keychain are never read), which
  // broke Max-subscription users with no API key. Trade-off: each
  // subprocess now runs hooks / LSP / plugin sync / auto-memory /
  // CLAUDE.md auto-discovery. Future opt-in fast path: re-enable
  // --bare when ANTHROPIC_API_KEY is set in the env.
  const args: string[] = [
    '-p',
    '--permission-mode',
    opts.permissionMode ?? 'dontAsk',
    '--allowedTools',
    allowed,
    '--output-format',
    opts.outputFormat ?? 'json',
    '--max-turns',
    String(opts.maxTurns ?? DEFAULT_MAX_TURNS),
  ];
  if (opts.extraArgs && opts.extraArgs.length > 0) {
    args.push(...opts.extraArgs);
  }
  args.push(prompt);
  return args;
}

/**
 * Build the env passed to `claude -p`. Strips `CLAUDECODE` so the
 * subprocess doesn't trigger the anti-reentrance gate that makes
 * nested `claude` invocations return `{is_error: true, result: "Not
 * logged in..."}`. Empirically verified 2026-05-20: only `CLAUDECODE`
 * is the gate; sibling `CLAUDE_CODE_*` vars are not, so we leave them
 * for the subprocess's own telemetry / call-source signal.
 */
export function buildSpawnEnv(
  parentEnv: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...parentEnv };
  delete env.CLAUDECODE;
  return env;
}

/**
 * True when `claude -p --output-format json` returned a payload whose
 * `is_error` field is true (auth failure, quota, refusal, etc.). The
 * process still exits 0 in these cases, so callers can't rely on
 * exit code alone.
 */
export function isClaudeJsonError(parsed: unknown): boolean {
  return (
    typeof parsed === 'object' &&
    parsed !== null &&
    'is_error' in parsed &&
    (parsed as { is_error?: unknown }).is_error === true
  );
}

/** Best-effort one-line description of a claude JSON error payload. */
export function describeClaudeError(parsed: unknown): string {
  if (typeof parsed !== 'object' || parsed === null) return '(unknown shape)';
  const p = parsed as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof p.result === 'string') parts.push(p.result);
  if (typeof p.subtype === 'string' && p.subtype !== 'success') {
    parts.push(`subtype=${p.subtype}`);
  }
  if (typeof p.stop_reason === 'string') {
    parts.push(`stop=${p.stop_reason}`);
  }
  return parts.length > 0 ? parts.join(' | ') : '(no result text)';
}

/**
 * Live impl that spawns `claude -p`. Untestable without a real Claude
 * binary + auth; covered by an env-gated `LIVE_LLM=1` smoke test only.
 */
export class ClaudeCliClient implements LlmClient {
  constructor(private readonly claudePath: string = 'claude') {}

  async invoke(
    prompt: string,
    opts: LlmInvokeOptions,
  ): Promise<LlmInvokeResult> {
    const args = buildClaudeArgs(prompt, opts);
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const start = Date.now();

    return new Promise<LlmInvokeResult>((resolve, reject) => {
      const child = spawn(this.claudePath, args, {
        cwd: opts.cwd,
        env: buildSpawnEnv(process.env),
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (b: Buffer) => (stdout += b.toString('utf-8')));
      child.stderr.on('data', (b: Buffer) => (stderr += b.toString('utf-8')));

      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(
          new LlmInvokeError(
            `claude -p timed out after ${timeoutMs}ms (cwd=${opts.cwd})`,
          ),
        );
      }, timeoutMs);

      child.on('error', (err) => {
        clearTimeout(timer);
        reject(new LlmInvokeError(`failed to spawn ${this.claudePath}`, err));
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        const exitCode = code ?? 0;
        let parsed: unknown;
        if ((opts.outputFormat ?? 'json') === 'json') {
          try {
            parsed = JSON.parse(stdout);
          } catch {
            // leave parsed undefined; caller can decide whether that's fatal
          }
        }
        // claude -p signals semantic errors (auth, quota, refusals) via
        // is_error=true inside the JSON payload while still exiting 0.
        // Surface those as LlmInvokeError so callers don't see false-green.
        if (isClaudeJsonError(parsed)) {
          reject(
            new LlmInvokeError(
              `claude -p returned semantic error: ${describeClaudeError(parsed)}`,
            ),
          );
          return;
        }
        resolve({
          exitCode,
          stdout,
          stderr,
          parsed,
          durationMs: Date.now() - start,
        });
      });
    });
  }
}

/**
 * Scripted client for tests. Each invoke() consumes the next entry in
 * `responses`. Functions receive (prompt, opts) so tests can assert on
 * what the orchestrator sent.
 */
export type FakeResponse =
  | LlmInvokeResult
  | ((prompt: string, opts: LlmInvokeOptions) => LlmInvokeResult);

export class FakeLlmClient implements LlmClient {
  private queue: FakeResponse[];
  public readonly calls: Array<{ prompt: string; opts: LlmInvokeOptions }> = [];

  constructor(responses: FakeResponse[] = []) {
    this.queue = [...responses];
  }

  enqueue(r: FakeResponse): void {
    this.queue.push(r);
  }

  async invoke(
    prompt: string,
    opts: LlmInvokeOptions,
  ): Promise<LlmInvokeResult> {
    this.calls.push({ prompt, opts });
    const next = this.queue.shift();
    if (next === undefined) {
      throw new LlmInvokeError(
        `FakeLlmClient: invoke() called ${this.calls.length} times but only ${this.calls.length - 1} responses enqueued`,
      );
    }
    return typeof next === 'function' ? next(prompt, opts) : next;
  }
}
