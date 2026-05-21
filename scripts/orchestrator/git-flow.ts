import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { TaskArchive } from './archive.js';
import type { LlmClient, LlmInvokeOptions } from './llm-client.js';
import type { ParsedPlan } from './parsers/plan.js';
import { ralphLoop, type RalphLoopResult } from './ralph-loop.js';
import type { Workspace } from './schemas/plan.js';
import type { ParsedTask, TaskKind } from './schemas/tasks.js';
import type { Shell } from './shell.js';
import { flipCheckbox, revertCheckbox } from './tasks-md-checkbox.js';

/** Port over a small set of git operations. Real impl shells out; tests inject FakeGit. */
export interface Git {
  add(files: string[], opts: { cwd: string }): Promise<void>;
  /** Throws GitCommitError on non-zero exit. */
  commit(message: string, opts: { cwd: string }): Promise<void>;
  restoreStaged(files: string[], opts: { cwd: string }): Promise<void>;
  /** Returns the current HEAD SHA (trimmed). Used to detect LLM self-commit. */
  revParseHead(opts: { cwd: string }): Promise<string>;
  /**
   * Returns a unified diff of the working tree (staged + unstaged) vs HEAD.
   * Best-effort: empty string on git error so archive capture never derails
   * the orchestrator pipeline.
   *
   * `intentToAddPaths` (per PoC blind spot #10): bare `git diff HEAD` misses
   * untracked files. Pass new-file paths here and the impl will
   * `git add --intent-to-add` them before diff (so they show as "new file
   * mode" patches), then `git reset HEAD --` to undo so the index isn't
   * left polluted (commitTask's own staging is a strict whitelist of
   * `task.files ∪ {tasks.md}`, not `git add -A`).
   */
  diffWorkingTree(opts: {
    cwd: string;
    intentToAddPaths?: readonly string[];
  }): Promise<string>;
  /**
   * Returns the parsed lines of `git status --porcelain` (empty array when the
   * worktree is fully clean). Used by commitTask's post-commit orphan assert
   * (PoC blind spot #22): the orchestrator only stages declared `task.files`,
   * so any file the LLM touched outside its declaration is left in the
   * worktree as an orphan after commit — silently polluting subsequent tasks'
   * baseline. The assert turns that silent leak into a hard failure.
   */
  statusPorcelain(opts: { cwd: string }): Promise<string[]>;
}

export class GitCommitError extends Error {
  constructor(
    public readonly stdout: string,
    public readonly stderr: string,
    public readonly exitCode: number,
  ) {
    super(`git commit failed (exit ${exitCode}): ${stderr || stdout}`);
    this.name = 'GitCommitError';
  }
}

/**
 * Thrown by commitTask when `git status --porcelain` is non-empty after a
 * (otherwise successful) commit. Indicates the LLM modified files outside
 * `task.files` and they were left orphaned in the working tree — would
 * silently pollute the next task's baseline if allowed through.
 */
export class OrphanAfterCommitError extends Error {
  constructor(public readonly orphans: string[]) {
    super(
      `Orphan files in worktree after commit (LLM touched files outside task.files declaration):\n${orphans.join('\n')}`,
    );
    this.name = 'OrphanAfterCommitError';
  }
}

/**
 * Live impl backed by a Shell. Quotes file paths defensively but assumes
 * paths don't contain double-quotes (the orchestrator only stages paths
 * declared in tasks.md schema, which forbids quotes).
 */
export class GitCli implements Git {
  constructor(private readonly shell: Shell) {}

  async add(files: string[], opts: { cwd: string }): Promise<void> {
    if (files.length === 0) return;
    const cmd = `git add ${files.map(quote).join(' ')}`;
    const r = await this.shell.run(cmd, { cwd: opts.cwd });
    if (r.exitCode !== 0) {
      throw new Error(`git add failed (exit ${r.exitCode}): ${r.stderr}`);
    }
  }

  async commit(message: string, opts: { cwd: string }): Promise<void> {
    const cmd = `git commit -m ${quote(message)}`;
    const r = await this.shell.run(cmd, { cwd: opts.cwd });
    if (r.exitCode !== 0) {
      throw new GitCommitError(r.stdout, r.stderr, r.exitCode);
    }
  }

  async restoreStaged(
    files: string[],
    opts: { cwd: string },
  ): Promise<void> {
    if (files.length === 0) return;
    const cmd = `git restore --staged ${files.map(quote).join(' ')}`;
    const r = await this.shell.run(cmd, { cwd: opts.cwd });
    if (r.exitCode !== 0) {
      throw new Error(
        `git restore --staged failed (exit ${r.exitCode}): ${r.stderr}`,
      );
    }
  }

