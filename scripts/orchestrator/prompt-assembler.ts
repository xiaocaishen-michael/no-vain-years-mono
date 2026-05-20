import type { CodeContext } from './graphify-client.js';
import { formatCodeContext } from './graphify-client.js';
import type { ParsedPlan } from './parsers/plan.js';
import type { ParsedSpec } from './parsers/spec.js';
import type { Endpoint, Workspace } from './schemas/plan.js';
import type { ParsedTask } from './schemas/tasks.js';

export interface BuildPromptInput {
  task: ParsedTask;
  spec: ParsedSpec;
  plan: ParsedPlan;
  workspace: Workspace;
  codeCtx: CodeContext;
}

export class PromptAssemblyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PromptAssemblyError';
  }
}

export function buildPrompt(input: BuildPromptInput): string {
  const { task, spec, plan, workspace, codeCtx } = input;

  const verifyCmd = workspace.verify_commands[task.verify_kind];
  if (!verifyCmd) {
    throw new PromptAssemblyError(
      `workspace "${workspace.id}" has no verify_commands["${task.verify_kind}"] for task ${task.id}`,
    );
  }

  const sections: string[] = [];

  sections.push(taskHeader(task));
  sections.push(specSection(task, spec));
  sections.push(architectureNotesSection(plan));
  sections.push(techConstraintsSection(plan));
  sections.push(moduleBoundariesSection(plan, workspace));
  sections.push(apiContractSection(task, plan));
  sections.push(codebaseSection(codeCtx));
  sections.push(verifySection(workspace, task.verify_kind, verifyCmd));
  sections.push(fileOpsSection(task));

  return sections.join('\n\n').trim() + '\n';
}

function taskHeader(task: ParsedTask): string {
  const tdd = task.tdd_red_expected ? ' (TDD red expected)' : '';
  return [
    `# Task ${task.id}: ${task.title}${tdd}`,
    ``,
    `- workspace: ${task.workspace}`,
    `- kind: ${task.kind}`,
    `- verify_kind: ${task.verify_kind}`,
    `- deps: ${task.deps.length === 0 ? '(none)' : task.deps.join(', ')}`,
  ].join('\n');
}

function specSection(task: ParsedTask, spec: ParsedSpec): string {
  const lines: string[] = ['## Spec context'];

  const usMatched = spec.userStories.filter((us) =>
    task.trace_us.includes(us.meta.id),
  );
  if (usMatched.length > 0) {
    lines.push('');
    lines.push('### User stories');
    for (const us of usMatched) {
      lines.push(
        `- ${us.meta.id} [${us.meta.priority}] ${us.title}`,
      );
    }
  }

  const frMatched = spec.functionalRequirements.filter((fr) =>
    task.trace_fr.includes(fr.meta.id),
  );
  if (frMatched.length > 0) {
    lines.push('');
    lines.push('### Functional requirements');
    for (const fr of frMatched) {
      lines.push(`- ${fr.meta.id} [${fr.meta.priority}] ${fr.text}`);
    }
  }

  const scTargets = task.trace_sc ?? [];
  const scMatched = spec.successCriteria.filter((sc) =>
    scTargets.includes(sc.id),
  );
  if (scMatched.length > 0) {
    lines.push('');
    lines.push('### Success criteria');
    for (const sc of scMatched) {
      lines.push(`- ${sc.id}: ${sc.text}`);
    }
  }

  if (spec.entities.length > 0) {
    lines.push('');
    lines.push('### Entities');
    for (const e of spec.entities) {
      const attrs = e.attrs
        .map((a) => `${a.name}: ${a.type}`)
        .join(', ');
      lines.push(`- ${e.id} ${e.name}${e.domain ? ` (${e.domain})` : ''} { ${attrs} }`);
    }
  }

  return lines.join('\n');
}

function architectureNotesSection(plan: ParsedPlan): string {
  const notes = plan.architectureNotes.trim();
  if (!notes) {
    return '## Architecture Notes\n\n(none)';
  }
  return `## Architecture Notes\n\n${notes}`;
}

