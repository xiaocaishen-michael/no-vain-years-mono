# Sub-plan 2: Nx 工业化轨道搭建（策略层 / PR-T2）

> 主 plan「策略层」阶段详细设计。本 sub-plan 由主 plan §跨阶段决策 + user 2026-05-22 6 处架构裁决 + 7 处 implementation 拍板 commit。**严格不动**主 plan 跨阶段契约。

## Context

机制层（PR-T1 / `nx run server:runtime-smoke` 已通过 `pnpm tsx scripts/ci/server-boot-smoke.ts` 本地裸跑验证）已 merged 入 main。本 PR-T2 把脚本与 spec-kit 升级**装上 Nx 工业化轨道**：

1. 全 5 projects（server + mobile + api-client + types + orchestrator）打 scope tag，**`*` fallback 删干净**
2. `nx.json` 加 namedInputs 核弹文件 + targetDefaults strict DAG
3. Server runtime-smoke + Mobile runtime-smoke 两 target 挂 Nx
4. `api-client` 加 `build` alias + `implicitDependencies: ["server"]` + `generate.outputs` → 实现 server 改一行 → `nx affected -t runtime-smoke` 自动牵连 server + api-client + mobile 三 projects 的自愈链路

设计纪律：L2 不稳不上 L3，本 sub-plan 不动 GitHub Actions / lefthook / branch ruleset — 全留 PR-T3。

## 6 处架构裁决（user 锁定）

| # | 裁决 | 落点 |
|---|---|---|
| 1 | mobile `runtime-smoke` 走 **static export**（`expo export -p web` + `serve dist`），CI 确定性 100% | `apps/mobile/project.json` 新 target + 新 dep `serve` |
| 2 | 保留 `mobile:e2e`（dev server，本地 DevX）+ 新增 `mobile:runtime-smoke`（static，CI 门禁）— 共享 Playwright spec | 2 个 playwright config 文件（B2 双文件隔离） |
| 3 | `namedInputs.sharedGlobals` 仅纳 4 核弹文件：`prisma/schema.prisma` / `.env.example` / root `package.json` / `pnpm-workspace.yaml` | `nx.json` |
| 4 | `targetDefaults` strict DAG：`typecheck ← ^build`、`test ← typecheck`、`runtime-smoke ← build` | `nx.json.targetDefaults` |
| 5 | Cross-package：api-client `implicitDependencies: ["server"]` + `generate.outputs: ["{projectRoot}/src/generated"]` + 新 `build` alias dependsOn `generate` | `packages/api-client/project.json` |
| 6 | orchestrator 加 minimal `project.json` + `tags: ["scope:orchestrator"]` + ESLint **`onlyDependOnLibsWithTags: []`** 彻底物理隔离 | `scripts/orchestrator/project.json` 新建 + `eslint.config.mjs` 加 depConstraint |

## 7 处 implementation 拍板（user 锁定）

| 字母 | 选择 |
|---|---|
| A | 静态 server = **`serve`** (vercel/serve, history-api-fallback 默认开) |
| B | Playwright config = **B2 双文件隔离**（`playwright.config.ts` 保留 dev server；新 `playwright.runtime-smoke.config.ts` 用 `npx serve dist`） |
| C | api-client `^build` 撞车 = **C1 alias target**（`build` dependsOn `generate`，兼容 0 breaking） |
| D | ESLint fallback `*` rule = **删干净**（default-deny；未来新 project 漏 tag 必报错） |
| E | orchestrator `onlyDependOnLibsWithTags` = **`[]`** 彻底孤岛（仅外部 deps 可用） |
| F | PR body 必含 `nx affected --dry-run` 拓扑证明截图（改 server 1 行 → 牵连 3 projects） |
| G | PR body 必含本地 `runtime-smoke` 全栈跑通绿灯证据（Testcontainers + Playwright 端到端耗时） |

## 8 项交付清单（PR-T2 全量）

### A. 装 `serve` dep
`apps/mobile/` 跑 `pnpm add -D serve`（不污染 root devDeps；mobile-only 工具）

### B. `nx.json` — namedInputs.sharedGlobals + targetDefaults strict DAG
落点：`nx.json`

```jsonc
{
  "namedInputs": {
    "default":       ["{projectRoot}/**/*", "sharedGlobals"],
    "production":    ["default", "!{projectRoot}/**/*.spec.ts", "!{projectRoot}/**/*.test.ts"],
    "sharedGlobals": [
      "{workspaceRoot}/apps/server/prisma/schema.prisma",
      "{workspaceRoot}/.env.example",
      "{workspaceRoot}/package.json",
      "{workspaceRoot}/pnpm-workspace.yaml"
    ]
  },
  "targetDefaults": {
    "build":          { "cache": true, "inputs": ["production", "^production"] },
    "typecheck":      { "cache": true, "dependsOn": ["^build"] },
    "test":           { "cache": true, "dependsOn": ["typecheck"] },
    "lint":           { "cache": true },
    "runtime-smoke":  { "cache": false, "dependsOn": ["build"] }
  }
}
```

