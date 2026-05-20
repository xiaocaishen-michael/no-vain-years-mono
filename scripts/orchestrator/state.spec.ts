import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  FeatureFileMissingError,
  FeatureRefMismatchError,
  loadFeature,
  summarize,
} from './state.js';

const FIXTURES_DIR = path.resolve(__dirname, '__fixtures__');

function readFixture(name: string): string {
  return fs.readFileSync(path.join(FIXTURES_DIR, name), 'utf-8');
}

function makeFeatureDir(
  files: Partial<Record<'spec.md' | 'plan.md' | 'tasks.md', string>>,
): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orchestrator-state-'));
  for (const [name, body] of Object.entries(files)) {
    if (body !== undefined) {
      fs.writeFileSync(path.join(dir, name), body);
    }
  }
  return dir;
}

describe('loadFeature', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const d of dirs.splice(0)) {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  function track(dir: string): string {
    dirs.push(dir);
    return dir;
  }

  it('parses happy-path feature dir + topo DAG', () => {
    const dir = track(
      makeFeatureDir({
        'spec.md': readFixture('spec-happy.md'),
        'plan.md': readFixture('plan-happy.md'),
        'tasks.md': readFixture('tasks-happy.md'),
      }),
    );

    const state = loadFeature(dir);
    expect(state.featureId).toBe('002-account-profile-base');
    expect(state.spec.functionalRequirements).toHaveLength(2);
    expect(state.plan.contracts.endpoints).toHaveLength(2);
    expect(state.tasks.tasks).toHaveLength(8);
    expect(state.tasks.schedule.map((b) => b.map((t) => t.id))).toEqual([
      ['T001'],
      ['T002', 'T003'],
      ['T004'],
      ['T005'],
      ['T006'],
      ['T007'],
      ['T008'],
    ]);
  });

  it('throws when feature dir does not exist', () => {
    expect(() => loadFeature('/nonexistent/feature/dir')).toThrow(
      FeatureFileMissingError,
    );
  });

  it('throws when spec.md / plan.md / tasks.md missing', () => {
    const dir = track(
      makeFeatureDir({
        'spec.md': readFixture('spec-happy.md'),
        'plan.md': readFixture('plan-happy.md'),
      }),
    );
    expect(() => loadFeature(dir)).toThrowError(/tasks\.md/);
  });

  it('throws when plan.feature_id ≠ spec.feature_id', () => {
    const plan = readFixture('plan-happy.md').replace(
      '002-account-profile-base',
      '003-divergent-feature',
    );
    const dir = track(
      makeFeatureDir({
        'spec.md': readFixture('spec-happy.md'),
        'plan.md': plan,
        'tasks.md': readFixture('tasks-happy.md'),
      }),
    );
    // tasks parser fires first (it checks both spec + plan feature_id);
    // either error path is acceptable as long as the drift is caught.
    expect(() => loadFeature(dir)).toThrowError(
      /feature_id|003-divergent-feature/,
    );
  });
});

describe('summarize', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  it('extracts feature_id / counts / DAG batches', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orchestrator-state-'));
    dirs.push(dir);
    fs.writeFileSync(path.join(dir, 'spec.md'), readFixture('spec-happy.md'));
    fs.writeFileSync(path.join(dir, 'plan.md'), readFixture('plan-happy.md'));
    fs.writeFileSync(path.join(dir, 'tasks.md'), readFixture('tasks-happy.md'));

    const state = loadFeature(dir);
    const summary = summarize(state);

    expect(summary.featureId).toBe('002-account-profile-base');
    expect(summary.totalTasks).toBe(8);
    expect(summary.pendingTasks).toBe(8);
    expect(summary.workspaces).toEqual(['server-app', 'api-client', 'mobile']);
    expect(summary.endpoints).toBe(2);
    expect(summary.entities).toBe(1);
    expect(summary.userStories).toBe(1);
    expect(summary.functionalRequirements).toBe(2);
    expect(summary.batches).toHaveLength(7);
    expect(summary.batches[0]).toEqual({ index: 0, ids: ['T001'] });
    expect(summary.batches[1]).toEqual({ index: 1, ids: ['T002', 'T003'] });
  });
});

// Silence unused-helper warning when no test path triggers it.
void FeatureRefMismatchError;
