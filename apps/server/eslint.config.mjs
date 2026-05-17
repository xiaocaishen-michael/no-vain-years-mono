import baseConfig from '../../eslint.config.mjs';
import boundaries from 'eslint-plugin-boundaries';

/**
 * apps/server flat config.
 *
 * extends mono root (含 @nx/enforce-module-boundaries 跨 project boundary) +
 * 加 eslint-plugin-boundaries 文件级 hexagonal layer boundary (Constitution Principle IV).
 *
 * 4 类规则:
 * 1. domain 层零外部业务依赖 (禁 application/infrastructure/web)
 * 2. web 层不直接 import infrastructure (必经 application)
 * 3. 跨 module 经 module exports (mono W2 只有 auth, 多 module 后启用 boundaries/no-private)
 * 4. shared packages 禁 import apps/* (mono W2 无 packages, 多 packages 后启用 boundaries/external)
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
        { type: 'domain', pattern: 'src/auth/domain/**' },
        { type: 'application', pattern: 'src/auth/application/**' },
        { type: 'infrastructure', pattern: 'src/auth/infrastructure/**' },
        { type: 'web', pattern: 'src/auth/web/**' },
        { type: 'module', pattern: 'src/auth/auth.module.ts' },
        { type: 'app', pattern: 'src/{app,main}.ts' },
        { type: 'app', pattern: 'src/app/**' },
      ],
      'boundaries/include': ['src/**/*.ts'],
    },
    rules: {
      // v6 object-selector syntax (per eslint-plugin-boundaries v5→v6 migration).
      // v5 legacy `boundaries/element-types` + string `disallow` array
      // silently no-op'd under v6, hiding Constitution IV gate breach.
      'boundaries/dependencies': [
        'error',
        {
          default: 'allow',
          rules: [
            {
              from: { type: 'domain' },
              disallow: {
                to: {
                  type: ['application', 'infrastructure', 'web', 'module'],
                },
              },
            },
            {
              from: { type: 'web' },
              disallow: { to: { type: 'infrastructure' } },
            },
          ],
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
