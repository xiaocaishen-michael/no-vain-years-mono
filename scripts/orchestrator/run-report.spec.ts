import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { formatStopsCell, printRunReport } from './run-report.js';
import { loadFeature, type FeatureState } from './state.js';
import type { TaskRunResult } from './run-feature.js';

const FIXTURES_DIR = path.resolve(__dirname, '__fixtures__');

function setupFeature(): { featureDir: string; archiveBase: string } {
  const repoRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'orchestrator-run-report-'),
  );
  const featureDir = path.join(repoRoot, 'specs', '002-demo');
  fs.mkdirSync(featureDir, { recursive: true });
  for (const f of ['spec-happy.md', 'plan-happy.md', 'tasks-happy.md']) {
    const dst = f.replace(/-happy/, '');
    fs.copyFileSync(
      path.join(FIXTURES_DIR, f),
      path.join(featureDir, dst),
    );
  }
  const archiveBase = path.join(repoRoot, '.spec-kit', 'runs', '002-demo');
  fs.mkdirSync(archiveBase, { recursive: true });
  return { featureDir, archiveBase };
}

function writeArchive(
  archiveBase: string,
  taskId: string,
  summary: Record<string, unknown>,
  llmStdout?: string,
): void {
  const dir = path.join(archiveBase, taskId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify(summary));
  if (llmStdout !== undefined) {
    fs.writeFileSync(path.join(dir, 'attempt-0-llm-stream.jsonl'), llmStdout);
  }
}

function fakeResult(taskId: string, ok = true): TaskRunResult {
  return { taskId, ok, reason: ok ? 'success' : 'llm-error' };
}

