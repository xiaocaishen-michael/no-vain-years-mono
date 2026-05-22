---
feature_id: 002-account-profile-base
spec_ref: ./spec.md
status: approved
created_at: 2026-05-20
updated_at: 2026-05-20
adr_refs: ["0018","0019","0020","0024"]
orchestrator_compat: ">=0.1.0"
context7_verified: []
---

# Implementation Plan: Account Profile Base

## Summary

GET / PATCH `/v1/account/profile` 两个 endpoint。

## Orchestrator Config

```json orchestrator_config
{
  "workspaces": [
    {
      "id": "server-app",
      "nx_project": "server",
      "cwd": "apps/server",
      "lang": "typescript",
      "module_path": "src/modules/account",
      "verify_commands": {
        "build": "pnpm nx build server",
        "test": "pnpm nx test server --watch=false",
        "lint": "pnpm nx lint server",
        "typecheck": "pnpm nx run server:typecheck",
        "e2e": "pnpm nx run server:e2e"
      },
      "graphify_scope": "apps/server/src/modules/account/**/*"
    },
    {
      "id": "api-client",
      "nx_project": "api-client",
      "cwd": "packages/api-client",
      "lang": "typescript",
      "verify_commands": {
        "generate": "pnpm nx run api-client:generate",
        "build": "pnpm nx build api-client",
        "test": "pnpm nx test api-client"
      },
      "graphify_scope": "packages/api-client/src/**"
    },
    {
      "id": "mobile",
      "nx_project": "mobile",
      "cwd": "apps/mobile",
      "lang": "typescript",
      "feature_path": "apps/mobile/src/features/account",
      "verify_commands": {
        "test": "pnpm nx test mobile",
        "typecheck": "pnpm nx run mobile:typecheck"
      },
      "graphify_scope": "apps/mobile/src/features/account/**"
    }
  ],
  "module_boundaries": {
    "server-app": {
      "modules": ["account"],
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
      { "metric": "P95 GET /v1/account/profile", "target": "<200ms", "trace_sc": ["SC-001"] }
    ],
    "scale": { "users": 10000, "rps": 100 }
  }
}
```

## API Contracts

```json api_contracts
{
  "endpoints": [
    {
      "id": "EP1",
      "method": "GET",
      "path": "/v1/account/profile",
      "auth": "bearer",
      "request": null,
      "response_schema_ref": "E1",
      "trace_fr": ["FR-001"]
    },
    {
      "id": "EP2",
      "method": "PATCH",
      "path": "/v1/account/profile",
      "auth": "bearer",
      "request": { "displayName": { "type": "string" } },
      "response_schema_ref": "E1",
      "trace_fr": ["FR-002"]
    }
  ]
}
```

## Constitution Check

```json constitution_check
{
  "passed": true,
  "violations": []
}
```

## Architecture Notes

- 复用现有 `AccountModule`,新增 `ProfileController` + `ProfileService`
- Prisma schema 已有 `Account.displayName / phone` 字段,无需 migration
- mobile 沿用 `@nvy/api-client` 自动生成 client (per ADR-0024)

## Complexity Tracking

(空)
