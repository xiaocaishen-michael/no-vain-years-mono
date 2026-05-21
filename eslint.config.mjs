import nx from "@nx/eslint-plugin";

export default [
    ...nx.configs["flat/base"],
    ...nx.configs["flat/typescript"],
    ...nx.configs["flat/javascript"],
    {
        ignores: [
            "**/dist",
            "**/out-tsc"
        ]
    },
    {
        files: [
            "**/*.ts",
            "**/*.tsx",
            "**/*.js",
            "**/*.jsx"
        ],
        rules: {
            // Mono-level Nx project boundary (per ADR-0020 § Decision 层 3).
            // Source of truth: specs/002-account-profile/plan.md § module_boundaries
            // (post-PR-3 ADR-0030: 4 workspaces — apps/{server,mobile} + packages/{api-client,types}).
            //
            // Business module "account" → filesystem path mapping (per 2026-05-20 dry-run + 001 reality):
            //   - server: apps/server/src/auth/{domain,application,infrastructure,web}/**
            //     (hexagonal layer enforcement lives in apps/server/eslint.config.mjs;
            //      "account" is the spec frontmatter business name, src/auth/ is the on-disk module dir)
            //   - mobile: apps/mobile/app/(app)/(tabs)/profile.tsx + co-located feature code
            //
            // depConstraints below are tag-driven via `scope:*` Nx tags on each project.json.
            // PR-T2 (ADR-0040 L2 策略层) flipped this from "fallback-permitted" to default-deny:
            // all 5 projects (server / mobile / api-client / types / orchestrator) now have
            // explicit scope tags; the previous `sourceTag: "*"` fallback was removed so
            // any new project added without a tag will fail lint immediately (forcing the
            // author to declare the intended scope upfront).
            "@nx/enforce-module-boundaries": [
                "error",
                {
                    enforceBuildableLibDependency: true,
                    allow: [
                        "^.*/eslint(\\.base)?\\.config\\.[cm]?[jt]s$"
                    ],
                    depConstraints: [
                        // server-app — NestJS backend; consumes @nvy/types only; no mobile/UI surface.
                        {
                            sourceTag: "scope:server-app",
                            onlyDependOnLibsWithTags: [
                                "scope:pkg-types"
                            ],
                            bannedExternalImports: [
                                "@nvy/api-client",
                                "react",
                                "react-native",
                                "nativewind",
                                "expo",
                                "expo-*",
                                "zustand"
                            ]
                        },
                        // mobile-app — Expo client; consumes api-client + types (Orval-generated
                        // typed client + shared types). auth/ui/theme/core inlined to
                        // apps/mobile/src/ per ADR-0030 (5→2 packages).
                        {
                            sourceTag: "scope:mobile-app",
                            onlyDependOnLibsWithTags: [
                                "scope:pkg-types",
                                "scope:pkg-api-client"
                            ],
                            bannedExternalImports: [
                                "@nestjs/*",
                                "@prisma/client"
                            ]
                        },
                        // pkg-types — re-exports @prisma/client types; zero internal deps.
                        {
                            sourceTag: "scope:pkg-types",
                            onlyDependOnLibsWithTags: [],
                            bannedExternalImports: [
                                "@nestjs/*",
                                "@nvy/api-client"
                            ]
                        },
                        // pkg-api-client — Orval-generated typed client; consumes @nvy/types only;
                        // no Nest / Prisma / UI / auth.
                        {
                            sourceTag: "scope:pkg-api-client",
                            onlyDependOnLibsWithTags: [
                                "scope:pkg-types"
                            ],
                            bannedExternalImports: [
                                "@nestjs/*",
                                "@prisma/client"
                            ]
                        },
                        // orchestrator — spec-kit DAG runner (scripts/orchestrator/). Total
                        // import isolation: drives apps via subprocess + fs reads, not via
                        // type imports. Allows external deps only (zod, gray-matter, listr2,
                        // node:*); forbids any business app/lib surface to prevent type
                        // pollution from server/mobile evolving its way into the orchestrator.
                        {
                            sourceTag: "scope:orchestrator",
                            onlyDependOnLibsWithTags: [],
                            bannedExternalImports: [
                                "@nestjs/*",
                                "@prisma/client",
                                "react",
                                "react-native",
                                "nativewind",
                                "expo",
                                "expo-*",
                                "zustand"
                            ]
                        }
                    ]
                }
            ]
        }
    },
    {
        files: [
            "**/*.ts",
            "**/*.tsx",
            "**/*.cts",
            "**/*.mts",
            "**/*.js",
            "**/*.jsx",
            "**/*.cjs",
            "**/*.mjs"
        ],
        // Override or add rules here
        rules: {}
    }
];
