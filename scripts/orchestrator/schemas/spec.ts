import { z } from 'zod';
import { IsoDateString } from './common.js';

// spec.md is prose-only (per orchestrator-command-parity p1 §2): the body carries
// no orchestrator metadata (no us-meta/fr-meta/cl-meta comments, no entities JSON
// block — entities live in plan.md's orchestrator_config). The only machine-read
// surface left on spec.md is this frontmatter.
//
// Required = feature_id (load-bearing: 3-way equality with plan/tasks) + the SDD
// governance quartet (modules/owners/status/dates, per ADR-0024). The
// orchestrator-coupling version fields are optional — a clean `/speckit-specify`
// (P4 vanilla) spec carries none. NOT `.strict()`: unknown keys are stripped, so
// additive frontmatter never breaks parse (forward-compat, p1 §2.1).
export const SpecFrontmatterSchema = z.object({
  feature_id: z.string().regex(/^\d{3}-[a-z0-9-]+$/),
  modules: z.array(z.string()).min(1),
  owners: z.array(z.string().regex(/^@/)).min(1),
  status: z.enum([
    'draft',
    'clarified',
    'planned',
    'tasks-ready',
    'implementing',
    'implemented',
    'superseded',
    'archived',
  ]),
  created_at: IsoDateString,
  updated_at: IsoDateString,
  spec_kit_version: z.string().optional(),
  orchestrator_compat: z.string().optional(),
  contracts: z
    .array(
      z.object({
        path: z.string(),
        checksum: z.string().regex(/^sha256-/),
      }),
    )
    .optional(),
});

export const FR_PRIORITIES = ['must', 'should', 'may'] as const;
export type FrPriority = (typeof FR_PRIORITIES)[number];

export type SpecFrontmatter = z.infer<typeof SpecFrontmatterSchema>;
