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

## Phase 0 Research Gates *(mandatory)*

<!--
4 gate checklists added in mono-orchestrator-ready 0.2.1 (post-A-002 retro).
Each gate is a hard YES/NO question + space for "evidence link / N/A reason".
Plan cannot advance to status: tasks-ready until all 4 gates resolved.
LLM filling /speckit-plan MUST check each box explicitly — empty `[ ]` blocks
the next phase.
-->

### Gate 0.1 — Integration Smoke Gate

- [ ] **Server**: real-boot smoke (PG + Redis up via Testcontainers or equiv) covers each new endpoint at least once. unit + module tests are NOT sufficient.
- [ ] **Mobile / Web**: golden-path flow walked in a real Expo simulator / Web browser session for each new user story (P1).
- [ ] **Evidence**: <link to smoke commit / screenshot / log paste; or "N/A — explain"></evidence>

### Gate 0.2 — Cross-stack Vendor Intersection 6Q Card

Fill IF this plan introduces a new third-party package / SDK / tool. SKIP otherwise (mark N/A in evidence).

| # | Question | Answer |
|---|---|---|
| Q1 | Long-term maintenance signals? (commit cadence / contributors / sponsor) | [...] |
| Q2 | Could an already-installed tool cover this equivalently? | [...] |
| Q3 | Compatibility with current stack (NestJS / Prisma / Expo / pnpm / Nx)? | [...] |
| Q4 | LLM training-data coverage — does Claude know this package's API surface? | [...] |
| Q5 | Decoupling cost — how many weeks to replace if it goes stale? | [...] |
| Q6 | Risk surface — license / CN availability / supply-chain / known CVE? | [...] |

**Evidence**: <link to context7 grounding session / decision memo; or "N/A">

### Gate 0.3 — Legacy → Mono Delta Sweep Checklist

Fill IF this plan touches code / docs that were migrated from the prior meta-repo (Java/Spring → mono TS). Use `rg` from mono root to verify stale references are gone:

- [ ] No stale Java class names (e.g. `\bAccount\b` referring to `mbw-account/...` instead of `apps/server/src/account/...`)
- [ ] No stale Maven coords (`org.springframework.*` / `org.mapstruct.*` references in doc / spec)
- [ ] No stale ADR ids (meta-repo ADR-NNNN vs mono ADR-NNNN — verify against `docs/adr/README.md` index)
- [ ] No stale file paths (`mbw-*/src/main/java/...` Maven layout vs nx workspace `apps/server/src/...`)
- [ ] No stale API paths (Spring `@RequestMapping` defaults vs NestJS `@nestjs/swagger` decorators)
- [ ] **Evidence**: <`rg` output / grep result link; or "N/A — feature is mono-native">

### Gate 0.4 — ADR-deferred-mitigation Scan Step

Scan `docs/adr/*.md` for Open Questions that this feature would surface. Each impacted ADR must be:

1. listed below + state the deferred question
2. classified: `mitigated` / `accepted-as-is` / `escalated-to-new-ADR`

| ADR | Open Question affected | Classification | Mitigation / next step |
|---|---|---|---|
| ADR-XXXX | [question excerpt] | mitigated / accepted / escalated | [action] |

If none → write "no impacted Open Questions" + the `rg` you ran to verify.

**Evidence**: <link to ADR amend commit / new ADR PR; or "N/A">

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
