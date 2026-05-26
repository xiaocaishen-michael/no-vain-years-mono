import { z } from 'zod';
import { IsoDateString } from './common.js';

export const TasksFrontmatterSchema = z.object({
  feature_id: z.string().regex(/^\d{3}-[a-z0-9-]+$/),
  spec_ref: z.string(),
  plan_ref: z.string(),
  status: z.enum(['not-started', 'in-progress', 'completed', 'blocked']),
  created_at: IsoDateString,
  updated_at: IsoDateString,
  orchestrator_compat: z.string(),
});

// Path convention: `path` and `rename_to` are repo-root-relative
// (e.g. "apps/server/src/account/profile.controller.ts").
// fs-ops + git-flow both resolve against repoRoot; workspace.cwd is
// used only as the working dir for verify_command.
export const TaskFileOpSchema = z
  .object({
    path: z.string(),
    op: z.enum(['create', 'modify', 'delete', 'rename']),
    rename_to: z.string().optional(),
  })
  .refine((d) => d.op !== 'rename' || !!d.rename_to, {
    message: 'op=rename must include rename_to',
  });

export const TaskKindSchema = z.enum([
  'impl',
  'test-unit',
  'test-integration',
  'test-e2e',
  'gen',
  'migration',
  'docs',
  'config',
  // Runtime gate task per ADR-0040 (e.g. server-boot smoke): runs a
  // verify_command but produces no files. Excluded from BULK_KINDS
  // (drift-classifier) and allowed to declare empty `files` (see below).
  'verification',
]);

export const TaskMetaSchema = z.object({
  id: z.string().regex(/^T\d{3}$/),
  workspace: z.string(),
  deps: z.array(z.string().regex(/^T\d{3}$/)),
  trace_us: z.array(z.union([z.string().regex(/^US\d+$/), z.literal('GLOBAL')])),
  trace_fr: z.array(z.string().regex(/^FR-\d{3}$/)),
  trace_ep: z.array(z.string().regex(/^EP\d+$/)).optional(),
  trace_sc: z.array(z.string().regex(/^SC-\d{3}$/)).optional(),
  kind: TaskKindSchema,
  verify_kind: z.string(),
  // Non-empty for file-producing tasks; the parser (validateTask) enforces
  // `≥ 1` for every kind except `verification` (a runtime gate has no files).
  files: z.array(TaskFileOpSchema),
  /**
   * Optional explicit "bulk-output scope" for gen / migration tasks. When the
   * LLM legitimately touches files outside `files` but inside one of these
   * directory prefixes, the orchestrator silently expands the commit to include
   * them (gen-fenced path, no ralph) — addresses the openapi-ts / Prisma
   * migrate cases where the generator's output set is not statically knowable.
   *
   * Repo-root-relative directory prefixes (no leading slash; with or without
   * trailing slash, both accepted; the classifier normalizes).
   * Ignored when kind ∉ {gen, migration}.
   */
  gen_dirs: z.array(z.string()).optional(),
  graphify_scope_override: z.string().optional(),
  // Optional, default serial (`false`). The orchestrator only honors parallel
  // within a batch under the `--parallel` flag; PoC default is serial for
  // Ralph-loop traceability, so authors may omit it.
  parallel: z.boolean().optional().default(false),
  tdd_red_expected: z.boolean().optional(),
  tdd_pair: z
    .string()
    .regex(/^T\d{3}$/)
    .optional(),
});

export const ParsedTaskSchema = TaskMetaSchema.extend({
  status: z.enum(['pending', 'completed']),
  title: z.string(),
});

export type TasksFrontmatter = z.infer<typeof TasksFrontmatterSchema>;
export type TaskFileOp = z.infer<typeof TaskFileOpSchema>;
export type TaskKind = z.infer<typeof TaskKindSchema>;
export type TaskMeta = z.infer<typeof TaskMetaSchema>;
export type ParsedTask = z.infer<typeof ParsedTaskSchema>;
