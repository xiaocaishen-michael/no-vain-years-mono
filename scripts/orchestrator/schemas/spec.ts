import { z } from 'zod';
import { IsoDateString } from './common.js';

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
  spec_kit_version: z.string(),
  orchestrator_compat: z.string(),
  contracts: z
    .array(
      z.object({
        path: z.string(),
        checksum: z.string().regex(/^sha256-/),
      }),
    )
    .optional(),
});

export const UsMetaSchema = z.object({
  id: z.string().regex(/^US\d+$/),
  priority: z.string().regex(/^P\d+$/),
  independent_test: z.string().min(10),
  trace_fr: z.array(z.string().regex(/^FR-\d{3}$/)).min(1),
});

export const FrMetaSchema = z.object({
  id: z.string().regex(/^FR-\d{3}$/),
  priority: z.enum(['must', 'should', 'may']),
  needs_clarification: z.boolean(),
  questions: z.array(
    z.object({
      q: z.string(),
      options: z.array(z.string()).optional(),
    }),
  ),
  trace_us: z.array(z.union([z.string().regex(/^US\d+$/), z.literal('GLOBAL')])).min(1),
  trace_sc: z.array(z.string().regex(/^SC-\d{3}$/)),
});

export const ClMetaSchema = z.object({
  id: z.string().regex(/^CL-\d{3}$/),
  resolved: z.boolean(),
  resolved_at: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  trace_fr: z.array(z.string().regex(/^FR-\d{3}$/)).min(1),
});

export const EntitySchema = z.object({
  id: z.string().regex(/^E\d+$/),
  name: z.string().min(1),
  domain: z.string().optional(),
  aggregate_root: z.boolean(),
  attrs: z.array(
    z.object({
      name: z.string(),
      type: z.string(),
      max_len: z.number().optional(),
      format: z.string().optional(),
    }),
  ),
  relations: z.array(
    z.object({
      to: z.string().regex(/^E\d+$/),
      kind: z.enum(['1:1', '1:N', 'N:1', 'N:N']),
    }),
  ),
});

export const EntitiesBlockSchema = z.object({
  entities: z.array(EntitySchema),
});

export type SpecFrontmatter = z.infer<typeof SpecFrontmatterSchema>;
export type UsMeta = z.infer<typeof UsMetaSchema>;
export type FrMeta = z.infer<typeof FrMetaSchema>;
export type ClMeta = z.infer<typeof ClMetaSchema>;
export type Entity = z.infer<typeof EntitySchema>;
