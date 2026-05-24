import baseConfig from '../../eslint.config.mjs';
import boundaries from 'eslint-plugin-boundaries';

/**
 * apps/server flat config.
 *
 * extends mono root (含 @nx/enforce-module-boundaries 跨 project boundary) +
 * 加 eslint-plugin-boundaries 文件级 bounded-context boundary (ADR-0032).
 *
 * PR-4 post-A-002 retro: split monolithic `auth` into 3 bounded contexts
 *   - security  platform infra (JWT + DB + Redis + common DTOs) — no business deps
 *   - account   Account aggregate + profile + account-bound auth guard
 *   - auth      phone-sms-auth 编排 (orchestrates account + security)
 *
 * Boundaries rules (module-level, single direction):
 *   auth → account → security
 *
 * Hexagonal layer subdirs (domain/application/infrastructure/web) were retired
 * in PR-4 and permanently removed by ADR-0043 (flat + anemic paradigm) — they
 * will NOT be reintroduced. Intra-module data-moat discipline (own-table-only)
 * is enforced by the ts-morph probe scripts/checks/check-server-moat.ts, not by
 * layer-based lint elements.
 */
export default [
  ...baseConfig,
  {
    files: ['src/**/*.ts'],
    plugins: { boundaries },
    settings: {
      'import/resolver': {
        typescript: {
          alwaysTryTypes: true,
          project: './tsconfig.json',
        },
      },
      'boundaries/elements': [
        { type: 'security', pattern: 'src/security/**' },
        { type: 'account', pattern: 'src/account/**' },
        { type: 'auth', pattern: 'src/auth/**' },
        { type: 'app', pattern: 'src/{app,main}.ts' },
        { type: 'app', pattern: 'src/app/**' },
        { type: 'generated', pattern: 'src/generated/**' },
        { type: 'smoke', pattern: 'src/__smoke__/**' },
        { type: 'openapi', pattern: 'src/openapi.*' },
      ],
      'boundaries/include': ['src/**/*.ts'],
    },
    rules: {
      // v6 object-selector syntax (per eslint-plugin-boundaries v5→v6 migration).
      // v5 legacy `boundaries/element-types` + string `disallow` array
      // silently no-op'd under v6, hiding gate breach.
      'boundaries/dependencies': [
        'error',
        {
          default: 'allow',
          rules: [
            // security 是 base layer — 不依赖任何业务 context
            {
              from: { type: 'security' },
              disallow: { to: { type: ['account', 'auth'] } },
            },
            // account 仅依赖 security
            {
              from: { type: 'account' },
              disallow: { to: { type: ['auth'] } },
            },
            // auth 可依赖 security + account (默认 allow 已覆盖)
          ],
        },
      ],
      // Allow `_xxx` parameters / variables / caught errors as the conventional
      // "intentionally unused" marker — keeps method signatures stable when the
      // arg is part of a contract (e.g., timestamp threading) but the current
      // body does not yet consume it.
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    files: ['src/**/*.spec.ts', 'src/**/*.test.ts', 'src/__smoke__/**'],
    rules: {
      'boundaries/dependencies': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-empty-function': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
];
