import { describe, expect, it } from 'vitest';
import {
  parseEventLine,
  phraseFor,
  StreamAggregator,
  type StreamEvent,
} from './llm-stream-parser.js';

describe('parseEventLine', () => {
  it('parses a valid system.init event', () => {
    const line = JSON.stringify({
      type: 'system',
      subtype: 'init',
      model: 'claude-sonnet-4-6',
      session_id: 'abc',
    });
    const e = parseEventLine(line);
    expect(e).not.toBeNull();
    expect(e!.type).toBe('system');
  });

  it('returns null on empty line', () => {
    expect(parseEventLine('')).toBeNull();
    expect(parseEventLine('   ')).toBeNull();
  });

  it('returns null (does not throw) on malformed JSON', () => {
    expect(parseEventLine('{not json')).toBeNull();
    expect(parseEventLine('null')).toBeNull();
    expect(parseEventLine('42')).toBeNull();
  });

  it('returns null when object has no .type string field', () => {
    expect(parseEventLine('{"foo":"bar"}')).toBeNull();
    expect(parseEventLine('{"type":123}')).toBeNull();
  });
});

describe('phraseFor (pure mapping)', () => {
  it('maps system.init to model phase', () => {
    const e = {
      type: 'system',
      subtype: 'init',
      model: 'claude-sonnet-4-6',
    } as StreamEvent;
    expect(phraseFor(e)).toEqual({
      phrase: '🧠 Claude (model=claude-sonnet-4-6)',
      channel: 'phase',
    });
  });

  it('ignores system.status / hook events', () => {
    expect(
      phraseFor({ type: 'system', subtype: 'status' } as StreamEvent),
    ).toBeNull();
    expect(
      phraseFor({ type: 'system', subtype: 'hook_started' } as StreamEvent),
    ).toBeNull();
  });

  it('maps assistant.thinking block to "💭 思考中"', () => {
    const e = {
      type: 'assistant',
      message: { content: [{ type: 'thinking', thinking: '...' }] },
    } as StreamEvent;
    expect(phraseFor(e)).toEqual({ phrase: '💭 思考中', channel: 'phase' });
  });

  it('maps assistant.tool_use Bash with command preview', () => {
    const e = {
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', name: 'Bash', input: { command: 'ls /tmp' } },
        ],
      },
    } as StreamEvent;
    expect(phraseFor(e)).toEqual({
      phrase: '🔧 Bash(ls /tmp)',
      channel: 'phase',
    });
  });

  it('maps assistant.tool_use Read with file_path', () => {
    const e = {
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            name: 'Read',
            input: { file_path: '/abs/long/path/to/file.ts' },
          },
        ],
      },
    } as StreamEvent;
    expect(phraseFor(e)?.phrase).toBe('🔧 Read(/abs/long/path/to/file.ts)');
  });

  it('truncates long tool args', () => {
    const longCmd = 'echo ' + 'a'.repeat(80);
    const e = {
      type: 'assistant',
      message: {
        content: [{ type: 'tool_use', name: 'Bash', input: { command: longCmd } }],
      },
    } as StreamEvent;
    const out = phraseFor(e)!;
    expect(out.phrase.length).toBeLessThan(60);
    expect(out.phrase).toContain('…');
  });

  it('maps assistant.text to "✍️ 回复"', () => {
    const e = {
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'done' }] },
    } as StreamEvent;
    expect(phraseFor(e)).toEqual({ phrase: '✍️ 回复', channel: 'phase' });
  });

  it('maps user.tool_result ok / error', () => {
    const ok = {
      type: 'user',
      message: {
        content: [{ type: 'tool_result', tool_use_id: 'x', is_error: false }],
      },
    } as StreamEvent;
    const err = {
      type: 'user',
      message: {
        content: [{ type: 'tool_result', tool_use_id: 'x', is_error: true }],
      },
    } as StreamEvent;
    expect(phraseFor(ok)?.phrase).toBe('🔁 tool ok');
    expect(phraseFor(err)?.phrase).toBe('🔁 tool failed');
  });

  it('maps stream_event.thinking_delta to heartbeat with tail', () => {
    const e = {
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        delta: { type: 'thinking_delta', thinking: 'a'.repeat(100) },
      },
    } as StreamEvent;
    const out = phraseFor(e);
    expect(out?.channel).toBe('heartbeat');
    expect(out?.phrase.startsWith('…')).toBe(true);
  });

  it('returns null for stream_event.message_start / message_stop / content_block_stop', () => {
    expect(
      phraseFor({
        type: 'stream_event',
        event: { type: 'message_start', message: {} },
      } as StreamEvent),
    ).toBeNull();
    expect(
      phraseFor({
        type: 'stream_event',
        event: { type: 'message_stop' },
      } as StreamEvent),
    ).toBeNull();
    expect(
      phraseFor({
        type: 'stream_event',
        event: { type: 'content_block_stop' },
      } as StreamEvent),
    ).toBeNull();
  });

  it('ignores result / rate_limit_event', () => {
    expect(
      phraseFor({
        type: 'result',
        subtype: 'success',
        is_error: false,
      } as StreamEvent),
    ).toBeNull();
    expect(
      phraseFor({ type: 'rate_limit_event' } as StreamEvent),
    ).toBeNull();
  });
});

