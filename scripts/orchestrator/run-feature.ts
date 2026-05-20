import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  applyFileOpPlan,
  FileOpApplyError,
  planFileOps,
} from './fs-ops.js';
import {
  commitTask,
  type CommitTaskResult,
  type Git,
} from './git-flow.js';
import {
  queryGraph,
  resolveDefaultGraphPath,
  type CodeContext,
} from './graphify-client.js';
import {
  type LlmClient,
  type LlmInvokeOptions,
  type LlmInvokeResult,
} from './llm-client.js';
import { buildPrompt } from './prompt-assembler.js';
import { ralphLoop, type RalphLoopResult } from './ralph-loop.js';
import type { Shell } from './shell.js';
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
  | 'verify-ralph-failed'
  | 'hook-ralph-failed'
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

    const parallelGroup = options.parallel
      ? candidates.filter((t) => t.parallel)
      : [];
    const serialGroup = options.parallel
      ? candidates.filter((t) => !t.parallel)
      : candidates;

    if (parallelGroup.length > 0) {
      const parallelResults = await Promise.all(
        parallelGroup.map((t) =>
          runTask(t, state, deps, repoRoot, options),
        ),
      );
      results.push(...parallelResults);
      const failed = parallelResults.find((r) => !r.ok);
      if (failed) return { ok: false, results, failedAt: failed.taskId };
    }

    for (const task of serialGroup) {
      const r = await runTask(task, state, deps, repoRoot, options);
      results.push(r);
      if (!r.ok) return { ok: false, results, failedAt: r.taskId };
    }
  }

  return { ok: true, results };
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
  const workspace = state.plan.config.workspaces.find(
    (w) => w.id === task.workspace,
  );
  if (!workspace) {
    return {
      taskId: task.id,
      ok: false,
      reason: 'workspace-missing',
      message: `workspace "${task.workspace}" not declared in plan.config.workspaces`,
    };
  }

  const sandboxCwd = resolveSandboxCwd(state, task);
  await fs.mkdir(sandboxCwd, { recursive: true });
  await fs.mkdir(path.join(sandboxCwd, '.spec-kit'), { recursive: true });

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
    );
  } catch (e) {
    result = {
      taskId: task.id,
      ok: false,
      reason: 'llm-error',
      message: e instanceof Error ? e.message : String(e),
    };
  }

  const sandboxCleaned = await maybeCleanupSandbox(
    sandboxCwd,
    state.plan.config.sandbox,
    result.ok,
  );
  return { ...result, sandboxCwd, sandboxCleaned };
}

async function runTaskInner(
  task: ParsedTask,
  state: FeatureState,
  workspace: Workspace,
  sandboxCwd: string,
  repoRoot: string,
  deps: RunFeatureDeps,
  options: RunFeatureOptions,
): Promise<TaskRunResult> {
  const workspaceCwd = path.resolve(repoRoot, workspace.cwd);

  // 1. graphify code context
  const graphJsonPath =
    deps.graphJsonPath ?? resolveDefaultGraphPath(repoRoot);
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
  const llmStartedAt = Date.now();
  let llmResult: LlmInvokeResult;
  try {
    llmResult = await deps.llm.invoke(prompt, llmInvokeOpts);
  } catch (e) {
    return {
      taskId: task.id,
      ok: false,
      reason: 'llm-error',
      message: e instanceof Error ? e.message : String(e),
    };
  }

  // 5b. Post-LLM check: assert declared task.files were actually filled.
  // Catches silent no-ops that verify_kind=typecheck would mask (an empty
  // .ts file is valid TS).
  const noOpError = await detectLlmNoOp(task, repoRoot, llmStartedAt);
  if (noOpError) {
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
    return {
      taskId: task.id,
      ok: false,
      reason: 'verify-ralph-failed',
      message: `workspace "${workspace.id}" has no verify_commands["${task.verify_kind}"]`,
      llmResult,
    };
  }
  const verifyResult = await deps.shell.run(verifyCmd, { cwd: workspaceCwd });

  // 7. Ralph-loop on verify failure (verify-command phase, default max 3)
  let verifyRalph: RalphLoopResult | undefined;
  if (verifyResult.exitCode !== 0) {
    verifyRalph = await ralphLoop({
      phase: 'verify-command',
      maxRetries: options.maxVerifyRetries,
      initialFailure: verifyResult.stderr || verifyResult.stdout,
      buildRetryPrompt: (feedback, n) =>
        buildVerifyRetryPrompt(task, feedback, n),
      attempt: async () => {
        const r = await deps.shell.run(verifyCmd, { cwd: workspaceCwd });
        return {
          ok: r.exitCode === 0,
          feedback: r.exitCode === 0 ? undefined : r.stderr || r.stdout,
        };
      },
      llm: deps.llm,
      llmInvokeOpts,
    });
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
  });

  return {
    taskId: task.id,
    ok: commit.ok,
    reason: commit.ok ? 'success' : 'hook-ralph-failed',
    verifyRalph,
    commit,
    llmResult,
    verifyExitCode: verifyResult.exitCode,
  };
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

export function resolveSandboxCwd(
  state: FeatureState,
  task: ParsedTask,
): string {
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
  const targets = task.files.filter(
    (f) => f.op === 'create' || f.op === 'modify',
  );
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
