import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import type { CommitDriftRecord } from './git-flow.js';
import type { FeatureState } from './state.js';
import type { TaskRunResult } from './run-feature.js';

/**
 * End-of-run summary report. Aggregates per-task `summary.json` archives
 * from `<repoRoot>/.spec-kit/runs/<feature_id>/<taskId>/` into a markdown
 * table + run-level totals. Printed to stdout AND archived to
 * `_run-<ISO-timestamp>.md` next to per-task dirs for historical comparison.
 *
 * Per A-002 (2026-05-21) user request — orchestrator was missing a single
 * "look here for the per-task wall / turns / cost / model / ralph / status"
 * report; user was running ad-hoc Python scripts every time.
 */

export interface TaskRow {
  id: string;
  title: string;
  wall_min: number;
  turns: number;
  cost: number;
  model: 'sonnet' | 'opus' | 'haiku' | 'unknown';
  attempts: number;
  ralph: number;
  ok: boolean;
  reason: string;
  commit_sha?: string;
  files_created: number;
  files_modified: number;
  cache_hit_pct?: number;
  permission_denials: number;
  /**
   * Histogram of `attempts[].llm.turns[].stop_reason` for this task.
   * `undefined` when no `turns[]` data is available (legacy archives
   * written before the NDJSON parser shipped, or runs with
   * ORCHESTRATOR_PARTIAL_MESSAGES=0).
   */
  stops?: Record<string, number>;
  /** PoC #22 P1 drift telemetry, carried over from TaskRunResult.commit. */
  drift?: CommitDriftRecord;
}

export interface RunTotals {
  task_count: number;
  ok_count: number;
  fail_count: number;
  sonnet_count: number;
  opus_count: number;
  ralph_triggered_count: number;
  total_cost_usd: number;
  total_llm_wall_min: number;
  total_turns: number;
  /**
   * Run-wide aggregate of per-task `stops` maps. Empty when no task had
   * per-turn `stop_reason` data available.
   */
  stop_reason_histogram: Record<string, number>;
  run_started_at: Date;
  run_finished_at: Date;
  run_wall_min: number;
}

export interface PrintRunReportInput {
  state: FeatureState;
  results: TaskRunResult[];
  archiveBase: string;
  runStartedAt: Date;
  runFinishedAt: Date;
  /** Default true — also writes `_run-<ts>.md` next to per-task archives. */
  writeArchiveFile?: boolean;
  /** Default true — also writes to stdout. False is useful for tests. */
  writeStdout?: boolean;
}

export interface PrintRunReportResult {
  markdown: string;
  rows: TaskRow[];
  totals: RunTotals;
  archiveFilePath?: string;
}

/** Public entry point. */
export async function printRunReport(input: PrintRunReportInput): Promise<PrintRunReportResult> {
  const rows: TaskRow[] = [];
  for (const r of input.results) {
    const row = await loadTaskRow(input.archiveBase, r.taskId, input.state);
    if (row) {
      if (r.commit?.drift) row.drift = r.commit.drift;
      rows.push(row);
    }
  }
  const totals = buildTotals(rows, input.runStartedAt, input.runFinishedAt);
  const markdown = formatMarkdown(rows, totals, input.state);

  if (input.writeStdout !== false) {
    // eslint-disable-next-line no-console
    console.log('\n' + markdown);
  }

  let archiveFilePath: string | undefined;
  if (input.writeArchiveFile !== false) {
    const stamp = input.runFinishedAt
      .toISOString()
      .replace(/[:.]/g, '-')
      .replace('T', '_')
      .replace('Z', '');
    archiveFilePath = path.join(input.archiveBase, `_run-${stamp}.md`);
    await fsp.mkdir(input.archiveBase, { recursive: true });
    await fsp.writeFile(archiveFilePath, markdown);
  }

  return { markdown, rows, totals, archiveFilePath };
}

/** Read summary.json + parse model from llm-stream.jsonl. Returns null
 *  when summary.json doesn't exist (task never got to reserveAttempt). */
