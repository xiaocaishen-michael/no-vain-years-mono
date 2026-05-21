---
feature_id: [###-feature-name]
modules: [<module>]
owners: ["@<github-handle>"]
status: draft
created_at: [YYYY-MM-DD]
updated_at: [YYYY-MM-DD]
spec_kit_version: ">=0.8.5,<0.10.0"
orchestrator_compat: ">=0.2.0"

# --- v2 fields (mono-orchestrator-ready 0.2.0, post-A-002 retro) ---

# 前端 Web 兼容性 (per ADR-0027). 值域: full | stub | untested | na.
# 当 stub | untested 时 web_compat_notes 必填,说明缺什么 / 哪条路径未测.
web_compat: na
# web_compat_notes: "Expo Web export 仅冒烟 login flow,onboarding+我的页未测"

# AI agent 协作摩擦观察 (per ADR-0024 amend + docs/conventions/ai-friction-catalog.md).
# 当 true 时 agent_friction_notes 必填,引 catalog 模式 ID + 一句话现象.
agent_friction_observed: false
# agent_friction_notes: "TS-Bundler-Mismatch — .js 后缀强加在 packages/auth 反 Metro"

# 性能预算 (per ADR-0039 SSOT). 实测靠 nightly perf IT;每个 user-facing endpoint 1 条.
# perf_budgets:
#   - endpoint: "POST /api/v1/phone-sms-auth"
#     p95_ms: 200
#     p99_ms: 500
#     timing_defense:       # 仅反枚举类 endpoint 填 (per ADR-0023 类场景)
#       diff_p95_ms: 50

# --- end v2 fields ---

# contracts (optional — fill when API surface stabilizes; orchestrator uses
# the sha256 checksum to detect server ↔ api-client ↔ mobile drift):
# contracts:
#   - path: "packages/api-client/src/<file>.interface.ts"
#     checksum: "sha256-..."
---

# Feature Specification: [FEATURE NAME]

<!--
Frontmatter contract (parsed by scripts/orchestrator/parsers/spec.ts):
- feature_id: NNN-slug, must equal directory name + git branch + PR slug
- modules: business-naming.md domain values; use [cross-cutting] only for
  platform-wide refactors
- owners: GitHub handles, prefix @, CODEOWNERS-compatible
- status: draft → clarified → planned → tasks-ready → implementing → implemented
         → superseded → archived

Marker contract (parsed by HTML-comment JSON):
- us-meta: every User Story heading
- fr-meta: every Functional Requirement bullet
- cl-meta: every resolved Clarifications entry
- entities: a single JSON fenced block in Key Entities

If the user-journey-mermaid preset is installed, a "## User Journey Diagram"
section is prepended above this file. Do not duplicate it here.
-->

## Clarifications

<!-- pending: run /speckit-clarify to populate. Each resolved entry gets a cl-meta marker. -->

## User Scenarios & Testing

### User Story 1 — [story title] (Priority: P1)
<!-- us-meta: {"id":"US1","priority":"P1","independent_test":"<one-line testable assertion>","trace_fr":["FR-001"]} -->

**Why this priority**: [why this story comes first]

**Acceptance Scenarios**:

1. **Given** [precondition], **When** [action], **Then** [expected outcome]
2. **Given** [precondition], **When** [action], **Then** [expected outcome]

### User Story 2 — [story title] (Priority: P2)
<!-- us-meta: {"id":"US2","priority":"P2","independent_test":"<one-line testable assertion>","trace_fr":["FR-002"]} -->

**Why this priority**: [why this story comes second]

**Acceptance Scenarios**:

1. **Given** [precondition], **When** [action], **Then** [expected outcome]

### Edge Cases

<!--
Edge cases attach to their parent FR via inline natural language:
  "(covers FR-001)" or "(covers FR-002, FR-003)"
Orchestrator parser uses fuzzy regex to extract these references — no per-row
marker needed.
-->

- [edge case description] (covers FR-XXX)
- [edge case description] (covers FR-XXX, FR-YYY)

## Requirements

### Functional Requirements

<!--
Every FR bullet MUST carry an fr-meta marker. trace_us accepts US ids OR the
literal string "GLOBAL" for infrastructure FRs that span all user stories.
trace_sc MAY be empty for infrastructure FRs (no metric to attach).
-->

- **FR-001**: System MUST [requirement] <!-- fr-meta: {"id":"FR-001","priority":"must","needs_clarification":false,"questions":[],"trace_us":["US1"],"trace_sc":["SC-001"]} -->
- **FR-002**: System MUST [requirement] <!-- fr-meta: {"id":"FR-002","priority":"must","needs_clarification":false,"questions":[],"trace_us":["US1"],"trace_sc":["SC-002"]} -->
- **FR-003**: [global / infra requirement] <!-- fr-meta: {"id":"FR-003","priority":"must","needs_clarification":false,"questions":[],"trace_us":["GLOBAL"],"trace_sc":[]} -->

### Key Entities

<!--
Single JSON fenced block. Orchestrator extracts the whole block at once and
validates with the EntitySchema (scripts/orchestrator/schemas/spec.ts).
- aggregate_root: required boolean; guides NestJS Service-layer codegen
- domain: optional DDD subdomain (decoupled from `modules` frontmatter)
- relations.kind: "1:1" | "1:N" | "N:1" | "N:N"
-->

```json entities
{
  "entities": [
    {
      "id": "E1",
      "name": "[EntityName]",
      "domain": "<module>",
      "aggregate_root": true,
      "attrs": [
        { "name": "id", "type": "string" }
      ],
      "relations": []
    }
  ]
}
```

## Success Criteria

<!--
SC entries use markdown bold ID only (no marker). Trace direction is inverse:
FR.fr-meta.trace_sc points here. Orchestrator builds the reverse index.
-->

- **SC-001**: [measurable success criterion — include the metric + target value]
- **SC-002**: [measurable success criterion]

## Assumptions

- [assumption 1 — what this spec relies on from other features / external systems]
- [assumption 2]
