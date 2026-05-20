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
            // Source of truth: specs/002-account-profile/plan.md § module_boundaries (7 workspaces).
            //
            // Business module "account" → filesystem path mapping (per 2026-05-20 dry-run + 001 reality):
            //   - server: apps/server/src/auth/{domain,application,infrastructure,web}/**
            //     (hexagonal layer enforcement lives in apps/server/eslint.config.mjs;
            //      "account" is the spec frontmatter business name, src/auth/ is the on-disk module dir)
            //   - mobile: apps/mobile/app/(app)/(tabs)/profile.tsx + co-located feature code
            //
            // depConstraints below are tag-driven via `scope:*` Nx tags on each project.json;
            // until tags land (downstream task), the trailing `sourceTag: "*"` fallback keeps
            // current imports green while the constraint shape is registered.
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
                                "@nvy/auth",
                                "@nvy/ui",
                                "@nvy/design-tokens",
                                "@nvy/api-client",
                                "react",
                                "react-native",
                                "nativewind",
                                "expo",
                                "expo-*",
                                "zustand"
                            ]
                        },
                        // mobile-app — Expo client; consumes all 5 packages; no server / Nest / Prisma.
                        {
                            sourceTag: "scope:mobile-app",
                            onlyDependOnLibsWithTags: [
                                "scope:pkg-auth",
                                "scope:pkg-ui",
                                "scope:pkg-design-tokens",
                                "scope:pkg-types",
                                "scope:pkg-api-client"
                            ],
                            bannedExternalImports: [
                                "@nestjs/*",
                                "@prisma/client"
                            ]
                        },
                        // pkg-auth — zustand store + expo-secure-store + typed API client;
                        // no UI / design-tokens (auth is headless), no Nest / Prisma (client-side).
                        {
                            sourceTag: "scope:pkg-auth",
                            onlyDependOnLibsWithTags: [
                                "scope:pkg-types",
                                "scope:pkg-api-client"
                            ],
                            bannedExternalImports: [
                                "@nestjs/*",
                                "@prisma/client",
                                "@nvy/ui",
                                "@nvy/design-tokens"
                            ]
                        },
                        // pkg-ui — presentational RN components; consumes design-tokens only;
                        // no auth / api-client / types (UI must stay data-shape-agnostic).
                        {
                            sourceTag: "scope:pkg-ui",
                            onlyDependOnLibsWithTags: [
                                "scope:pkg-design-tokens"
                            ],
                            bannedExternalImports: [
                                "@nestjs/*",
                                "@prisma/client",
                                "@nvy/auth",
                                "@nvy/api-client",
                                "@nvy/types"
                            ]
                        },
                        // pkg-design-tokens — leaf; zero internal deps; consumed by pkg-ui + mobile-app.
                        {
                            sourceTag: "scope:pkg-design-tokens",
                            onlyDependOnLibsWithTags: [],
                            bannedExternalImports: [
                                "@nestjs/*",
                                "@prisma/client",
                                "@nvy/auth",
                                "@nvy/ui",
                                "@nvy/api-client",
                                "@nvy/types"
                            ]
                        },
                        // pkg-types — re-exports @prisma/client types; zero internal deps.
                        {
                            sourceTag: "scope:pkg-types",
                            onlyDependOnLibsWithTags: [],
                            bannedExternalImports: [
                                "@nestjs/*",
                                "@nvy/ui",
                                "@nvy/design-tokens",
                                "@nvy/auth",
                                "@nvy/api-client"
                            ]
                        },
                        // pkg-api-client — @hey-api/openapi-ts generated typed client;
                        // consumes @nvy/types only; no Nest / Prisma / UI / auth.
                        {
                            sourceTag: "scope:pkg-api-client",
                            onlyDependOnLibsWithTags: [
                                "scope:pkg-types"
                            ],
                            bannedExternalImports: [
                                "@nestjs/*",
                                "@prisma/client",
                                "@nvy/auth",
                                "@nvy/ui",
                                "@nvy/design-tokens"
                            ]
                        },
                        // Fallback — untagged projects keep current behavior so the lint stays
                        // green until each project.json `tags` field lands downstream.
                        {
                            sourceTag: "*",
                            onlyDependOnLibsWithTags: [
                                "*"
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
