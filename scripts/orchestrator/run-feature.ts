import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { TaskArchive } from './archive.js';
import { applyFileOpPlan, FileOpApplyError, planFileOps } from './fs-ops.js';
import { buildCommitMsg, commitTask, type CommitTaskResult, type Git } from './git-flow.js';
import { queryGraph, resolveDefaultGraphPath, type CodeContext } from './graphify-client.js';
import {
  isClaudeMaxTurnsError,
  LlmInvokeError,
  type LlmClient,
  type LlmInvokeOptions,
  type LlmInvokeResult,
} from './llm-client.js';
import type { StreamEvent } from './llm-stream-parser.js';
import { startLiveProjector, type LiveProjector } from './live-projector.js';
import { buildPrompt } from './prompt-assembler.js';
import { ralphLoop, type RalphLoopResult } from './ralph-loop.js';
import type { Shell, ShellRunResult } from './shell.js';
import type { FeatureState } from './state.js';
import type { Workspace } from './schemas/plan.js';
import type { ParsedTask } from './schemas/tasks.js';

export interface RunFeatureDeps {
  llm: LlmClient;
  git: Git;
  shell: Shell;
  /** Override default `<repoRoot>/graphify-out/graph.json`. */
  graphJsonPath?: string;
  /** Override default LLM invoke opts (e.g. timeoutMs in tests). */
  llmInvokeOpts?: Partial<LlmInvokeOptions>;
  /**
   * Optional progress sink used by the CLI to surface live status in a
   * terminal UI (listr2). Tests can omit it; the orchestrator pipeline
   * stays silent when undefined.
   */
  progress?: TaskProgressSink;
}

/**
 * Sink for per-task progress events. The CLI wires a listr2-backed impl;
 * tests inject a FakeTaskProgressSink that records events for assertions.
 */
export interface TaskProgressSink {
  /** Called when runTask begins a task. Returns a handle for status updates. */
  start(task: ParsedTask): TaskProgressHandle;
}

export interface TaskProgressHandle {
  /** Update the human-readable status line for this task (e.g. "🧠 Claude (12s)").
   *  Triggers the dedup-gated stderr line write on phase change. */
  update(status: string): void;
  /** Update the live TTY status line only (no stderr write). Used for high-frequency
   *  heartbeat output (e.g. thinking_delta) where the underlying phase is unchanged
   *  but we want to surface live progress in the listr task row. Default: noop. */
  heartbeat?(text: string): void;
  /** Called when runTask is done (success or fail). Idempotent. */
  finish(result: TaskRunResult): void;
}

export interface RunFeatureOptions {
  /** Run only the named task (must be currently pending). */
  onlyTaskId?: string;
  /** Honor task-meta.parallel within each batch. Default false (all serial). */
  parallel?: boolean;
  /** Override default ralph-loop max retries for verify-command phase. */
  maxVerifyRetries?: number;
  /** Override default ralph-loop max retries for git-hook phase. */
  maxHookRetries?: number;
}

export type TaskRunReason =
  | 'success'
  | 'gen-fenced'
  | 'orphan-resolved-expand'
  | 'orphan-resolved-revert'
  | 'orphan-stuck'
  | 'llm-self-committed'
  | 'verify-ralph-failed'
  | 'hook-ralph-failed'
  | 'orphan-after-commit'
  | 'llm-error'
  | 'fs-ops-error'
  | 'workspace-missing'
  | 'skipped-completed';

export interface TaskRunResult {
  taskId: string;
  ok: boolean;
  reason: TaskRunReason;
  verifyRalph?: RalphLoopResult;
  commit?: CommitTaskResult;
  llmResult?: LlmInvokeResult;
  verifyExitCode?: number;
  message?: string;
  /** Where the task's sandbox lived. Set whenever the sandbox was created. */
  sandboxCwd?: string;
  /** True iff the sandbox was removed by the cleanup policy. */
  sandboxCleaned?: boolean;
}

export interface RunFeatureResult {
  ok: boolean;
  results: TaskRunResult[];
  failedAt?: string;
}

/**
 * Iterate the DAG batches and run each pending task. Stops on first task
 * failure (mirrors a typical CI / commit-driven workflow where a red task
 * blocks downstream batches).
 *
 * Per plan § 5.3.15.8.6 step 2: parallel-marked tasks within a batch may
 * be Promise.all'd; serial tasks run sequentially.
 */
