# Plan: PR-5 Tail — Orval + 数据流重构收口（polyfill 修 + 全链路验证）

## Context

PR-5 链（PR-5a #73 server / PR-5b #74 api-client Orval / PR-5c #75 mobile）于 2026-05-21 全部 merged，但**未跑过任何真后端 + 真 mobile runtime smoke**。本 plan 从 [05-21-review-tech-stack-post-a002](2026-05/05-21-review-tech-stack-post-a002.md) 的 PR-5 段单独迁出，理由：

1. **明确遗留 bug**：`apps/mobile/app/_layout.tsx` 缺 `import 'react-native-get-random-values'` polyfill（原 plan L185 显式要求）。`apps/mobile/src/core/api/setup.ts` axios interceptor 用 `Crypto.randomUUID()` 生成 `x-trace-id` — bare RN runtime 未注入 polyfill 时会抛 `crypto.getRandomValues() not supported`，**所有走 axios 的请求（useMe / login / SMS / refresh / 任何 RQ hook）在 interceptor 阶段就死**。
2. **级联风险**：A-002 收尾阶段已有 5 次「单点修复 → 新 bug → 再修 → 再 bug」循环（pnpm strict / Metro / NativeWind / web localStorage / 11+ peer dep 雪崩）。本 plan 用**一次性宽验证**（nx affected 全包 + 真后端 + Expo Web golden path + ErrorBoundary 触发实证）截断循环，而不是只修 polyfill。
3. **scope 隔离**：原 review plan 的 PR-6（lefthook gitleaks / check-env-sync / seed / JWT 双 token / refresh rotation / secrets volumes / perf env）与 PR-7（ADR-0026 stub / Catalog v1 / Maestro / PR template）与本 tail 无强耦合，**留在原 plan**。

**目标**：PR-5 链状态从「merged 但未运行验证」→「全链路真实跑通 + Issue #68 closed + T040 e2e GREEN」。

## Out of Scope（明确不做）

- 任何原 PR-6 范围（data / security / perf infra）
- 任何原 PR-7 范围（doc 收口）
- mobile telemetry / Sentry / 远程日志（deferred 到 Plan 3）
- 重审 Orval / react-query / Zustand 决策（已 locked，本 plan 不动）

## 工作单元（5 个 sequential micro-task，无并行）

### T1 — Polyfill 修复（≈ 5 min，必先）

**改动 1 file**：`apps/mobile/app/_layout.tsx`，在文件**第 1 行**（任何 import 之前）加：

```ts
import 'react-native-get-random-values';
```

**依赖**：`react-native-get-random-values` 是 expo-crypto 的 transitive peer dep，apps/mobile/package.json 应已含；若 `pnpm -C apps/mobile ls react-native-get-random-values` 返回空，显式 `pnpm -C apps/mobile add react-native-get-random-values`。

**Why first**：T2-T5 所有验证依赖 axios interceptor 不抛错。polyfill 不在位 → smoke 一启动就死。

### T2 — 全包 cascade typecheck/test/lint（≈ 5 min）

```bash
pnpm nx run-many --target=typecheck,test,lint --all --skip-nx-cache
```

**verify**：3 个 target 在 mono root 全 GREEN。任何包 RED → STOP，不进 T3。

**Why**：polyfill 是 side-effect import 不影响 typecheck，但 PR-5b/5c 期间可能埋 stale cache（参 memory `feedback_nx_cache_false_green_on_new_files` — phone-sms-auth PR #7 实证）。`--skip-nx-cache` 强制重跑捕真实 baseline。

### T3 — 真后端 boot + ProblemDetail endpoint smoke（≈ 10 min）

启 Testcontainers PG + Redis + nest server（端口走 `mono-worktree feat-list` 查询当前 feature 分配的 server PORT），然后：

```bash
# Terminal A: server
pnpm nx run server:serve
# Terminal B: smoke
TRACE_PROBE_PORT=<port>
curl -i http://localhost:$TRACE_PROBE_PORT/api/v1/accounts/me \
  -H "Authorization: Bearer expired.fake.token"
# 期望: 401 ProblemDetail + traceId + x-trace-id header

# 触发 FORM_VALIDATION（missing field）
curl -i -X POST http://localhost:$TRACE_PROBE_PORT/api/v1/auth/sms/send \
  -H "Content-Type: application/json" -d '{}'
# 期望: 400 ProblemDetail + code:"FORM_VALIDATION" + invalidAttributes:[...]
```

