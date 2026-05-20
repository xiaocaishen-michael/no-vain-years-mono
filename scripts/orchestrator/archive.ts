import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import type { LlmInvokeResult } from './llm-client.js';

/**
 * Per-task on-disk archive. Streams the LLM stdout/stderr to per-attempt
 * log files in real-time (so `tail -f` reveals progress mid-run) and dumps
 * a structured summary.json on finalize. Lives at
 * `<repoRoot>/.spec-kit/runs/<feature_id>/<task_id>/`.
 *
 * Per memory feedback `archive-logs-before-agentic-runs` (P1 + P2):
 * cat one file → see full picture; tail -f → see live progress.
 */

export type AttemptPhase = 'initial' | 'verify-ralph' | 'hook-ralph';

export interface LlmSummary {
  exit_code: number;
  duration_ms: number;
}

export interface ActionSummary {
  exit_code: number;
}

export interface AttemptMetadata {
  n: number;
  phase: AttemptPhase;
  elapsed_ms: number;
  llm?: LlmSummary;
  llm_error?: string;
  action?: ActionSummary;
  ok: boolean;
}

export interface CommitMetadata {
  message: string;
  sha?: string;
  ralph_attempts: number;
}

export interface FileOpSummaryEntry {
  op: string;
  path: string;
}

export interface FileOpsSummary {
  create: number;
  modify: number;
  delete: number;
  rename: number;
  files: FileOpSummaryEntry[];
}

export interface TaskArchiveCreateOptions {
  featureId: string;
  taskId: string;
}

export interface FinalizeInput {
  ok: boolean;
  reason: string;
}

export interface AttemptFinishInput {
  prompt: string;
  llmResult?: LlmInvokeResult;
  llmError?: Error;
  actionStdout?: string;
  actionStderr?: string;
  actionExitCode?: number;
  diff?: string;
  ok: boolean;
}

export class TaskArchive {
  private attemptCount = 0;
  private readonly attempts: AttemptMetadata[] = [];
  private commit?: CommitMetadata;
  private fileOps?: FileOpsSummary;
  private readonly errors: string[] = [];
  private readonly startedAt = new Date();
  private headBefore?: string;
  private headAfter?: string;
  private sandboxCwd?: string;
  private sandboxCleaned?: boolean;

  private constructor(
    public readonly dir: string,
    public readonly featureId: string,
    public readonly taskId: string,
  ) {}

  static async create(
    dir: string,
    opts: TaskArchiveCreateOptions,
  ): Promise<TaskArchive> {
    await fsp.mkdir(dir, { recursive: true });
    return new TaskArchive(dir, opts.featureId, opts.taskId);
  }

  setHeadBefore(sha: string): void {
    this.headBefore = sha;
  }

  setHeadAfter(sha: string): void {
    this.headAfter = sha;
  }

  setSandbox(cwd: string, cleaned: boolean): void {
    this.sandboxCwd = cwd;
    this.sandboxCleaned = cleaned;
  }

  setCommit(meta: CommitMetadata): void {
    this.commit = meta;
  }

  pushError(msg: string): void {
    this.errors.push(msg);
  }

  recordFileOps(ops: ReadonlyArray<{ op: string; path: string }>): void {
    const counts = { create: 0, modify: 0, delete: 0, rename: 0 };
    for (const f of ops) {
      if (f.op in counts) {
        (counts as Record<string, number>)[f.op]++;
      }
    }
    this.fileOps = {
      ...counts,
      files: ops.map((f) => ({ op: f.op, path: f.path })),
    };
  }

  reserveAttempt(phase: AttemptPhase): AttemptHandle {
    const n = this.attemptCount++;
    return new AttemptHandle(this, n, phase);
  }

  pathFor(n: number, suffix: string): string {
    return path.join(this.dir, `attempt-${n}-${suffix}`);
  }

  /** Internal: AttemptHandle.finish() pushes its metadata here. */
  recordAttemptMetadata(meta: AttemptMetadata): void {
    this.attempts.push(meta);
  }

