import { spawn } from 'node:child_process';
import * as readline from 'node:readline';
import {
  parseEventLine,
  StreamAggregator,
  type McpServerInfo,
  type StreamEvent,
  type TurnMetric,
} from './llm-stream-parser.js';

/**
 * Port for the LLM call. The live impl shells out to `claude -p
 * --output-format stream-json` and parses the NDJSON event stream; tests
 * inject a FakeLlmClient with a scripted response queue.
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
  /**
   * claude-cli `--model` value (e.g. 'sonnet' / 'opus' / 'haiku' / full model
   * ID). When omitted: `ORCHESTRATOR_MODEL` env var if set, else 'sonnet'.
   * PoC blind spot #17: prior to this orchestrator emitted no --model and
   * defaulted to whatever claude-cli's system-level default was (Opus on
   * Max plan with `/model sonnet` interactive switch — that switch only
   * affects the parent session, not nested subprocesses).
   */
  model?: string;
  /** Hard timeout for the subprocess (ms). */
  timeoutMs?: number;
  /** Permission mode; defaults to 'dontAsk'. */
  permissionMode?: 'dontAsk' | 'plan' | 'default';
  /** Extra args passed verbatim before the prompt argument. Escape hatch. */
  extraArgs?: string[];
  /**
   * Tee raw NDJSON bytes to this sink in real-time (archive llm-stream.jsonl).
   */
  streamStdout?: NodeJS.WritableStream;
  /** Tee stderr to this sink in real-time. */
  streamStderr?: NodeJS.WritableStream;
  /**
   * Optional per-event callback fired once per parsed NDJSON line. Used by
   * run-feature to project phase / heartbeat phrases onto the listr progress
   * sink. Pure observer — does not affect parsing / result extraction.
   */
  onEvent?: (e: StreamEvent) => void;
}

export interface LlmInvokeResult {
  exitCode: number;
  /** Raw NDJSON dump (one event per line) — caller persists to llm-stream.jsonl. */
  stdout: string;
  stderr: string;
  /**
   * Terminal `result` event lifted out of the NDJSON stream. Preserves the
   * exact field shape that `isClaudeJsonError` / `extractClaudeMetrics` /
   * `isClaudeMaxTurnsError` / `describeClaudeError` expected before the
   * stream-json migration (those functions read from this opaque payload).
   */
  parsed?: unknown;
  /** Wall-clock duration in ms. */
  durationMs: number;
  /**
   * Best-effort claude-cli telemetry extracted from `parsed`. Lets the
   * archive layer persist cost / token usage / denial counts.
   */
  metrics?: ClaudeMetrics;
  /**
   * Per-turn diagnostic rows (stop_reason + per-turn token usage). Length
   * equals number of `message_stop` events seen — i.e., `apiRounds` (count
   * of Anthropic Messages API rounds). NOTE: this is NOT identical to the
   * result event's `num_turns` field — see StreamAggregator JSDoc for the
   * semantic distinction (T032 2026-05-21: 27 apiRounds vs 40 num_turns,
   * because one API round can batch multiple tool_use blocks).
   *
   * Populated by StreamAggregator on the live path; absent on test fixtures
   * that don't care. Callers should default to `[]`.
   */
  turns?: TurnMetric[];
  /**
   * Count of Anthropic Messages API rounds (== `turns.length`). Surfaced
   * explicitly so summary readers can sanity-check the parser without
   * inspecting the per-turn array length.
   */
  apiRounds?: number;
  /**
   * Count of agent-loop iterations from the user-prompt side
   * (= 1 initial prompt + N `user.tool_result` events). Independent
   * derivation of what the result event reports as `num_turns`; surfaced
   * for cross-validation when the two diverge.
   */
  userTurns?: number;
  /**
   * MCP servers reported in this subprocess's `system.init` event.
   * Snapshot of `{name, status?}` per server. Undefined when the stream
   * carried no system.init event (test fixtures / partial-message mode off).
   */
  mcpServers?: McpServerInfo[];
}

/** Subset of claude-cli `usage` we care about for archive summaries. */
export interface ClaudeUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
}

export interface ClaudeMetrics {
  cost_usd?: number;
  num_turns?: number;
  /** Count of `permission_denials[]` entries (0 if empty array). */
  permission_denials?: number;
  usage?: ClaudeUsage;
}

export class LlmInvokeError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
    /**
     * claude-cli telemetry recovered from the parsed JSON before reject().
     * Populated when the failure was a semantic error (is_error=true) and
     * the payload could still be parsed — lets the archive layer persist
     * cost / token usage / turn count on the failure path.
     */
    public readonly metrics?: ClaudeMetrics,
    /** Raw parsed JSON payload, for callers that want full fidelity. */
    public readonly parsed?: unknown,
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
// (~15-25 turns including research). T006 (ESLint boundaries for 6 packages)
// hit 30-turn ceiling at $2.25 burn, so 30 is still too tight for some
// research-heavy config tasks. Per-task override via tasks-meta is the
// long-term fix; ORCHESTRATOR_MAX_TURNS env var is the short-term escape
// hatch (set ORCHESTRATOR_MAX_TURNS=50 for one-off retries).
const DEFAULT_MAX_TURNS_FALLBACK = 30;

