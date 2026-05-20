import * as fs from 'node:fs/promises';
import * as path from 'node:path';
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
}

function quote(s: string): string {
  // Defensive shell quoting; orchestrator inputs are validated by Zod but
  // we still wrap so spaces / unicode don't surprise /bin/sh.
  return `"${s.replace(/(["\\$`])/g, '\\$1')}"`;
}

export interface FakeGitCallLog {
  method: 'add' | 'commit' | 'restoreStaged';
  args: unknown[];
}

export type FakeCommitResponse = { ok: true } | { ok: false; stderr: string };

/**
 * Scripted git for tests. add/restoreStaged always succeed and are logged.
 * commit consumes one entry from `commitResponses`; ok=false throws GitCommitError.
 */
export class FakeGit implements Git {
  public readonly calls: FakeGitCallLog[] = [];
  private commitQueue: FakeCommitResponse[];

  constructor(commitResponses: FakeCommitResponse[] = [{ ok: true }]) {
    this.commitQueue = [...commitResponses];
  }

  enqueueCommit(r: FakeCommitResponse): void {
    this.commitQueue.push(r);
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
}

export type CommitTaskTerminalReason =
  | 'success'
  | 'hook-ralph-failed'
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
  } = input;

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
    return { ok: true, reason: 'success' };
  }

  // Hook failure → ralph-loop with phase=git-hook (default maxRetries=2).
  const ralph = await ralphLoop({
    phase: 'git-hook',
    maxRetries: input.maxHookRetries,
    initialFailure: first.feedback ?? '',
    buildRetryPrompt: (feedback) =>
      buildHookRetryPrompt(task, allStaged, feedback),
    attempt: async () => performCommit(),
    llm,
    llmInvokeOpts,
  });

  return {
    ok: ralph.ok,
    reason: ralph.ok ? 'success' : 'hook-ralph-failed',
    ralph,
    lastStderr: ralph.ok ? undefined : ralph.finalFeedback,
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
