#!/usr/bin/env -S node --no-warnings
import { ConstitutionViolationError } from './parsers/plan.js';
import {
  FeatureFileMissingError,
  FeatureRefMismatchError,
  loadFeature,
  summarize,
  type FeatureState,
} from './state.js';

interface CliArgs {
  featurePath: string;
  dryRun: boolean;
  only: string | null;
  parallel: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const positional: string[] = [];
  let dryRun = false;
  let parallel = false;
  let only: string | null = null;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') {
      dryRun = true;
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

  return { featurePath: positional[0], dryRun, only, parallel };
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
      'Usage: orchestrate <feature-path> [options]',
      '',
      'Arguments:',
      '  <feature-path>     path to feature dir containing spec.md, plan.md, tasks.md',
      '',
      'Options:',
      '  --dry-run          parse + DAG print, no LLM / no commit (PR-A scope)',
      '  --only T<NNN>      run a single task by id (not yet implemented)',
      '  --parallel         enable parallel batch execution (not yet implemented)',
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
  // eslint-disable-next-line no-console
  console.log(lines.join('\n'));
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

  // eslint-disable-next-line no-console
  console.error(
    [
      `✗ orchestrator main loop is not yet implemented (PR-A scope is --dry-run only).`,
      `  Use \`--dry-run\` to parse + print DAG.`,
      `  Subsequent PRs will add fs-ops / prompt-assembler / llm-client / git-flow / ralph-loop.`,
    ].join('\n'),
  );
  return 1;
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