async function loadTaskRow(
  archiveBase: string,
  taskId: string,
  state: FeatureState,
): Promise<TaskRow | null> {
  const dir = path.join(archiveBase, taskId);
  const summaryPath = path.join(dir, 'summary.json');
  if (!fs.existsSync(summaryPath)) return null;

  const summary = JSON.parse(await fsp.readFile(summaryPath, 'utf-8')) as {
    elapsed_ms: number;
    ok: boolean;
    reason: string;
    head_before?: string;
    head_after?: string;
    file_ops?: { create?: number; modify?: number };
    commit?: { sha?: string };
    attempts: Array<{
      phase: string;
      llm?: {
        cost_usd?: number;
        num_turns?: number;
        permission_denials?: number;
        usage?: {
          input_tokens?: number;
          cache_read_input_tokens?: number;
          cache_creation_input_tokens?: number;
        };
        turns?: Array<{ stop_reason?: string }>;
      };
    }>;
  };

  const totalCost = summary.attempts.reduce((s, a) => s + (a.llm?.cost_usd ?? 0), 0);
  const totalTurns = summary.attempts.reduce((s, a) => s + (a.llm?.num_turns ?? 0), 0);
  const ralph = summary.attempts.filter((a) => a.phase === 'verify-ralph').length;

  const u0 = summary.attempts[0]?.llm?.usage;
  let cacheHit: number | undefined;
  if (u0) {
    const cr = u0.cache_read_input_tokens ?? 0;
    const cc = u0.cache_creation_input_tokens ?? 0;
    const inp = u0.input_tokens ?? 0;
    const denom = cr + cc + inp;
    if (denom > 0) cacheHit = (cr / denom) * 100;
  }

  // Model detection from llm-stream.jsonl: claude-cli emits the model name
  // in multiple events (system.init.model, message_start.message.model,
  // result.modelUsage keys). The substring grep is intentional — survives
  // model-name format changes / minor versions.
  let model: TaskRow['model'] = 'unknown';
  const streamPath = path.join(dir, 'attempt-0-llm-stream.jsonl');
  if (fs.existsSync(streamPath)) {
    const txt = await fsp.readFile(streamPath, 'utf-8');
    if (/claude-sonnet/.test(txt)) model = 'sonnet';
    else if (/claude-opus/.test(txt)) model = 'opus';
    else if (/claude-haiku/.test(txt)) model = 'haiku';
  }

  const stops = collectStopReasons(summary.attempts);

  const title = state.tasks.tasks.find((t) => t.id === taskId)?.title ?? '';

  // Prefer explicit commit.sha; else fall back to head_after if HEAD shifted.
  let commitSha: string | undefined = summary.commit?.sha;
  if (
    !commitSha &&
    summary.head_after &&
    summary.head_before &&
    summary.head_after !== summary.head_before
  ) {
    commitSha = summary.head_after;
  }

  return {
    id: taskId,
    title: title.slice(0, 60),
    wall_min: summary.elapsed_ms / 60_000,
    turns: totalTurns,
    cost: totalCost,
    model,
    attempts: summary.attempts.length,
    ralph,
    ok: summary.ok,
    reason: summary.reason,
    commit_sha: commitSha?.slice(0, 7),
    files_created: summary.file_ops?.create ?? 0,
    files_modified: summary.file_ops?.modify ?? 0,
    cache_hit_pct: cacheHit,
    permission_denials: summary.attempts[0]?.llm?.permission_denials ?? 0,
    stops,
  };
}

/**
 * Reduce `attempts[].llm.turns[].stop_reason` into a count map. Returns
 * undefined when no attempt carried a `turns[]` array — distinguishes
 * "task had per-turn data and the model never stopped" (empty map) from
 * "we have no data at all" (undefined → display as `—`).
 */
function collectStopReasons(
  attempts: Array<{
    llm?: { turns?: Array<{ stop_reason?: string }> };
  }>,
): Record<string, number> | undefined {
  let sawTurns = false;
  const counts: Record<string, number> = {};
  for (const a of attempts) {
    const turns = a.llm?.turns;
    if (!turns) continue;
    sawTurns = true;
    for (const t of turns) {
      if (typeof t.stop_reason === 'string') {
        counts[t.stop_reason] = (counts[t.stop_reason] ?? 0) + 1;
      }
    }
  }
  return sawTurns ? counts : undefined;
}

/** Map full stop_reason names to ≤3-char abbreviations for the table cell. */
const STOP_REASON_SHORT: Record<string, string> = {
  tool_use: 'tu',
  end_turn: 'end',
  max_tokens: 'max',
  stop_sequence: 'ss',
  pause_turn: 'pause',
  refusal: 'refusal',
};

