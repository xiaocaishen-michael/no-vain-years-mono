---
feature_id: [###-feature-name]
spec_ref: ./spec.md
status: drafted
created_at: [YYYY-MM-DD]
updated_at: [YYYY-MM-DD]
adr_refs: []
orchestrator_compat: ">=0.1.0"
context7_verified: []
---

# Implementation Plan: [FEATURE]

<!--
Frontmatter contract (parsed by scripts/orchestrator/parsers/plan.ts):
- feature_id: must equal spec.md frontmatter feature_id
- spec_ref: relative path to spec.md (orchestrator cross-loads)
- status: drafted → tasks-ready → implementing → implemented → superseded
- adr_refs: list of ADR ids this plan depends on (e.g., ["0019", "0020"])
- context7_verified: library names whose API surface was grounded via
  mcp__context7__query-docs during plan drafting (populated by
  context7-injection preset workflow)

JSON fenced block contract (HARD requirement, validated by Zod):
- orchestrator_config — workspaces + module_boundaries + sandbox + tech_constraints
- api_contracts        — endpoints + auth + request/response schemas
- constitution_check   — passed boolean + violations array

LLM JSON output failure → orchestrator triggers Ralph-loop to rewrite this file.
-->

## Summary *(mandatory)*

[1-2 sentences. Extract from spec.md: primary requirement + 1-line technical
approach. Do NOT restate full FR list — orchestrator already loads spec.md.]

## Orchestrator Config *(mandatory)*

<!--
Single JSON block, language tag MUST be `json orchestrator_config`.
- workspaces[].id is referenced by tasks-meta.workspace
- workspaces[].verify_commands keys must match tasks-meta.verify_kind values
- workspaces[].graphify_scope is the default AST scope per workspace
- module_boundaries enforces ESLint @nx/enforce-module-boundaries (per ADR-0020)
- sandbox.cwd_template uses {feature_id} and {task_id} placeholders
-->

```json orchestrator_config
{
  "workspaces": [
    {
      "id": "server-app",
      "nx_project": "server",
      "cwd": "apps/server",
      "lang": "typescript",
      "module_path": "src/modules/<module>",
      "verify_commands": {
        "build": "pnpm nx build server",
        "test": "pnpm nx test server --watch=false",
        "lint": "pnpm nx lint server",
        "typecheck": "pnpm nx run server:typecheck"
      },
      "graphify_scope": "apps/server/src/modules/<module>/**/*"
    }
  ],
  "module_boundaries": {
    "server-app": {
      "modules": ["<module>"],
      "allowed_imports": ["@nestjs/*", "libs/db"],
      "forbidden_imports": ["apps/mobile/**/*"]
    }
  },
  "sandbox": {
    "cwd_template": "/tmp/orchestrator-{feature_id}-{task_id}",
    "cleanup_on_success": true,
    "cleanup_on_failure": false
  },
  "tech_constraints": {
    "versions": [
      { "lib": "@nestjs/core", "version": "^11.0.0" }
    ],
    "perf_budget": [
      { "metric": "<metric description>", "target": "< 50ms", "trace_sc": ["SC-001"] }
    ],
    "scale": { "users": 10000, "rps": 100 }
  }
}
```

## API Contracts *(mandatory)*

<!--
Single JSON block, language tag MUST be `json api_contracts`.
- endpoints[].id is referenced by tasks-meta.trace_ep (impl/gen tasks)
- endpoints[].response_schema_ref points to an entity id from spec.md
- auth values: "public" | "user" | "admin"
- request/response use JSON Schema subset (type, properties, required)
-->

```json api_contracts
{
  "endpoints": [
    {
      "id": "EP1",
      "method": "GET",
      "path": "/v1/<resource>",
      "auth": "user",
      "request": {
        "type": "object",
        "properties": {},
        "required": []
      },
      "response_schema_ref": "E1",
      "trace_fr": ["FR-001"]
    }
  ]
}
```

## Constitution Check *(mandatory)*

<!--
Single JSON block, language tag MUST be `json constitution_check`.
Populated by /speckit-plan after evaluating .specify/memory/constitution.md.
If passed=false, fill the Complexity Tracking table below with justifications.
-->

```json constitution_check
{
  "passed": true,
  "violations": []
}
```

## Architecture Notes *(mandatory)*

<!--
Natural-language bullets. Orchestrator injects this section verbatim into
each task's temp-prompt.md during /speckit-implement, so keep each bullet
focused on a decision that an LLM coding agent needs to honor.
-->

- [Key design decision 1 — e.g., "Reuse AccountModule, add ProfileController + ProfileService"]
- [Key design decision 2 — e.g., "Prisma schema already has the field; no migration needed (per ADR-0019)"]
- [Key design decision 3 — e.g., "Phone-number masking happens at the response serializer, not at the entity layer"]

## Complexity Tracking

> Fill ONLY if Constitution Check reports violations that need justification.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|--------------------------------------|
| [e.g., cross-module import] | [current requirement] | [why a simpler design is insufficient] |
