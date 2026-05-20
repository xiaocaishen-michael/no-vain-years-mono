import * as fs from 'node:fs';
import * as path from 'node:path';
import { PlanAnalyzer, type ParsedPlan } from './parsers/plan.js';
import { SpecAnalyzer, type ParsedSpec } from './parsers/spec.js';
import { TasksAnalyzer, type ParsedTasks } from './parsers/tasks.js';

export interface FeatureState {
  featureId: string;
  featureDir: string;
  spec: ParsedSpec;
  plan: ParsedPlan;
  tasks: ParsedTasks;
}

export class FeatureFileMissingError extends Error {
  constructor(public readonly missing: string[]) {
    super(`feature directory missing required file(s): ${missing.join(', ')}`);
    this.name = 'FeatureFileMissingError';
  }
}

export class FeatureRefMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FeatureRefMismatchError';
  }
}

const REQUIRED_FILES = ['spec.md', 'plan.md', 'tasks.md'] as const;

export function loadFeature(featureDir: string): FeatureState {
  const absDir = path.resolve(featureDir);
  if (!fs.existsSync(absDir) || !fs.statSync(absDir).isDirectory()) {
    throw new FeatureFileMissingError([absDir]);
  }

  const missing = REQUIRED_FILES.filter(
    (f) => !fs.existsSync(path.join(absDir, f)),
  );
  if (missing.length > 0) {
    throw new FeatureFileMissingError(missing);
  }

  const spec = new SpecAnalyzer().parse(path.join(absDir, 'spec.md'));
  const plan = new PlanAnalyzer().parse(path.join(absDir, 'plan.md'));
  const tasks = new TasksAnalyzer().parse(
    path.join(absDir, 'tasks.md'),
    plan,
    spec,
  );

  if (plan.frontmatter.feature_id !== spec.frontmatter.feature_id) {
    throw new FeatureRefMismatchError(
      `plan.feature_id (${plan.frontmatter.feature_id}) ≠ spec.feature_id (${spec.frontmatter.feature_id})`,
    );
  }

  return {
    featureId: spec.frontmatter.feature_id,
    featureDir: absDir,
    spec,
    plan,
    tasks,
  };
}

export interface FeatureSummary {
  featureId: string;
  specStatus: ParsedSpec['frontmatter']['status'];
  planStatus: ParsedPlan['frontmatter']['status'];
  tasksStatus: ParsedTasks['frontmatter']['status'];
  workspaces: string[];
  endpoints: number;
  entities: number;
  userStories: number;
  functionalRequirements: number;
  totalTasks: number;
  pendingTasks: number;
  batches: { index: number; ids: string[] }[];
}

export function summarize(state: FeatureState): FeatureSummary {
  const batches = state.tasks.schedule.map((batch, i) => ({
    index: i,
    ids: batch.map((t) => t.id),
  }));
  return {
    featureId: state.featureId,
    specStatus: state.spec.frontmatter.status,
    planStatus: state.plan.frontmatter.status,
    tasksStatus: state.tasks.frontmatter.status,
    workspaces: state.plan.config.workspaces.map((w) => w.id),
    endpoints: state.plan.contracts.endpoints.length,
    entities: state.spec.entities.length,
    userStories: state.spec.userStories.length,
    functionalRequirements: state.spec.functionalRequirements.length,
    totalTasks: state.tasks.tasks.length,
    pendingTasks: state.tasks.tasks.filter((t) => t.status === 'pending').length,
    batches,
  };
}