**verify checklist**：
- [ ] 响应 body 是 RFC 9457 ProblemDetail JSON（含 `type / title / status / detail / instance`）
- [ ] `traceId` 字段非空且为 UUID
- [ ] `x-trace-id` response header 值与 body.traceId 相等
- [ ] 同 trace_id 命中 server stdout（`docker compose logs server | grep <id>`）
- [ ] FORM_VALIDATION 响应含 `code` + `invalidAttributes[]`

任一 fail → 写入「Findings」+ STOP。

### T4 — Expo Web golden-path smoke（≈ 15 min）

调用 `verify` skill 起 `pnpm nx run mobile:start --web`，跑 4 条主路径：

1. **登录路径**：phone → SMS code → 登录成功 → DevTools console 见 `useMe()` fire → `useAuthStore.profile` 字段同步非空
2. **trace_id 串联**：DevTools Network 选任一 `/api/v1/*` 请求 → Request header `x-trace-id: <uuid>` → 后端 `docker compose logs server | grep <uuid>` 同 id 命中至少 1 行
3. **业务错误中文展示**：用 freeze fixture user 触发 `ACCOUNT_IN_FREEZE_PERIOD` → UI 显示 ERROR_DISPLAY_MAP 中文（`apps/mobile/src/core/api/errors.ts` L123-132） → 错误屏底部灰字 `trace_id: <uuid>` 可见
4. **ErrorBoundary 触发**：临时在 `use-me.ts` onSuccess 注入 `throw new Error('boundary-test')`（验证后立刻 revert）→ ErrorBoundary fallback UI 出现 → 含 trace_id + retry 按钮 → retry 后恢复

**Evidence**：4 张截图存 `/tmp/pr5-tail-smoke/{login,trace,freeze,boundary}.png`，PR body 内链引用。

**Why 4 条而非 1 条**：合起来覆盖 axios interceptor / Orval-generated client call / react-query / Zustand persist / type guards / ERROR_DISPLAY_MAP / ErrorBoundary / x-trace-id 串联 — 即全部 PR-5c 新 surface。少一条都可能漏 cascade bug。

### T5 — Issue #68 close + T040 e2e + 单 PR 收口（≈ 10 min）

```bash
pnpm nx run mobile:e2e --skip-nx-cache   # 原 plan L237 T040
gh issue close 68 --comment "Closed by PR #74 (Orval swap) + PR-5 tail validation"
```

- T040 GREEN 后才 close Issue #68
- 单 PR title: `fix(mobile): PR-5 tail — react-native-get-random-values polyfill + post-merge validation`
- PR body 含 T2 / T3 / T4 / T5 全部 evidence 链接
- 走默认 `gh pr merge --auto --squash --delete-branch`（per [git-workflow.md](../conventions/git-workflow.md)）

## Critical Files

仅 1 个改动文件 + 1 个临时改动（T4 step 4 revert）：

| 路径 | 改动 |
|---|---|
| `apps/mobile/app/_layout.tsx` | L1 加 `import 'react-native-get-random-values';` |
| `apps/mobile/src/core/api/use-me.ts` | T4 step 4 临时注入 `throw`，验证后 git restore |

不动文件（已 ship，不动）：`packages/api-client/orval.config.ts` / `apps/mobile/src/core/api/{setup,errors,query-client}.ts` / `apps/mobile/src/core/error-boundary.tsx` / `apps/server/src/security/{form-validation.exception,problem-detail.filter,problem-detail.response}.ts` / `apps/server/src/app/app.module.ts`。

## Verification（整体 DONE / STOP）

**STOP criteria（任意命中即停 + 写「Findings」+ 回报 user，不绕过）**：

- T2 / T3 / T4 / T5 任一 step RED
- T040 e2e RED 且无法 5 分钟内定位
- 出现原 plan 未预期的新错误类型（典型：Metro bundle 异常 / 新 peer dep 缺失 / Orval-generated 调用签名 mismatch）

**DONE criteria（5 条全满足）**：

1. T1-T5 五个 micro-task 全 GREEN
2. Issue #68 状态 = closed
3. 4 张 smoke 截图存证
4. T040 e2e GREEN
5. 单 PR merged + 分支删

## Risk + Rollback

