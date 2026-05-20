#!/usr/bin/env -S node --no-warnings
import * as path from 'node:path';
import {
  FileOpPathEscapeError,
  planFileOps,
  summarizePlan,
  type FileOpPlanResult,
} from './fs-ops.js';
import { GitCli } from './git-flow.js';
import {
  queryGraph,
  resolveDefaultGraphPath,
  type CodeContext,
} from './graphify-client.js';
import { ClaudeCliClient } from './llm-client.js';
import { ConstitutionViolationError } from './parsers/plan.js';
import { buildPrompt, PromptAssemblyError } from './prompt-assembler.js';
import { runFeature, type TaskRunResult } from './run-feature.js';
import { RealShell } from './shell.js';
import {
  FeatureFileMissingError,
  FeatureRefMismatchError,
  loadFeature,
  summarize,
  type FeatureState,
} from './state.js';

const PROMPT_PREVIEW_LINES = 30;

interface CliArgs {
  featurePath: string;
  dryRun: boolean;
  live: boolean;
  only: string | null;
  parallel: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const positional: string[] = [];
  let dryRun = false;
  let live = false;
  let parallel = false;
  let only: string | null = null;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') {
      dryRun = true;
    } else if (a === '--live') {
      live = true;
    } else if (a === '--parallel') {
      parallel = true;
    } else if (a === '--only') {
      const next = argv[++i];
      if (!next) throw new CliUsageError('--only requires a task id (e.g. T001)');
      only = next;
    } else if (a.startsWith('--only=')) {
      only = a.slice('--only='.length);
    } else if (a === '-h' || a === '--help') {
      printUsage();
      process.exit(0);
    } else if (a.startsWith('-')) {
      throw new CliUsageError(`unknown flag: ${a}`);
    } else {
      positional.push(a);
    }
  }

  if (positional.length === 0) {
    throw new CliUsageError('feature path is required');
  }
  if (positional.length > 1) {
    throw new CliUsageError(
      `expected exactly 1 feature path, got ${positional.length}`,
    );
  }
  if (only !== null && !/^T\d{3}$/.test(only)) {
    throw new CliUsageError(
      `--only value must match /^T\\d{3}$/ (got "${only}")`,
    );
  }
  if (dryRun && live) {
    throw new CliUsageError('cannot pass both --dry-run and --live');
  }
  if (!dryRun && !live) {
    throw new CliUsageError('must pass either --dry-run or --live');
  }

  return { featurePath: positional[0], dryRun, live, only, parallel };
}

class CliUsageError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'CliUsageError';
  }
}

function printUsage(): void {
  // eslint-disable-next-line no-console
  console.error(
    [
      'Usage: orchestrate <feature-path> (--dry-run | --live) [options]',
      '',
      'Arguments:',
      '  <feature-path>     path to feature dir containing spec.md, plan.md, tasks.md',
      '',
      'Mode (exactly one required):',
      '  --dry-run          parse + DAG print + prompt preview, no LLM / no commit',
      '  --live             execute tasks: LLM + verify + commit (mutates repo)',
      '',
      'Options:',
      '  --only T<NNN>      run a single task by id',
      '  --parallel         honor task.parallel within batches (default all serial)',
      '  -h, --help         print this help',
    ].join('\n'),
  );
}

function printDryRunReport(state: FeatureState): void {
  const s = summarize(state);
  const lines: string[] = [];
  lines.push(`✅ Feature: ${s.featureId}`);
  lines.push(`   dir: ${state.featureDir}`);
  lines.push(
    `   status: spec=${s.specStatus} / plan=${s.planStatus} / tasks=${s.tasksStatus}`,
  );
  lines.push('');
  lines.push(`✅ Spec`);
  lines.push(`   user_stories=${s.userStories}`);
  lines.push(`   functional_requirements=${s.functionalRequirements}`);
  lines.push(`   entities=${s.entities}`);
  lines.push('');
  lines.push(`✅ Plan`);
  lines.push(`   workspaces=[${s.workspaces.join(', ')}]`);
  lines.push(`   api_endpoints=${s.endpoints}`);
  lines.push(`   constitution_check.passed=true ← GATE PASSED`);
  lines.push('');
  lines.push(`✅ Tasks`);
  lines.push(`   total=${s.totalTasks} pending=${s.pendingTasks}`);
  lines.push(`   DAG (${s.batches.length} batches):`);
  for (const b of s.batches) {
    lines.push(`     B${b.index}: ${b.ids.join(', ')}`);
  }
  lines.push('');
  appendFilePlanReport(state, lines);
  lines.push('');
  appendPromptPreviewReport(state, lines);
  // eslint-disable-next-line no-console
  console.log(lines.join('\n'));
}

