/**
 * Pure NDJSON parser + aggregator for `claude -p --output-format stream-json`.
 *
 * claude-cli emits one JSON event per line. Event shapes were spike-verified
 * 2026-05-21 against claude-cli 2.1.145. See docs/plans/jazzy-pondering-ripple.md.
 *
 * The aggregator is the single source of truth for what callers used to read
 * from `JSON.parse(stdout)` (final `result` event) PLUS the new per-turn
 * diagnostic table (every `stream_event.message_delta` accumulated into a
 * turns[] array).
 */

/** Heartbeat tail length for thinking_delta / text_delta UI projection. */
const HEARTBEAT_TAIL_CHARS = 60;

/** Truncation length for tool-arg inline preview (Bash command / file path). */
const TOOL_ARG_PREVIEW_CHARS = 40;

/** Discriminated event types emitted by claude-cli stream-json. */
export type StreamEvent =
  | SystemEvent
  | AssistantEvent
  | UserEvent
  | StreamSubEvent
  | RateLimitEvent
  | ResultEvent
  | UnknownEvent;

export interface SystemEvent {
  type: 'system';
  subtype: 'init' | 'status' | 'hook_started' | 'hook_response' | string;
  model?: string;
  mcp_servers?: Array<{ name: string }>;
  tools?: string[];
  permissionMode?: string;
  [k: string]: unknown;
}

export interface AssistantEvent {
  type: 'assistant';
  message: {
    content: Array<AssistantContentBlock>;
    [k: string]: unknown;
  };
  [k: string]: unknown;
}

export type AssistantContentBlock =
  | { type: 'thinking'; thinking?: string }
  | { type: 'tool_use'; name: string; input?: Record<string, unknown> }
  | { type: 'text'; text?: string };

export interface UserEvent {
  type: 'user';
  message: {
    content: Array<{
      type: 'tool_result';
      tool_use_id: string;
      content?: unknown;
      is_error?: boolean;
    }>;
  };
  tool_use_result?: { stdout?: string; stderr?: string; [k: string]: unknown };
  [k: string]: unknown;
}

/** Wrapper around Anthropic Messages API streaming events. */
export interface StreamSubEvent {
  type: 'stream_event';
  event: AnthropicStreamEvent;
  [k: string]: unknown;
}

export type AnthropicStreamEvent =
  | { type: 'message_start'; message: { usage?: PerTurnUsage; [k: string]: unknown } }
  | { type: 'content_block_start'; content_block: { type: string; [k: string]: unknown } }
  | {
      type: 'content_block_delta';
      delta:
        | { type: 'thinking_delta'; thinking: string }
        | { type: 'text_delta'; text: string }
        | { type: 'input_json_delta'; partial_json: string }
        | { type: 'signature_delta'; [k: string]: unknown };
    }
  | { type: 'content_block_stop' }
  | { type: 'message_delta'; delta: { stop_reason?: string }; usage?: { output_tokens?: number } }
  | { type: 'message_stop' };

export interface PerTurnUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

export interface RateLimitEvent {
  type: 'rate_limit_event';
  rate_limit_info?: unknown;
  [k: string]: unknown;
}

export interface ResultEvent {
  type: 'result';
  subtype: 'success' | string;
  is_error: boolean;
  num_turns?: number;
  total_cost_usd?: number;
  duration_ms?: number;
  permission_denials?: unknown[];
  stop_reason?: string;
  terminal_reason?: string;
  usage?: PerTurnUsage;
  modelUsage?: Record<string, unknown>;
  result?: string;
  [k: string]: unknown;
}

/** Fallthrough so callers can ignore unknown event shapes safely. */
export interface UnknownEvent {
  type: string;
  [k: string]: unknown;
}

/** Per-turn diagnostic row written to summary.json `attempts[].llm.turns`. */
export interface TurnMetric {
  stop_reason?: string;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  input_tokens?: number;
}

/** Phrase + channel emitted to UI by the aggregator on feed(). */
export interface PhraseOutput {
  phrase: string;
  /**
   * - `phase`: coarse milestone (assistant block / tool result / system init / result)
   *   — caller may show immediately
   * - `heartbeat`: high-frequency token-level delta — caller should throttle
   */
  channel: 'phase' | 'heartbeat';
}

/**
 * Parse a single NDJSON line. Returns null on JSON.parse failure or empty
 * input — caller is expected to archive the raw line either way.
 *
 * Time complexity: O(n) where n = line length.
 */
export function parseEventLine(line: string): StreamEvent | null {
  const trimmed = line.trim();
  if (trimmed === '') return null;
  let v: unknown;
  try {
    v = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.type !== 'string') return null;
  return o as StreamEvent;
}

/**
 * Stateful aggregator. Two responsibilities:
 *  1. Per-event → optional UI phrase output (for live progress projection).
 *  2. Cumulative state → final `result` event + per-turn metrics array
 *     (replaces the old `JSON.parse(stdout)` single-blob path).
 *
 * Time complexity per feed(): O(1). Memory: O(api_rounds) for turns[].
 *
 * Two distinct "turn" counts surface in finalize():
 *
 * - `apiRounds` = count of Anthropic Messages API rounds (== turns[].length;
 *   one per `stream_event.message_stop`). An assistant message may batch
 *   multiple `tool_use` blocks, so one API round can issue multiple tool calls.
 *
 * - `userTurns` = count of agent-loop iterations from the user-prompt side
 *   (= 1 initial prompt + N `user.tool_result` events). Empirically matches
 *   the result event's `num_turns` field on claude-cli 2.1.x (T032 2026-05-21:
 *   39 tool_use blocks → 39 user tool_result echoes + 1 initial = 40 == num_turns).
 *
 * The two diverge when one assistant round emits multiple tool_use blocks:
 * apiRounds counts the round once, userTurns counts each tool_result echo.
 */