export async function runFeature(
  state: FeatureState,
  deps: RunFeatureDeps,
  options: RunFeatureOptions = {},
): Promise<RunFeatureResult> {
  const results: TaskRunResult[] = [];
  const repoRoot = path.resolve(state.featureDir, '..', '..');

  for (const batch of state.tasks.schedule) {
    const candidates = batch
      .filter((t) => t.status === 'pending')
      .filter((t) => !options.onlyTaskId || t.id === options.onlyTaskId);
    if (candidates.length === 0) continue;

    const parallelGroup = options.parallel ? candidates.filter((t) => t.parallel) : [];
    const serialGroup = options.parallel ? candidates.filter((t) => !t.parallel) : candidates;

    if (parallelGroup.length > 0) {
      const parallelResults = await Promise.all(
        parallelGroup.map((t) => runTask(t, state, deps, repoRoot, options)),
      );
      results.push(...parallelResults);
      const failed = parallelResults.find((r) => !r.ok);
      if (failed) {
        if (failed.reason === 'orphan-stuck') warnOrphanStuck(failed);
        return { ok: false, results, failedAt: failed.taskId };
      }
    }

    for (const task of serialGroup) {
      const r = await runTask(task, state, deps, repoRoot, options);
      results.push(r);
      if (!r.ok) {
        if (r.reason === 'orphan-stuck') warnOrphanStuck(r);
        return { ok: false, results, failedAt: r.taskId };
      }
    }
  }

  return { ok: true, results };
}

/**
 * Surface an orphan-stuck halt to the operator. Per stop-signal #6: the
 * worktree is dirty with files outside the declared task.files; downstream
 * tasks would mistake them for their baseline. Print orphans + remediation
 * to stderr so the operator can decide expand-or-revert manually.
 */
function warnOrphanStuck(r: TaskRunResult): void {
  const orphans = r.commit?.drift?.orphans ?? [];
  const lines = [
    '',
    `⛔ Task ${r.taskId} orphan-stuck — feature run halted (PoC #22 hard-stop).`,
    '   The LLM touched files outside the declared task.files whitelist,',
    '   the orphan self-justify ralph could not resolve, and the working tree is dirty.',
  ];
  if (orphans.length > 0) {
    lines.push('   Orphans:');
    for (const f of orphans) lines.push(`     - ${f}`);
  }
  lines.push('   Resolve manually: inspect the worktree, choose `git restore` (hallucination)');
  lines.push('   or `git add` + edit tasks.md task.files (legitimate ripple), then re-run.');
  // eslint-disable-next-line no-console
  console.error(lines.join('\n'));
}

/**
 * Run a single task end-to-end (per plan § 5.3.15.8.6 steps 3.1-3.10).
 *
 * Sandbox lifecycle is owned here via try/finally: the inner pipeline
 * runs in `runTaskInner`; on the way out, `maybeCleanupSandbox` applies
 * `plan.config.sandbox.cleanup_on_{success,failure}`. The result always
 * carries `sandboxCwd` + `sandboxCleaned` for downstream logging.
 */