describe('StreamAggregator', () => {
  it('records turns across message_start → message_delta → message_stop sequence', () => {
    const agg = new StreamAggregator();
    agg.feed({
      type: 'stream_event',
      event: {
        type: 'message_start',
        message: {
          usage: {
            input_tokens: 3,
            cache_read_input_tokens: 100,
            cache_creation_input_tokens: 5,
          },
        },
      },
    } as StreamEvent);
    agg.feed({
      type: 'stream_event',
      event: {
        type: 'message_delta',
        delta: { stop_reason: 'tool_use' },
        usage: { output_tokens: 50 },
      },
    } as StreamEvent);
    agg.feed({
      type: 'stream_event',
      event: { type: 'message_stop' },
    } as StreamEvent);

    const { turns } = agg.finalize();
    expect(turns).toHaveLength(1);
    expect(turns[0]).toEqual({
      input_tokens: 3,
      cache_read_input_tokens: 100,
      cache_creation_input_tokens: 5,
      stop_reason: 'tool_use',
      output_tokens: 50,
    });
  });

  it('records multiple turns for multi-turn task', () => {
    const agg = new StreamAggregator();
    const cycle = (stop: string) => {
      agg.feed({
        type: 'stream_event',
        event: { type: 'message_start', message: { usage: {} } },
      } as StreamEvent);
      agg.feed({
        type: 'stream_event',
        event: {
          type: 'message_delta',
          delta: { stop_reason: stop },
          usage: { output_tokens: 1 },
        },
      } as StreamEvent);
      agg.feed({
        type: 'stream_event',
        event: { type: 'message_stop' },
      } as StreamEvent);
    };
    cycle('tool_use');
    cycle('tool_use');
    cycle('end_turn');
    const { turns } = agg.finalize();
    expect(turns.map((t) => t.stop_reason)).toEqual([
      'tool_use',
      'tool_use',
      'end_turn',
    ]);
  });

  it('handles message_delta without prior message_start (defensive)', () => {
    const agg = new StreamAggregator();
    agg.feed({
      type: 'stream_event',
      event: {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn' },
      },
    } as StreamEvent);
    agg.feed({
      type: 'stream_event',
      event: { type: 'message_stop' },
    } as StreamEvent);
    const { turns } = agg.finalize();
    expect(turns).toHaveLength(1);
    expect(turns[0].stop_reason).toBe('end_turn');
  });

  it('captures the result event for terminal extraction', () => {
    const agg = new StreamAggregator();
    agg.feed({
      type: 'result',
      subtype: 'success',
      is_error: false,
      num_turns: 5,
      total_cost_usd: 0.05,
      permission_denials: [],
    } as StreamEvent);
    const { result } = agg.finalize();
    expect(result?.type).toBe('result');
    expect(result?.num_turns).toBe(5);
    expect(result?.is_error).toBe(false);
  });

  it('finalize returns undefined result when stream had no result event', () => {
    const agg = new StreamAggregator();
    agg.feed({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'partial' }] },
    } as StreamEvent);
    expect(agg.finalize().result).toBeUndefined();
  });

  it('finalize reports apiRounds (== turns.length) and userTurns (= tool_results + 1)', () => {
    const agg = new StreamAggregator();
    const apiRound = (stop: string) => {
      agg.feed({
        type: 'stream_event',
        event: { type: 'message_start', message: { usage: {} } },
      } as StreamEvent);
      agg.feed({
        type: 'stream_event',
        event: { type: 'message_delta', delta: { stop_reason: stop } },
      } as StreamEvent);
      agg.feed({
        type: 'stream_event',
        event: { type: 'message_stop' },
      } as StreamEvent);
    };
    const toolResult = () => {
      agg.feed({
        type: 'user',
        message: {
          content: [{ type: 'tool_result', tool_use_id: 'x', is_error: false }],
        },
      } as StreamEvent);
    };
    // Simulate: 2 API rounds where the first batched 3 tool_use → 3 tool_results.
    apiRound('tool_use');
    toolResult();
    toolResult();
    toolResult();
    apiRound('end_turn');

    const { apiRounds, userTurns, turns } = agg.finalize();
    expect(turns).toHaveLength(2);
    expect(apiRounds).toBe(2);
    // 1 initial prompt + 3 tool_result echoes = 4 user-side iterations.
    expect(userTurns).toBe(4);
  });

  it('finalize reports 0/0 when no events fed at all', () => {
    const agg = new StreamAggregator();
    const { apiRounds, userTurns, turns } = agg.finalize();
    expect(turns).toEqual([]);
    expect(apiRounds).toBe(0);
    expect(userTurns).toBe(0);
  });

  it('finalize reports userTurns=1 when stream had only system.init (no tool calls)', () => {
    const agg = new StreamAggregator();
    agg.feed({
      type: 'system',
      subtype: 'init',
      model: 'sonnet',
    } as StreamEvent);
    const { userTurns, apiRounds } = agg.finalize();
    expect(userTurns).toBe(1);
    expect(apiRounds).toBe(0);
  });

  it('ignores user events that are not tool_result (defensive)', () => {
    const agg = new StreamAggregator();
    agg.feed({
      type: 'system',
      subtype: 'init',
      model: 'sonnet',
    } as StreamEvent);
    // Hypothetical user event with no tool_result content — should not bump.
    agg.feed({
      type: 'user',
      message: { content: [{ type: 'text', text: 'noise' }] as never },
    } as StreamEvent);
    expect(agg.finalize().userTurns).toBe(1);
  });

  it('feed() returns phrase output (combines mapping + state)', () => {
    const agg = new StreamAggregator();
    const out = agg.feed({
      type: 'system',
      subtype: 'init',
      model: 'sonnet',
    } as StreamEvent);
    expect(out?.phrase).toBe('🧠 Claude (model=sonnet)');
    expect(out?.channel).toBe('phase');
  });
});