注意：`runtime-smoke.cache: false` — smoke 是真启 Testcontainers + 真 HTTP probe，结果不该 cache（每次跑都该捕到 drift）。

### C. 5 projects tag + 新 orchestrator project.json
落点：4 modified + 1 new project.json

| project.json | tags 字段值 | 额外改动 |
|---|---|---|
| `apps/server/project.json` | `["scope:server-app"]` | — |
| `apps/mobile/project.json` | `["scope:mobile-app"]` | + `runtime-smoke` target (见 E) |
| `packages/api-client/project.json` | `["scope:pkg-api-client"]` | + `implicitDependencies: ["server"]` + `generate.outputs` + `build` alias |
| `packages/types/project.json` | `["scope:pkg-types"]` | — |
| `scripts/orchestrator/project.json` | `["scope:orchestrator"]` | **新建** minimal (含 typecheck + lint + test 三 target，复用现有命令) |

api-client 改动 snippet：
```jsonc
{
  "name": "api-client",
  "tags": ["scope:pkg-api-client"],
  "implicitDependencies": ["server"],
  "targets": {
    "generate": {
      "outputs": ["{projectRoot}/src/generated"],
      // ... existing config
    },
    "build": {
      "executor": "nx:run-commands",
      "options": { "command": "pnpm nx run api-client:generate" },
      "dependsOn": ["generate"]
    }
  }
}
```

### D. server `runtime-smoke` target 挂 Nx
落点：`apps/server/project.json`

```jsonc
"runtime-smoke": {
  "executor": "nx:run-commands",
  "options": {
    "command": "pnpm tsx scripts/ci/server-boot-smoke.ts",
    "cwd": "{workspaceRoot}"
  }
}
```

不动 `scripts/ci/server-boot-smoke.ts`（PR-T1 已稳定）— 仅 wrap。

### E. mobile `runtime-smoke` target + 新 Playwright config
落点：`apps/mobile/project.json` + 新 `apps/mobile/playwright.runtime-smoke.config.ts`

project.json target：
```jsonc
"runtime-smoke": {
  "executor": "nx:run-commands",
  "options": {
    "command": "npx expo export -p web && pnpm exec playwright test -c playwright.runtime-smoke.config.ts",
    "cwd": "{projectRoot}"
  },
  "outputs": [
    "{projectRoot}/playwright-report",
    "{projectRoot}/playwright-test-results"
  ]
}
```

新 `playwright.runtime-smoke.config.ts`（基于现有 `playwright.config.ts`，关键差异 2 处）：
- `webServer.command`: `npx serve dist -p 4173 --single` (`--single` 启用 history-api-fallback，Expo Web 路由刚需)
- `webServer.reuseExistingServer`: 永远 false（CI 确定性）
- 其余 (testDir / projects / use / outputDir 等) 保留 dev config 同形

现有 `playwright.config.ts` 不动（`mobile:e2e` 仍跑 dev server 本地 DevX）。

### F. ESLint module boundaries 终态
落点：`eslint.config.mjs`

3 处改动：
1. **删 fallback `*` 兜底规则**（4 + 1 projects 全 tagged 后兜底失去合法性，留 = 后门）
2. **加 `scope:orchestrator` depConstraint**：
   ```js
   {
     sourceTag: 'scope:orchestrator',
     onlyDependOnLibsWithTags: [],
     bannedExternalImports: ['@nestjs/*', 'react', 'react-native', 'expo', 'zustand']
   }
   ```
3. 已有 4 条 (`scope:server-app` / `scope:mobile-app` / `scope:pkg-types` / `scope:pkg-api-client`) 不动

### G. PR body 强制验收 evidence（F+G 双截图）
**evidence 1**：`nx affected --dry-run` 拓扑证明
```bash
# 临时改 apps/server/src/foo.ts → 跑：
pnpm exec nx affected --base=HEAD --target=runtime-smoke --dry-run
# 期望输出含: server + api-client + mobile（3 projects）
git restore apps/server/src/foo.ts
```

**evidence 2**：本地 `runtime-smoke` 全栈跑通绿灯
```bash
pnpm exec nx run server:runtime-smoke      # ~2-3 min (Testcontainers + boot + curl)
pnpm exec nx run mobile:runtime-smoke      # ~3-5 min (expo export + serve + Playwright 5/5)
```

evidence 全 attach 进 PR body。

### H. master + sub-plan 2 文件 git mv 落定
PR-T2 同 commit 内：
- 本 scratch `pr-5-05-21-...-declarative-creek.md` → `docs/plans/2026-05/05-22-test-infra-p2-nx-tracks.md`

## Verification（local 裸跑 evidence，PR ready 前全通）