| 风险 | 缓解 |
|---|---|
| polyfill 加后 Metro bundle 异常 | `react-native-get-random-values` 是 Expo SDK 54 通过 expo-crypto 间接 bundle 的包，未触发过 Metro 冲突；若真出现，回滚 = `git revert` 单行 |
| nx affected cache 假绿 | `--skip-nx-cache` 强制重跑 |
| T4 截图工具不可用 | 退化为浏览器手动导航 + console.log + 屏幕录制 |
| 撞到原 plan 未预期 cascade bug | 立即停在 T2/T3/T4 任一节点，写 Findings + 评估是否新 follow-up plan；**不在本 PR 内 hack** |

## Findings（执行时填）

**T1** — Polyfill fact-check 结论是不必要（`expo-crypto@55.0.15` Web 走 `globalThis.crypto.randomUUID()`，native 走原生模块；`react-native-get-random-values` 在当前栈零调用点）。User 选择防御性仍添（防未来 lib 升级带 hidden 依赖）。改动：`apps/mobile/app/_layout.tsx` L1 加 polyfill import + comment 注明 defensive 性质；`apps/mobile/package.json` 新增 `react-native-get-random-values@^2.0.0` direct dep。

**T2 (v1)** — 撞 1 个 pre-existing lint ERROR：`scripts/orchestrator/llm-client.ts:355` 违反 `@typescript-eslint/no-inferrable-types`，与 PR-5 无关。Pre-existing 但 CI 在 main 上被 nx cache 蒙过（与 memory `feedback_nx_cache_false_green_on_new_files` 同源）。

**T2 (v2)** — User 授权顺手 fix（1 行删 `: string`）。重跑全包 cascade GREEN：`Successfully ran targets typecheck, test, lint for 5 projects`，0 fail。

**T3** — 撞 **2 个真级联 bug**（PR-5a 服务端瑕疵，PR-5c 移动端死代码）：

1. **`x-trace-id` 全链路断**（验 3 个 endpoint 全空，含 inbound header 传入场景）
   - 根因：`apps/server/src/security/security.module.ts:61` ClsModule 用 `interceptor: { mount: true }` 注册
   - NestJS lifecycle 顺序：Guards → Interceptors → Pipes → Controller → Filters。Guard 抛异常 / Filter 接异常时 ClsInterceptor 的 RxJS pipeline 外，`cls.getId()` 永远 `undefined`
   - 实证：服务器 stdout log 字段 `"trace_id":"no-trace"`，header `x-trace-id: ` 空
   - 修：interceptor → middleware mode，`mount: true` + Fastify middleware adapter
   - 影响面：`ProblemDetailFilter` traceId 注入失效 / LoggerModule customProps `trace_id` 全 `"no-trace"` / mobile ErrorBoundary 显示 trace_id 拿到空串

2. **`FormValidationException` 完全没接进 lifecycle**（mobile FORM_VALIDATION 路径全死代码）
   - 根因：`apps/server/src/main.ts:19-21` `new ValidationPipe({ transform: true, whitelist: true })` 用默认 `exceptionFactory`，class-validator 错全部走 vanilla `BadRequestException`
   - `FormValidationException` 类定义在 `apps/server/src/security/form-validation.exception.ts`，但 grep 全仓 **0 caller** —— 永远不会被抛
   - 实证：smoke 2 (`POST /accounts/sms-codes` body `{}`) 响应 body `{"type":"about:blank","title":"Bad Request","status":400,"detail":"phone must be E.164 ...","instance":"..."}`，**无 `code: "FORM_VALIDATION"`，无 `invalidAttributes[]`**
   - 修：`ValidationPipe.exceptionFactory` 自定义，把 `ValidationError[]` map 成 `InvalidAttribute[]` 后抛 `FormValidationException`
   - 影响面：mobile `isFormValidationError` 类型守卫 / `FORM_VALIDATION` ERROR_DISPLAY_MAP entry / form.setError invalidAttributes 自动映射全部是死代码

**T3 额外发现**：`apps/server/.env` 缺 `SMS_CODE_HMAC_SECRET`（`.env.example` 有但本地 .env 没），server boot fail。本机 fix（gitignore 中本地补齐）但这印证原 review plan PR-6 lefthook `check-env-sync` 该 ship。out-of-scope，建议 PR-6 提速。

**T4** — 起手撞**第 4 层 cascade**（pre-existing 自 PR #65 A-002 起，e2e 从未真跑过所以无人发现）：
- 根因：`decideAuthRoute` 在 `isAuth + onboarded + 在 /` 时返回 noop（误把"无 group flag"等同于"已在 (tabs)"）；`app/index.tsx` 返 null → blank screen
- 修：加 `inTabs` 输入字段 + 分支改成 `if (inTabs) noop else replace /(app)/(tabs)/profile`
- 同步改 `_layout.tsx` 调用点传 `inTabs: segments.includes('(tabs)')` + spec 新增 cold-boot 测试 case