describe('end-to-end: feed spike NDJSON sample', () => {
  it('extracts a coherent phase timeline from a 2-turn task', () => {
    // Minimal hand-curated sample matching the shape seen in
    // /tmp/orch-spike/out.jsonl (32 events for "ls /tmp + done" task).
    const sample = [
      { type: 'system', subtype: 'init', model: 'claude-sonnet-4-6' },
      {
        type: 'stream_event',
        event: { type: 'message_start', message: { usage: { input_tokens: 3 } } },
      },
      {
        type: 'assistant',
        message: { content: [{ type: 'thinking', thinking: 'plan' }] },
      },
      {
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', name: 'Bash', input: { command: 'ls /tmp' } },
          ],
        },
      },
      {
        type: 'stream_event',
        event: {
          type: 'message_delta',
          delta: { stop_reason: 'tool_use' },
          usage: { output_tokens: 10 },
        },
      },
      { type: 'stream_event', event: { type: 'message_stop' } },
      {
        type: 'user',
        message: {
          content: [
            { type: 'tool_result', tool_use_id: 'x', is_error: false },
          ],
        },
      },
      {
        type: 'stream_event',
        event: { type: 'message_start', message: { usage: { input_tokens: 1 } } },
      },
      {
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'done' }] },
      },
      {
        type: 'stream_event',
        event: {
          type: 'message_delta',
          delta: { stop_reason: 'end_turn' },
          usage: { output_tokens: 4 },
        },
      },
      { type: 'stream_event', event: { type: 'message_stop' } },
      {
        type: 'result',
        subtype: 'success',
        is_error: false,
        num_turns: 2,
        total_cost_usd: 0.048,
        permission_denials: [],
      },
    ];

    const agg = new StreamAggregator();
    const phases: string[] = [];
    for (const e of sample) {
      const out = agg.feed(e as StreamEvent);
      if (out && out.channel === 'phase') phases.push(out.phrase);
    }
    const { result, turns } = agg.finalize();

    expect(phases).toEqual([
      '🧠 Claude (model=claude-sonnet-4-6)',
      '💭 思考中',
      '🔧 Bash(ls /tmp)',
      '🔁 tool ok',
      '✍️ 回复',
    ]);
    expect(turns).toHaveLength(2);
    expect(turns.map((t) => t.stop_reason)).toEqual(['tool_use', 'end_turn']);
    expect(result?.num_turns).toBe(2);
  });
});
