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

/** Run a single task end-to-end (per plan § 5.3.15.8.6 steps 3.1-3.10). */
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

  const workspaceCwd = path.resolve(repoRoot, workspace.cwd);
  const sandboxCwd = resolveSandboxCwd(state, task);
  await fs.mkdir(sandboxCwd, { recursive: true });
  await fs.mkdir(path.join(sandboxCwd, '.spec-kit'), { recursive: true });

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

  // 5. Invoke LLM
  const llmInvokeOpts: LlmInvokeOptions = {
    cwd: sandboxCwd,
    ...deps.llmInvokeOpts,
  };
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

export function resolveSandboxCwd(
  state: FeatureState,
  task: ParsedTask,
): string {
  const tmpl = state.plan.config.sandbox.cwd_template;
  return tmpl
    .replace('{feature_id}', state.plan.frontmatter.feature_id)
    .replace('{task_id}', task.id);
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