/**
 * Format a stops map as a compact cell (e.g. `tu26·end1`). Returns `—`
 * when the map is undefined (no data) or empty. Stable sort: highest
 * count first, ties broken alphabetically so the rendering is deterministic.
 */
export function formatStopsCell(stops: Record<string, number> | undefined): string {
  if (!stops) return '—';
  const entries = Object.entries(stops);
  if (entries.length === 0) return '—';
  entries.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return entries.map(([k, n]) => `${STOP_REASON_SHORT[k] ?? k}${n}`).join('·');
}

function buildTotals(rows: TaskRow[], startedAt: Date, finishedAt: Date): RunTotals {
  const stop_reason_histogram: Record<string, number> = {};
  for (const r of rows) {
    if (!r.stops) continue;
    for (const [k, n] of Object.entries(r.stops)) {
      stop_reason_histogram[k] = (stop_reason_histogram[k] ?? 0) + n;
    }
  }
  return {
    task_count: rows.length,
    ok_count: rows.filter((r) => r.ok).length,
    fail_count: rows.filter((r) => !r.ok).length,
    sonnet_count: rows.filter((r) => r.model === 'sonnet').length,
    opus_count: rows.filter((r) => r.model === 'opus').length,
    ralph_triggered_count: rows.filter((r) => r.ralph > 0).length,
    total_cost_usd: rows.reduce((s, r) => s + r.cost, 0),
    total_llm_wall_min: rows.reduce((s, r) => s + r.wall_min, 0),
    total_turns: rows.reduce((s, r) => s + r.turns, 0),
    stop_reason_histogram,
    run_started_at: startedAt,
    run_finished_at: finishedAt,
    run_wall_min: (finishedAt.getTime() - startedAt.getTime()) / 60_000,
  };
}

function formatMarkdown(rows: TaskRow[], totals: RunTotals, state: FeatureState): string {
  const lines: string[] = [];
  lines.push(`# Orchestrator run report — ${state.featureId}`);
  lines.push('');
  lines.push(
    `Run: ${totals.run_started_at.toISOString()} → ${totals.run_finished_at.toISOString()} (${totals.run_wall_min.toFixed(1)} min wall)`,
  );
  lines.push('');

  if (rows.length === 0) {
    lines.push('_(no tasks executed in this run)_');
    return lines.join('\n');
  }

  lines.push(
    '| Task | Title | Wall | Turns | Stops | Cost | Model | Atts | Ralph | OK | Reason | Cache% | Files | Commit |',
  );
  lines.push('|---|---|---:|---:|---|---:|---|---:|---:|:---:|---|---:|---|---|');
  for (const r of rows) {
    const wall = `${r.wall_min.toFixed(1)}min`;
    const cost = `$${r.cost.toFixed(2)}`;
    const status = r.ok ? '✅' : '❌';
    const cacheStr = r.cache_hit_pct !== undefined ? `${r.cache_hit_pct.toFixed(0)}%` : '—';
    const filesStr = `${r.files_created}c/${r.files_modified}m`;
    const commitStr = r.commit_sha ? `\`${r.commit_sha}\`` : '—';
    const denialsStr = r.permission_denials > 0 ? ` (denials=${r.permission_denials})` : '';
    const stopsCell = formatStopsCell(r.stops);
    lines.push(
      `| ${r.id} | ${escapePipe(r.title)} | ${wall} | ${r.turns} | ${stopsCell} | ${cost} | ${r.model} | ${r.attempts} | ${r.ralph} | ${status} | ${escapePipe(r.reason)}${denialsStr} | ${cacheStr} | ${filesStr} | ${commitStr} |`,
    );
  }

  lines.push('');
  lines.push('## Totals');
  lines.push('');
  lines.push(
    `- Tasks: **${totals.task_count}** (ok=${totals.ok_count}, fail=${totals.fail_count})`,
  );
  lines.push(
    `- Model breakdown: sonnet=${totals.sonnet_count}, opus=${totals.opus_count}, ralph-triggered=${totals.ralph_triggered_count}`,
  );
  lines.push(
    `- Total cost: **$${totals.total_cost_usd.toFixed(2)}** · avg/task $${totals.task_count ? (totals.total_cost_usd / totals.task_count).toFixed(2) : '0.00'}`,
  );
  lines.push(
    `- Total LLM wall: **${totals.total_llm_wall_min.toFixed(1)} min** (sum across tasks; serial)`,
  );
  lines.push(`- Total turns: ${totals.total_turns}`);
  lines.push(
    `- Run wall-clock: **${totals.run_wall_min.toFixed(1)} min** (overhead = ${(totals.run_wall_min - totals.total_llm_wall_min).toFixed(1)} min for sandbox/graphify/commit)`,
  );

  // Stop-reason histogram (run-level aggregate of attempts[].llm.turns[].stop_reason).
  appendStopReasonSection(lines, totals.stop_reason_histogram);

  // Outliers
  if (rows.length >= 2) {
    const topCost = [...rows].sort((a, b) => b.cost - a.cost).slice(0, 3);
    lines.push('');
    lines.push('## Top 3 cost outliers');
    for (const r of topCost) {
      lines.push(
        `- **${r.id}** $${r.cost.toFixed(2)} / ${r.wall_min.toFixed(1)}min / ${r.turns}t — ${r.title}`,
      );
    }
  }

  // Failures detail
  const failures = rows.filter((r) => !r.ok);
  if (failures.length > 0) {
    lines.push('');
    lines.push('## Failures');
    for (const r of failures) {
      lines.push(`- **${r.id}** \`${r.reason}\` after ${r.attempts} attempt(s) — ${r.title}`);
    }
  }

  // Scope drift (PoC #22 P1) — orphan files the LLM touched outside its
  // declared task.files, and how the gate resolved them.
  appendDriftSection(lines, rows);

  return lines.join('\n');
}