  async revParseHead(opts: { cwd: string }): Promise<string> {
    const r = await this.shell.run('git rev-parse HEAD', { cwd: opts.cwd });
    if (r.exitCode !== 0) {
      throw new Error(`git rev-parse HEAD failed (exit ${r.exitCode}): ${r.stderr}`);
    }
    return r.stdout.trim();
  }

  async diffWorkingTree(opts: {
    cwd: string;
    intentToAddPaths?: readonly string[];
  }): Promise<string> {
    const paths = opts.intentToAddPaths ?? [];
    if (paths.length > 0) {
      const addCmd = `git add --intent-to-add -- ${paths.map(quote).join(' ')}`;
      await this.shell.run(addCmd, { cwd: opts.cwd });
    }
    try {
      const r = await this.shell.run('git diff HEAD', { cwd: opts.cwd });
      // Best-effort: return whatever stdout was produced. Git typically exits 0
      // even when the diff is empty; non-zero (e.g. broken repo) → empty string
      // so archive capture never derails the orchestrator pipeline.
      return r.exitCode === 0 ? r.stdout : '';
    } finally {
      if (paths.length > 0) {
        const resetCmd = `git reset HEAD -- ${paths.map(quote).join(' ')}`;
        await this.shell.run(resetCmd, { cwd: opts.cwd });
      }
    }
  }

  async statusPorcelain(opts: { cwd: string }): Promise<string[]> {
    const r = await this.shell.run('git status --porcelain', { cwd: opts.cwd });
    if (r.exitCode !== 0) {
      throw new Error(
        `git status --porcelain failed (exit ${r.exitCode}): ${r.stderr}`,
      );
    }
    return r.stdout.split('\n').filter((line) => line.length > 0);
  }
}

function quote(s: string): string {
  // Defensive shell quoting; orchestrator inputs are validated by Zod but
  // we still wrap so spaces / unicode don't surprise /bin/sh.
  return `"${s.replace(/(["\\$`])/g, '\\$1')}"`;
}

export interface FakeGitCallLog {
  method:
    | 'add'
    | 'commit'
    | 'restoreStaged'
    | 'revParseHead'
    | 'diffWorkingTree'
    | 'statusPorcelain';
  args: unknown[];
}

export type FakeCommitResponse = { ok: true } | { ok: false; stderr: string };

/** Default SHA when no script is enqueued — keeps headBefore == headAfter (no shift). */
const FAKE_DEFAULT_HEAD = 'fakehead00000000000000000000000000000000';

/**
 * Scripted git for tests. add/restoreStaged always succeed and are logged.
 * commit consumes one entry from `commitResponses`; ok=false throws GitCommitError.
 * revParseHead consumes one entry from `shaQueue`, falling back to a fixed
 * default so existing tests don't need updating.
 */
export class FakeGit implements Git {
  public readonly calls: FakeGitCallLog[] = [];
  private commitQueue: FakeCommitResponse[];
  private shaQueue: string[] = [];
  private diffQueue: string[] = [];
  private statusQueue: string[][] = [];

  constructor(commitResponses: FakeCommitResponse[] = [{ ok: true }]) {
    this.commitQueue = [...commitResponses];
  }

  enqueueCommit(r: FakeCommitResponse): void {
    this.commitQueue.push(r);
  }

  /** Queue the next return value(s) for revParseHead. */
  enqueueHeadSha(...shas: string[]): void {
    this.shaQueue.push(...shas);
  }

  /** Queue the next return value(s) for diffWorkingTree. */
  enqueueDiff(...patches: string[]): void {
    this.diffQueue.push(...patches);
  }

  /**
   * Queue the next return value(s) for statusPorcelain. Each element is the
   * list of porcelain lines returned by one call; default (empty queue) is
   * an empty array — i.e. a clean worktree — so existing tests don't need
   * updating.
   */
  enqueueStatus(...statuses: string[][]): void {
    this.statusQueue.push(...statuses);
  }

  async add(files: string[], opts: { cwd: string }): Promise<void> {
    this.calls.push({ method: 'add', args: [files, opts] });
  }

  async commit(message: string, opts: { cwd: string }): Promise<void> {
    this.calls.push({ method: 'commit', args: [message, opts] });
    const next = this.commitQueue.shift();
    if (!next) {
      throw new Error(
        `FakeGit: commit() called but no scripted response left (call #${this.calls.length})`,
      );
    }
    if (!next.ok) {
      throw new GitCommitError('', next.stderr, 1);
    }
  }

