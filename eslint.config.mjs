import nx from '@nx/eslint-plugin';
import eslintConfigPrettier from 'eslint-config-prettier';

export default [
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  {
    ignores: ['**/dist', '**/out-tsc'],
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    rules: {
      // Mono-level Nx project boundary (cross-project, tag-driven via scope:* tags).
      // Source of truth: specs/002-account-profile/plan.md § module_boundaries
      // (post-PR-3 ADR-0030: 4 workspaces — apps/{server,mobile} + packages/{api-client,types}).
      //
      // Business module → filesystem path mapping:
      //   - server: apps/server/src/<module>/** — flat module dir, NO layer subdirs
      //     (per ADR-0043; intra-server bounded-context boundaries are file-level,
      //      module-scoped, in apps/server/eslint.config.mjs per ADR-0032)
      //   - mobile: apps/mobile/app/(app)/(tabs)/<feature> + co-located feature code
      //
      // depConstraints below are tag-driven via `scope:*` Nx tags on each project.json.
      // PR-T2 (ADR-0040 L2 策略层) flipped this from "fallback-permitted" to default-deny:
      // all 5 projects (server / mobile / api-client / types / orchestrator) now have
      // explicit scope tags; the previous `sourceTag: "*"` fallback was removed so
      // any new project added without a tag will fail lint immediately (forcing the
      // author to declare the intended scope upfront).
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          allow: ['^.*/eslint(\\.base)?\\.config\\.[cm]?[jt]s$'],
          depConstraints: [
            // server-app — NestJS backend; consumes @nvy/types only; no mobile/UI surface.
            {
              sourceTag: 'scope:server-app',
              onlyDependOnLibsWithTags: ['scope:pkg-types'],
              bannedExternalImports: [
                '@nvy/api-client',
                'react',
                'react-native',
                'nativewind',
                'expo',
                'expo-*',
                'zustand',
              ],
            },
            // mobile-app — Expo client; consumes api-client + types (Orval-generated
            // typed client + shared types). auth/ui/theme/core inlined to
            // apps/mobile/src/ per ADR-0030 (5→2 packages).
            {
              sourceTag: 'scope:mobile-app',
              onlyDependOnLibsWithTags: ['scope:pkg-types', 'scope:pkg-api-client'],
              bannedExternalImports: ['@nestjs/*', '@prisma/client'],
            },
            // pkg-types — re-exports @prisma/client types; zero internal deps.
            {
              sourceTag: 'scope:pkg-types',
              onlyDependOnLibsWithTags: [],
              bannedExternalImports: ['@nestjs/*', '@nvy/api-client'],
            },
            // pkg-api-client — Orval-generated typed client; consumes @nvy/types only;
            // no Nest / Prisma / UI / auth.
            {
              sourceTag: 'scope:pkg-api-client',
              onlyDependOnLibsWithTags: ['scope:pkg-types'],
              bannedExternalImports: ['@nestjs/*', '@prisma/client'],
            },
            // orchestrator — spec-kit DAG runner (scripts/orchestrator/). Total
            // import isolation: drives apps via subprocess + fs reads, not via
            // type imports. Allows external deps only (zod, gray-matter, listr2,
            // node:*); forbids any business app/lib surface to prevent type
            // pollution from server/mobile evolving its way into the orchestrator.
            {
              sourceTag: 'scope:orchestrator',
              onlyDependOnLibsWithTags: [],
              bannedExternalImports: [
                '@nestjs/*',
                '@prisma/client',
                'react',
                'react-native',
                'nativewind',
                'expo',
                'expo-*',
                'zustand',
              ],
            },
          ],
        },
      ],
    },
  },
  {
    files: [
      '**/*.ts',
      '**/*.tsx',
      '**/*.cts',
      '**/*.mts',
      '**/*.js',
      '**/*.jsx',
      '**/*.cjs',
      '**/*.mjs',
    ],
    // Checkstyle-equivalent semantic lint (per docs/plans/2026-05/
    // 05-22-meta-config-mono-migration.md § 2.2). 全 warn 不 error 避免
    // AI 协作场景下 PR 被小驼峰错误硬卡;M3 部署前看 baseline 数据决定收紧。
    rules: {
      // CyclomaticComplexity: Java Checkstyle 默认 10 / meta 12;TS 略宽 15
      // 因 React 声明式代码 + 状态机分支多。
      complexity: ['warn', 15],
      // MethodLength: Java Checkstyle meta 80;TS 150 因 React component
      // 整页常态。skipBlankLines + skipComments 减噪音。
      'max-lines-per-function': ['warn', { max: 150, skipBlankLines: true, skipComments: true }],
    },
  },
  {
    // Naming convention — TS-only (@typescript-eslint/naming-convention 需类型上下文)
    files: ['**/*.ts', '**/*.tsx', '**/*.cts', '**/*.mts'],
    rules: {
      '@typescript-eslint/naming-convention': [
        'warn',
        { selector: 'default', format: ['camelCase'] },
        // 变量允许 camelCase / UPPER_CASE / PascalCase (React component / namespace)
        { selector: 'variable', format: ['camelCase', 'UPPER_CASE', 'PascalCase'] },
        // typeLike (class / interface / type / enum) → PascalCase
        { selector: 'typeLike', format: ['PascalCase'] },
        // 枚举成员 → UPPER_CASE (Java enum / DDD 状态机惯例,e.g. AccountStatus.ACTIVE)
        { selector: 'enumMember', format: ['UPPER_CASE'] },
        // 参数允许 _-prefix 表示 unused
        { selector: 'parameter', format: ['camelCase'], leadingUnderscore: 'allow' },
        // property null — 放过 API 返回的 snake_case 字段 + 配置对象 kebab-case
        { selector: 'property', format: null },
        // import name null — 第三方 lib 导出名不可控 (e.g. Dysmsapi/Tea SDK)
        { selector: 'import', format: null },
      ],
    },
  },
  // 关掉与 Prettier 冲突的 ESLint 风格规则 — 必须放最后
  // (per https://github.com/prettier/eslint-config-prettier)
  eslintConfigPrettier,
];
