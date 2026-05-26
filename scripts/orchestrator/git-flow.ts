import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { TaskArchive } from './archive.js';
import { classifyDrift, normalizePath } from './drift-classifier.js';
import { startLiveProjector, type LiveProjector } from './live-projector.js';
import type { LlmClient, LlmInvokeOptions } from './llm-client.js';
import { runOrphanRalph, type OrphanRalphResult } from './orphan-ralph.js';
import type { ParsedPlan } from './parsers/plan.js';
import { ralphLoop, type RalphLoopResult } from './ralph-loop.js';
import type { TaskProgressHandle } from './run-feature.js';
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
  diffWorkingTree(opts: { cwd: string; intentToAddPaths?: readonly string[] }): Promise<string>;
  /**
   * Returns the parsed lines of `git status --porcelain` (empty array when the
   * worktree is fully clean). Used by commitTask's post-commit orphan assert
   * (PoC blind spot #22): the orchestrator only stages declared `task.files`,
   * so any file the LLM touched outside its declaration is left in the
   * worktree as an orphan after commit — silently polluting subsequent tasks'
   * baseline. The assert turns that silent leak into a hard failure.
   */
  statusPorcelain(opts: { cwd: string }): Promise<string[]>;
  /**
   * Returns repo-root-relative paths the LLM actually touched since `fromSha`:
   * `git diff --name-only <fromSha>` ∪ untracked-not-ignored files. Used by
   * the kind-aware drift gate (PoC #22 P1) to compute drift = actual − declared
   * BEFORE staging — so the orchestrator can route to gen-fenced / orphan-ralph
   * based on real behavior rather than declared intent.
   */
  diffNameOnly(fromSha: string, opts: { cwd: string }): Promise<string[]>;
  /**
   * `git restore -- <files>` (worktree-only restore; does not touch index).
   * Used by orphan-ralph's `revert` intent to discard LLM hallucinations that
   * fall outside the declared task scope. Caller is responsible for ensuring
   * files ⊆ orphan set — restoring declared (verify-pass) edits would corrupt
   * the task. No-op on empty input.
   */
  restore(files: string[], opts: { cwd: string }): Promise<void>;
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

  async restoreStaged(files: string[], opts: { cwd: string }): Promise<void> {
    if (files.length === 0) return;
    const cmd = `git restore --staged ${files.map(quote).join(' ')}`;
    const r = await this.shell.run(cmd, { cwd: opts.cwd });
    if (r.exitCode !== 0) {
      throw new Error(`git restore --staged failed (exit ${r.exitCode}): ${r.stderr}`);
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
      throw new Error(`git status --porcelain failed (exit ${r.exitCode}): ${r.stderr}`);
    }
    return r.stdout.split('\n').filter((line) => line.length > 0);
  }

  async diffNameOnly(fromSha: string, opts: { cwd: string }): Promise<string[]> {
    // Modified + added + deleted vs <fromSha>.
    const diff = await this.shell.run(`git diff --name-only ${quote(fromSha)}`, { cwd: opts.cwd });
    if (diff.exitCode !== 0) {
      throw new Error(`git diff --name-only failed (exit ${diff.exitCode}): ${diff.stderr}`);
    }
    // Untracked (new files the LLM created but never staged).
    // --exclude-standard honors .gitignore so Obsidian / .DS_Store etc. don't
    // leak in as false-positive orphans.
    const untracked = await this.shell.run('git ls-files --others --exclude-standard', {
      cwd: opts.cwd,
    });
    if (untracked.exitCode !== 0) {
      throw new Error(
        `git ls-files --others failed (exit ${untracked.exitCode}): ${untracked.stderr}`,
      );
    }
    const merged = new Set<string>();
    for (const line of diff.stdout.split('\n')) {
      if (line.length > 0) merged.add(line);
    }
    for (const line of untracked.stdout.split('\n')) {
      if (line.length > 0) merged.add(line);
    }
    return [...merged].sort();
  }

  async restore(files: string[], opts: { cwd: string }): Promise<void> {
    if (files.length === 0) return;
    const cmd = `git restore -- ${files.map(quote).join(' ')}`;
    const r = await this.shell.run(cmd, { cwd: opts.cwd });
    if (r.exitCode !== 0) {
      throw new Error(`git restore failed (exit ${r.exitCode}): ${r.stderr}`);
    }
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
    | 'statusPorcelain'
    | 'diffNameOnly'
    | 'restore';
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
  private nameOnlyQueue: string[][] = [];

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

  /**
   * Queue the next return value(s) for diffNameOnly. Default (empty queue) is
   * an empty array — i.e. "no files changed since fromSha".
   */
  enqueueDiffNameOnly(...patches: string[][]): void {
    this.nameOnlyQueue.push(...patches);
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

  async restoreStaged(files: string[], opts: { cwd: string }): Promise<void> {
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

  async diffNameOnly(fromSha: string, opts: { cwd: string }): Promise<string[]> {
    this.calls.push({ method: 'diffNameOnly', args: [fromSha, opts] });
    return this.nameOnlyQueue.shift() ?? [];
  }

  async restore(files: string[], opts: { cwd: string }): Promise<void> {
    this.calls.push({ method: 'restore', args: [files, opts] });
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
  verification: 'test',
};

/** Per § 5.3.12 commit message example: `feat(account): add phone-sms-auth (T001)`. */
export function buildCommitMsg(task: ParsedTask, plan: ParsedPlan, workspace: Workspace): string {
  const type = KIND_TO_CONVENTIONAL_TYPE[task.kind] ?? 'chore';
  const moduleBoundary = plan.config.module_boundaries[workspace.id];
  const scope =
    moduleBoundary && moduleBoundary.modules.length > 0 ? moduleBoundary.modules[0] : workspace.id;
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
  /**
   * Optional listr task row handle. When provided, hook-ralph and
   * orphan-ralph rounds each spin up a fresh LiveProjector with a label
   * prefix (e.g. "🪝 hook-ralph #1/2", "🩹 orphan-ralph #2/2") so the
   * user sees per-round narration in the row instead of frozen static
   * labels. Caller (run-feature) is responsible for projector cleanup
   * when commitTask returns.
   */
  progress?: TaskProgressHandle;
}

export type CommitTaskTerminalReason =
  | 'success'
  | 'gen-fenced'
  | 'orphan-resolved-expand'
  | 'orphan-resolved-revert'
  | 'orphan-stuck'
  | 'llm-self-committed'
  | 'hook-ralph-failed'
  | 'orphan-after-commit'
  | 'rollback-error';

/**
 * Drift telemetry attached to CommitTaskResult so run-report can render the
 * "Scope drift" section without re-parsing per-task archives. Populated on
 * every commit attempt (including no-drift, for uniform downstream code).
 */
export interface CommitDriftRecord {
  /** What happened: parallel structure to CommitTaskTerminalReason but
   *  always set, even for no-drift commits. */
  resolution:
    | 'no-drift'
    | 'gen-fenced'
    | 'orphan-resolved-expand'
    | 'orphan-resolved-revert'
    | 'orphan-stuck'
    | 'llm-self-committed-skipped';
  /** task.files-derived declared list at commit time. */
  declared: string[];
  /** Files actually touched since headBefore (diffNameOnly + untracked). */
  actual: string[];
  /** Subset of `actual` not in `declared`. */
  orphans: string[];
  /** Resolved gen_scope when classifier returned `gen-fenced`. */
  genScope?: string[];
}

export interface CommitTaskResult {
  ok: boolean;
  reason: CommitTaskTerminalReason;
  ralph?: RalphLoopResult;
  /** stderr from the final failed commit (if any). */
  lastStderr?: string;
  /** Populated whenever the commit gate ran (omitted on #9 LLM-self-commit
   *  short-circuit where headBefore is no longer trustworthy). */
  drift?: CommitDriftRecord;
  /** Populated when the orphan self-justify ralph ran. */
  orphanRalph?: OrphanRalphResult;
}

/**
 * Per plan § 5.3.15.8.2 + PoC blind spot #22 P1: atomic flip → stage → commit
 * with two layered ralph loops (orphan self-justify + git-hook recovery).
 *
 * Gate (Steps A-H):
 *   A. headBefore captured by caller (run-feature) before LLM.
 *   B. actualFiles = git.diffNameOnly(headBefore) ∪ untracked
 *   C. HEAD moved → PoC #9 LLM-self-commit branch (final statusPorcelain assert)
 *   D. declared = filesToStage(task)
 *   E. drift = ∅ → happy path commit (declared + tasks.md)
 *   F. classifyDrift(task, declared, actual)
 *        gen-fenced (kind ∈ {gen, migration} ∧ drift ⊆ gen_scope)
 *          → silently expand stage to declared ∪ orphans, commit
 *        needs-ralph → Step G
 *   G. runOrphanRalph (LLM intent: expand / revert / stuck, max 2 retries)
 *        resolved → re-derive declared from (possibly-mutated) tasks.md, commit
 *        stuck    → return ok:false, reason:'orphan-stuck'
 *   H. Final git.statusPorcelain assert (PR-1 baseline; catches edge cases).
 */
export async function commitTask(input: CommitTaskInput): Promise<CommitTaskResult> {
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
    progress,
  } = input;

  // Step C': PoC blind spot 9 — if HEAD moved during the LLM run, the
  // subprocess self-committed despite the prompt. headBefore is no longer
  // trustworthy for drift, so we skip A/B/D-G and rely only on Step H.
  const headNow = await git.revParseHead({ cwd: repoRoot });
  if (headNow !== headBefore) {
    const orphan = await checkOrphans(git, repoRoot);
    if (orphan) return orphan;
    return { ok: true, reason: 'llm-self-committed' };
  }

  // Step B: ground-truth diff (modified + untracked).
  const actualRaw = await git.diffNameOnly(headBefore, { cwd: repoRoot });
  const tasksMdRel = normalizePath(path.relative(repoRoot, tasksMdPath));
  // Exclude tasks.md from drift accounting — it isn't "LLM-touched code", it's
  // orchestrator-owned bookkeeping. (The flip happens inside performCommit
  // below; tasks.md isn't part of declared either.)
  const actual = actualRaw.map(normalizePath).filter((f) => f !== tasksMdRel);

  // Step D: declared list (mutable — orphan-ralph expand may grow it).
  let declared = filesToStage(task).map(normalizePath);

  // Step F: classify drift.
  const decision = classifyDrift(task, declared, actual);

  let resolution: CommitDriftRecord['resolution'] = 'no-drift';
  let genScope: string[] | undefined;
  let orphans: string[] = [];
  let orphanRalph: OrphanRalphResult | undefined;
  let stageList = declared.slice();

  switch (decision.kind) {
    case 'no-drift':
      // Step E: happy path. stageList = declared.
      resolution = 'no-drift';
      break;

    case 'gen-fenced':
      // Bulk-output kind whose drift is fully in gen_scope. Silently expand.
      resolution = 'gen-fenced';
      genScope = decision.genScope;
      orphans = decision.expandedStage;
      stageList = [...declared, ...decision.expandedStage];
      break;

    case 'needs-ralph': {
      // Step G: orphan self-justify.
      orphans = decision.orphans;
      let orphanProjector: LiveProjector | undefined;
      orphanRalph = await runOrphanRalph({
        task,
        declared,
        orphans,
        headBefore,
        llm,
        llmInvokeOpts,
        git,
        repoRoot,
        tasksMdPath,
        prepareRound: (n, max) => {
          if (orphanProjector) orphanProjector.stop();
          orphanProjector = startLiveProjector(progress, '🧠 Claude');
          orphanProjector.setPrefix(`🩹 orphan-ralph #${n}/${max}`);
          return { onEvent: (e) => orphanProjector?.onEvent(e) };
        },
      });
      if (orphanProjector) orphanProjector.stop();
      if (!orphanRalph.ok) {
        // stuck / max-retries / invalid / llm-error all surface as orphan-stuck
        // to the caller; the per-reason history is preserved on the result.
        return {
          ok: false,
          reason: 'orphan-stuck',
          orphanRalph,
          drift: {
            resolution: 'orphan-stuck',
            declared,
            actual,
            orphans,
          },
          lastStderr: `orphan-ralph terminated: ${orphanRalph.reason}`,
        };
      }
      // Resolved. declared may have grown (expand) or stayed same (revert).
      declared = orphanRalph.finalDeclared;
      stageList = declared.slice();
      resolution =
        orphanRalph.reason === 'resolved-expand'
          ? 'orphan-resolved-expand'
          : 'orphan-resolved-revert';
      break;
    }
  }

  // Stage list always includes tasks.md (for the [X] flip).
  const allStaged = [...stageList, tasksMdRel];
  const commitMessage = buildCommitMsg(task, plan, workspace);

  // One atomic commit attempt: flip → stage → commit; on failure roll back.
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
        try {
          await fs.writeFile(tasksMdPath, revertCheckbox(flipped, task.id));
        } catch {
          /* best-effort */
        }
        throw e;
      }
      await git.restoreStaged(allStaged, { cwd: repoRoot });
      await fs.writeFile(tasksMdPath, original);
      return { ok: false, feedback: e.stderr };
    }
  };

  const finalReason: CommitTaskTerminalReason =
    resolution === 'no-drift'
      ? 'success'
      : resolution === 'gen-fenced'
        ? 'gen-fenced'
        : resolution === 'orphan-resolved-expand'
          ? 'orphan-resolved-expand'
          : 'orphan-resolved-revert';
  const driftRecord: CommitDriftRecord = {
    resolution,
    declared,
    actual,
    orphans,
    ...(genScope ? { genScope } : {}),
  };

  const first = await performCommit();
  if (first.ok) {
    const orphan = await checkOrphans(git, repoRoot);
    if (orphan) return { ...orphan, drift: driftRecord, orphanRalph };
    return {
      ok: true,
      reason: finalReason,
      drift: driftRecord,
      orphanRalph,
    };
  }

  // Hook failure → ralph-loop with phase=git-hook (default maxRetries=2).
  let lastFeedback: string | undefined = first.feedback;
  const archive = input.archive;
  let hookProjector: LiveProjector | undefined;
  const ralph = await ralphLoop({
    phase: 'git-hook',
    maxRetries: input.maxHookRetries,
    initialFailure: first.feedback ?? '',
    buildRetryPrompt: (feedback) => buildHookRetryPrompt(task, allStaged, feedback),
    attempt: async () => {
      if (hookProjector) hookProjector.stop();
      hookProjector = undefined;
      const r = await performCommit();
      lastFeedback = r.feedback;
      return r;
    },
    prepareRound: (n, max) => {
      if (hookProjector) hookProjector.stop();
      hookProjector = startLiveProjector(progress, '🧠 Claude');
      hookProjector.setPrefix(`🪝 hook-ralph #${n}/${max}`);
      return { onEvent: (e) => hookProjector?.onEvent(e) };
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
  if (hookProjector) hookProjector.stop();

  if (ralph.ok) {
    const orphan = await checkOrphans(git, repoRoot);
    if (orphan) return { ...orphan, ralph, drift: driftRecord, orphanRalph };
    return {
      ok: true,
      reason: finalReason,
      ralph,
      drift: driftRecord,
      orphanRalph,
    };
  }
  return {
    ok: false,
    reason: 'hook-ralph-failed',
    ralph,
    lastStderr: ralph.finalFeedback,
    drift: driftRecord,
    orphanRalph,
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
async function checkOrphans(git: Git, repoRoot: string): Promise<CommitTaskResult | null> {
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