describe('printRunReport', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  function load(): { state: FeatureState; archiveBase: string } {
    const { featureDir, archiveBase } = setupFeature();
    dirs.push(path.dirname(path.dirname(featureDir)));
    return { state: loadFeature(featureDir), archiveBase };
  }

  it('builds a per-task row from summary.json + parses model from llm-stream.jsonl', async () => {
    const { state, archiveBase } = load();
    writeArchive(
      archiveBase,
      'T001',
      {
        feature_id: '002-demo',
        task_id: 'T001',
        started_at: '2026-05-21T00:00:00Z',
        finished_at: '2026-05-21T00:03:00Z',
        elapsed_ms: 180000,
        ok: true,
        reason: 'success',
        head_before: 'aaa',
        head_after: 'bbb',
        file_ops: { create: 2, modify: 1, delete: 0, rename: 0 },
        attempts: [
          {
            n: 0,
            phase: 'initial',
            elapsed_ms: 175000,
            llm: {
              exit_code: 0,
              duration_ms: 170000,
              cost_usd: 0.5,
              num_turns: 12,
              permission_denials: 1,
              usage: {
                input_tokens: 50,
                output_tokens: 1000,
                cache_read_input_tokens: 800,
                cache_creation_input_tokens: 150,
              },
            },
            action: { exit_code: 0 },
            ok: true,
          },
        ],
        commit: { message: 'feat: ...', sha: 'bbbcccd', ralph_attempts: 0 },
      },
      '{"modelUsage":{"claude-sonnet-4-6":{"costUSD":0.5}}}',
    );

    const result = await printRunReport({
      state,
      results: [fakeResult('T001')],
      archiveBase,
      runStartedAt: new Date('2026-05-21T00:00:00Z'),
      runFinishedAt: new Date('2026-05-21T00:04:00Z'),
      writeStdout: false,
    });

    expect(result.rows).toHaveLength(1);
    const r = result.rows[0];
    expect(r.id).toBe('T001');
    expect(r.model).toBe('sonnet');
    expect(r.cost).toBeCloseTo(0.5);
    expect(r.turns).toBe(12);
    expect(r.attempts).toBe(1);
    expect(r.ralph).toBe(0);
    expect(r.files_created).toBe(2);
    expect(r.files_modified).toBe(1);
    expect(r.permission_denials).toBe(1);
    expect(r.commit_sha).toBe('bbbcccd');
    // cache hit = 800 / (800+150+50) = 80%
    expect(r.cache_hit_pct).toBeCloseTo(80, 0);
    expect(r.wall_min).toBeCloseTo(3, 1);
  });

  it('counts ralph attempts separately from initial', async () => {
    const { state, archiveBase } = load();
    writeArchive(
      archiveBase,
      'T001',
      {
        feature_id: '002-demo',
        task_id: 'T001',
        elapsed_ms: 600000,
        ok: true,
        reason: 'success',
        file_ops: { create: 0, modify: 1, delete: 0, rename: 0 },
        attempts: [
          { n: 0, phase: 'initial', elapsed_ms: 300000, llm: { cost_usd: 0.5, num_turns: 10 }, action: { exit_code: 1 }, ok: false },
          { n: 1, phase: 'verify-ralph', elapsed_ms: 200000, llm: { cost_usd: 0.3, num_turns: 5 }, action: { exit_code: 1 }, ok: false },
          { n: 2, phase: 'verify-ralph', elapsed_ms: 100000, llm: { cost_usd: 0.2, num_turns: 4 }, action: { exit_code: 0 }, ok: true },
        ],
      },
      'claude-sonnet-4-6',
    );

    const result = await printRunReport({
      state,
      results: [fakeResult('T001')],
      archiveBase,
      runStartedAt: new Date(),
      runFinishedAt: new Date(),
      writeStdout: false,
    });

    expect(result.rows[0].attempts).toBe(3);
    expect(result.rows[0].ralph).toBe(2);
    expect(result.rows[0].cost).toBeCloseTo(1.0, 6);
    expect(result.rows[0].turns).toBe(19);
  });

  it('totals sum across rows + counts model breakdown', async () => {
    const { state, archiveBase } = load();
    writeArchive(
      archiveBase,
      'T001',
      { elapsed_ms: 60000, ok: true, reason: 'success', file_ops: {}, attempts: [{ phase: 'initial', llm: { cost_usd: 0.4, num_turns: 8 } }] },
      'claude-sonnet-4-6',
    );
    writeArchive(
      archiveBase,
      'T002',
      { elapsed_ms: 120000, ok: false, reason: 'llm-error', file_ops: {}, attempts: [{ phase: 'initial', llm: { cost_usd: 0.6, num_turns: 15 } }] },
      'claude-opus-4-7',
    );

    const result = await printRunReport({
      state,
      results: [fakeResult('T001'), fakeResult('T002', false)],
      archiveBase,
      runStartedAt: new Date('2026-05-21T00:00:00Z'),
      runFinishedAt: new Date('2026-05-21T00:05:00Z'),
      writeStdout: false,
    });

    expect(result.totals.task_count).toBe(2);
    expect(result.totals.ok_count).toBe(1);
    expect(result.totals.fail_count).toBe(1);
    expect(result.totals.sonnet_count).toBe(1);
    expect(result.totals.opus_count).toBe(1);
    expect(result.totals.total_cost_usd).toBeCloseTo(1.0, 6);
    expect(result.totals.total_turns).toBe(23);
    expect(result.totals.run_wall_min).toBeCloseTo(5, 1);
  });

  it('writes _run-<ts>.md archive next to per-task dirs by default', async () => {
    const { state, archiveBase } = load();
    writeArchive(
      archiveBase,
      'T001',
      { elapsed_ms: 60000, ok: true, reason: 'success', file_ops: {}, attempts: [{ phase: 'initial', llm: { cost_usd: 0.4, num_turns: 8 } }] },
      'claude-sonnet-4-6',
    );

    const result = await printRunReport({
      state,
      results: [fakeResult('T001')],
      archiveBase,
      runStartedAt: new Date('2026-05-21T00:00:00Z'),
      runFinishedAt: new Date('2026-05-21T00:05:00Z'),
      writeStdout: false,
    });

    expect(result.archiveFilePath).toBeDefined();
    expect(fs.existsSync(result.archiveFilePath!)).toBe(true);
    const content = fs.readFileSync(result.archiveFilePath!, 'utf-8');
    expect(content).toContain(`# Orchestrator run report — ${state.featureId}`);
    expect(content).toContain('T001');
  });

  it('skips writing archive file when writeArchiveFile=false', async () => {
    const { state, archiveBase } = load();
    writeArchive(archiveBase, 'T001', { elapsed_ms: 1, ok: true, reason: 'success', file_ops: {}, attempts: [] }, '');

    const result = await printRunReport({
      state,
      results: [fakeResult('T001')],
      archiveBase,
      runStartedAt: new Date(),
      runFinishedAt: new Date(),
      writeStdout: false,
      writeArchiveFile: false,
    });

    expect(result.archiveFilePath).toBeUndefined();
  });

  it('returns empty rows + writes "(no tasks)" message when results empty', async () => {
    const { state, archiveBase } = load();
    const result = await printRunReport({
      state,
      results: [],
      archiveBase,
      runStartedAt: new Date(),
      runFinishedAt: new Date(),
      writeStdout: false,
      writeArchiveFile: false,
    });
    expect(result.rows).toHaveLength(0);
    expect(result.markdown).toContain('(no tasks executed in this run)');
  });

  it('handles result without matching summary.json (task aborted before archive)', async () => {
    const { state, archiveBase } = load();
    // No archive written
    const result = await printRunReport({
      state,
      results: [fakeResult('T999', false)],
      archiveBase,
      runStartedAt: new Date(),
      runFinishedAt: new Date(),
      writeStdout: false,
      writeArchiveFile: false,
    });
    expect(result.rows).toHaveLength(0);
  });

  it('collects stop_reason histogram from attempts[].llm.turns + renders compact cell + run-level section', async () => {
    const { state, archiveBase } = load();
    writeArchive(
      archiveBase,
      'T001',
      {
        elapsed_ms: 60000,
        ok: true,
        reason: 'success',
        file_ops: {},
        attempts: [
          {
            phase: 'initial',
            llm: {
              cost_usd: 0.5,
              num_turns: 27,
              turns: [
                ...Array.from({ length: 26 }, () => ({ stop_reason: 'tool_use' })),
                { stop_reason: 'end_turn' },
              ],
            },
          },
        ],
      },
      'claude-sonnet-4-6',
    );
    writeArchive(
      archiveBase,
      'T002',
      {
        elapsed_ms: 30000,
        ok: false,
        reason: 'error_max_turns',
        file_ops: {},
        attempts: [
          {
            phase: 'initial',
            llm: {
              cost_usd: 0.3,
              num_turns: 30,
              turns: [
                ...Array.from({ length: 29 }, () => ({ stop_reason: 'tool_use' })),
                { stop_reason: 'max_tokens' },
              ],
            },
          },
        ],
      },
      'claude-sonnet-4-6',
    );

    const result = await printRunReport({
      state,
      results: [fakeResult('T001'), fakeResult('T002', false)],
      archiveBase,
      runStartedAt: new Date(),
      runFinishedAt: new Date(),
      writeStdout: false,
      writeArchiveFile: false,
    });

    expect(result.rows[0].stops).toEqual({ tool_use: 26, end_turn: 1 });
    expect(result.rows[1].stops).toEqual({ tool_use: 29, max_tokens: 1 });

    expect(result.totals.stop_reason_histogram).toEqual({
      tool_use: 55,
      end_turn: 1,
      max_tokens: 1,
    });

    // Compact table cell — sorted by count desc, abbreviated names.
    expect(result.markdown).toContain('| tu26·end1 |');
    expect(result.markdown).toContain('| tu29·max1 |');

    // Run-level section.
    expect(result.markdown).toContain('## Stop-reason histogram');
    expect(result.markdown).toContain('`tool_use`: 55');
    expect(result.markdown).toContain('`max_tokens`: 1');
  });

  it('omits Stop-reason histogram section when no task has turns[] data', async () => {
    const { state, archiveBase } = load();
    writeArchive(
      archiveBase,
      'T001',
      {
        elapsed_ms: 60000,
        ok: true,
        reason: 'success',
        file_ops: {},
        attempts: [
          { phase: 'initial', llm: { cost_usd: 0.4, num_turns: 8 } }, // no turns[]
        ],
      },
      'claude-sonnet-4-6',
    );
    const result = await printRunReport({
      state,
      results: [fakeResult('T001')],
      archiveBase,
      runStartedAt: new Date(),
      runFinishedAt: new Date(),
      writeStdout: false,
      writeArchiveFile: false,
    });
    expect(result.rows[0].stops).toBeUndefined();
    expect(result.markdown).not.toContain('## Stop-reason histogram');
    // Table cell shows em-dash for missing data.
    expect(result.markdown).toMatch(/\| 8 \| — \|/);
  });
});

describe('formatStopsCell', () => {
  it('returns em-dash on undefined', () => {
    expect(formatStopsCell(undefined)).toBe('—');
  });

  it('returns em-dash on empty map', () => {
    expect(formatStopsCell({})).toBe('—');
  });

  it('abbreviates known stop_reasons and sorts by count desc', () => {
    expect(formatStopsCell({ tool_use: 26, end_turn: 1 })).toBe('tu26·end1');
    expect(formatStopsCell({ end_turn: 1, tool_use: 26 })).toBe('tu26·end1');
  });

  it('passes through unknown stop_reasons verbatim', () => {
    expect(formatStopsCell({ unknown_reason: 3, tool_use: 5 })).toBe(
      'tu5·unknown_reason3',
    );
  });

  it('breaks count ties alphabetically (stable output)', () => {
    expect(formatStopsCell({ end_turn: 5, max_tokens: 5 })).toBe('end5·max5');
  });
});