function appendStopReasonSection(lines: string[], histogram: Record<string, number>): void {
  const entries = Object.entries(histogram);
  if (entries.length === 0) return;
  // Highest count first; ties alphabetical for stable output.
  entries.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const total = entries.reduce((s, [, n]) => s + n, 0);
  lines.push('');
  lines.push('## Stop-reason histogram');
  lines.push('');
  lines.push('Aggregate of `attempts[].llm.turns[].stop_reason` across all tasks in this run.');
  lines.push('');
  for (const [k, n] of entries) {
    const pct = total > 0 ? ` (${((n / total) * 100).toFixed(0)}%)` : '';
    lines.push(`- \`${k}\`: ${n}${pct}`);
  }
}

function appendDriftSection(lines: string[], rows: TaskRow[]): void {
  const driftRows = rows.filter((r) => r.drift && r.drift.resolution !== 'no-drift');
  if (driftRows.length === 0) return;

  // Resolution histogram across all rows that have a drift record.
  const counts: Record<CommitDriftRecord['resolution'], number> = {
    'no-drift': 0,
    'gen-fenced': 0,
    'orphan-resolved-expand': 0,
    'orphan-resolved-revert': 0,
    'orphan-stuck': 0,
    'llm-self-committed-skipped': 0,
  };
  for (const r of rows) {
    if (r.drift) counts[r.drift.resolution] += 1;
  }

  lines.push('');
  lines.push('## Scope drift (PoC #22 gate)');
  lines.push('');
  lines.push('Resolution histogram (per-task outcome of the kind-aware drift gate):');
  lines.push('');
  for (const [k, n] of Object.entries(counts)) {
    if (n > 0) lines.push(`- \`${k}\`: ${n}`);
  }
  lines.push('');
  lines.push('Tasks with drift:');
  for (const r of driftRows) {
    const d = r.drift!;
    const orphCount = d.orphans.length;
    const scope = d.genScope ? ` scope=\`${d.genScope.join(', ')}\`` : '';
    lines.push(`- **${r.id}** \`${d.resolution}\` — ${orphCount} orphan file(s)${scope}`);
    if (d.orphans.length > 0 && d.orphans.length <= 10) {
      for (const f of d.orphans) lines.push(`    - ${f}`);
    } else if (d.orphans.length > 10) {
      for (const f of d.orphans.slice(0, 5)) lines.push(`    - ${f}`);
      lines.push(`    - … (+${d.orphans.length - 5} more)`);
    }
  }
}

function escapePipe(s: string): string {
  return s.replace(/\|/g, '\\|');
}
