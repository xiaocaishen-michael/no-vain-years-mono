---
feature_id: 002-account-profile-base
spec_ref: ./spec.md
plan_ref: ./plan.md
status: in-progress
created_at: 2026-05-20
updated_at: 2026-05-20
orchestrator_compat: ">=0.1.0"
---

# Tasks: 002-account-profile-base

## Server

- [ ] T001 GET /v1/account/profile endpoint + ProfileService
  <!-- task-meta: {"id":"T001","workspace":"server-app","deps":[],"trace_us":["US1"],"trace_fr":["FR-001"],"trace_ep":["EP1"],"kind":"impl","verify_kind":"typecheck","files":[{"path":"apps/server/src/modules/account/profile.controller.ts","op":"create"},{"path":"apps/server/src/modules/account/profile.service.ts","op":"create"}],"parallel":false} -->

- [ ] T002 ProfileController unit test
  <!-- task-meta: {"id":"T002","workspace":"server-app","deps":["T001"],"trace_us":["US1"],"trace_fr":["FR-001"],"trace_ep":["EP1"],"kind":"test-unit","verify_kind":"test","files":[{"path":"apps/server/src/modules/account/profile.controller.spec.ts","op":"create"}],"parallel":false} -->

- [ ] T003 PATCH /v1/account/profile + displayName 校验
  <!-- task-meta: {"id":"T003","workspace":"server-app","deps":["T001"],"trace_us":["US1"],"trace_fr":["FR-002"],"trace_ep":["EP2"],"kind":"impl","verify_kind":"test","files":[{"path":"apps/server/src/modules/account/profile.controller.ts","op":"modify"}],"parallel":true} -->

- [ ] T004 PATCH endpoint integration test
  <!-- task-meta: {"id":"T004","workspace":"server-app","deps":["T003"],"trace_us":["US1"],"trace_fr":["FR-002"],"trace_ep":["EP2"],"trace_sc":["SC-001"],"kind":"test-integration","verify_kind":"test","files":[{"path":"apps/server/src/modules/account/profile.integration.spec.ts","op":"create"}],"parallel":false} -->

## API Client

- [ ] T005 OpenAPI export + @hey-api regenerate
  <!-- task-meta: {"id":"T005","workspace":"api-client","deps":["T002","T004"],"trace_us":["US1"],"trace_fr":["FR-001","FR-002"],"trace_ep":["EP1","EP2"],"kind":"gen","verify_kind":"generate","files":[{"path":"packages/api-client/src/profile.gen.ts","op":"create"}],"parallel":false} -->

## Mobile

- [ ] T006 设置页 - 个人信息 Section
  <!-- task-meta: {"id":"T006","workspace":"mobile","deps":["T005"],"trace_us":["US1"],"trace_fr":["FR-001"],"trace_ep":["EP1"],"kind":"impl","verify_kind":"typecheck","files":[{"path":"apps/mobile/src/features/account/profile/screen.tsx","op":"create"}],"parallel":false} -->

- [ ] T007 设置页 - displayName 编辑表单
  <!-- task-meta: {"id":"T007","workspace":"mobile","deps":["T006"],"trace_us":["US1"],"trace_fr":["FR-002"],"trace_ep":["EP2"],"kind":"impl","verify_kind":"test","files":[{"path":"apps/mobile/src/features/account/profile/edit-display-name.tsx","op":"create"}],"parallel":false} -->

## E2E

- [ ] T008 端到端测试 — 登录 → 看 profile → 改 displayName → 重读
  <!-- task-meta: {"id":"T008","workspace":"server-app","deps":["T004","T007"],"trace_us":["US1"],"trace_fr":["FR-001","FR-002"],"trace_ep":["EP1","EP2"],"trace_sc":["SC-001"],"kind":"test-e2e","verify_kind":"e2e","files":[{"path":"apps/server/test/account-profile.e2e-spec.ts","op":"create"}],"parallel":false} -->
