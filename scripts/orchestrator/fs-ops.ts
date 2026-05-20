import * as fs from 'node:fs';
import * as path from 'node:path';
import type { TaskFileOp } from './schemas/tasks.js';

export type FilePlanAction = 'create' | 'delete' | 'rename' | 'modify' | 'noop';

export interface FilePlanEntry {
  taskId?: string;
  op: TaskFileOp['op'];
  action: FilePlanAction;
  path: string;
  renameTo?: string;
  reason?: string;
}

export interface FileOpPlanResult {
  entries: FilePlanEntry[];
  warnings: string[];
}

export class FileOpPathEscapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FileOpPathEscapeError';
  }
}

function isInsideCwd(absPath: string, cwd: string): boolean {
  const rel = path.relative(cwd, absPath);
  return rel.length > 0 && !rel.startsWith('..') && !path.isAbsolute(rel);
}

export function planFileOps(
  workspaceCwd: string,
  files: TaskFileOp[],
  taskId?: string,
): FileOpPlanResult {
  const entries: FilePlanEntry[] = [];
  const warnings: string[] = [];
  const cwdAbs = path.resolve(workspaceCwd);
  const tag = taskId ?? '?';

  for (const f of files) {
    const absPath = path.resolve(cwdAbs, f.path);
    if (!isInsideCwd(absPath, cwdAbs)) {
      throw new FileOpPathEscapeError(
        `task ${tag} file ${f.path} resolves outside workspace cwd (${cwdAbs})`,
      );
    }

    const exists = fs.existsSync(absPath);

    switch (f.op) {
      case 'create':
        entries.push({
          taskId,
          op: 'create',
          action: exists ? 'noop' : 'create',
          path: absPath,
          reason: exists ? 'already exists' : undefined,
        });
        break;

      case 'delete':
        entries.push({
          taskId,
          op: 'delete',
          action: exists ? 'delete' : 'noop',
          path: absPath,
          reason: exists ? undefined : 'already absent',
        });
        break;

      case 'rename': {
        // Zod refine guarantees rename_to present; assert defensively.
        if (!f.rename_to) {
          throw new Error(
            `task ${tag} file ${f.path} op=rename missing rename_to (schema bug)`,
          );
        }
        const renameToAbs = path.resolve(cwdAbs, f.rename_to);
        if (!isInsideCwd(renameToAbs, cwdAbs)) {
          throw new FileOpPathEscapeError(
            `task ${tag} rename_to ${f.rename_to} resolves outside workspace cwd (${cwdAbs})`,
          );
        }
        if (!exists) {
          warnings.push(
            `task ${tag} file ${f.path} op=rename but source missing`,
          );
          entries.push({
            taskId,
            op: 'rename',
            action: 'noop',
            path: absPath,
            renameTo: renameToAbs,
            reason: 'source missing',
          });
        } else {
          entries.push({
            taskId,
            op: 'rename',
            action: 'rename',
            path: absPath,
            renameTo: renameToAbs,
          });
        }
        break;
      }

      case 'modify':
        if (!exists) {
          warnings.push(
            `task ${tag} file ${f.path} op=modify but file missing`,
          );
          entries.push({
            taskId,
            op: 'modify',
            action: 'noop',
            path: absPath,
            reason: 'file missing',
          });
        } else {
          entries.push({
            taskId,
            op: 'modify',
            action: 'modify',
            path: absPath,
          });
        }
        break;
    }
  }

  return { entries, warnings };
}

export class FileOpApplyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FileOpApplyError';
  }
}

export interface ApplyFileOpPlanOptions {
  // When true, modify+missing is a fatal error (matches the live-orchestrator
  // contract in plan § 5.3.15.2). When false, it's a no-op with a warning.
  // Default: true.
  strictModifyMissing?: boolean;
}

export interface ApplyResult {
  applied: FilePlanEntry[];
  warnings: string[];
}

export function applyFileOpPlan(
  result: FileOpPlanResult,
  options: ApplyFileOpPlanOptions = {},
): ApplyResult {
  const strict = options.strictModifyMissing ?? true;
  const applied: FilePlanEntry[] = [];
  const warnings: string[] = [...result.warnings];

  for (const entry of result.entries) {
    switch (entry.action) {
      case 'create':
        fs.mkdirSync(path.dirname(entry.path), { recursive: true });
        if (!fs.existsSync(entry.path)) {
          fs.writeFileSync(entry.path, '');
        }
        applied.push(entry);
        break;

      case 'delete':
        fs.rmSync(entry.path, { force: true });
        applied.push(entry);
        break;

      case 'rename':
        if (!entry.renameTo) {
          throw new FileOpApplyError(
            `entry op=rename for ${entry.path} missing renameTo (planner bug)`,
          );
        }
        fs.mkdirSync(path.dirname(entry.renameTo), { recursive: true });
        fs.renameSync(entry.path, entry.renameTo);
        applied.push(entry);
        break;

      case 'modify':
        // op=modify requires the file to exist; planner already verified.
        // Apply phase is a no-op (LLM writes content via Write tool).
        applied.push(entry);
        break;

      case 'noop':
        if (entry.op === 'modify' && entry.reason === 'file missing') {
          if (strict) {
            throw new FileOpApplyError(
              `task ${entry.taskId ?? '?'} file ${entry.path} op=modify but file missing`,
            );
          }
          // strict=false: surface as warning, skip
        }
        // Other noops (create/already exists, delete/already absent,
        // rename/source-missing) are skipped without error.
        break;
    }
  }

  return { applied, warnings };
}

export function summarizePlan(result: FileOpPlanResult): {
  create: number;
  delete: number;
  rename: number;
  modify: number;
  noop: number;
  warnings: number;
} {
  let create = 0;
  let del = 0;
  let rename = 0;
  let modify = 0;
  let noop = 0;
  for (const e of result.entries) {
    switch (e.action) {
      case 'create':
        create++;
        break;
      case 'delete':
        del++;
        break;
      case 'rename':
        rename++;
        break;
      case 'modify':
        modify++;
        break;
      case 'noop':
        noop++;
        break;
    }
  }
  return {
    create,
    delete: del,
    rename,
    modify,
    noop,
    warnings: result.warnings.length,
  };
}
