import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CodeContext } from './graphify-client.js';
import { PlanAnalyzer } from './parsers/plan.js';
import { SpecAnalyzer } from './parsers/spec.js';
import { TasksAnalyzer } from './parsers/tasks.js';
import { buildPrompt, PromptAssemblyError } from './prompt-assembler.js';

const FIXTURES_DIR = path.resolve(__dirname, '__fixtures__');

function loadFixtures() {
  const spec = new SpecAnalyzer().parse(path.join(FIXTURES_DIR, 'spec-happy.md'));
  const plan = new PlanAnalyzer().parse(path.join(FIXTURES_DIR, 'plan-happy.md'));
  const tasks = new TasksAnalyzer().parse(path.join(FIXTURES_DIR, 'tasks-happy.md'), plan, spec);
  return { spec, plan, tasks };
}

const EMPTY_CODE_CTX: CodeContext = {
  scope: 'apps/server/src/modules/account',
  graphPath: '/fake/graph.json',
  nodes: [],
  warnings: [],
  truncated: false,
};

describe('buildPrompt', () => {
  it('throws when workspace lacks verify_commands[verify_kind]', () => {
    const { spec, plan, tasks } = loadFixtures();
    const task = tasks.tasks.find((t) => t.id === 'T001')!;
    const workspace = plan.config.workspaces.find((w) => w.id === task.workspace)!;
    // mutate a copy so other tests aren't affected
    const brokenWorkspace = {
      ...workspace,
      verify_commands: { other: 'pnpm test' },
    };
    expect(() =>
      buildPrompt({
        task,
        spec,
        plan,
        workspace: brokenWorkspace,
        codeCtx: EMPTY_CODE_CTX,
      }),
    ).toThrow(PromptAssemblyError);
  });

  it('renders all required sections for an impl task', () => {
    const { spec, plan, tasks } = loadFixtures();
    const task = tasks.tasks.find((t) => t.id === 'T001')!;
    const workspace = plan.config.workspaces.find((w) => w.id === task.workspace)!;

    const prompt = buildPrompt({
      task,
      spec,
      plan,
      workspace,
      codeCtx: EMPTY_CODE_CTX,
    });

    expect(prompt).toMatch(/# Task T001:/);
    expect(prompt).toMatch(/## Spec context/);
    expect(prompt).toMatch(/### User stories/);
    expect(prompt).toMatch(/### Functional requirements/);
    expect(prompt).toMatch(/### Entities/);
    expect(prompt).toMatch(/## Architecture Notes/);
    expect(prompt).toMatch(/## Tech constraints/);
    expect(prompt).toMatch(/## Module boundaries \(workspace=server-app\)/);
    expect(prompt).toMatch(/## API contract/);
    expect(prompt).toMatch(/EP1 GET \/v1\/account\/profile/);
    expect(prompt).toMatch(/## Codebase context/);
    expect(prompt).toMatch(/## Verify command/);
    expect(prompt).toMatch(/## File operations/);
  });

  it('filters spec FR/US by task.trace_fr / task.trace_us', () => {
    const { spec, plan, tasks } = loadFixtures();
    // T003 traces FR-002 only, not FR-001
    const task = tasks.tasks.find((t) => t.id === 'T003')!;
    const workspace = plan.config.workspaces.find((w) => w.id === task.workspace)!;

    const prompt = buildPrompt({ task, spec, plan, workspace, codeCtx: EMPTY_CODE_CTX });

    expect(prompt).toMatch(/FR-002/);
    // FR-001 may appear in entity refs or section names, but should NOT appear as a `- FR-001 ` bullet entry
    expect(prompt).not.toMatch(/- FR-001 \[/);
  });

  it('includes file-op guidance for create / modify / delete / rename', () => {
    const { spec, plan, tasks } = loadFixtures();
    const t1 = tasks.tasks.find((t) => t.id === 'T001')!; // create
    const t3 = tasks.tasks.find((t) => t.id === 'T003')!; // modify
    const wsServer = plan.config.workspaces.find((w) => w.id === 'server-app')!;

    const p1 = buildPrompt({ task: t1, spec, plan, workspace: wsServer, codeCtx: EMPTY_CODE_CTX });
    expect(p1).toMatch(/created empty:.*profile\.controller\.ts/);

    const p3 = buildPrompt({ task: t3, spec, plan, workspace: wsServer, codeCtx: EMPTY_CODE_CTX });
    expect(p3).toMatch(/modify existing:.*profile\.controller\.ts/);
  });

  it('renders code context from graphify when nodes present', () => {
    const { spec, plan, tasks } = loadFixtures();
    const task = tasks.tasks.find((t) => t.id === 'T001')!;
    const workspace = plan.config.workspaces.find((w) => w.id === task.workspace)!;
    const codeCtx: CodeContext = {
      scope: 'apps/server/src/modules/account',
      graphPath: '/x/graph.json',
      nodes: [
        {
          id: 'a',
          label: 'AccountService',
          source_file: 'apps/server/src/modules/account/account.service.ts',
          source_location: 'L10',
        },
      ],
      warnings: [],
      truncated: false,
    };
    const prompt = buildPrompt({ task, spec, plan, workspace, codeCtx });
    expect(prompt).toMatch(
      /AccountService @ apps\/server\/src\/modules\/account\/account\.service\.ts:L10/,
    );
  });

  it('falls back gracefully when task has no trace_ep', () => {
    const { spec, plan, tasks } = loadFixtures();
    const baseTask = tasks.tasks.find((t) => t.id === 'T001')!;
    const taskNoEp = { ...baseTask, trace_ep: undefined };
    const workspace = plan.config.workspaces.find((w) => w.id === baseTask.workspace)!;
    const prompt = buildPrompt({
      task: taskNoEp,
      spec,
      plan,
      workspace,
      codeCtx: EMPTY_CODE_CTX,
    });
    expect(prompt).toMatch(/\(task not bound to any endpoint\)/);
  });

  it('includes TDD-red annotation when tdd_red_expected', () => {
    const { spec, plan, tasks } = loadFixtures();
    const baseTask = tasks.tasks.find((t) => t.id === 'T002')!;
    const tddTask = { ...baseTask, tdd_red_expected: true };
    const workspace = plan.config.workspaces.find((w) => w.id === baseTask.workspace)!;
    const prompt = buildPrompt({
      task: tddTask,
      spec,
      plan,
      workspace,
      codeCtx: EMPTY_CODE_CTX,
    });
    expect(prompt).toMatch(/# Task T002:.*\(TDD red expected\)/);
  });

  it('reports missing module_boundaries for workspace gracefully', () => {
    const { spec, plan, tasks } = loadFixtures();
    const task = tasks.tasks.find((t) => t.id === 'T001')!;
    const workspace = plan.config.workspaces.find((w) => w.id === task.workspace)!;
    const planNoBoundary = {
      ...plan,
      config: { ...plan.config, module_boundaries: {} },
    };
    const prompt = buildPrompt({
      task,
      spec,
      plan: planNoBoundary,
      workspace,
      codeCtx: EMPTY_CODE_CTX,
    });
    expect(prompt).toMatch(/no module_boundaries declared/);
  });

  it('ends with a single trailing newline', () => {
    const { spec, plan, tasks } = loadFixtures();
    const task = tasks.tasks.find((t) => t.id === 'T001')!;
    const workspace = plan.config.workspaces.find((w) => w.id === task.workspace)!;
    const prompt = buildPrompt({ task, spec, plan, workspace, codeCtx: EMPTY_CODE_CTX });
    expect(prompt.endsWith('\n')).toBe(true);
    expect(prompt.endsWith('\n\n')).toBe(false);
  });
});

describe('buildPrompt — fixture file sanity', () => {
  it('all 3 happy-path fixtures parse without error', () => {
    // sanity check that fixture references didn't drift
    const { spec, plan, tasks } = loadFixtures();
    expect(spec.frontmatter.feature_id).toBe(plan.frontmatter.feature_id);
    expect(tasks.frontmatter.feature_id).toBe(plan.frontmatter.feature_id);
    expect(fs.existsSync(path.join(FIXTURES_DIR, 'tasks-happy.md'))).toBe(true);
  });
});
