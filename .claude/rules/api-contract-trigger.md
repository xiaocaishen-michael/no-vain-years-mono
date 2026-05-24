---
paths:
  - 'apps/server/src/**/*.controller.ts'
  - 'apps/server/src/**/*.dto.ts'
  - 'apps/server/openapi.json'
  - 'packages/api-client/src/**'
---

# API contract path-trigger（改 server endpoint / DTO / api-client 时自动加载）

## 硬性 invariant

1. **mobile 禁手写 `fetch` / `axios` 直调业务 API** — 走 `@nvy/api-client`（per [docs/conventions/fe-directory-structure.md § API client 单源](../../docs/conventions/fe-directory-structure.md#api-client-单源)）
2. **server endpoint / DTO 改后必跑** `pnpm nx affected --target=generate`（一行覆盖 server openapi.json → api-client regen → mobile rebuild 链；per [docs/conventions/sdd.md § server impl 后的 mobile types 同步](../../docs/conventions/sdd.md#server-impl-后的-mobile-types-同步)）

## 单源真理

详细 wire format（URL / method / 字段体例 / 鉴权）见 [`docs/conventions/api-contract.md`](../../docs/conventions/api-contract.md)；错误响应 contract（RFC 9457 ProblemDetail + 6 业务扩展 + trace_id 串联）见 [ADR-0038](../../docs/adr/0038-error-handling-ux-contract.md)。本 rule 仅 surface 路径触发的硬 invariant，不重复 wire format / error schema 细节。

## Nx target 依赖链（server → api-client → mobile）

mono 内 server → api-client → mobile 走 **Nx target 依赖链**（不装 `api-types-sync` preset，per W2.0 决策）：

1. `apps/server` `@nestjs/swagger` 装饰器 → `nx run server:export-openapi` 启临时实例 curl `/docs-json` → 写 `apps/server/openapi.json`
2. `packages/api-client` `nx run api-client:generate` 依赖 server openapi.json，跑 `openapi-typescript` 生成 TS client
3. `apps/mobile` 依赖 `packages/api-client`，`nx affected` 改 server endpoint 自动传导触发 api-client regen + mobile rebuild

**PR 边界**：mono 单仓内 server impl + api-client regen + mobile 消费**可同 PR**；commit message `chore(api-client): sync types — <feature-slug>` 或并入主 PR commit message 备注 types 已 regen。
