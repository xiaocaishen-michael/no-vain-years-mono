import { Listr } from 'listr2';
import type { ParsedTask } from './schemas/tasks.js';
import type {
  TaskProgressHandle,
  TaskProgressSink,
  TaskRunResult,
} from './run-feature.js';

// listr2 v10's ListrTaskWrapper generics are strict; we only need the
// surface that mutates .output and calls .skip(), so an opaque shape lets
// the consumer file stay free of listr2 internals.
interface ListrRowApi {
  output: string;
  skip(reason: string): void;
}

/**
 * Listr2-backed progress sink. Pre-builds one Listr row per pending task;
 * each row awaits a Promise<TaskRunResult> that the sink resolves when
 * the orchestrator calls handle.finish(). update() sets the row's live
 * output line (e.g. "🧠 Claude (12s)").
 *
 * If runFeature short-circuits on a failure, the remaining tasks never
 * see finish() — call finalizeSkipped() to mark them skipped so listr's
 * render terminates instead of hanging on infinite spinners.
 */

interface PerTaskState {
  listrTask?: ListrRowApi;
  resolve: (r: TaskRunResult | typeof SKIP_SENTINEL) => void;
  promise: Promise<TaskRunResult | typeof SKIP_SENTINEL>;
  finished: boolean;
  lastPhase?: string;
}

const SKIP_SENTINEL = Symbol('upstream-skip');

export class ListrProgressSink implements TaskProgressSink {
  private readonly per = new Map<string, PerTaskState>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public readonly listr: Listr<any, any, any>;

  constructor(pending: ParsedTask[]) {
    for (const t of pending) {
      let resolveFn!: (r: TaskRunResult | typeof SKIP_SENTINEL) => void;
      const promise = new Promise<TaskRunResult | typeof SKIP_SENTINEL>((r) => {
        resolveFn = r;
      });
      this.per.set(t.id, { promise, resolve: resolveFn, finished: false });
    }

    this.listr = new Listr(
      pending.map((t) => ({
        title: `${t.id} [${t.workspace}] ${t.title}`,
        task: async (_ctx: unknown, listrTask) => {
          const state = this.per.get(t.id);
          if (!state) return;
          state.listrTask = listrTask as unknown as ListrRowApi;
          const r = await state.promise;
          if (r === SKIP_SENTINEL) {
            return listrTask.skip('skipped — upstream failure');
          }
          if (!r.ok) {
            throw new Error(
              `${r.reason}${r.message ? ': ' + r.message : ''}`,
            );
          }
        },
      })),
      {
        concurrent: true,
        exitOnError: false,
        rendererOptions: { collapseErrors: false },
        fallbackRenderer: 'verbose',
        fallbackRendererCondition: () => !process.stdout.isTTY,
      },
    );
  }

  start(task: ParsedTask): TaskProgressHandle {
    const s = this.per.get(task.id);
    if (!s) {
      // Unknown task — orchestrator added a task after the sink was built.
      // Fall back to a noop handle so we don't crash the run.
      return { update: () => undefined, finish: () => undefined };
    }
    return {
      update: (status) => {
        if (s.listrTask) s.listrTask.output = status;
        const phaseKey = status.replace(/\s*\(\d+s\)$/, '');
        if (phaseKey !== s.lastPhase) {
          s.lastPhase = phaseKey;
          process.stderr.write(`[${task.id}] ${status}\n`);
        }
      },
      finish: (result) => {
        if (s.finished) return;
        s.finished = true;
        s.resolve(result);
      },
    };
  }

  /**
   * Resolve any still-pending listr rows as skipped. Call after runFeature
   * returns so the listr render terminates.
   */
  finalizeSkipped(): void {
    for (const s of this.per.values()) {
      if (s.finished) continue;
      s.finished = true;
      s.resolve(SKIP_SENTINEL);
    }
  }
}