export async function runTask(
  task: ParsedTask,
  state: FeatureState,
  deps: RunFeatureDeps,
  repoRoot: string,
  options: RunFeatureOptions = {},
): Promise<TaskRunResult> {
  const progressHandle = deps.progress?.start(task);

  const workspace = state.plan.config.workspaces.find((w) => w.id === task.workspace);
  if (!workspace) {
    const r: TaskRunResult = {
      taskId: task.id,
      ok: false,
      reason: 'workspace-missing',
      message: `workspace "${task.workspace}" not declared in plan.config.workspaces`,
    };
    progressHandle?.finish(r);
    return r;
  }

  const sandboxCwd = resolveSandboxCwd(state, task);
  await fs.mkdir(sandboxCwd, { recursive: true });
  await fs.mkdir(path.join(sandboxCwd, '.spec-kit'), { recursive: true });

  const archiveDir = path.join(repoRoot, '.spec-kit', 'runs', state.featureId, task.id);
  const archive = await TaskArchive.create(archiveDir, {
    featureId: state.featureId,
    taskId: task.id,
  });

  let result: TaskRunResult;
  try {
    result = await runTaskInner(
      task,
      state,
      workspace,
      sandboxCwd,
      repoRoot,
      deps,
      options,
      archive,
      progressHandle,
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    archive.pushError(msg);
    result = {
      taskId: task.id,
      ok: false,
      reason: 'llm-error',
      message: msg,
    };
  }

  const sandboxCleaned = await maybeCleanupSandbox(
    sandboxCwd,
    state.plan.config.sandbox,
    result.ok,
  );
  archive.setSandbox(sandboxCwd, sandboxCleaned);
  try {
    archive.setHeadAfter(await deps.git.revParseHead({ cwd: repoRoot }));
  } catch {
    // best-effort: leave head_after unset
  }
  await archive.finalize({ ok: result.ok, reason: result.reason });

  const finalResult = { ...result, sandboxCwd, sandboxCleaned };
  progressHandle?.finish(finalResult);
  return finalResult;
}

/**
 * Map CommitTaskResult.{ok, reason} to TaskRunReason. Pulled out so the new
 * PoC #22 gate reasons (gen-fenced / orphan-resolved-* / orphan-stuck) can
 * round-trip into the run-report uniformly.
 */
function mapCommitReason(
  ok: boolean,
  reason: import('./git-flow.js').CommitTaskTerminalReason,
): TaskRunReason {
  if (ok) {
    switch (reason) {
      case 'success':
        return 'success';
      case 'gen-fenced':
        return 'gen-fenced';
      case 'orphan-resolved-expand':
        return 'orphan-resolved-expand';
      case 'orphan-resolved-revert':
        return 'orphan-resolved-revert';
      case 'llm-self-committed':
        return 'llm-self-committed';
      default:
        return 'success';
    }
  }
  switch (reason) {
    case 'orphan-after-commit':
      return 'orphan-after-commit';
    case 'orphan-stuck':
      return 'orphan-stuck';
    case 'hook-ralph-failed':
    case 'rollback-error':
    default:
      return 'hook-ralph-failed';
  }
}

async function runTaskInner(
  task: ParsedTask,
  state: FeatureState,
  workspace: Workspace,
  sandboxCwd: string,
  repoRoot: string,
  deps: RunFeatureDeps,
  options: RunFeatureOptions,
  archive: TaskArchive,
  progress: TaskProgressHandle | undefined,
): Promise<TaskRunResult> {
  const workspaceCwd = path.resolve(repoRoot, workspace.cwd);

  // 1. graphify code context
  progress?.update('📦 Loading code context (graphify)');
  const graphJsonPath = deps.graphJsonPath ?? resolveDefaultGraphPath(repoRoot);
  const scope = task.graphify_scope_override ?? workspace.graphify_scope;
  const codeCtx: CodeContext = queryGraph(graphJsonPath, scope);

  // 2. buildPrompt
  const prompt = buildPrompt({
    task,
    spec: state.spec,
    plan: state.plan,
    workspace,
    codeCtx,
  });

  // 3. Pre-emptive file ops. task.files[].path is repo-root-relative
  //    (see schemas/tasks.ts), so we resolve against repoRoot.
  try {
    const filePlan = planFileOps(repoRoot, task.files, task.id);
    applyFileOpPlan(filePlan);
  } catch (e) {
    return {
      taskId: task.id,
      ok: false,
      reason: 'fs-ops-error',
      message: e instanceof FileOpApplyError ? e.message : String(e),
    };
  }
  archive.recordFileOps(task.files);

  // 4. Write temp-prompt.md (informational; LLM invocation passes prompt
  // inline per Q-O2, but the file gives the operator a paper trail)
  const promptFile = path.join(sandboxCwd, '.spec-kit', 'temp-prompt.md');
  await fs.writeFile(promptFile, prompt);

  // 5. Invoke LLM. cwd MUST be repoRoot — prompt file paths are
  // repo-root-relative (see schemas/tasks.ts + prompt-assembler
  // fileOpsSection), so LLM Write/Edit must resolve them against the
  // real repo, not the sandbox (or output is lost on cleanup). Sandbox
  // remains the scratch home for temp-prompt.md paper trail.
  const llmInvokeOpts: LlmInvokeOptions = {
    cwd: repoRoot,
    ...deps.llmInvokeOpts,
  };
  // PoC blind spot 9: capture HEAD before LLM runs so commitTask can detect
  // a self-commit by the subprocess (despite prompt instruction not to).
  const headBefore = await deps.git.revParseHead({ cwd: repoRoot });
  archive.setHeadBefore(headBefore);

  // PoC blind spot #18: Sonnet hits max_turns on research-heavy tasks
  // (T006 ESLint boundaries). Escalate to Opus once before giving up.
  // The loop runs at most twice: initial (Sonnet/default) then Opus retry.
  let attempt = archive.reserveAttempt('initial');
  let { stdout: llmStdoutSink, stderr: llmStderrSink } = attempt.openLlmStreams();
  const llmStartedAt = Date.now();
  let projector = startLiveProjector(progress, '🧠 Claude');
  let llmResult: LlmInvokeResult | undefined;
  let llmFinalError: Error | undefined;

  const baseModel = llmInvokeOpts.model ?? process.env.ORCHESTRATOR_MODEL ?? 'sonnet';
  const canEscalateModel = baseModel.toLowerCase() !== 'opus';

  for (let pass = 0; pass < 2; pass++) {
    const passModel = pass === 1 ? 'opus' : undefined;
    try {
      llmResult = await deps.llm.invoke(prompt, {
        ...llmInvokeOpts,
        ...(passModel ? { model: passModel } : {}),
        streamStdout: llmStdoutSink,
        streamStderr: llmStderrSink,
        onEvent: (e) => projector.onEvent(e),
      });
      projector.stop();
      llmFinalError = undefined;
      break;
    } catch (e) {
      projector.stop();
      const err = e instanceof Error ? e : new Error(String(e));
      const shouldEscalate = pass === 0 && canEscalateModel && isClaudeMaxTurnsError(err);
      if (!shouldEscalate) {
        llmFinalError = err;
        break;
      }
      // Close out the failed attempt (Sonnet), open a fresh one for Opus.
      const failureDiff = await safeDiff(deps.git, repoRoot, task.files);
      const llmMetrics = err instanceof LlmInvokeError ? err.metrics : undefined;
      await attempt.finish({
        prompt,
        llmError: err,
        llmMetrics,
        diff: failureDiff,
        ok: false,
      });
      archive.pushError(`${baseModel} hit max_turns; escalating to Opus retry`);
      attempt = archive.reserveAttempt('initial');
      const newStreams = attempt.openLlmStreams();
      llmStdoutSink = newStreams.stdout;
      llmStderrSink = newStreams.stderr;
      projector = startLiveProjector(progress, '🧠 Claude (opus retry)');
    }
  }

  if (llmFinalError) {
    // PoC blind spot #15: capture diff + recover metrics from LlmInvokeError.
    const failureDiff = await safeDiff(deps.git, repoRoot, task.files);
    const llmMetrics = llmFinalError instanceof LlmInvokeError ? llmFinalError.metrics : undefined;
    await attempt.finish({
      prompt,
      llmError: llmFinalError,
      llmMetrics,
      diff: failureDiff,
      ok: false,
    });
    return {
      taskId: task.id,
      ok: false,
      reason: 'llm-error',
      message: llmFinalError.message,
    };
  }
  // llmResult is defined here (loop set it on success path).

  // 5b. Post-LLM check: assert declared task.files were actually filled.
  // Catches silent no-ops that verify_kind=typecheck would mask (an empty
  // .ts file is valid TS).
  const noOpError = await detectLlmNoOp(task, repoRoot, llmStartedAt);
  if (noOpError) {
    const diff = await safeDiff(deps.git, repoRoot, task.files);
    await attempt.finish({
      prompt,
      llmResult,
      actionStderr: noOpError,
      actionExitCode: -1,
      diff,
      ok: false,
    });
    return {
      taskId: task.id,
      ok: false,
      reason: 'llm-error',
      message: noOpError,
      llmResult,
    };
  }

  // 6. Verify command (in workspace.cwd, NOT sandbox)
  const verifyCmd = workspace.verify_commands[task.verify_kind];
  if (!verifyCmd) {
    await attempt.finish({ prompt, llmResult, ok: false });
    return {
      taskId: task.id,
      ok: false,
      reason: 'verify-ralph-failed',
      message: `workspace "${workspace.id}" has no verify_commands["${task.verify_kind}"]`,
      llmResult,
    };
  }
  progress?.update('🧪 verify command');
  const verifyResult = await deps.shell.run(verifyCmd, { cwd: workspaceCwd });
  const initialDiff = await safeDiff(deps.git, repoRoot, task.files);
  await attempt.finish({
    prompt,
    llmResult,
    actionStdout: verifyResult.stdout,
    actionStderr: verifyResult.stderr,
    actionExitCode: verifyResult.exitCode,
    diff: initialDiff,
    ok: verifyResult.exitCode === 0,
  });

  // 7. Ralph-loop on verify failure (verify-command phase, default max 3)
  let verifyRalph: RalphLoopResult | undefined;
  if (verifyResult.exitCode !== 0) {
    let lastVerify: ShellRunResult | undefined;
    // Fresh projector per round so each retry's elapsed timer starts at 0
    // and heartbeat dedup doesn't carry over phrases from the previous round.
    let roundProjector: LiveProjector | undefined;
    verifyRalph = await ralphLoop({
      phase: 'verify-command',
      maxRetries: options.maxVerifyRetries,
      initialFailure: verifyResult.stderr || verifyResult.stdout,
      buildRetryPrompt: (feedback, n) => buildVerifyRetryPrompt(task, feedback, n),
      attempt: async () => {
        if (roundProjector) roundProjector.stop();
        roundProjector = undefined;
        progress?.update('🧪 verify retry');
        const r = await deps.shell.run(verifyCmd, { cwd: workspaceCwd });
        lastVerify = r;
        return {
          ok: r.exitCode === 0,
          feedback: r.exitCode === 0 ? undefined : r.stderr || r.stdout,
        };
      },
      prepareRound: (n, max) => {
        if (roundProjector) roundProjector.stop();
        roundProjector = startLiveProjector(progress, '🧠 Claude');
        roundProjector.setPrefix(`⚠️  verify-ralph #${n}/${max}`);
        return { onEvent: (e) => roundProjector?.onEvent(e) };
      },
      llm: deps.llm,
      llmInvokeOpts,
      onRound: async (round) => {
        progress?.update(
          `⚠️  verify-ralph #${round.attemptNumber} (${round.outcome?.ok ? 'fixed' : 'still red'})`,
        );
        const attN = archive.reserveAttempt('verify-ralph');
        const diff = await safeDiff(deps.git, repoRoot, task.files);
        await attN.finish({
          prompt: round.retryPrompt,
          llmResult: round.llmResult,
          llmError: round.llmError,
          actionStdout: lastVerify?.stdout,
          actionStderr: lastVerify?.stderr,
          actionExitCode: lastVerify?.exitCode,
          diff,
          ok: round.outcome?.ok ?? false,
        });
      },
    });
    if (roundProjector) roundProjector.stop();
    if (!verifyRalph.ok) {
      return {
        taskId: task.id,
        ok: false,
        reason: 'verify-ralph-failed',
        verifyRalph,
        llmResult,
        verifyExitCode: verifyResult.exitCode,
      };
    }
  }

  // 8. Commit (with its own internal ralph-loop for git-hook phase)
  progress?.update('📝 git commit');
  const commit = await commitTask({
    task,
    plan: state.plan,
    workspace,
    tasksMdPath: path.join(state.featureDir, 'tasks.md'),
    repoRoot,
    git: deps.git,
    llm: deps.llm,
    llmInvokeOpts,
    maxHookRetries: options.maxHookRetries,
    headBefore,
    archive,
    progress,
  });

  const reason: TaskRunReason = mapCommitReason(commit.ok, commit.reason);

  if (commit.ok) {
    archive.setCommit({
      message: buildCommitMsg(task, state.plan, workspace),
      ralph_attempts: commit.ralph?.attempts ?? 0,
    });
  }

  return {
    taskId: task.id,
    ok: commit.ok,
    reason,
    verifyRalph,
    commit,
    llmResult,
    verifyExitCode: verifyResult.exitCode,
  };
}

/**
 * Tick a "<label> (Xs)" elapsed-time message into the progress sink every
 * second while a long-running step is in flight. Returns a stop fn the
 * caller MUST invoke when the step finishes (in both success and error
 * paths) so the interval doesn't leak.
 *
 * Fires an immediate "(0s)" tick so the sink shows the label right away
 * even if the step finishes before the first interval boundary.
 */
// LiveProjector / startLiveProjector moved to `./live-projector.ts` so
// git-flow.ts can wire hook-ralph + orphan-ralph rounds to the same live
// narration channel without a circular import.

async function safeDiff(
  git: Git,
  repoRoot: string,
  files?: ReadonlyArray<{ op: string; path: string }>,
): Promise<string> {
  try {
    const intentToAddPaths = files?.filter((f) => f.op === 'create').map((f) => f.path);
    return await git.diffWorkingTree({ cwd: repoRoot, intentToAddPaths });
  } catch {
    return '';
  }
}

/**
 * Apply the configured cleanup policy. Returns true if the sandbox was
 * removed; false if preserved (whether by policy or by an underlying rm error).
 */
export async function maybeCleanupSandbox(
  sandboxCwd: string,
  cfg: { cleanup_on_success: boolean; cleanup_on_failure: boolean },
  taskOk: boolean,
): Promise<boolean> {
  const shouldClean = taskOk ? cfg.cleanup_on_success : cfg.cleanup_on_failure;
  if (!shouldClean) return false;
  try {
    await fs.rm(sandboxCwd, { recursive: true, force: true });
    return true;
  } catch {
    // best-effort: if we can't rm, leave it for the operator
    return false;
  }
}

export function resolveSandboxCwd(state: FeatureState, task: ParsedTask): string {
  const tmpl = state.plan.config.sandbox.cwd_template;
  return tmpl
    .replace('{feature_id}', state.plan.frontmatter.feature_id)
    .replace('{task_id}', task.id);
}

/**
 * Returns an error message if the LLM didn't fulfill any declared
 * task.files write (op=create/modify untouched after llmStartedAt).
 * Returns null on success. Files with op=delete/rename are skipped
 * (their state is owned by pre-emptive fs-ops, not the LLM).
 *
 * Catches the silent no-op class of LLM failures that verify commands
 * like typecheck can't see (an empty .ts file is valid TS).
 */
export async function detectLlmNoOp(
  task: ParsedTask,
  repoRoot: string,
  llmStartedAt: number,
): Promise<string | null> {
  const targets = task.files.filter((f) => f.op === 'create' || f.op === 'modify');
  if (targets.length === 0) return null;

  const offenders: string[] = [];
  for (const f of targets) {
    const abs = path.resolve(repoRoot, f.path);
    let stat;
    try {
      stat = await fs.stat(abs);
    } catch {
      offenders.push(`${f.path} (missing)`);
      continue;
    }
    if (f.op === 'create' && stat.size === 0) {
      offenders.push(`${f.path} (empty after LLM)`);
      continue;
    }
    if (stat.mtimeMs < llmStartedAt) {
      const skew = llmStartedAt - stat.mtimeMs;
      // eslint-disable-next-line no-console
      console.error(
        `[#95-DEBUG detectLlmNoOp] ${f.path}: mtimeMs=${stat.mtimeMs} llmStartedAt=${llmStartedAt} skew=+${skew}ms (size=${stat.size})`,
      );
      offenders.push(`${f.path} (untouched after LLM)`);
    }
  }
  if (offenders.length === 0) return null;
  return [
    `LLM no-op detected for task ${task.id}: ${offenders.length} of ${targets.length} declared file(s) were not written.`,
    `Offending files: ${offenders.join(', ')}`,
    `(Verify commands like typecheck cannot catch empty/unfilled files, so the orchestrator checks file mtime/size post-LLM.)`,
  ].join('\n');
}

export function buildVerifyRetryPrompt(
  task: ParsedTask,
  feedback: string,
  attempt: number,
): string {
  return [
    `Task ${task.id}: verify_command failed (attempt #${attempt}).`,
    ``,
    `Below is the verify command stderr. Fix the issues without changing the task's intent (see the original prompt for spec context).`,
    ``,
    `Verify stderr:`,
    feedback.trim() || '(empty stderr)',
  ].join('\n');
}

// Silence unused-import lint when caller doesn't need types (re-export for convenience)
export type { Workspace };