  async restoreStaged(
    files: string[],
    opts: { cwd: string },
  ): Promise<void> {
    this.calls.push({ method: 'restoreStaged', args: [files, opts] });
  }

  async revParseHead(opts: { cwd: string }): Promise<string> {
    this.calls.push({ method: 'revParseHead', args: [opts] });
    return this.shaQueue.shift() ?? FAKE_DEFAULT_HEAD;
  }

  async diffWorkingTree(opts: {
    cwd: string;
    intentToAddPaths?: readonly string[];
  }): Promise<string> {
    this.calls.push({ method: 'diffWorkingTree', args: [opts] });
    return this.diffQueue.shift() ?? '';
  }

  async statusPorcelain(opts: { cwd: string }): Promise<string[]> {
    this.calls.push({ method: 'statusPorcelain', args: [opts] });
    return this.statusQueue.shift() ?? [];
  }
}

const KIND_TO_CONVENTIONAL_TYPE: Record<TaskKind, string> = {
  impl: 'feat',
  'test-unit': 'test',
  'test-integration': 'test',
  'test-e2e': 'test',
  gen: 'chore',
  migration: 'feat',
  docs: 'docs',
  config: 'chore',
};

/** Per § 5.3.12 commit message example: `feat(account): add phone-sms-auth (T001)`. */
export function buildCommitMsg(
  task: ParsedTask,
  plan: ParsedPlan,
  workspace: Workspace,
): string {
  const type = KIND_TO_CONVENTIONAL_TYPE[task.kind] ?? 'chore';
  const moduleBoundary = plan.config.module_boundaries[workspace.id];
  const scope =
    moduleBoundary && moduleBoundary.modules.length > 0
      ? moduleBoundary.modules[0]
      : workspace.id;
  return `${type}(${scope}): ${task.title} (${task.id})`;
}

/** Compute the set of files to `git add` for a task. */
export function filesToStage(task: ParsedTask): string[] {
  return task.files
    .filter((f) => f.op !== 'delete')
    .map((f) => (f.op === 'rename' && f.rename_to ? f.rename_to : f.path));
}

export interface CommitTaskInput {
  task: ParsedTask;
  plan: ParsedPlan;
  workspace: Workspace;
  /** Absolute path to the feature's tasks.md. */
  tasksMdPath: string;
  /** Absolute path to the repo root (where git operates). */
  repoRoot: string;
  git: Git;
  /** LLM is invoked only during git-hook ralph-loop retries. */
  llm: LlmClient;
  /** LLM invoke options used by ralph-loop retries. */
  llmInvokeOpts: LlmInvokeOptions;
  /** Override default max retries (2) for git-hook ralph-loop. */
  maxHookRetries?: number;
  /**
   * HEAD SHA captured before the LLM was invoked. If HEAD has moved by the
   * time commitTask runs, the LLM committed mid-run (PoC blind spot 9) —
   * skip the orchestrator's own commit and report success.
   */
  headBefore: string;
  /**
   * Optional per-task archive sink. When provided, hook-ralph rounds are
   * recorded as attempt-N entries with prompt + LLM stdout/stderr + commit
   * hook stderr captured for later cat-based debugging.
   */
  archive?: TaskArchive;
}

export type CommitTaskTerminalReason =
  | 'success'
  | 'llm-self-committed'
  | 'hook-ralph-failed'
  | 'orphan-after-commit'
  | 'rollback-error';

export interface CommitTaskResult {
  ok: boolean;
  reason: CommitTaskTerminalReason;
  ralph?: RalphLoopResult;
  /** stderr from the final failed commit (if any). */
  lastStderr?: string;
}

/**
 * Per plan § 5.3.15.8.2: atomic flip → stage → commit, with ralph-loop
 * on hook failure. Each commit attempt is fully transactional —
 * either it succeeds, or tasks.md + staging area are restored to
 * pre-attempt state before returning.
 */
