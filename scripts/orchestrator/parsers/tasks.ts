import * as fs from 'node:fs';
import {
  ParsedTaskSchema,
  TaskMetaSchema,
  TasksFrontmatterSchema,
  type ParsedTask,
  type TasksFrontmatter,
} from '../schemas/tasks.js';
import { parseFrontmatterRaw } from './common/gray-matter-wrap.js';
import { parseJson5 } from './common/json5-cleanse.js';
import type { ParsedPlan } from './plan.js';
import type { ParsedSpec } from './spec.js';

export interface ParsedTasks {
  frontmatter: TasksFrontmatter;
  tasks: ParsedTask[];
  schedule: ParsedTask[][];
}

export class TasksAnalyzer {
  parse(filePath: string, plan: ParsedPlan, spec: ParsedSpec): ParsedTasks {
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    return this.parseContent(fileContent, plan, spec);
  }

  parseContent(fileContent: string, plan: ParsedPlan, spec: ParsedSpec): ParsedTasks {
    const { data, body } = parseFrontmatterRaw(fileContent);
    const frontmatter = TasksFrontmatterSchema.parse(data);

    if (frontmatter.feature_id !== plan.frontmatter.feature_id) {
      throw new Error(
        `tasks.md feature_id (${frontmatter.feature_id}) ≠ plan.md feature_id (${plan.frontmatter.feature_id})`,
      );
    }
    if (frontmatter.feature_id !== spec.frontmatter.feature_id) {
      throw new Error(
        `tasks.md feature_id (${frontmatter.feature_id}) ≠ spec.md feature_id (${spec.frontmatter.feature_id})`,
      );
    }

    const tasks = this.extractTasks(body);
    for (const t of tasks) {
      this.validateTask(t, plan, spec);
    }
    const schedule = this.topoSort(tasks);

    return { frontmatter, tasks, schedule };
  }

  private extractTasks(body: string): ParsedTask[] {
    // `- [ ] T<n> <title>\n  <!-- task-meta: {...} -->` or `- [X] ...`
    const regex = /^-\s+\[([ X])\]\s+(T\d{3})\s+(.+?)\n\s*<!--\s*task-meta:\s*([\s\S]*?)\s*-->/gm;
    const out: ParsedTask[] = [];
    let m: RegExpExecArray | null;
    while ((m = regex.exec(body)) !== null) {
      const [, checkbox, id, title, metaRaw] = m;
      const meta = parseJson5(metaRaw, TaskMetaSchema);
      if (meta.id !== id) {
        throw new Error(`task-meta id (${meta.id}) ≠ checkbox id (${id}) at "${title.trim()}"`);
      }
      const parsed = ParsedTaskSchema.parse({
        ...meta,
        status: checkbox === 'X' ? 'completed' : 'pending',
        title: title.trim(),
      });
      out.push(parsed);
    }
    return out;
  }

  private validateTask(t: ParsedTask, plan: ParsedPlan, spec: ParsedSpec): void {
    const ws = plan.config.workspaces.find((w) => w.id === t.workspace);
    if (!ws) {
      throw new Error(`task ${t.id} workspace '${t.workspace}' not in plan.workspaces`);
    }
    if (!(t.verify_kind in ws.verify_commands)) {
      throw new Error(
        `task ${t.id} verify_kind '${t.verify_kind}' not in workspace.verify_commands (have: ${Object.keys(ws.verify_commands).join(', ')})`,
      );
    }
    if (t.trace_ep) {
      for (const ep of t.trace_ep) {
        if (!plan.contracts.endpoints.find((e) => e.id === ep)) {
          throw new Error(`task ${t.id} trace_ep '${ep}' not in plan.api_contracts`);
        }
      }
    }
    // trace_fr cross-doc: each FR must exist in spec.functionalRequirements
    for (const fr of t.trace_fr) {
      if (!spec.functionalRequirements.find((s) => s.id === fr)) {
        throw new Error(`task ${t.id} trace_fr '${fr}' not in spec.requirements`);
      }
    }
  }

  private topoSort(tasks: ParsedTask[]): ParsedTask[][] {
    const idMap = new Map(tasks.map((t) => [t.id, t]));
    const indeg = new Map(tasks.map((t) => [t.id, 0]));
    const adj = new Map<string, string[]>(tasks.map((t) => [t.id, []]));

    for (const t of tasks) {
      for (const d of t.deps) {
        if (!idMap.has(d)) {
          throw new Error(`task ${t.id} dep '${d}' not found`);
        }
        adj.get(d)!.push(t.id);
        indeg.set(t.id, indeg.get(t.id)! + 1);
      }
    }

    const batches: ParsedTask[][] = [];
    let current = tasks.filter((t) => indeg.get(t.id) === 0);
    let processed = 0;
    while (current.length > 0) {
      batches.push(current);
      processed += current.length;
      const next: ParsedTask[] = [];
      for (const t of current) {
        for (const child of adj.get(t.id)!) {
          indeg.set(child, indeg.get(child)! - 1);
          if (indeg.get(child) === 0) next.push(idMap.get(child)!);
        }
      }
      current = next;
    }
    if (processed !== tasks.length) {
      throw new Error(`task DAG has cycle (processed ${processed} of ${tasks.length})`);
    }
    return batches;
  }
}