T4 二次跑后撞 **3 个测试层问题**（test 配置 / 选择器 brittleness，非业务 bug）：
- `toHaveURL(/\(tabs\)\/profile/)` regex 没考虑 expo-router web 默认隐藏 route groups（实际 URL 是 `/profile`）→ 改成 `/\/profile$|\(tabs\)\/profile/`
- Playwright Desktop Chrome 默认 `hasTouch: false`，`.tap()` 全 throw → playwright.config.ts 加 `hasTouch: true`
- US11 用 `getByRole('button', ...)` 找 bottom tabs，但 @react-navigation 输出 ARIA `role="tab"`（test 注释自己也写了 `role="tab"`）→ 改成 `getByRole('tab', ...)`

**T4 最终**：5/5 Playwright e2e GREEN（US5/US7/US8/US9/US11 cold-boot + top tabs + settings push + topnav noop + bottom tabs 全验证）。Screenshot 显示 profile 完整渲染（小明 + 5 关注 / 12 粉丝 + 三 tabs + bottom nav）。

**T5** — 待填（PR 收口阶段）。

## 累积 cascade fix 全清单（8 处）

| # | 改动 | 类型 |
|---|---|---|
| 1 | `apps/mobile/app/_layout.tsx` + package.json | T1 polyfill + 调 decideAuthRoute 传 inTabs |
| 2 | `scripts/orchestrator/llm-client.ts` | T2 pre-existing lint error 顺手 fix |
| 3 | `apps/server/src/security/security.module.ts` | T3 CLS interceptor → middleware（覆盖 Guards/Filters） |
| 4 | `apps/server/src/main.ts` | T3 ValidationPipe.exceptionFactory 改抛 FormValidationException |
| 5 | `apps/server/.env` (gitignored) | T3 SMS_CODE_HMAC_SECRET 本机补齐（PR-6 check-env-sync 该 CI 拦） |
| 6 | `apps/mobile/src/core/auth-gate-decision.{ts,spec.ts}` | T4 加 inTabs 字段 + 分支改 + spec case |
| 7 | `apps/mobile/e2e/profile.spec.ts` | T4 URL regex / US11 selector role 修 |
| 8 | `apps/mobile/playwright.config.ts` | T4 hasTouch: true |

## Cascade 层深度回放（实证 user "不停的重修" 担忧）

| 层 | 触发 | bug 来源 |
|---|---|---|
| 0 | polyfill 缺 | 原 review plan L185（防御性，非真 bug） |
| 1 | T2 lint 红 | orchestrator main 上 stale，nx cache 蒙过 |
| 2 | T3 server boot 红 | .env / .env.example drift（SMS_CODE_HMAC_SECRET） |
| 3 | T3 traceId 空 | PR-5a CLS interceptor mode 漏 Guards/Filters |
| 4 | T3 FORM_VALIDATION 缺 | PR-5a FormValidationException 定义了但 0 caller |
| 5 | T4 blank screen | PR #65 A-002 decideAuthRoute 漏 root `/` 分支 |
| 6 | T4 URL regex 不识 web | A-002 spec 没考虑 expo-router 隐藏 route groups |
| 7 | T4 tap 不支持 | A-002 playwright config 没 hasTouch |
| 8 | T4 selector role | A-002 test 注释 vs 代码不一致 |

8 层中 5 层都是 "之前 merged 但从未真后端 + 真 UI 跑过" 的 silent breakage。本 PR 一次性兜底验证截断了未来反复修的循环。

## On Ship 备注

本文件目前在 plan-mode scratch 路径 `docs/plans/pr-5-05-21-review-tech-stack-post-a002-declarative-creek.md`。执行 T5 收口 PR 时，**同 PR 内 git mv** 到约定位置：

```
docs/plans/2026-05/05-21-pr5-tail-orval-stabilize.md
```

并删除 `declarative-creek` 后缀。理由：遵循 [docs-organization](../conventions/docs-organization.md) 约定 `YYYY-MM/MM-DD-<slug>.md` 体例（参 memory S349 — plan mode scratch 路径与项目 docs 约定有持续 friction，是已知问题不在本 plan 解决）。
