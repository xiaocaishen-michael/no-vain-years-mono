---
feature_id: [###-feature-name]
spec_ref: ./spec.md
plan_ref: ./plan.md
status: not-started
created_at: [YYYY-MM-DD]
updated_at: [YYYY-MM-DD]
orchestrator_compat: ">=0.1.0"
---

# Tasks: [FEATURE NAME]

<!--
Frontmatter contract (parsed by scripts/orchestrator/parsers/tasks.ts):
- feature_id / spec_ref / plan_ref must match plan.md and spec.md
- status: not-started → in-progress → completed
- orchestrator_compat: bumped by orchestrator when schema breaks

Task-meta marker contract (HTML comment immediately after each task heading):
{
  "id":                       "T001",                  // required, must equal heading id
  "workspace":                "server-app",            // required, must exist in plan.md
  "deps":                     ["T000"],                // required, array of task ids (DAG)
  "trace_us":                 ["US1"],                 // required, ≥ 1 user story
  "trace_fr":                 ["FR-001"],              // required, ≥ 1 functional requirement
  "trace_ep":                 ["EP1"],                 // optional, ≥ 1 endpoint (impl/gen tasks)
  "trace_sc":                 ["SC-001"],              // optional, ≥ 1 success criterion (perf IT tasks)
  "kind":                     "impl",                  // required: impl | gen | test-unit | test-integration | test-e2e | verification
  "verify_kind":              "test",                  // required, must be a key of plan.workspaces[ws].verify_commands (extended w/ "smoke" for runtime boot probes per ADR-0040)
  "files":                    [{"path":"...","op":"create"}],  // required, ops: create | modify | delete | rename
  "graphify_scope_override":  "...",                   // optional, narrows the workspace default AST scope
  "parallel":                 false,                   // optional default false (force serial during PoC for Ralph-loop traceability)
  "tdd_red_expected":         false                    // optional default false (true → test-unit tasks where the failing test ships first; orchestrator allows test red, typecheck must still pass)
}

Phase headings (## Server / ## API Client / ## Mobile / ## E2E) are
human-reading grouping only. Orchestrator parser ignores them; DAG is built
exclusively from task-meta.deps.

Status semantics (per task-closure preset):
- `- [ ]` = pending
- `- [X]` = completed (flipped by /speckit-implement after the task ships)
-->

## Server

- [ ] T001 [task title]
  <!-- task-meta: {"id":"T001","workspace":"server-app","deps":[],"trace_us":["US1"],"trace_fr":["FR-001"],"trace_ep":["EP1"],"kind":"impl","verify_kind":"test","files":[{"path":"apps/server/src/<module>/<file>.ts","op":"create"}]} -->

- [ ] T002 [task title — unit test, ships RED first then GREEN]
  <!-- task-meta: {"id":"T002","workspace":"server-app","deps":["T001"],"trace_us":["US1"],"trace_fr":["FR-001"],"kind":"test-unit","verify_kind":"test","files":[{"path":"apps/server/src/<module>/<file>.spec.ts","op":"create"}],"tdd_red_expected":true} -->

- [ ] T003 Verify Backend Physics — Server Runtime Smoke Verification
  <!-- task-meta: {"id":"T003","workspace":"server-app","deps":["T001","T002"],"trace_us":["US1"],"trace_fr":["FR-001"],"kind":"verification","verify_kind":"smoke","files":[]} -->
  <!--
  T003 is the gating runtime smoke per ADR-0040 multi-layer test gate. It
  invokes scripts/ci/server-boot-smoke.ts which spins up Testcontainers PG +
  Redis, boots the real Nest server, fires a real HTTP probe, and asserts
  RFC 9457 ProblemDetail shape + traceId end-to-end. NO mocks. T003 RED
  means the cascade (CLS / ValidationPipe / AuthGate / Filter) shipped
  broken — Ralph-loop must roll back impl. Do not skip; do not split.
  -->

## API Client

- [ ] T0XX [task title — typically OpenAPI export + codegen]
  <!-- task-meta: {"id":"T0XX","workspace":"api-client","deps":["T001"],"trace_us":["US1"],"trace_fr":["FR-001"],"trace_ep":["EP1"],"kind":"gen","verify_kind":"generate","files":[{"path":"packages/api-client/src/<file>.gen.ts","op":"create"}]} -->

## Mobile

- [ ] T0XX [task title]
  <!-- task-meta: {"id":"T0XX","workspace":"mobile","deps":["T0XX"],"trace_us":["US1"],"trace_fr":["FR-001"],"trace_ep":["EP1"],"kind":"impl","verify_kind":"typecheck","files":[{"path":"apps/mobile/src/features/<module>/<file>.tsx","op":"create"}]} -->

## E2E (optional)

- [ ] T0XX [task title]
  <!-- task-meta: {"id":"T0XX","workspace":"server-app","deps":["T0XX","T0XX"],"trace_us":["US1"],"trace_fr":["FR-001"],"trace_ep":["EP1"],"trace_sc":["SC-001"],"kind":"test-e2e","verify_kind":"e2e","files":[{"path":"apps/server/test/<feature>.e2e-spec.ts","op":"create"}]} -->
