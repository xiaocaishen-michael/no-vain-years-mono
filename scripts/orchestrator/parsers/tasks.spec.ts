import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { PlanAnalyzer, type ParsedPlan } from './plan.js';
import { SpecAnalyzer, type ParsedSpec } from './spec.js';
import { TasksAnalyzer } from './tasks.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, '..', '__fixtures__');
const happySpec = fs.readFileSync(path.join(FIXTURES, 'spec-happy.md'), 'utf-8');
const happyPlan = fs.readFileSync(path.join(FIXTURES, 'plan-happy.md'), 'utf-8');
const happyTasks = fs.readFileSync(path.join(FIXTURES, 'tasks-happy.md'), 'utf-8');

describe('TasksAnalyzer', () => {
  const analyzer = new TasksAnalyzer();
  let spec: ParsedSpec;
  let plan: ParsedPlan;

  beforeAll(() => {
    spec = new SpecAnalyzer().parseContent(happySpec);
    plan = new PlanAnalyzer().parseContent(happyPlan);
  });

  it('parses 8 tasks across 7 batches (matches plan §5.3.11 DAG)', () => {
    const result = analyzer.parseContent(happyTasks, plan, spec);

    expect(result.tasks).toHaveLength(8);
    expect(result.tasks.map((t) => t.id)).toEqual([
      'T001',
      'T002',
      'T003',
      'T004',
      'T005',
      'T006',
      'T007',
      'T008',
    ]);
    expect(result.tasks.every((t) => t.status === 'pending')).toBe(true);

    expect(result.schedule).toHaveLength(7);
    expect(result.schedule[0].map((t) => t.id)).toEqual(['T001']);
    expect(result.schedule[1].map((t) => t.id).sort()).toEqual(['T002', 'T003']);
    expect(result.schedule[6].map((t) => t.id)).toEqual(['T008']);
  });

  it('throws when tasks.feature_id ≠ plan.feature_id', () => {
    const bad = happyTasks.replace(
      'feature_id: 002-account-profile-base',
      'feature_id: 999-other-feature',
    );
    expect(() => analyzer.parseContent(bad, plan, spec)).toThrowError(/feature_id .* plan\.md/);
  });

  it('throws when task-meta id ≠ checkbox id', () => {
    const bad = happyTasks.replace(
      '- [ ] T001 GET /v1/account/profile endpoint + ProfileService\n  <!-- task-meta: {"id":"T001"',
      '- [ ] T001 GET /v1/account/profile endpoint + ProfileService\n  <!-- task-meta: {"id":"T999"',
    );
    expect(() => analyzer.parseContent(bad, plan, spec)).toThrowError(
      /task-meta id .* ≠ checkbox id/,
    );
  });

  it('throws when task references workspace not in plan', () => {
    const bad = happyTasks.replace(
      '"workspace":"server-app","deps":[],',
      '"workspace":"ghost-workspace","deps":[],',
    );
    expect(() => analyzer.parseContent(bad, plan, spec)).toThrowError(
      /workspace 'ghost-workspace' not in plan/,
    );
  });

  it('throws when verify_kind missing from workspace.verify_commands', () => {
    const bad = happyTasks.replace(
      '"verify_kind":"typecheck","files":[{"path":"apps/server/src/modules/account/profile.controller.ts","op":"create"}',
      '"verify_kind":"sniff","files":[{"path":"apps/server/src/modules/account/profile.controller.ts","op":"create"}',
    );
    expect(() => analyzer.parseContent(bad, plan, spec)).toThrowError(
      /verify_kind 'sniff' not in workspace\.verify_commands/,
    );
  });

  it('throws when DAG has a cycle', () => {
    const bad = happyTasks.replace(
      // Inject T008 → T001 dep (T008 already depends on T004/T007; making T001 depend on T008 closes cycle)
      '"id":"T001","workspace":"server-app","deps":[]',
      '"id":"T001","workspace":"server-app","deps":["T008"]',
    );
    expect(() => analyzer.parseContent(bad, plan, spec)).toThrowError(/cycle/);
  });

  it('throws when task.trace_fr is not in spec.requirements', () => {
    const bad = happyTasks.replace(
      '"trace_fr":["FR-001"],"trace_ep":["EP1"],"kind":"impl","verify_kind":"typecheck"',
      '"trace_fr":["FR-999"],"trace_ep":["EP1"],"kind":"impl","verify_kind":"typecheck"',
    );
    expect(() => analyzer.parseContent(bad, plan, spec)).toThrowError(
      /trace_fr 'FR-999' not in spec/,
    );
  });

  it('throws when task.trace_ep is not in plan.api_contracts', () => {
    const bad = happyTasks.replace(
      '"trace_fr":["FR-001"],"trace_ep":["EP1"]',
      '"trace_fr":["FR-001"],"trace_ep":["EP99"]',
    );
    expect(() => analyzer.parseContent(bad, plan, spec)).toThrowError(
      /trace_ep 'EP99' not in plan\.api_contracts/,
    );
  });
});
