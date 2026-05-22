import { phraseFor, type StreamEvent } from './llm-stream-parser.js';
import type { TaskProgressHandle } from './run-feature.js';

/**
 * Live projector: unified phase narration + heartbeat + elapsed-timer ticker.
 *
 * Owns the listr task row for the LLM phase: phrases come from claude-cli
 * NDJSON events (via `onEvent`), elapsed seconds get suffixed, heartbeat
 * (thinking_delta / text_delta) is throttled and rendered into a second
 * TTY-only line.
 *
 * `setPrefix` lets the caller annotate the row with a persistent prefix
 * (e.g. `"⚠️  verify-ralph #2/3"`) while the inner LLM stream still narrates
 * phase / heartbeat phrases — used by ralph-loop / orphan-ralph wiring to
 * surface retry context without abandoning the main task row.
 *
 * Channels:
 *  - `phase` events → updates currentPhase + stderr-logged via progress.update
 *    on actual phase change (dedup gated downstream by phaseKey strip).
 *  - `heartbeat` events → 500ms throttle, appended as `${label} | ${tail}`,
 *    written to TTY only via progress.heartbeat? (no stderr noise).
 *  - Background ticker: 1s TTY / 15s non-TTY, refreshes `${label}` so users
 *    see "still alive" between events (LLM thinking with no deltas).
 */
const HEARTBEAT_THROTTLE_MS = 500;

export interface LiveProjector {
  onEvent(e: StreamEvent): void;
  stop(): void;
  /**
   * Set a persistent prefix prepended to every render
   * (e.g. "⚠️  verify-ralph #2/3"). Pass empty string to clear.
   */
  setPrefix(prefix: string): void;
}

/**
 * Compose the label for a render.
 * - no prefix: `${currentPhase}${elapsed}`
 * - with prefix: `${prefix} | ${currentPhase}${elapsed}`
 * Heartbeat appends ` | ${heartbeatPhrase}` to whichever of the above ran.
 *
 * Exported for unit testability.
 */
export function composeLabel(prefix: string, currentPhase: string, elapsedSuffix: string): string {
  return prefix ? `${prefix} | ${currentPhase}${elapsedSuffix}` : `${currentPhase}${elapsedSuffix}`;
}

export function startLiveProjector(
  progress: TaskProgressHandle | undefined,
  initialPhase: string,
): LiveProjector {
  if (!progress) {
    return {
      onEvent: () => undefined,
      stop: () => undefined,
      setPrefix: () => undefined,
    };
  }
  const start = Date.now();
  let currentPhase = initialPhase;
  let prefix = '';
  let lastHeartbeatAt = 0;
  let lastRenderedHeartbeat: string | undefined;

  const elapsedSuffix = () => {
    const s = Math.floor((Date.now() - start) / 1000);
    return ` (${s}s)`;
  };
  const renderPhase = () => {
    progress.update(composeLabel(prefix, currentPhase, elapsedSuffix()));
  };
  renderPhase();

  // PoC blind spot #12: listr2 falls back to verbose (line-per-update)
  // renderer when stdout isn't a TTY. 1s tick floods the log; 15s non-TTY.
  const tickMs = process.stdout.isTTY ? 1000 : 15000;
  const handle = setInterval(renderPhase, tickMs);

  return {
    onEvent: (e) => {
      const out = phraseFor(e);
      if (!out) return;
      if (out.channel === 'phase') {
        currentPhase = out.phrase;
        lastRenderedHeartbeat = undefined;
        renderPhase();
        return;
      }
      // heartbeat
      const now = Date.now();
      if (now - lastHeartbeatAt < HEARTBEAT_THROTTLE_MS) return;
      if (out.phrase === lastRenderedHeartbeat) return;
      lastHeartbeatAt = now;
      lastRenderedHeartbeat = out.phrase;
      if (progress.heartbeat) {
        progress.heartbeat(
          `${composeLabel(prefix, currentPhase, elapsedSuffix())} | ${out.phrase}`,
        );
      }
    },
    stop: () => clearInterval(handle),
    setPrefix: (p) => {
      prefix = p;
      lastRenderedHeartbeat = undefined;
      renderPhase();
    },
  };
}