function getDefaultMaxTurns(): number {
  const env = process.env.ORCHESTRATOR_MAX_TURNS;
  if (env) {
    const n = parseInt(env, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return DEFAULT_MAX_TURNS_FALLBACK;
}

// 2026-05-20 PoC blind spot #17: orchestrator subprocess was inheriting
// the system-level claude-cli default (Opus 4.7 on Max plan) because no
// --model arg was passed. Plan said implementation should run on Sonnet
// but the user's interactive `/model sonnet` switch only affects their
// own session, not nested subprocesses. Default sonnet here so a plain
// invocation matches plan intent; ORCHESTRATOR_MODEL=opus opts back into
// Opus for one-off escalation runs.
const DEFAULT_MODEL_FALLBACK = 'sonnet';

function getDefaultModel(): string {
  return process.env.ORCHESTRATOR_MODEL || DEFAULT_MODEL_FALLBACK;
}

/**
 * Whether to add `--include-partial-messages` to `claude -p`. Default ON
 * — the three unique signals (thinking_delta / per-turn message_delta
 * stop_reason / per-turn message_start usage) are precisely what diagnose
 * "why 16 min / why 31 turn / cache hit %". Set ORCHESTRATOR_PARTIAL_MESSAGES=0
 * to opt out when archive disk is a concern (NDJSON shrinks ~10×).
 */
function partialMessagesEnabled(): boolean {
  return process.env.ORCHESTRATOR_PARTIAL_MESSAGES !== '0';
}
// 2026-05-20 A-002 PoC surfaced blind spot 7: 5min wall-clock is too tight
// when max_turns=30 and each turn takes 10-30s. T001 (Expo workspace bootstrap)
// timed out mid-stream after burning research turns + file writes. Bumped to
// 20min.
//
// 2026-05-27 (p2 §7 F2): 20min is still too tight for greenfield tasks that
// reverse-guess conventions (999 orch run2 T002 timed out at 20min, 0 commits,
// work lost). Mirror getDefaultMaxTurns' escape hatch: ORCHESTRATOR_TIMEOUT_MIN
// env var widens the per-attempt wall-clock (e.g. ORCHESTRATOR_TIMEOUT_MIN=40).
// Per-task override via tasks-meta remains the long-term fix.
const DEFAULT_TIMEOUT_MIN_FALLBACK = 20;

/** Exported for tests (the live use site in `invoke` spawns a real process and
 *  can't be unit-tested). Mirrors getDefaultMaxTurns' env-override pattern. */
export function getDefaultTimeoutMs(): number {
  const env = process.env.ORCHESTRATOR_TIMEOUT_MIN;
  if (env) {
    const n = parseInt(env, 10);
    if (Number.isFinite(n) && n > 0) return n * 60 * 1000;
  }
  return DEFAULT_TIMEOUT_MIN_FALLBACK * 60 * 1000;
}

/**
 * Build the argv vector for the live `claude -p` invocation. Exported
 * so tests can assert flag composition without spawning a subprocess.
 */
export function buildClaudeArgs(prompt: string, opts: LlmInvokeOptions): string[] {
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
    'stream-json',
    '--verbose',
    '--max-turns',
    String(opts.maxTurns ?? getDefaultMaxTurns()),
    '--model',
    opts.model ?? getDefaultModel(),
  ];
  if (partialMessagesEnabled()) {
    args.push('--include-partial-messages');
  }
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
export function buildSpawnEnv(parentEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...parentEnv };
  delete env.CLAUDECODE;
  // F6 (p2 §7): force NX_DAEMON=false for the agent subprocess too, mirroring
  // RealShell (F4). The agent often wants daemon-off determinism for its own
  // `nx build` / `nx test` self-verification (the macOS nx daemon emits
  // spurious TS6059), so it prefixes commands with `NX_DAEMON=false pnpm …` —
  // but the `Bash(pnpm *)` allowedTools entry does NOT match an env-var prefix
  // (`NX_DAEMON=false pnpm …` ≠ a `pnpm` head), so the self-verify gets DENIED
  // (999 v5 run T001: agent's `NX_DAEMON=false pnpm nx build server` denied,
  // denials=1). Injecting it ambiently lets the agent run a plain
  // `pnpm nx build` that is BOTH allowed AND daemon-off — no prefix needed.
  env.NX_DAEMON = 'false';
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

/**
 * Best-effort extraction of cost / usage / denials count from the
 * claude-cli result JSON. Returns undefined when `parsed` doesn't look
 * like a claude payload at all (no known fields). Caller can treat the
 * result as opaque telemetry — every field is optional and partial
 * payloads are tolerated.
 */
export function extractClaudeMetrics(parsed: unknown): ClaudeMetrics | undefined {
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const p = parsed as Record<string, unknown>;

  const metrics: ClaudeMetrics = {};
  let touched = false;

  if (typeof p.total_cost_usd === 'number') {
    metrics.cost_usd = p.total_cost_usd;
    touched = true;
  }
  if (typeof p.num_turns === 'number') {
    metrics.num_turns = p.num_turns;
    touched = true;
  }
  if (Array.isArray(p.permission_denials)) {
    metrics.permission_denials = p.permission_denials.length;
    touched = true;
  }
  if (typeof p.usage === 'object' && p.usage !== null) {
    const u = p.usage as Record<string, unknown>;
    if (
      typeof u.input_tokens === 'number' &&
      typeof u.output_tokens === 'number' &&
      typeof u.cache_read_input_tokens === 'number' &&
      typeof u.cache_creation_input_tokens === 'number'
    ) {
      metrics.usage = {
        input_tokens: u.input_tokens,
        output_tokens: u.output_tokens,
        cache_read_input_tokens: u.cache_read_input_tokens,
        cache_creation_input_tokens: u.cache_creation_input_tokens,
      };
      touched = true;
    }
  }

  return touched ? metrics : undefined;
}

/**
 * True when `err` is an LlmInvokeError carrying a parsed claude JSON
 * with `subtype: 'error_max_turns'`. Used by run-feature to decide
 * whether to escalate to Opus (PoC blind spot #18).
 */
export function isClaudeMaxTurnsError(err: unknown): err is LlmInvokeError {
  if (!(err instanceof LlmInvokeError)) return false;
  const p = err.parsed;
  if (typeof p !== 'object' || p === null) return false;
  return (p as { subtype?: unknown }).subtype === 'error_max_turns';
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
  constructor(private readonly claudePath = 'claude') {}

  async invoke(prompt: string, opts: LlmInvokeOptions): Promise<LlmInvokeResult> {
    const args = buildClaudeArgs(prompt, opts);
    const timeoutMs = opts.timeoutMs ?? getDefaultTimeoutMs();
    const start = Date.now();

    return new Promise<LlmInvokeResult>((resolve, reject) => {
      const child = spawn(this.claudePath, args, {
        cwd: opts.cwd,
        env: buildSpawnEnv(process.env),
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const agg = new StreamAggregator();
      let stdout = '';
      let stderr = '';

      const rl = readline.createInterface({
        input: child.stdout,
        crlfDelay: Infinity,
      });
      rl.on('line', (line: string) => {
        // 1. Physical archive: stream raw line + newline so the .jsonl
        //    file is parseable by jq / vitest fixtures verbatim.
        stdout += line + '\n';
        if (opts.streamStdout) opts.streamStdout.write(line + '\n');
        // 2. Logical aggregation: parse → feed aggregator + fire observer.
        //    Malformed lines (parseEventLine returns null) are silently
        //    archived; we don't crash on schema drift.
        const event = parseEventLine(line);
        if (!event) return;
        agg.feed(event);
        if (opts.onEvent) {
          try {
            opts.onEvent(event);
          } catch {
            // Observer must not break the LLM call; swallow.
          }
        }
      });

      child.stderr.on('data', (b: Buffer) => {
        stderr += b.toString('utf-8');
        if (opts.streamStderr) opts.streamStderr.write(b);
      });

      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new LlmInvokeError(`claude -p timed out after ${timeoutMs}ms (cwd=${opts.cwd})`));
      }, timeoutMs);

      child.on('error', (err) => {
        clearTimeout(timer);
        reject(new LlmInvokeError(`failed to spawn ${this.claudePath}`, err));
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        rl.close();
        const exitCode = code ?? 0;
        const { result, turns, apiRounds, userTurns, mcpServers } = agg.finalize();
        const parsed: unknown = result;
        // claude -p signals semantic errors (auth, quota, refusals) via
        // is_error=true in the terminal `result` event while still exiting 0.
        // Surface those as LlmInvokeError so callers don't see false-green.
        if (isClaudeJsonError(parsed)) {
          // PoC blind spot #15: even on semantic error the result event
          // carries total_cost_usd / num_turns / usage. Attach metrics +
          // turns so the archive layer can persist them on the failure path.
          reject(
            new LlmInvokeError(
              `claude -p returned semantic error: ${describeClaudeError(parsed)}`,
              undefined,
              extractClaudeMetrics(parsed),
              parsed,
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
          metrics: extractClaudeMetrics(parsed),
          turns,
          apiRounds: apiRounds > 0 ? apiRounds : undefined,
          userTurns: userTurns > 0 ? userTurns : undefined,
          mcpServers,
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

  async invoke(prompt: string, opts: LlmInvokeOptions): Promise<LlmInvokeResult> {
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
