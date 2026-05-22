import { afterEach, describe, expect, it, vi } from 'vitest';
import { composeLabel, startLiveProjector } from './live-projector.js';
import type { StreamEvent } from './llm-stream-parser.js';
import type { TaskProgressHandle } from './run-feature.js';

describe('composeLabel', () => {
  it('returns currentPhase + elapsed when prefix empty', () => {
    expect(composeLabel('', '🧠 Claude', ' (3s)')).toBe('🧠 Claude (3s)');
  });

  it('prepends "${prefix} | " when prefix is non-empty', () => {
    expect(composeLabel('⚠️  verify-ralph #2/3', '🔧 Bash(pnpm test)', ' (4s)')).toBe(
      '⚠️  verify-ralph #2/3 | 🔧 Bash(pnpm test) (4s)',
    );
  });
});

interface FakeProgressHandle extends TaskProgressHandle {
  updates: string[];
  heartbeats: string[];
}

function makeProgress(): FakeProgressHandle {
  const updates: string[] = [];
  const heartbeats: string[] = [];
  return {
    updates,
    heartbeats,
    update: (s) => updates.push(s),
    heartbeat: (s) => heartbeats.push(s),
    finish: () => undefined,
  };
}

describe('startLiveProjector', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders initial phase + (0s) on construction', () => {
    const p = makeProgress();
    const proj = startLiveProjector(p, '🧠 Claude');
    expect(p.updates).toHaveLength(1);
    expect(p.updates[0]).toMatch(/^🧠 Claude \(\d+s\)$/);
    proj.stop();
  });

  it('returns no-op projector when progress is undefined', () => {
    const proj = startLiveProjector(undefined, '🧠 Claude');
    expect(() => proj.onEvent({ type: 'system', subtype: 'init' } as StreamEvent)).not.toThrow();
    expect(() => proj.setPrefix('x')).not.toThrow();
    proj.stop();
  });

  it('phase event overwrites currentPhase; render uses new phrase', () => {
    const p = makeProgress();
    const proj = startLiveProjector(p, '🧠 Claude');
    proj.onEvent({
      type: 'assistant',
      message: {
        content: [{ type: 'tool_use', name: 'Bash', input: { command: 'ls' } }],
      },
    } as StreamEvent);
    expect(p.updates.at(-1)).toMatch(/^🔧 Bash\(ls\) \(\d+s\)$/);
    proj.stop();
  });

  it('setPrefix prepends prefix to every render', () => {
    const p = makeProgress();
    const proj = startLiveProjector(p, '🧠 Claude');
    proj.setPrefix('⚠️  verify-ralph #1/3');
    expect(p.updates.at(-1)).toMatch(/^⚠️ {2}verify-ralph #1\/3 \| 🧠 Claude \(\d+s\)$/);
    // Phase change preserves the prefix.
    proj.onEvent({
      type: 'assistant',
      message: { content: [{ type: 'thinking', thinking: 'plan' }] },
    } as StreamEvent);
    expect(p.updates.at(-1)).toMatch(/^⚠️ {2}verify-ralph #1\/3 \| 💭 思考中 \(\d+s\)$/);
    proj.stop();
  });

  it('setPrefix("") clears prefix', () => {
    const p = makeProgress();
    const proj = startLiveProjector(p, '🧠 Claude');
    proj.setPrefix('PREFIX');
    proj.setPrefix('');
    expect(p.updates.at(-1)).toMatch(/^🧠 Claude \(\d+s\)$/);
    proj.stop();
  });

  it('heartbeat composes prefix + phase + elapsed + heartbeat phrase', () => {
    const p = makeProgress();
    const proj = startLiveProjector(p, '🧠 Claude');
    proj.setPrefix('🩹 orphan-ralph #1/2');
    proj.onEvent({
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        delta: { type: 'thinking_delta', thinking: 'pondering' },
      },
    } as StreamEvent);
    expect(p.heartbeats).toHaveLength(1);
    expect(p.heartbeats[0]).toMatch(/^🩹 orphan-ralph #1\/2 \| 🧠 Claude \(\d+s\) \| .*pondering$/);
    proj.stop();
  });

  it('stop() halts the periodic ticker', () => {
    vi.useFakeTimers();
    const p = makeProgress();
    const proj = startLiveProjector(p, '🧠 Claude');
    const initialCount = p.updates.length;
    proj.stop();
    vi.advanceTimersByTime(60_000);
    expect(p.updates.length).toBe(initialCount);
  });
});