1. ☐ `pnpm exec nx show project server --json` → tags 含 `"scope:server-app"`
2. ☐ `pnpm exec nx run server:runtime-smoke` → exit 0 + 3 assertion pass
3. ☐ `pnpm exec nx run mobile:runtime-smoke` → exit 0 + 5/5 Playwright（基于 PR-79 已 GREEN test suite）
4. ☐ `pnpm exec nx run api-client:build` → exit 0（alias 跑通 generate）
5. ☐ `pnpm exec nx run-many --target=typecheck,test,lint --all --skip-nx-cache` → all GREEN（含新 orchestrator project + ESLint 改动）
6. ☐ Cross-package 拓扑实证：临时改 `apps/server/src/app/app.controller.ts` 加一空行 → `pnpm exec nx affected --base=HEAD --target=runtime-smoke --dry-run` → 输出含 `server + api-client + mobile`（3 projects）→ `git restore` 回滚
7. ☐ ESLint boundary 实证：mobile 加临时 `import '@nestjs/common'` → `pnpm exec nx lint mobile` 必须报 boundary error → `git restore`
8. ☐ `pnpm exec nx graph` → 视图含 implicit dep `api-client → server`

## STOP criteria（任一红即 STOP，不绕过）

- mobile `runtime-smoke` 5 Playwright 中任一 RED — static export 路径与 dev server 路径有微差，必须修通到 5/5 才合
- ESLint boundary 改动后 `nx lint` 既有代码 RED — 说明某 project import 已经越界，需补 tag 或修 import（绝不允许放过 lint）
- cross-package 实证 `nx affected --dry-run` 漏 `api-client` 或 `mobile` — `implicitDependencies` 没接对，回退检查
- `runtime-smoke.cache: false` 配错导致 cache 假绿 — 第二次跑必须真重启 Testcontainers

## Out of Scope（defer 给 P3 / follow-up）

- `.github/workflows/` CI job → PR-T3
- PR template + unchecked-blocker Action → PR-T3
- lefthook anti-mock 正则 / branch ruleset required checks → PR-T3
- nightly --skip-nx-cache job → PR-T3
- upstream `michael-speckit-presets` sync → follow-up issue (PR-T1 留的)
- `state_branches` 转 required + backfill spec 001/002 → PR-T3
- 任何脚本逻辑修改（`scripts/ci/server-boot-smoke.ts` 不动）

## Risk + Rollback

| 风险 | 缓解 |
|---|---|
| `expo export -p web` 在 mono仓首跑失败 | 本地先单独 `pnpm exec expo export -p web` 验证产物 size + history-fallback；失败 → 检查 mobile config |
| `serve --single` flag 在某 serve 版本里改名 | pin `serve@^14`（最新主要版本）；fallback `npx serve dist --single-page-app` 别名 |
| `^build` DAG 让既有 `nx run server:test` 跑慢（先要 build 所有 deps） | 测：跑 `nx run server:test --skip-nx-cache` 测耗时；若超 5min 退化为 `dependsOn: ["^typecheck"]`（更轻量） |
| api-client `build` alias 触发 orval 死循环 | alias 只 dependsOn `generate`，不重新 codegen — 测：跑 2 次 `nx run api-client:build`，第二次应 cache hit |
| ESLint fallback 删后某 project 漏 tag 导致 lint RED | C 节 5 projects 全部强制 tag；删 fallback 前先跑 nx lint 全包验所有 src 都不越界 |
| orchestrator `onlyDependOnLibsWithTags: []` 误伤现有 import | 加 constraint 前 grep `scripts/orchestrator/**/*.ts` 检 `@nvy/*` import — 期望 0 命中（orchestrator 应只用外部 deps） |
| `nx affected` 实证 dry-run 输出顺序不固定 | 验收只检 set 包含关系不检 order |

## 执行步骤建议顺序（PR-T2 内）

1. **基础设施第一波**（10 min）：mobile install serve / nx.json namedInputs + targetDefaults / 5 projects 加 tags（含新 orchestrator project.json）
2. **跨包链路**（5 min）：api-client implicitDeps + outputs + build alias
3. **server runtime-smoke target**（2 min）：apps/server/project.json + 复用 PR-T1 脚本
4. **mobile runtime-smoke 双轨**（15 min）：复制 playwright.config.ts → playwright.runtime-smoke.config.ts 改 webServer / 加 project.json target / 本地实测 expo export + serve + Playwright 跑通
5. **ESLint 收紧**（10 min）：删 fallback + 加 orchestrator depConstraint + 全包 lint 验
6. **F+G 验收 evidence 采集**（10 min）：拓扑 dry-run 截图 + 全栈 runtime-smoke 跑通截图
7. **scratch 文件 git mv + commit + push + PR + auto-merge**（5 min）

总 estimated time：~1h 主线 + ~30min evidence/buffer。
