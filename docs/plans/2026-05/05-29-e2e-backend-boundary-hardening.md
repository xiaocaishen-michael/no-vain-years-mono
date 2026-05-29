# Mobile e2e 后端边界硬化

> 目标：让 Expo Web Playwright e2e 的「后端依赖」确定化，消除「seed 假会话 + 赌后端不可达」反模式，撤掉 `retries:2`/`workers:1` 这层掩盖，并补齐 smoke + 契约两层。落地后 e2e 结果只取决于代码，不取决于本机是否恰好有后端在 :3000。

## 1. 背景与问题

当前部分 seed-authed e2e **既不 mock 后端、又依赖后端不可达**：往 `localStorage('nvy-auth')` 注入假 token → 启动 web 产物 → 靠「CI 里没后端」让假会话存活。一旦真后端在 `:3000`（如本机 `nx serve` 正在跑），`useMe`（挂 `_layout`）发的 `GET /me` 拿到真 **401** → token-refresh 用假 refreshToken 失败 → `clearSession` → 跳 `/login` → 断言全栽。

这在业界是公认反模式（详见 §7 调研）：

1. **非 hermetic** —— 未受控外部依赖（:3000 后端）泄漏进测试。
2. **seed 的会话服务端不认** —— 与 refresh-token 轮换天然冲突（FusionAuth/Momentic）。
3. **`retries:2` 掩盖** —— Fowler/多家 QA：retry 不修 flake，只藏 flake。

实证（2026-05-29）：`apps/mobile/e2e/playwright.runtime-smoke.config.ts` 设 `retries: CI?2:0` + `workers: CI?1:undefined`；本机有后端时该套件确定性失败 6 条，CI 无后端 + 重试下确定性通过 —— 即「绿」全靠环境差异，不是测试本身稳。

## 2. 目标架构（4 层）

| 层 | 会话怎么来 | 网络怎么处理 | 量 | retry |
| --- | --- | --- | --- | --- |
| **主体 FE e2e** | seed `storageState`/localStorage（假的也行） | **stub**（`mockJson`/`page.route`）——**含 `GET /me` + refresh** | 大批 | 并行；`retries:1`+`trace:on-first-retry` 仅作探测 |
| **真后端 smoke** | 程序化 API 登录（服务端真认的有效会话） | 不 stub，打真·临时后端（testcontainers + seed DB） | 1 条 | 同上 |
| **契约测试** | — | 验 stub 与真 API 不漂移 | 守门 | — |
| **原生信心**（按需） | 真登录 / seed | 真 / staging 后端 | 少 | Maestro 跑原生二进制 |

关键纪律：主体层命门是**网络边界确定性**，不是会话有效性；会话有效性只在「真后端 smoke」（故意不 stub）时才上场。

## 3. 现状盘点（grounds 排期，2026-05-29 grep 实证）

mock 基建**已存在**：`apps/mobile/e2e/_support/api-mock.ts` 的 `mockJson(page, urlGlob, status, body, method?)`，已处理 CORS 预检 + 按 method 区分同 glob 的 `GET`/`PATCH /me`（login T066 抽出）。本计划是**补缺口**，非从零建 mock。

| spec | 用 `mockJson`? | 现状 | P1 动作 |
| --- | --- | --- | --- |
| `profile.spec.ts` | ❌ 纯 `addInitScript` seed | **最脆**（US5/US7/US8/US9/US11 栽这） | 改用 `mockJson` stub `GET /me`（+ 必要 refresh） |
| `tokens-refresh.spec.ts` | ❌ 裸 inline `page.route` | 未走 helper | 收敛到 `mockJson`，确保 `/me`+refresh 覆盖 |
| `cancel-deletion.spec.ts` | ✅ | authed-boot `GET /me` 可能 stub 不全（真后端在场时失败） | audit 补全 authed-boot `GET /me` stub |
| `delete-account.spec.ts` | ✅（+ seed） | 同上待 audit | audit `GET /me` 覆盖 |
| `login-management.spec.ts` | ✅（+ seed） | 同上待 audit | audit |
| `settings-shell.spec.ts` | ✅（+ seed） | 同上待 audit | audit |
| `login.spec.ts` | ✅ | cold-boot 流，无 seed | 复核（基本 OK） |
| `onboarding.spec.ts` | ✅（+ seed） | 同上待 audit | audit |

## 4. 分阶段排期

### P1 — 主体层确定化（消除反模式，撤重试掩盖）

目标：所有 seed-authed e2e 在「有无 :3000 后端」下结果一致；撤 `retries:2`/`workers:1`。

1. `profile.spec.ts` 引入 `mockJson` → stub `GET /me`（返回 seed 一致的 profile body）+ refresh：verify → 本机 `nx serve` 起后端占 :3000，`nx run mobile:runtime-smoke` 仍全绿（旧行为此时必栽）。
2. `tokens-refresh.spec.ts` 收敛到 `mockJson`（保留它本就要测的 refresh 行为，但 `/me` 走 helper）：verify → 同上后端在场仍绿。
3. audit 其余 5 个 seed-authed spec 的 authed-boot `GET /me` stub 是否齐（`mockJson(..., 'GET')` 命中）：verify → 逐个本机带后端跑绿。
4. `playwright.runtime-smoke.config.ts` 与 `playwright.config.ts`：`retries` 降到 `CI?1:0`、移除 `workers:1`（恢复并行）、保 `trace:'on-first-retry'`：verify → 干净环境 `nx affected ... runtime-smoke` 零重试全绿 + 并行下无 storageState 串扰。
5. 加一条 ESLint/lint 或文档约束：seed-authed spec **必须** import `_support/api-mock` 并 stub `GET /me`（防回归再现 profile.spec 裸 seed）：verify → 故意删一处 stub，约束 fire。

