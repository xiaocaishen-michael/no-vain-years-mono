---
feature_id: 003-admin-ping
modules: [account]
owners: ["@xiaocaishen-michael"]
status: draft
created_at: "2026-05-22"
updated_at: "2026-05-22"
spec_kit_version: ">=0.8.5,<0.10.0"
orchestrator_compat: ">=0.2.0"

web_compat: na
agent_friction_observed: false

perf_budgets:
  - endpoint: "GET /api/v1/ping"
    p95_ms: 50
    p99_ms: 100

state_branches:
  - "authenticated admin (role=admin): GET /ping → 200 + { pong: true, traceId: <CLS uuid> }"
  - "authenticated non-admin (role=user or null): GET /ping → 403 Forbidden ProblemDetail with traceId"
  - "unauthenticated (missing / invalid / expired JWT): GET /ping → 401 Unauthorized ProblemDetail with traceId"
---

# Feature Specification: Admin-only Ping Endpoint

**Feature Branch**: `003-admin-ping`
**Created**: 2026-05-22
**Status**: Draft
**Input**: 测试基建 multi-layer test gate strategy (ADR-0040) Sandbox E2E 验证 feature

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Admin liveness check (Priority: P1)
<!-- us-meta: {"id":"US1","priority":"P1","independent_test":"admin curl GET /ping → 200 + traceId","trace_fr":["FR-001"]} -->

**Why this priority**: Sandbox E2E 验证需要一个 admin-only protected endpoint 触发 4 gate (state_branches schema / lefthook anti-mock / pr-validation checkbox / nx affected runtime-smoke); 选 admin role 而非简单 isAuthenticated 是为引入 fine-grained auth check.

**Independent Test**: Can be tested by issuing a valid admin JWT, curling `GET /api/v1/ping`, asserting 200 + body shape + `x-trace-id` header.

**Acceptance Scenarios**:

1. **Given** an account row with `role = 'admin'`, **When** the admin requests GET /api/v1/ping with valid JWT, **Then** receives 200 with `{ pong: true, traceId: <uuid> }` body and matching `x-trace-id` response header.
2. **Given** an account row with `role = 'user'` or null, **When** the non-admin requests GET /api/v1/ping with valid JWT, **Then** receives 403 Forbidden ProblemDetail (含 `code` / `traceId`).
3. **Given** any unauthenticated request (no JWT, expired JWT, malformed JWT), **When** GET /api/v1/ping, **Then** receives 401 Unauthorized ProblemDetail (含 `code` / `traceId`).

### Edge Cases

- JWT 含 admin claim 但 Account row 已 FROZEN/ANONYMIZED → 走 401 INVALID_CREDENTIALS (与 spec 001 timing-defense 一致, byte-identical to code-error)
- 高并发 ping → 复用 @nestjs/throttler default rate, 不引入新 limit

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001** [P1]: Server MUST expose `GET /api/v1/ping` endpoint. Returns HTTP 200 with `{ pong: true, traceId: string }` when account has `role = 'admin'`.
- **FR-002** [P1]: Endpoint MUST be protected by JWT auth. Missing / invalid JWT → 401 ProblemDetail with traceId.
- **FR-003** [P1]: Endpoint MUST enforce admin-only role check. Authenticated non-admin → 403 ProblemDetail with traceId.
- **FR-004** [P1]: All responses (200 / 401 / 403) MUST include `x-trace-id` response header matching body `traceId` (per ADR-0036).
- **FR-005** [P1]: Account schema MUST gain nullable `role` column (`'admin' | 'user' | null`). Default null (treated non-admin). Promotion via direct DB write only.

### Key Entities

- **Account.role** (new column): `String?` enum-like `'admin' | 'user' | null`. PG persisted. Not exposed in client responses (only consumed by admin guard).

## Success Criteria *(mandatory)*

- **SC-001**: 3 state branches each have ≥ 1 `it()` block in integration test using `Test.createTestingModule` (per 🚨 Testing Invariants EXHAUSTIVE BRANCHING).
- **SC-002**: `nx affected -t runtime-smoke` after change to `apps/server/src/account/web/ping.controller.ts` resolves to `[server, api-client, mobile]` (per ADR-0040 P2 cascade).
- **SC-003**: `pnpm exec nx run server:runtime-smoke` exits 0 with new admin-200 probe alongside existing 401 probe.
- **SC-004**: PR body 3 `### 🚨 部署与存活前置确认` checkboxes ticked, otherwise pr-validation.yml workflow blocks merge.

## Assumptions

- Admin role provisioning out of scope; via Prisma seed or manual DB write.
- No audit log / admin action telemetry.
- `role` claim added to JWT payload by phone-sms-auth use case at sign-in (lookup `Account.role` at issuance).
- Throttler default rate covers admin ping; no per-endpoint override.