function appendFilePlanReport(state: FeatureState, lines: string[]): void {
  const repoRoot = path.resolve(state.featureDir, '..', '..');
  const workspaceIds = new Set(state.plan.config.workspaces.map((w) => w.id));

  const pending = state.tasks.tasks.filter((t) => t.status === 'pending');
  if (pending.length === 0) {
    lines.push(`✅ File Plan`);
    lines.push(`   (no pending tasks — nothing to plan)`);
    return;
  }

  lines.push(`✅ File Plan (pre-emptive ops, dry-run only — no mutations)`);

  const totals = { create: 0, delete: 0, rename: 0, modify: 0, noop: 0 };
  const allWarnings: string[] = [];

  for (const task of pending) {
    if (!workspaceIds.has(task.workspace)) {
      lines.push(
        `   ${task.id}: ✗ workspace "${task.workspace}" not declared in plan.config.workspaces`,
      );
      continue;
    }

    let result: FileOpPlanResult;
    try {
      result = planFileOps(repoRoot, task.files, task.id);
    } catch (e) {
      if (e instanceof FileOpPathEscapeError) {
        lines.push(`   ${task.id}: ✗ ${e.message}`);
        continue;
      }
      throw e;
    }

    const sum = summarizePlan(result);
    totals.create += sum.create;
    totals.delete += sum.delete;
    totals.rename += sum.rename;
    totals.modify += sum.modify;
    totals.noop += sum.noop;
    for (const w of result.warnings) allWarnings.push(w);

    const parts = [
      sum.create && `create=${sum.create}`,
      sum.delete && `delete=${sum.delete}`,
      sum.rename && `rename=${sum.rename}`,
      sum.modify && `modify=${sum.modify}`,
      sum.noop && `noop=${sum.noop}`,
    ].filter(Boolean);
    lines.push(
      `   ${task.id} [${task.workspace}]: ${parts.length ? parts.join(' ') : '(no files)'}`,
    );
  }

  lines.push(
    `   totals: create=${totals.create} delete=${totals.delete} rename=${totals.rename} modify=${totals.modify} noop=${totals.noop}`,
  );

  if (allWarnings.length > 0) {
    lines.push('');
    lines.push(`⚠️  File Plan warnings (${allWarnings.length}):`);
    for (const w of allWarnings) lines.push(`   - ${w}`);
  }
}