工作量：~0.5–1 天。依赖：无（mock 基建已就位）。**这是最高杠杆、解耦的一阶段，建议先单独 ship。**

### P2 — 真后端 smoke + 契约守门 ✅（已 ship）

目标：补 1 条真链路 smoke + 守 stub 不漂移。

1. ✅ 选 1 条核心旅程（登录 → 落鉴权区核心页）作**唯一**真后端 smoke：起 testcontainers PG+Redis + 真 server + **程序化 API 登录**取真 token 注入：verify → 该 smoke 不 stub 任何网络仍绿。
   - 落地为 env-gated 独立 job（`RUN_REAL_BACKEND_SMOKE`，nightly 软信号，非 PR 阻断），不进 `nx affected` 主管线。
   - **架构（Option B）**：standalone tsx orchestrator（`apps/mobile/e2e/_support/real-backend-runner.ts`）起容器 → `prisma migrate deploy` → spawn 真 server（`node apps/server/dist/main.js`，swc build 保留装饰器元数据，避开「Playwright globalSetup in-process boot 不发 decorator metadata → NestJS DI 炸」）→ 程序化登录 → 跑 Playwright → `finally` 拆容器。Nx target `mobile:e2e-real-backend`（dependsOn `build` + `server:build`）。
   - **纯黑盒登录**：`phone-sms-auth` 首登自动注册（find-or-create）→ 无需 `@prisma/client` 耦合进 mobile；`issueSmsCode()` 在 `NODE_ENV=development && !VITEST` 返回固定 `999999` → 无需翻日志/DI 取码。登录后 `PATCH /me` 置 displayName，使 AuthGate 落鉴权区 tabs（null 名会走 onboarding）。
   - **会话引导真实性**：浏览器只 seed 真 refreshToken（无 accessToken，与 web 端 in-memory-only 一致）→ cold boot → 真 `POST /refresh-token` → 真 `GET /me` → tabs。spec（`real-backend.spec.ts`）**零** `mockJson`/`page.route`。
   - **负控已验**：把 refreshToken 改坏 → smoke 必 RED（真 server 拒续期 → clearSession → 弹 /login），证明真依赖后端非假绿。CI 见 `.github/workflows/e2e-real-backend.yml`。
2. ✅ 契约守门：基于已有 `@nvy/api-client`（Orval 从 server `openapi.json` 生成）给 `GET /me` + refresh 加一个 typed shape 断言（轻量，非引入 Pact）：verify → 故意改 server DTO 字段，契约检查 fire（暴露 mock 将漂移）。落地 `apps/mobile/src/core/api/backend-contract.spec.ts`（放 `src/` 非 `e2e/`，因 mobile tsconfig exclude `e2e/`，守门放那永不 fire）。

工作量：~1–2 天。依赖：P1 完成（先确定化主体，再加 smoke 不被噪声淹没）。

### P3 — 原生信心（按需，可延后）

目标：补原生二进制 e2e（Playwright Expo Web 只覆盖 web runtime，不验真机）。

1. 评估 Maestro（YAML 声明式、零原生构建配置、低 flake）跑 1–2 条原生关键流：verify → 真机/模拟器登录流绿。

工作量：~2–3 天。依赖：与 P1/P2 解耦；**仅当需要真机发布信心时启动**，否则留 backlog。

## 5. Out-of-scope（按目标定）

- 不重写 mock 基建（`mockJson` 已够用，只补 caller 缺口）。
- 不引入 Pact 全套契约平台（P2 用轻量 typed shape 守门即可）。
- 不动 server 侧 IT（Testcontainers 已健全）。
- 不在 P1/P2 阶段做 Maestro（P3 单独评估）。

## 6. 风险 / 注意

- **CORS**：`mockJson` 已处理跨源预检（OPTIONS 204）；新 stub 别绕过 helper 自己写 route，否则漏预检（参 helper 头注释）。
- **同 glob 多 verb**：authed-boot `GET /me` 与表单 `PATCH /me` 同 URL，必须用 `method` 参数区分（helper 已支持，caller 别漏传）。
- **撤并行前**先确认无 storageState 串扰（每条测试自带 stub 网络后即可恢复并行）。
- **retries 不要直接归 0**：留 `retries:1`+trace 作探测器，per Fowler「quarantine + 修根因」而非「retry 到绿」或「一刀切关」。

## 7. 参考（调研已核 ≥2 源，2026-05-29）

Playwright 官方 [best-practices](https://playwright.dev/docs/best-practices)/[auth](https://playwright.dev/docs/auth)/[mock](https://playwright.dev/docs/mock)；Cypress e2e 指南（绝大多数 stub + 单条 true e2e）；Fowler [Test Pyramid](https://martinfowler.com/articles/practical-test-pyramid.html) + [Non-Determinism](https://martinfowler.com/articles/nonDeterminism.html)（quarantine + 修根因，拒 retry-to-green）；Kent C. Dodds 测试奖杯；MSW / Pact docs；FusionAuth / Momentic（localStorage token 复用 vs refresh 轮换冲突 → 程序化 API 登录）；Maestro vs Detox（RN 原生 e2e）。
