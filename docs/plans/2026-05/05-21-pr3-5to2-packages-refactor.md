# Plan: PR-3 5→2 packages 重构（lift-out from review-tech-stack-post-a002）

## Context

[`05-21-review-tech-stack-post-a002`](05-21-review-tech-stack-post-a002.md) chore 链 PR-1/2/4/5a/5b/5c 已 ship（commits 2cbe07a / b7cf67d / 9dae4be / 88a5d56 / 2c77397 / 0bb691d）。**剩余仅 PR-3 5→2 packages 重构未做**。

**为何独立成 plan**：

1. PR-3 涉及 **7 个工具层**改动（pnpm-workspace / Nx project graph / tsconfig paths / eslint boundaries / tailwind content / vitest resolve / metro+babel resolver），任一层漏改即 bundler/typecheck 红。原 review-plan PR-3 段只列了 5 项关键文件，未拆 7 层 cross-cut。
2. **PR-5c 已产生 drift**：`apps/mobile/lib/{error-boundary,auth-gate-decision,api/*}` 落点违背 ADR-0030 设计的 `apps/mobile/src/core/`。原 PR-3 plan 未覆盖 lib/ 迁移，照原 scope 走会留下 `src/` + `lib/` 双轨。
3. 历史经验（A-002 ship 5 类集成坑）证明：Expo + pnpm strict + RN bundler 三角联动改动需 dedicated session + 一次性闭环，否则反复来回 fix。

**目标**：单 PR 一次性消除 `packages/{auth,ui,design-tokens}` 3 个单 consumer 包 + 消除 `apps/mobile/lib/` drift，落地 ADR-0030 完整目标布局 `apps/mobile/src/{auth,ui,theme,core}/`。

## Locked Decisions（决策已固，不 re-evaluate）

| 决策 | 选择 | 出处 |
|---|---|---|
| 目标布局 | `apps/mobile/src/{auth,ui,theme,core}/`（严格守 ADR-0030）+ 同 PR 迁 `apps/mobile/lib/` 进 `src/core/` | user 选项 1 |
| PR 切粒度 | 单 PR 一次性 ship（diff 大，但中间态零） | user |
| 验收门槛 | 4 道全 must-pass：(a) nx typecheck+test+lint 全 GREEN  (b) Metro/Expo Web 启动冒烟 + grep 0 命中  (c) Playwright e2e (T040) GREEN  (d) Tailwind 渲染冒烟（Button 视觉） | user |
| 保留 packages | `packages/api-client/` + `packages/types/`（双 consumer 真共享） | ADR-0030 |
| 路径 alias | `~/*: ["src/*"]`（per ADR-0030）；同时移除 `@nvy/{auth,ui,design-tokens}*` | ADR-0030 |

## 目标布局（落地后 apps/mobile/）

```text
apps/mobile/
  app/                         Expo Router 路由（不动）
  src/
    auth/                      ← packages/auth/src/* 内联
      store.ts
      store.spec.ts
      token-refresh.ts
      token-refresh.spec.ts
      index.ts
    ui/                        ← packages/ui/src/* 内联
      Button.tsx
      SafeAreaView.tsx
      Spinner.tsx
      index.ts
    theme/                     ← packages/design-tokens/src/* 内联（语义化重命名）
      colors.ts
      typography.ts
      spacing.ts
      index.ts
    core/                      ← apps/mobile/lib/* 内联 + 新建
      error-boundary.tsx       (from lib/error-boundary.tsx)
      auth-gate-decision.ts    (from lib/auth-gate-decision.ts)
      auth-gate-decision.spec.ts
      api/
        client.ts              (from lib/api/setup.ts 或拆分)
        query-client.ts        (from lib/api/query-client.ts)
        use-me.ts              (from lib/api/use-me.ts)
        errors.ts              (from lib/api/errors.ts)
        problem-guards.ts      (per ADR-0036/0038 — 已存在/或本 PR 新增)
  app.json / babel.config.js / metro.config.js / tailwind.config.ts / tsconfig.json / vitest.config.ts
```

`packages/` 落地后只剩：

```text
packages/
  api-client/      保留（Orval 生成，server+mobile 共享）
  types/           保留（server+mobile 共享）
```

## 7 工具层改动 inventory