export async function commitTask(
  input: CommitTaskInput,
): Promise<CommitTaskResult> {
  const {
    task,
    plan,
    workspace,
    tasksMdPath,
    repoRoot,
    git,
    llm,
    llmInvokeOpts,
    headBefore,
  } = input;

  // PoC blind spot 9 structural defense: if HEAD moved during the LLM run,
  // the subprocess self-committed (despite the prompt telling it not to).
  // The verify command already passed, so the work is on disk and the
  // history advanced — skip our own flip+stage+commit and report success.
  const headNow = await git.revParseHead({ cwd: repoRoot });
  if (headNow !== headBefore) {
    const orphan = await checkOrphans(git, repoRoot);
    if (orphan) return orphan;
    return { ok: true, reason: 'llm-self-committed' };
  }

  const stageFiles = filesToStage(task);
  const allStaged = [...stageFiles, path.relative(repoRoot, tasksMdPath)];
  const commitMessage = buildCommitMsg(task, plan, workspace);

  // One atomic commit attempt: flip → stage → commit; on failure roll back fully.
  const performCommit = async (): Promise<{
    ok: boolean;
    feedback?: string;
  }> => {
    const original = await fs.readFile(tasksMdPath, 'utf-8');
    const flipped = flipCheckbox(original, task.id);
    await fs.writeFile(tasksMdPath, flipped);

    try {
      await git.add(allStaged, { cwd: repoRoot });
      await git.commit(commitMessage, { cwd: repoRoot });
      return { ok: true };
    } catch (e) {
      if (!(e instanceof GitCommitError)) {
        // Non-hook error (e.g. git add path issue): try to revert tasks.md
        // and rethrow — caller treats as fatal.
        try {
          await fs.writeFile(tasksMdPath, revertCheckbox(flipped, task.id));
        } catch {
          /* best-effort */
        }
        throw e;
      }
      // Hook failure: atomic rollback (per § 5.3.15.8.2 steps A-C).
      await git.restoreStaged(allStaged, { cwd: repoRoot });
      await fs.writeFile(tasksMdPath, original);
      return { ok: false, feedback: e.stderr };
    }
  };

  const first = await performCommit();
  if (first.ok) {
    const orphan = await checkOrphans(git, repoRoot);
    if (orphan) return orphan;
    return { ok: true, reason: 'success' };
  }

  // Hook failure → ralph-loop with phase=git-hook (default maxRetries=2).
  // The archive (if provided) records each round's prompt + LLM I/O + hook
  // stderr as attempt-N-* files. lastAttempt tracks the most recent
  // performCommit() outcome so onRound can surface its full feedback.
  let lastFeedback: string | undefined = first.feedback;
  const archive = input.archive;
  const ralph = await ralphLoop({
    phase: 'git-hook',
    maxRetries: input.maxHookRetries,
    initialFailure: first.feedback ?? '',
    buildRetryPrompt: (feedback) =>
      buildHookRetryPrompt(task, allStaged, feedback),
    attempt: async () => {
      const r = await performCommit();
      lastFeedback = r.feedback;
      return r;
    },
    llm,
    llmInvokeOpts,
    onRound: archive
      ? async (round) => {
          const attN = archive.reserveAttempt('hook-ralph');
          await attN.finish({
            prompt: round.retryPrompt,
            llmResult: round.llmResult,
            llmError: round.llmError,
            actionStderr: lastFeedback,
            actionExitCode: round.outcome?.ok ? 0 : 1,
            ok: round.outcome?.ok ?? false,
          });
        }
      : undefined,
  });

  if (ralph.ok) {
    const orphan = await checkOrphans(git, repoRoot);
    if (orphan) return { ...orphan, ralph };
    return { ok: true, reason: 'success', ralph };
  }
  return {
    ok: false,
    reason: 'hook-ralph-failed',
    ralph,
    lastStderr: ralph.finalFeedback,
  };
}

/**
 * Post-commit orphan assert (PoC blind spot #22): `git status --porcelain`
 * must be empty after a successful commit. Non-empty → the LLM modified
 * files outside the declared `task.files` whitelist that were skipped by
 * staging; passing them silently into the next task would pollute its diff
 * baseline (cf. T027 / T023 ralph runs). Returns the failure CommitTaskResult
 * to use, or null when clean.
 */
async function checkOrphans(
  git: Git,
  repoRoot: string,
): Promise<CommitTaskResult | null> {
  const orphans = await git.statusPorcelain({ cwd: repoRoot });
  if (orphans.length === 0) return null;
  const err = new OrphanAfterCommitError(orphans);
  return {
    ok: false,
    reason: 'orphan-after-commit',
    lastStderr: err.message,
  };
}

export function buildHookRetryPrompt(
  task: ParsedTask,
  stagedFiles: string[],
  hookStderr: string,
): string {
  return [
    `Task ${task.id} verify_command already passed (tests green) but \`git commit\` was rejected by a lefthook.`,
    `Please fix code-style / docs-sync issues ONLY. Do NOT change business logic — that's already verified.`,
    ``,
    `Hook scope is limited to this task's staged files: ${stagedFiles.join(', ')}.`,
    `The rejection is necessarily in a file you edited.`,
    ``,
    `Hook stderr:`,
    hookStderr.trim() || '(empty stderr)',
  ].join('\n');
}