  async finalize(input: FinalizeInput): Promise<void> {
    const finishedAt = new Date();
    const summary = {
      feature_id: this.featureId,
      task_id: this.taskId,
      started_at: this.startedAt.toISOString(),
      finished_at: finishedAt.toISOString(),
      elapsed_ms: finishedAt.getTime() - this.startedAt.getTime(),
      ok: input.ok,
      reason: input.reason,
      sandbox_cwd: this.sandboxCwd,
      sandbox_cleaned: this.sandboxCleaned,
      head_before: this.headBefore,
      head_after: this.headAfter,
      file_ops: this.fileOps,
      attempts: this.attempts,
      commit: this.commit,
      errors: this.errors,
    };
    await fsp.writeFile(
      path.join(this.dir, 'summary.json'),
      JSON.stringify(summary, null, 2) + '\n',
    );
  }
}

export class AttemptHandle {
  private stdoutStream?: fs.WriteStream;
  private stderrStream?: fs.WriteStream;
  private streamsOpened = false;
  private readonly startedAt = Date.now();
  private finished = false;

  constructor(
    private readonly archive: TaskArchive,
    public readonly n: number,
    public readonly phase: AttemptPhase,
  ) {}

  /**
   * Open write streams to attempt-N-llm-{stdout,stderr}.log. Pass the
   * streams to llm.invoke / shell.run as streamStdout / streamStderr so
   * the subprocess output hits disk in real-time (tail -f friendly).
   *
   * On finish() we overwrite the same files with llmResult.{stdout,stderr}
   * — that's the authoritative buffer, equal in content but ensures
   * non-streaming callers (tests, FakeLlmClient) still produce non-empty
   * log files.
   */
  openLlmStreams(): { stdout: fs.WriteStream; stderr: fs.WriteStream } {
    if (this.streamsOpened) {
      throw new Error(
        `AttemptHandle: streams already opened for attempt ${this.n}`,
      );
    }
    this.streamsOpened = true;
    this.stdoutStream = fs.createWriteStream(
      this.archive.pathFor(this.n, 'llm-stdout.log'),
    );
    this.stderrStream = fs.createWriteStream(
      this.archive.pathFor(this.n, 'llm-stderr.log'),
    );
    return { stdout: this.stdoutStream, stderr: this.stderrStream };
  }

  /**
   * Close any open streams, write all per-attempt files (prompt, llm log
   * pair, llm-error, action log pair, diff), and push metadata into the
   * archive's summary.attempts[] array.
   *
   * Idempotent against calling twice (throws on re-finish).
   */
  async finish(input: AttemptFinishInput): Promise<void> {
    if (this.finished) {
      throw new Error(`AttemptHandle: finish() already called for attempt ${this.n}`);
    }
    this.finished = true;

    if (this.stdoutStream) await closeStream(this.stdoutStream);
    if (this.stderrStream) await closeStream(this.stderrStream);

    await fsp.writeFile(
      this.archive.pathFor(this.n, 'prompt.md'),
      input.prompt,
    );

    if (input.llmResult) {
      await fsp.writeFile(
        this.archive.pathFor(this.n, 'llm-stdout.log'),
        input.llmResult.stdout,
      );
      await fsp.writeFile(
        this.archive.pathFor(this.n, 'llm-stderr.log'),
        input.llmResult.stderr,
      );
    }

    if (input.llmError) {
      const body =
        `${input.llmError.name}: ${input.llmError.message}\n` +
        (input.llmError.stack ?? '') + '\n';
      await fsp.writeFile(
        this.archive.pathFor(this.n, 'llm-error.log'),
        body,
      );
    }

    if (input.actionStdout !== undefined) {
      await fsp.writeFile(
        this.archive.pathFor(this.n, 'action-stdout.log'),
        input.actionStdout,
      );
    }
    if (input.actionStderr !== undefined) {
      await fsp.writeFile(
        this.archive.pathFor(this.n, 'action-stderr.log'),
        input.actionStderr,
      );
    }

    if (input.diff !== undefined) {
      await fsp.writeFile(
        this.archive.pathFor(this.n, 'diff.patch'),
        input.diff,
      );
    }

    this.archive.recordAttemptMetadata({
      n: this.n,
      phase: this.phase,
      elapsed_ms: Date.now() - this.startedAt,
      llm: input.llmResult
        ? {
            exit_code: input.llmResult.exitCode,
            duration_ms: input.llmResult.durationMs,
          }
        : undefined,
      llm_error: input.llmError?.message,
      action:
        input.actionExitCode !== undefined
          ? { exit_code: input.actionExitCode }
          : undefined,
      ok: input.ok,
    });
  }
}

function closeStream(s: fs.WriteStream): Promise<void> {
  return new Promise((resolve, reject) => {
    s.once('error', reject);
    s.end(() => resolve());
  });
}
