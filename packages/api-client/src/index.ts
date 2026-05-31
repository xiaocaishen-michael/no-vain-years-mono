/**
 * @nvy/api-client — generated TS types + React Query hooks + Axios client
 * functions for the no-vain-years HTTP API.
 *
 * Backend: NestJS controllers + @nestjs/swagger → OpenAPI 3.1 JSON snapshot.
 * Codegen: Orval (per ADR-0027), mode tags-split / client react-query /
 *   httpClient axios. Per-tag service files re-exported from this index.
 *
 * Regenerate (from repo root):
 *   pnpm -C apps/server export-openapi          # → apps/server/openapi.json
 *   pnpm -C packages/api-client api:gen
 *
 * PR-5b (this swap): replaced @hey-api/openapi-ts. Function signatures use
 * raw axios responses (`Promise<AxiosResponse<T>>`). PR-5c will introduce
 * a custom axios mutator to register x-trace-id + ProblemDetail interceptor
 * via Orval `override.mutator`.
 */
export * from './generated/account-deletion/account-deletion';
export * from './generated/accounts/accounts';
export * from './generated/app/app';
export * from './generated/devices/devices';
export * from './generated/wechat-binding/wechat-binding';
export * from './generated/models/index';