| # | 层 | 文件 | 改动 |
|---|---|---|---|
| 1 | pnpm workspace | `pnpm-workspace.yaml` | 删 `packages/auth` / `packages/ui` / `packages/design-tokens` 三行（如未走 glob 通配） |
| 2 | Nx project graph | `packages/{auth,ui,design-tokens}/project.json` | 物理删除整目录；`nx graph` 应自动重生 |
| 3 | TS 路径 | `apps/mobile/tsconfig.json` | 删 `paths.@nvy/auth*` / `paths.@nvy/ui*` / `paths.@nvy/design-tokens*`；加 `paths."~/*": ["src/*"]` |
| 3 | TS base | `tsconfig.base.json` | 检查是否同样含 @nvy/* paths，需同步删 |
| 4 | ESLint | `eslint.config.mjs` | 删 `pkg-auth` / `pkg-ui` / `pkg-design-tokens` 三 depConstraints 段；mobile element 加 `~/*` 兼容 |
| 5 | Tailwind | `apps/mobile/tailwind.config.ts` | `content[]` 加 `./src/**/*.{ts,tsx}`（保留 `./app/**` 与 `./lib/**` 视存留情况） |
| 6 | Vitest | `apps/mobile/vitest.config.ts` | 若有 alias resolve 段，同步加 `~`→`src` |
| 7 | Metro+Babel | `apps/mobile/metro.config.js` + `apps/mobile/babel.config.js` | 加 `~/*` resolver（`metro-resolver` extraNodeModules 或 `babel-plugin-module-resolver`），确保 RN 端运行时 alias 可解 |
| 附 | mobile package.json | `apps/mobile/package.json` | 吸收原 `@nvy/auth` 的 deps：`expo-secure-store` + `zustand`（验是否已在 mobile deps，是则 dedupe） |
| 附 | 已合包消费 | `apps/mobile/app/**/*.tsx` / `apps/mobile/lib/**/*.ts*` | import 全量 rewrite，见下表 |

## Import rewrite 映射

| 旧 | 新 |
|---|---|
| `@nvy/auth` / `@nvy/auth/*` | `~/auth` / `~/auth/*` |
| `@nvy/ui` / `@nvy/ui/*` | `~/ui` / `~/ui/*` |
| `@nvy/design-tokens` / `@nvy/design-tokens/*` | `~/theme` / `~/theme/*` |
| `../lib/error-boundary` / `apps/mobile/lib/error-boundary` | `~/core/error-boundary` |
| `../lib/auth-gate-decision` | `~/core/auth-gate-decision` |
| `../lib/api/use-me` / `../lib/api/query-client` / `../lib/api/errors` / `../lib/api/setup` | `~/core/api/use-me` / `~/core/api/query-client` / `~/core/api/errors` / `~/core/api/client` |

**已知 6 个 mobile 消费文件** 需 rewrite（grep `@nvy/(auth|ui|design-tokens)` 命中）：

- `apps/mobile/tailwind.config.ts`
- `apps/mobile/app/_layout.tsx`
- `apps/mobile/app/(app)/(tabs)/_layout.tsx`
- `apps/mobile/app/(app)/(tabs)/profile.tsx`
- `apps/mobile/lib/api/use-me.ts`
- `apps/mobile/lib/api/setup.ts`

外加 lib/ 内部互引（auth-gate-decision / error-boundary / api/* 之间）需同步 path 化。

## Step → verify 执行序列

1. **新建空骨架** → verify: `mkdir apps/mobile/src/{auth,ui,theme,core,core/api}`；`tree apps/mobile/src` 见 5 个目录
2. **3 包 git mv 内联** → verify: `git mv packages/auth/src/* apps/mobile/src/auth/` × 3 包；`ls packages/{auth,ui,design-tokens}/src` 应空或不存在
3. **lib/ 迁 src/core/** → verify: `git mv apps/mobile/lib/error-boundary.tsx apps/mobile/src/core/`（+ auth-gate-decision* + api/*）；`ls apps/mobile/lib` 应空
4. **删 packages 残壳** → verify: `rm -rf packages/{auth,ui,design-tokens}`；`pnpm-workspace.yaml` 同步删；`pnpm install` 不报 missing workspace
5. **tsconfig paths swap** → verify: `apps/mobile/tsconfig.json` paths 仅含 `~/*` + `@nvy/api-client` + `@nvy/types`；`tsconfig.base.json` 同步；`nx run mobile:typecheck --skip-nx-cache` GREEN（**禁缓存**，per `feedback_nx_cache_false_green_on_new_files`）
6. **eslint boundaries 清理** → verify: 删 3 个 depConstraints 段；`nx run mobile:lint --skip-nx-cache` GREEN；用一条 forbidden import 反向验 boundaries 真生效（per `feedback_lint_plugin_upgrade_must_verify_with_violation`）
7. **tailwind content + metro/babel resolver** → verify: `tailwind.config.ts` content 加 `./src/**`；`metro.config.js` extraNodeModules 或 babel module-resolver root 含 `~`；`pnpm nx run mobile:start` 不报 "unable to resolve `~/auth`"
8. **vitest resolve alias** → verify: 单测引 `~/auth/store` 跑 GREEN；`nx run mobile:test --skip-nx-cache` GREEN
9. **import rewrite 全仓 sweep** → verify: `rg '@nvy/(auth|ui|design-tokens)' apps packages` 0 命中；`rg "from '\.\./lib/" apps/mobile` 0 命中
10. **mobile package.json deps absorb** → verify: `expo-secure-store` + `zustand` 在 `apps/mobile/package.json` 已存在或加入；`pnpm install` 后 lockfile diff 仅减不增（packages 删除导致的 dep 收缩）
11. **typecheck 闭环全包** → verify: `pnpm nx run-many --target=typecheck --all --skip-nx-cache` GREEN（含 server / api-client / types — packages 删除不应连锁影响）
12. **test 闭环** → verify: `pnpm nx run-many --target=test --all --skip-nx-cache` GREEN
13. **bundler 冒烟** → verify: `pnpm nx run mobile:start` 30s 内 bundler ready 0 error；`pnpm nx run mobile:serve-web`（或 `expo start --web`）打开 login page console clean
14. **Tailwind 视觉冒烟** → verify: Expo Web 开 login page 看 `<Button>` 真有 `bg-*` / `text-*` 渲染（content path 漏改时 class 不生效，Button 退化成无样式）
15. **Playwright e2e T040** → verify: `pnpm nx run mobile:e2e --skip-nx-cache` GREEN（PR-5c 已通过的 baseline 不应回退）

## 验收门槛（must-pass，全过才能 merge）

| Gate | 命令 | 期望 |
|---|---|---|
| A. nx 全包 typecheck/test/lint | `pnpm nx run-many --target=typecheck,test,lint --all --skip-nx-cache` | 全 GREEN |
| B. Bundler 冒烟 + grep 0 命中 | `pnpm nx run mobile:start` 30s GREEN；`rg '@nvy/(auth\|ui\|design-tokens)' apps packages` | bundler ready 无 error；grep 退出码 1（0 命中） |
| C. Playwright e2e T040 | `pnpm nx run mobile:e2e --skip-nx-cache` | GREEN |
| D. Tailwind 视觉冒烟 | Expo Web 开 login page，肉眼 Button 带样式 | Button 不退化为无样式 |

## 风险与边界

| 风险 | 应对 |
|---|---|
| `~/*` alias 在 metro 运行时不解（babel-plugin-module-resolver 漏配） | step 7 显式验 `metro:start`；如失败 fallback 用相对路径（`../auth/store`），可临时绕开但 ADR-0030 alias 设计需 amend |
| Tailwind content path 改了但 cache 命中导致老 CSS 输出 | tailwind 不走 nx cache；`rm -rf apps/mobile/.expo apps/mobile/dist` 后重启 |
| `expo-secure-store` / `zustand` 因 packages/auth 删除而被 pnpm GC 出依赖树 | step 10 显式加 `apps/mobile/package.json` dependencies；shamefully-hoist 不依赖（[ADR-0028](../../adr/0028-monorepo-pnpm-policy.md)） |
| `nx graph` 缓存残留指向已删 packages | `pnpm nx reset` 后重跑 |
| Expo `app/` 目录文件被误当 import root（per `reference_expo_router_app_route_scan`） | 所有共享逻辑必落 `src/` 不入 `app/`；`app/` 仅放路由 .tsx |
| PR diff 大（约 30+ 文件 + 数百行）review 负担 | commit 内部分两轮：(a) git mv (rename-only，diff 几乎为 0)  (b) 工具配置 + import rewrite。git 识别 rename 后 diff 主要落 (b)。 |

## Out of scope（明确不做）

- `packages/api-client` / `packages/types` 任何动作（保留）
- ADR-0030 文本 amend（本 PR 严格按 ADR-0030 现版执行，不 amend）
- 任何 server / api-client 业务逻辑改动
- `eslint.config.mjs` 中 mobile element 之外的 boundaries 段重排
- Storybook / 设计系统抽象（YAGNI，sunset_trigger 触发再做）

## 关键文件清单（修改点）

- 新建空目录：`apps/mobile/src/{auth,ui,theme,core,core/api}/`
- `git mv` 源/目标 13 个：
  - `packages/auth/src/{store,store.spec,token-refresh,token-refresh.spec,index}.ts*` → `apps/mobile/src/auth/`
  - `packages/ui/src/{Button,SafeAreaView,Spinner,index}.tsx*` → `apps/mobile/src/ui/`
  - `packages/design-tokens/src/{colors,typography,spacing,index}.ts` → `apps/mobile/src/theme/`
  - `apps/mobile/lib/{error-boundary.tsx, auth-gate-decision.ts, auth-gate-decision.spec.ts}` → `apps/mobile/src/core/`
  - `apps/mobile/lib/api/{client(setup),query-client,use-me,errors}.ts` → `apps/mobile/src/core/api/`
- 删除：`packages/{auth,ui,design-tokens}/` 整目录
- amend：`pnpm-workspace.yaml` / `tsconfig.base.json` / `apps/mobile/tsconfig.json` / `apps/mobile/package.json` / `apps/mobile/tailwind.config.ts` / `apps/mobile/vitest.config.ts` / `apps/mobile/metro.config.js` / `apps/mobile/babel.config.js` / `eslint.config.mjs`
- import rewrite（6 个 mobile 文件 + lib 内部互引）

## 与 review-tech-stack-post-a002 plan 的关系

- 本 plan **superseded** 原 PR-3 段（lines 162-170）
- 原 review plan PR-3 段建议加 historical note 指向本 plan；其余 PR-1/2/4/5a/5b/5c 已 ship 不变
- 本 plan 完成后，review chore 链全部 closed，触发 retro 进入 Plan 2 业务迁移
