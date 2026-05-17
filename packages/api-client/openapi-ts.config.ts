import { defineConfig } from '@hey-api/openapi-ts';

/**
 * @hey-api/openapi-ts config — generates TS types + Fetch SDK + service
 * functions from a local OpenAPI 3.1 JSON snapshot produced by
 * `apps/server/scripts/dump-openapi.mjs`.
 *
 * Workflow (from repo root, or any cwd via Nx):
 *   pnpm -C apps/server nx run server:build
 *   pnpm -C apps/server api:dump
 *   pnpm -C packages/api-client api:gen
 *
 * Or override `OPENAPI_INPUT` to point at a running server's `/docs-json`.
 */
export default defineConfig({
  input: process.env.OPENAPI_INPUT ?? '../../apps/server/openapi.json',
  output: { path: 'src/generated' },
  plugins: [
    '@hey-api/client-fetch',
    '@hey-api/typescript',
    '@hey-api/sdk',
  ],
});
