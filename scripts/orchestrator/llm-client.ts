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

const DEFAULT_MAX_TURNS = 5;
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Build the argv vector for the live `claude -p` invocation. Exported
 * so tests can assert flag composition without spawning a subprocess.
 */
export function buildClaudeArgs(
  prompt: string,
  opts: LlmInvokeOptions,
): string[] {
  const allowed = (opts.allowedTools ?? DEFAULT_ALLOWED_TOOLS).join(',');
  const args: string[] = [
    '-p',
    '--bare',
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
        env: process.env,
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
