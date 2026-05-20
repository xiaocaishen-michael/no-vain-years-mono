import { z } from 'zod';
import { IsoDateString } from './common.js';

export const PlanFrontmatterSchema = z.object({
  feature_id: z.string().regex(/^\d{3}-[a-z0-9-]+$/),
  spec_ref: z.string(),
  status: z.enum(['drafted', 'approved', 'superseded']),
  created_at: IsoDateString,
  updated_at: IsoDateString,
  adr_refs: z.array(z.string().regex(/^\d{4}$/)),
  orchestrator_compat: z.string(),
  context7_verified: z.array(
    z.union([
      z.string(),
      z.object({ lib: z.string(), version: z.string(), source: z.string() }),
    ]),
  ),
});

export const WorkspaceSchema = z.object({
  id: z.string(),
  nx_project: z.string(),
  cwd: z.string(),
  lang: z.enum(['typescript', 'javascript', 'json']),
  module_path: z.string().optional(),
  feature_path: z.string().optional(),
  verify_commands: z.record(z.string(), z.string()),
  graphify_scope: z.string(),
});

export const OrchestratorConfigSchema = z.object({
  workspaces: z.array(WorkspaceSchema).min(1),
  module_boundaries: z.record(
    z.string(),
    z.object({
      modules: z.array(z.string()),
      allowed_imports: z.array(z.string()),
      forbidden_imports: z.array(z.string()),
    }),
  ),
  sandbox: z.object({
    cwd_template: z.string(),
    cleanup_on_success: z.boolean(),
    cleanup_on_failure: z.boolean(),
  }),
  tech_constraints: z.object({
    versions: z.array(z.object({ lib: z.string(), version: z.string() })),
    perf_budget: z.array(
      z.object({
        metric: z.string(),
        target: z.string(),
        trace_sc: z.array(z.string().regex(/^SC-\d{3}$/)),
      }),
    ),
    scale: z.object({ users: z.number(), rps: z.number() }),
  }),
});

const ResponseSchemaRef = z.string().regex(
  /^(E\d+|array\(E\d+\)|union\(E\d+(,\s*E\d+)*\))$/,
  {
    message:
      'response_schema_ref must be E<n> / array(E<n>) / union(E<n>, E<m>, ...) form',
  },
);

export const EndpointSchema = z.object({
  id: z.string().regex(/^EP\d+$/),
  method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']),
  path: z.string().regex(/^\//),
  auth: z.enum(['public', 'bearer', 'api_key']),
  request: z.any().nullable(),
  response_schema_ref: ResponseSchemaRef,
  trace_fr: z.array(z.string().regex(/^FR-\d{3}$/)).min(1),
});

export const ApiContractsSchema = z.object({
  endpoints: z.array(EndpointSchema),
});

export const ConstitutionCheckSchema = z.object({
  passed: z.boolean(),
  violations: z.array(
    z.object({
      rule_id: z.string(),
      justification: z.string(),
    }),
  ),
});

export type PlanFrontmatter = z.infer<typeof PlanFrontmatterSchema>;
export type Workspace = z.infer<typeof WorkspaceSchema>;
export type OrchestratorConfig = z.infer<typeof OrchestratorConfigSchema>;
export type Endpoint = z.infer<typeof EndpointSchema>;
export type ApiContracts = z.infer<typeof ApiContractsSchema>;
export type ConstitutionCheck = z.infer<typeof ConstitutionCheckSchema>;