function techConstraintsSection(plan: ParsedPlan): string {
  const tc = plan.config.tech_constraints;
  const lines: string[] = ['## Tech constraints'];

  if (tc.versions.length > 0) {
    lines.push('');
    lines.push('### Versions');
    for (const v of tc.versions) {
      lines.push(`- ${v.lib} @ ${v.version}`);
    }
  }

  if (tc.perf_budget.length > 0) {
    lines.push('');
    lines.push('### Perf budget');
    for (const p of tc.perf_budget) {
      lines.push(`- ${p.metric}: ${p.target} (trace: ${p.trace_sc.join(', ')})`);
    }
  }

  return lines.join('\n');
}

function moduleBoundariesSection(plan: ParsedPlan, workspace: Workspace): string {
  const mb = plan.config.module_boundaries[workspace.id];
  const lines: string[] = [`## Module boundaries (workspace=${workspace.id})`];
  if (!mb) {
    lines.push('');
    lines.push(`(no module_boundaries declared for workspace "${workspace.id}")`);
    return lines.join('\n');
  }
  lines.push('');
  lines.push(`- modules: ${mb.modules.join(', ') || '(none)'}`);
  lines.push(
    `- allowed imports: ${mb.allowed_imports.join(', ') || '(none)'}`,
  );
  lines.push(
    `- forbidden imports: ${mb.forbidden_imports.join(', ') || '(none)'}`,
  );
  return lines.join('\n');
}

function apiContractSection(task: ParsedTask, plan: ParsedPlan): string {
  const targets = task.trace_ep ?? [];
  if (targets.length === 0) {
    return `## API contract\n\n(task not bound to any endpoint)`;
  }
  const matched = plan.contracts.endpoints.filter((e) =>
    targets.includes(e.id),
  );
  const lines: string[] = ['## API contract'];
  if (matched.length === 0) {
    lines.push('');
    lines.push(
      `(declared trace_ep=[${targets.join(', ')}] but none matched plan.api_contracts.endpoints)`,
    );
    return lines.join('\n');
  }
  for (const e of matched) {
    lines.push('');
    lines.push(formatEndpoint(e));
  }
  return lines.join('\n');
}

function formatEndpoint(e: Endpoint): string {
  return [
    `### ${e.id} ${e.method} ${e.path}`,
    `- auth: ${e.auth}`,
    `- response_schema_ref: ${e.response_schema_ref}`,
    `- request: ${e.request === null ? '(none)' : JSON.stringify(e.request)}`,
    `- trace_fr: ${e.trace_fr.join(', ')}`,
  ].join('\n');
}

function codebaseSection(codeCtx: CodeContext): string {
  return `## Codebase context\n\n${formatCodeContext(codeCtx)}`;
}

function verifySection(
  workspace: Workspace,
  verifyKind: string,
  verifyCmd: string,
): string {
  return [
    `## Verify command`,
    ``,
    `- verify_kind: ${verifyKind}`,
    `- command: \`${verifyCmd}\``,
    `- run from: \`${workspace.cwd}\` (workspace cwd)`,
  ].join('\n');
}

function fileOpsSection(task: ParsedTask): string {
  const lines: string[] = ['## File operations'];
  lines.push('');
  lines.push(
    `Your working directory is the **monorepo root**. The paths below are relative to it — when you call Write/Edit, pass these paths verbatim (do NOT prepend or strip any prefix).`,
  );
  lines.push('');
  lines.push(
    `Files in this task are pre-staged by the orchestrator. Do NOT \`mkdir\`, \`touch\`, or \`mv\` them yourself — use the Write/Edit tools to fill content.`,
  );
  lines.push('');
  for (const f of task.files) {
    switch (f.op) {
      case 'create':
        lines.push(`- created empty: \`${f.path}\` — write its full content`);
        break;
      case 'modify':
        lines.push(`- modify existing: \`${f.path}\``);
        break;
      case 'delete':
        lines.push(`- already deleted: \`${f.path}\` — do not recreate`);
        break;
      case 'rename':
        lines.push(
          `- already renamed: \`${f.path}\` → \`${f.rename_to}\` — edit at the new path`,
        );
        break;
    }
  }
  return lines.join('\n');
}