function appendPromptPreviewReport(state: FeatureState, lines: string[]): void {
  const repoRoot = path.resolve(state.featureDir, '..', '..');
  const graphPath = resolveDefaultGraphPath(repoRoot);
  const workspaceById = new Map(
    state.plan.config.workspaces.map((w) => [w.id, w]),
  );

  const pending = state.tasks.tasks.filter((t) => t.status === 'pending');
  if (pending.length === 0) {
    lines.push(`✅ Prompt Preview`);
    lines.push(`   (no pending tasks)`);
    return;
  }

  lines.push(
    `✅ Prompt Preview (first ${PROMPT_PREVIEW_LINES} lines per task; dry-run only)`,
  );
  lines.push(`   graphify: ${graphPath}`);

  for (const task of pending) {
    const workspace = workspaceById.get(task.workspace);
    if (!workspace) {
      lines.push('');
      lines.push(
        `── ${task.id} [${task.workspace}]: ✗ workspace not declared in plan.config.workspaces`,
      );
      continue;
    }

    const scope = task.graphify_scope_override ?? workspace.graphify_scope;
    let codeCtx: CodeContext;
    try {
      codeCtx = queryGraph(graphPath, scope);
    } catch (e) {
      lines.push('');
      lines.push(`── ${task.id}: graphify query failed: ${(e as Error).message}`);
      continue;
    }

    let prompt: string;
    try {
      prompt = buildPrompt({
        task,
        spec: state.spec,
        plan: state.plan,
        workspace,
        codeCtx,
      });
    } catch (e) {
      if (e instanceof PromptAssemblyError) {
        lines.push('');
        lines.push(`── ${task.id}: ✗ ${e.message}`);
        continue;
      }
      throw e;
    }

    const promptLines = prompt.split('\n');
    const total = promptLines.length;
    const preview = promptLines.slice(0, PROMPT_PREVIEW_LINES);

    lines.push('');
    lines.push(`── ${task.id} [${task.workspace}] (${total} lines)`);
    for (const pl of preview) lines.push(`   │ ${pl}`);
    if (total > PROMPT_PREVIEW_LINES) {
      lines.push(`   │ … (${total - PROMPT_PREVIEW_LINES} more lines suppressed)`);
    }
  }
}

async function main(argv: string[]): Promise<number> {
  let args: CliArgs;
  try {
    args = parseArgs(argv);
  } catch (e) {
    if (e instanceof CliUsageError) {
      // eslint-disable-next-line no-console
      console.error(`error: ${e.message}\n`);
      printUsage();
      return 2;
    }
    throw e;
  }

  let state: FeatureState;
  try {
    state = loadFeature(args.featurePath);
  } catch (e) {
    if (
      e instanceof FeatureFileMissingError ||
      e instanceof FeatureRefMismatchError ||
      e instanceof ConstitutionViolationError
    ) {
      // eslint-disable-next-line no-console
      console.error(`✗ ${e.name}: ${e.message}`);
      return 1;
    }
    throw e;
  }

  if (args.dryRun) {
    printDryRunReport(state);
    return 0;
  }

  // Live execution. Wire real subprocess-backed dependencies and run.
  const shell = new RealShell();
  const llm = new ClaudeCliClient();
  const git = new GitCli(shell);

  // eslint-disable-next-line no-console
  console.error(
    `▶ orchestrator --live: ${state.tasks.tasks.filter((t) => t.status === 'pending').length} pending task(s) for ${state.featureId}`,
  );

  const result = await runFeature(state, { llm, git, shell }, {
    onlyTaskId: args.only ?? undefined,
    parallel: args.parallel,
  });

  printLiveSummary(result.results);

  if (!result.ok) {
    // eslint-disable-next-line no-console
    console.error(
      `✗ orchestrator failed at task ${result.failedAt ?? '?'} — sandbox cwd preserved for inspection`,
    );
    return 1;
  }
  // eslint-disable-next-line no-console
  console.error(`✅ orchestrator finished: all tasks committed`);
  return 0;
}

function printLiveSummary(results: TaskRunResult[]): void {
  const lines: string[] = ['', '── Task results ──'];
  for (const r of results) {
    const tag = r.ok ? '✅' : '✗';
    const detail = r.ok
      ? ''
      : ` (${r.reason}${r.message ? ': ' + r.message : ''})`;
    lines.push(`${tag} ${r.taskId}${detail}`);
    if (r.sandboxCwd && r.sandboxCleaned === false) {
      lines.push(`   ↳ sandbox preserved: ${r.sandboxCwd}`);
    }
  }
  // eslint-disable-next-line no-console
  console.error(lines.join('\n'));
}

const isCli =
  import.meta.url === `file://${process.argv[1]}` ||
  import.meta.url.endsWith(process.argv[1] ?? '');

if (isCli) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error(err?.stack ?? err);
      process.exit(1);
    });
}

export { main, parseArgs, printDryRunReport };