export class StreamAggregator {
  private result: ResultEvent | undefined;
  private turns: TurnMetric[] = [];
  /** Buffer for the currently-streaming turn; flushed on message_delta / message_stop. */
  private currentTurn: TurnMetric | null = null;
  /** Count of `user` top-level events carrying a `tool_result` content block. */
  private toolResultCount = 0;
  /** Flips true on the first feed() so we know to add 1 (initial prompt) to userTurns. */
  private sawAnyEvent = false;

  feed(e: StreamEvent): PhraseOutput | null {
    this.recordState(e);
    return phraseFor(e);
  }

  finalize(): {
    result?: ResultEvent;
    turns: TurnMetric[];
    apiRounds: number;
    userTurns: number;
  } {
    return {
      result: this.result,
      turns: this.turns,
      apiRounds: this.turns.length,
      userTurns: this.sawAnyEvent ? this.toolResultCount + 1 : 0,
    };
  }

  private recordState(e: StreamEvent): void {
    this.sawAnyEvent = true;
    if (e.type === 'result') {
      this.result = e as ResultEvent;
      return;
    }
    if (e.type === 'user') {
      const first = (e as UserEvent).message?.content?.[0];
      if (first && first.type === 'tool_result') this.toolResultCount++;
      return;
    }
    if (e.type !== 'stream_event') return;
    const sub = (e as StreamSubEvent).event;
    if (sub.type === 'message_start') {
      const u = sub.message?.usage;
      this.currentTurn = {
        input_tokens: u?.input_tokens,
        cache_read_input_tokens: u?.cache_read_input_tokens,
        cache_creation_input_tokens: u?.cache_creation_input_tokens,
      };
      return;
    }
    if (sub.type === 'message_delta') {
      if (!this.currentTurn) this.currentTurn = {};
      if (sub.delta?.stop_reason) this.currentTurn.stop_reason = sub.delta.stop_reason;
      if (typeof sub.usage?.output_tokens === 'number') {
        this.currentTurn.output_tokens = sub.usage.output_tokens;
      }
      return;
    }
    if (sub.type === 'message_stop') {
      if (this.currentTurn) {
        this.turns.push(this.currentTurn);
        this.currentTurn = null;
      }
    }
  }
}

/**
 * Pure event → phrase mapping. No state.
 *
 * Returns null for events that shouldn't reach the UI (rate_limit, message_stop,
 * content_block_stop, hook events, result). Caller decides per-channel throttling.
 */
export function phraseFor(e: StreamEvent): PhraseOutput | null {
  if (e.type === 'system') return phraseForSystem(e as SystemEvent);
  if (e.type === 'assistant') return phraseForAssistant(e as AssistantEvent);
  if (e.type === 'user') return phraseForUser(e as UserEvent);
  if (e.type === 'stream_event') return phraseForStreamSub((e as StreamSubEvent).event);
  return null;
}

function phraseForSystem(e: SystemEvent): PhraseOutput | null {
  if (e.subtype === 'init') {
    const model = typeof e.model === 'string' ? e.model : 'claude';
    return { phrase: `🧠 Claude (model=${model})`, channel: 'phase' };
  }
  return null;
}

function phraseForAssistant(e: AssistantEvent): PhraseOutput | null {
  const blocks = e.message?.content ?? [];
  if (blocks.length === 0) return null;
  const block = blocks[blocks.length - 1];
  if (block.type === 'thinking') {
    return { phrase: '💭 思考中', channel: 'phase' };
  }
  if (block.type === 'tool_use') {
    const arg = previewToolArg(block.input);
    const phrase = arg ? `🔧 ${block.name}(${arg})` : `🔧 ${block.name}`;
    return { phrase, channel: 'phase' };
  }
  if (block.type === 'text') {
    return { phrase: '✍️ 回复', channel: 'phase' };
  }
  return null;
}

function phraseForUser(e: UserEvent): PhraseOutput | null {
  const first = e.message?.content?.[0];
  if (!first || first.type !== 'tool_result') return null;
  return {
    phrase: first.is_error ? '🔁 tool failed' : '🔁 tool ok',
    channel: 'phase',
  };
}

function phraseForStreamSub(e: AnthropicStreamEvent): PhraseOutput | null {
  if (e.type !== 'content_block_delta') return null;
  if (e.delta.type === 'thinking_delta') {
    return { phrase: tail(e.delta.thinking), channel: 'heartbeat' };
  }
  if (e.delta.type === 'text_delta') {
    return { phrase: tail(e.delta.text), channel: 'heartbeat' };
  }
  return null;
}

function previewToolArg(input: Record<string, unknown> | undefined): string {
  if (!input || typeof input !== 'object') return '';
  if (typeof input.command === 'string') {
    return truncate(input.command, TOOL_ARG_PREVIEW_CHARS);
  }
  if (typeof input.file_path === 'string') {
    return truncate(input.file_path, TOOL_ARG_PREVIEW_CHARS);
  }
  if (typeof input.path === 'string') {
    return truncate(input.path, TOOL_ARG_PREVIEW_CHARS);
  }
  if (typeof input.pattern === 'string') {
    return truncate(input.pattern, TOOL_ARG_PREVIEW_CHARS);
  }
  return '';
}

function tail(s: string | undefined): string {
  if (!s) return '';
  const clean = s.replace(/\s+/g, ' ').trim();
  return clean.length <= HEARTBEAT_TAIL_CHARS
    ? clean
    : '…' + clean.slice(-HEARTBEAT_TAIL_CHARS);
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}
