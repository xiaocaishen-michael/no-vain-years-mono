# API Contract（HTTP wire format）

> 服务端 `apps/server/` HTTP API wire format 单一来源。错误响应 contract 见 [ADR-0038](../adr/0038-error-handling-ux-contract.md)（端到端 ProblemDetail + 业务扩展 + trace_id 串联，**本文件不重复**）；本文件聚焦 URL / method / 字段 / 鉴权 + OpenAPI 同步链 cross-link。

按需 read 触发：新增 / 改动 server endpoint（controller / DTO / OpenAPI 装饰器）/ `packages/api-client` 重新 gen。

## URL 体例

- 全局前缀 `/api`（`apps/server/src/main.ts` `setGlobalPrefix('api')`）
- Controller path `v{n}/<resource>` → 实际 URL `/api/v{n}/<resource>`
- `n` = major version；向后兼容必新 `v2` 不动 `v1`；deprecate 走 OpenAPI `deprecated: true`
- 资源 = **复数 kebab-case**：`/api/v1/accounts` / `/api/v1/third-party-bindings`
- 嵌套 sub-resource：`/api/v1/accounts/{id}/sessions`

## HTTP 方法语义

| 方法   | 语义                                                 | 幂等   |
| ------ | ---------------------------------------------------- | ------ |
| GET    | 查询，无副作用                                       | ✓      |
| POST   | 创建 / 不可幂等的操作触发（e.g. `request-sms-code`） | ✗      |
| PUT    | 整体替换 resource（全 field 必填）                   | ✓      |
| PATCH  | 部分更新 resource（半 field 体）                     | ✓ 语义 |
| DELETE | 删除                                                 | ✓      |

**`PUT vs PATCH` 易混**：默认走 PATCH（部分 update）；PUT 仅用于 idempotent 全量替换（资源 state 完整覆盖）。

## 字段体例

- **时间**：ISO 8601 UTC（`2026-05-23T07:00:00Z`）；DB `TIMESTAMP WITH TIME ZONE` UTC 落库
- **枚举**：大写 `SNAKE_CASE` 字符串（`AccountStatus: "ACTIVE" | "FROZEN"`）；与 Prisma enum / DB ENUM 字面值严格一致；mobile 客户端通过 Orval typed codegen 穷举（per [ADR-0027](../adr/0027-frontend-data-test-layer.md)）
- **错误码 `code` 字段**：大写 `SNAKE_CASE`（per [ADR-0038](../adr/0038-error-handling-ux-contract.md) Trade-offs）

## 鉴权

- `Authorization: Bearer <access_token>`（JWT，`apps/server/src/account/web/jwt-auth.guard.ts` 解析）
- Swagger 装饰：受保护 controller 加 `@ApiBearerAuth()`
- token 由 `security` context issue / verify（per [ADR-0032](../adr/0032-backend-bounded-context.md)）

## 错误响应

→ [ADR-0038 RFC 9457 ProblemDetail + 业务扩展 + trace_id 串联](../adr/0038-error-handling-ux-contract.md)

本文件不重复 ProblemDetail schema / Orval typed code union / 客户端 fallback chain / log level 分流 / `ERROR_DISPLAY_MAP` 等内容。

## OpenAPI 同步链

→ [sdd.md § server impl 后的 mobile types 同步](sdd.md#server-impl-后的-mobile-types-同步)

server `@nestjs/swagger` 装饰 → `apps/server/openapi.json` → `packages/api-client` Orval typed → `apps/mobile` 消费。改 endpoint / DTO 后 `pnpm nx affected --target=generate` 一行覆盖。

## 翻页（DEFER）

mono 0 个 paginated endpoint（截至 2026-05-23）。体例随第一个 paginated use case spec 阶段决策（cursor-based vs offset+limit），决策落地后回填本段 + 视情况起 ADR。

## 与其他约定的分工

| 关心点                                  | 单源                                                                                                        |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| HTTP wire format（URL / method / 字段） | 本文件                                                                                                      |
| 错误响应 schema + UX 串联               | [ADR-0038](../adr/0038-error-handling-ux-contract.md)                                                       |
| 业务 Operation 跨 context 传播规则      | [server-bounded-context-catalog.md](server-bounded-context-catalog.md)                                      |
| 模块命名（业务概念字符串）              | [business-naming.md](business-naming.md)                                                                    |
| OpenAPI codegen + Orval typed           | [sdd.md § server impl 后的 mobile types 同步](sdd.md) + [ADR-0027](../adr/0027-frontend-data-test-layer.md) |
