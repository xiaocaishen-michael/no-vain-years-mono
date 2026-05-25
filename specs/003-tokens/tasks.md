---
feature_id: 003-tokens
spec_ref: ./spec.md
plan_ref: ./plan.md
status: ready
created_at: '2026-05-25'
---

# Tasks: 003-tokens（refresh-token 持久化 + 轮换 + 全端登出）

**Spec**: [`spec.md`](./spec.md) | **Plan**: [`plan.md`](./plan.md) | **Branch**: `003-tokens`

## Format

`- [ ] T0NN [P?] [USx?] [层] 描述 + 文件路径`

- `[P]` = 可并行（不同文件、无未完成依赖）
- `[USx]` = 仅 user-story 阶段 task 带；Setup / Foundational / Polish 不带
- 层 = `[Server]` / `[Server-IT]` / `[Contract]` / `[Mobile]` / `[Mobile-E2E]`（per sdd.md）
- **TDD（强制）**：每个 impl task 内联绑 **unit 测试**（红→绿→typecheck/lint→`[X]`→commit，6 步闭环，per `.claude/rules/implement-task-closure.md`）；**integration 测试（Testcontainers）单列 `[Server-IT]` task**（= 每 US 的 Independent Test 验收）
- 无 task-meta JSON（手动模式，per p3 §3）
- 三位一体：server + contract + mobile **同 1 PR**

## Path Conventions

- server：`apps/server/src/{security,auth,account}/`（ADR-0043 扁平，文件平铺）；IT：`apps/server/test/integration/`
- contract：`apps/server/openapi.json` → `packages/api-client/`（Orval）
- mobile：`apps/mobile/src/auth/`；e2e：`apps/mobile/e2e/`

---

## Phase 1: Setup & 决策

- [X] T001 [Server] 确认 `JwtAuthGuard` 归位决策 → **决策 B**（方案 A「提升到 `security/`」不可行：现 guard 含 `isActive`/`account.rules` 账号状态门控，security→account 被 ESLint boundary 禁令拦死）。已加 `JwtTokenService.verifyAccess(token)→{accountId}`（security 平台层拥有 token 验证 + 单测 5 例）；auth 薄 guard 待 T017（logout-all 控制器，唯一消费方）委托之；account guard + `/me` **完全不动**（零回归，无新行为）

---

## Phase 2: Foundational（security token 基座 — 阻塞 US1/US2/US5）

- [X] T002 [P] [Server] `refresh-token-hasher.ts` in `apps/server/src/security/`：SHA-256 → 64 小写 hex（高熵 token 无 salt/HMAC，per ADR-0023 区分；禁 bcrypt）+ 单测（同输入稳定 / 大写 hex 拒 / 64 长度）。落为**纯函数** `hashRefreshToken`（ADR-0043 零-class），service 直接 import
- [X] T003 [P] [Server] `refresh-token.rules.ts` in `apps/server/src/security/`：纯函数 `isActive(record, now)`（`revokedAt==null && expiresAt>now`）/ `scrubPrivateIp(ip)`（私网/回环→null）/ `normalizeDeviceType(raw)`（→ **UPPERCASE** PHONE/TABLET/DESKTOP/WEB/UNKNOWN，**drift 修正**：plan 写小写但 DB `device_type` 默认 `"UNKNOWN"` + `login_method` `"PHONE_SMS"` 全大写，从 schema 权威）+ 常量 `REFRESH_TTL_DAYS=30` / `ACCESS_TTL_MIN=15`（与 JwtModule `15m` 对齐单一来源）+ 单测（37 断言：表驱动私网/回环/链路本地/IPv4-mapped/公网 IP + 各 deviceType + active/expired/revoked + 过期边界）
- [X] T004 [Server] `refresh-token.service.ts` in `apps/server/src/security/` 骨架：`@Injectable` + 4 方法签名占位（persist/findActiveByHash/rotate/revokeAllForAccount，throw stub）+ 导出 `PersistRefreshTokenInput`/`RotatedTokens` 类型；加入 `SecurityModule` `providers` + `exports`。**构造器 DI 延后增量补**（TS `noUnusedLocals` 不允许提前声明未读注入：T005 补 `PrismaService`+`hashRefreshToken`，T010 补 `JwtTokenService`）；verify typecheck ✅（DI 图静态自洽 + 骨架无新外部依赖，真 boot 由 T007 IT 验）

---

## Phase 3: User Story 1 — 签发即持久化 (P1) 🎯 MVP

**Goal**：登录成功后落 1 条 active refresh-token 行（带 device 元数据 + 30d 过期 + tokenHash）。
**Independent Test**：Testcontainers PG；新号经 phone-sms-auth 成功 → DB 新增 1 active 记录，逐字段断言。

- [X] T005 [US1] [Server] `RefreshTokenService.persist(accountId, rawToken, { deviceId?, deviceName?, deviceType?, clientIp, loginMethod })` in `apps/server/src/security/refresh-token.service.ts`：hash token → `prisma.refreshToken.create`（`expiresAt=now+30d`、`deviceId` 缺失回退 uuid v4、`ipAddress=scrubPrivateIp`、`deviceType=normalizeDeviceType`、`revokedAt=null`）+ 构造器补 `PrismaService` DI + 单测（Testcontainers PG：显式 deviceId + 私网 IP→null + deviceType 归一 / 无 deviceId→uuid v4 + 公网 IP 原样）。**run via `nx test server <file>`（cwd=apps/server，prisma migrate deploy 需）**
- [ ] T006 [US1] [Server] 改既有登录流接 persist：`phone-sms-auth.usecase.ts` 注入 `RefreshTokenService`（注入点上方 `// CROSS-CONTEXT-SYNC: auth → security 持久化 refresh-token`）→ `commitPhoneLogin` 后调 `persist(...)`；`account-phone-sms-auth.controller.ts` 取 `X-Device-Id` 头 + clientIp 透传 usecase；更新既有 `phone-sms-auth.usecase.spec.ts`（断言 persist 被调 + 返回 shape 不漂）
- [ ] T007 [US1] [Server-IT] `apps/server/test/integration/tokens.us1-persist.it.spec.ts`（Testcontainers PG）：登录成功 → DB active 记录逐字段（tokenHash=返回 token 哈希 / accountId / expiresAt≈+30d / deviceId 非空 / loginMethod=PHONE_SMS）；带 `X-Device-Id` vs 不带（回退）两路

---

## Phase 4: User Story 2 — Refresh 轮换 (P1) + US3 反枚举 + US4 并发

**Goal**：持 refresh token 原子轮换（revoke 旧 + 签新 + insert 新，继承 device 血缘 + 更 IP），全失败臂统一 401，并发恰 1 成功。
**Independent Test**：Testcontainers PG；预置 active 记录 → refresh → 旧撤/新 active/血缘继承/IP 更新；7 路失败字节级一致；10 并发同 token 恰 1。

- [ ] T008 [P] [US2] [Server] `RefreshTokenService.findActiveByHash(hash, now)` in `refresh-token.service.ts`：查 + `isActive` 过滤 → record|null + 单测（Testcontainers：active 命中 / expired miss / revoked miss）
- [ ] T009 [P] [US2] [Server] `account/inspect-account-status-by-id.usecase.ts`：`execute(accountId): Promise<AccountStatusInspection>`（findById + `account.rules.ts` 状态映射，返回同既有 kind）+ 单测
- [ ] T010 [US2] [Server] `RefreshTokenService.rotate(record, clientIp)` in `refresh-token.service.ts`：interactive `$transaction`（`isolationLevel:'Serializable'`）= signAccess + generateRefresh + hash + 条件 revoke 旧（`updateMany where {id, revokedAt:null}`）→ `count===0` throw `UnauthorizedException('INVALID_CREDENTIALS')`（回滚）→ create 新（继承 deviceId/deviceName/deviceType/loginMethod + 更 ipAddress + expiresAt=now+30d）；catch P2002 → 401；**外层 ≤3 次 P2034 retry**（镜像 `commit-phone-login.usecase.ts`）+ 单测（mock + Testcontainers）
- [ ] T011 [US2] [Server] `auth/refresh-token.usecase.ts` 编排：hash → per-token-hash 限流 → `findActiveByHash`（null→401）→ `inspectAccountStatusById`（非 ACTIVE→401，**不**抛 FROZEN 403）→ `rotate` → `LoginResponse`；跨 ctx 注入点 `// CROSS-CONTEXT-SYNC`（注入 `RefreshTokenService` + `InspectAccountStatusByIdUseCase`）+ 单测（各失败臂折叠 401）
- [ ] T012 [US2] [Server] `auth/account-token.controller.ts` `POST /api/v1/accounts/refresh-token`（EP1）+ `refresh-token.request.ts`（`{refreshToken}` + `@IsNotEmpty`，空→400）+ Swagger 装饰器 + register `auth.module.ts`；per-IP throttler named `refresh-ip` 100/60s（IP tracker）+ per-token-hash guard `refresh:<hash>` 5/60s（镜像 `sms-phone-throttler.guard.ts`）+ 单测
- [ ] T013 [US2] [Server-IT] `tokens.us2-rotate.it.spec.ts`（Testcontainers）：预置 active 记录 → refresh → 200 新 access/refresh；DB 旧 `revokedAt` 置、新 active、device 4 字段继承、`ipAddress`=本次、`expiresAt`≈+30d；重放已轮换 token → 401（单次使用）
- [ ] T014 [US3] [Server-IT] `tokens.us3-anti-enum.it.spec.ts`：7 路失败（not-found/expired/revoked/forged/account-missing/account-not-eligible/race-lost）响应 body+status+code **字节级一致**（401 INVALID_CREDENTIALS）；请求体缺 token → 400（区分）
- [ ] T015 [US4] [Server-IT] `tokens.us4-concurrency.it.spec.ts`：10 并发持同一 token rotate → 恰 1 成功 + 9×401，DB active=1；100 并发各不同 token → 0 错误

---

## Phase 5: User Story 5 — 全端登出 LogoutAll (P1)

**Goal**：撤账号全部 active 记录（含当前 device），幂等 204。
**Independent Test**：Testcontainers PG；账号 A 3 active + 1 已撤销 + 账号 B 2 active → logout-all → A 3 撤、A 已撤销时间戳不变、B 不动。

- [ ] T016 [US5] [Server] `RefreshTokenService.revokeAllForAccount(accountId, now)` in `refresh-token.service.ts`：`updateMany where {accountId, revokedAt:null} set revokedAt=now`（count 忽略，幂等）+ 单测（Testcontainers：N 撤 / 0 撤 / 隔离其他账号）
- [ ] T017 [US5] [Server] `auth/logout-all.usecase.ts`（取 accountId from JWT sub → `revokeAllForAccount` → void）+ `account-token.controller.ts` `POST /api/v1/accounts/logout-all`（EP2，挂 JwtAuthGuard，返回 **204**）；throttler named `logout-all-ip` 50/60s + `logout-all-account` 5/60s（account 桶先）+ 单测
- [ ] T018 [US5] [Server-IT] `tokens.us5-logout-all.it.spec.ts`：幂等（0/1/N 均 204）+ 隔离（已撤销记录时间戳不变 / 其他账号不受影响）+ 鉴权缺失→401

---

## Phase 6: User Story 6 — 限流 (P2)

**Independent Test**：Testcontainers + Redis；refresh 同 token 第 6 次 429、同 IP 第 101 次 429；logout-all 同账号第 6 次 429、同 IP 第 51 次 429。

- [ ] T019 [US6] [Server-IT] `tokens.us6-rate-limit.it.spec.ts`：4 规则（refresh-ip 100 / refresh-token 5 / logout-all-ip 50 / logout-all-account 5）→ 429 + 正确 `Retry-After`（限流 config 已在 T012/T017 加，本 task 纯验证）

---

## Phase 7: Contract（类型同步链，Constitution V）

- [ ] T020 [Contract] `nx run server:export-openapi` 产 `apps/server/openapi.json`（含 refresh-token + logout-all 端点）→ `pnpm nx affected --target=generate`（Orval `packages/api-client` regen）→ verify typed `refresh-token` / `logout-all` 调用生成（函数式，非 class）+ typecheck

---

## Phase 8: User Story 7 — 透明续期 (P1) + US8 登出 wrapper (P2)（client，无可见 UI）

**Goal**：401 透明续期（single-flight + retry once + 豁免）；logout-all wrapper（finally 清 session）。
**Independent Test**：vitest logic-level（拦截器调用次数 / 重试 / 清 session）；Playwright Web e2e 端到端续期。

- [ ] T021 [P] [US7] [Mobile] device id 生成 + 本地持久化（`apps/mobile/src/auth/`：uuid v4 + `expo-secure-store`，web localStorage fallback）+ api-client 请求拦截器注入 `X-Device-Id` 头 + logic 单测
- [ ] T022 [US7] [Mobile] 透明续期拦截器（`packages/api-client/src/` axios response interceptor）：401 → single-flight 一次 refresh（共享 in-flight promise）→ 新 access 重试原请求一次（`x-nvy-retry` 标记防二次）→ refresh 端点豁免 → 失败清 session + 路由 login + vitest logic-level（断言 refresh 调用次数=1 / 重试 1 次 / 豁免 / 失败清 session）。Metro `.js` 陷阱：相对 import extensionless
- [ ] T023 [P] [US8] [Mobile] `logout-all` wrapper（`apps/mobile/src/auth/`）：调 Orval logout-all hook + `finally` 无条件清 session（zustand clear）+ 路由 login + 单测（成功/失败均清 session）。**无可见 UI**
- [ ] T024 [US7] [Mobile-E2E] `apps/mobile/e2e/tokens-refresh.spec.ts`（Playwright Web）：登录 → 模拟 access 过期触发 401 → 透明续期 → 业务请求成功（复用 `apps/mobile/e2e/_support/api-mock.ts` 的 `mockJson`）

---

## Phase 9: Polish & Verify

- [ ] T025 [Server] catalog Operation 清单新增行：`server-bounded-context-catalog.md` § Operation Catalog 加 `logout-all`(auth,R2→security.revoke-all) / `persist-refresh-token` / `rotate-refresh-token` / `revoke-all-refresh-tokens`(security) / `inspect-account-status-by-id`(account)；spec + plan frontmatter `status` bump（draft→implemented / drafted→done）
- [ ] T026 [Verify] `pnpm exec nx affected -t lint typecheck test build runtime-smoke --base=origin/main` 全绿（含 `runtime-smoke`）+ `scripts/checks/check-server-moat.ts` 跨 ctx 注释通过 + 真后端冒烟（refresh+logout-all curl）+ web e2e 通过

---

## Dependencies（完成顺序）

```text
Setup(T001) → Foundational(T002-T004) → US1(T005-T007) → US2/3/4(T008-T015) → US5(T016-T018) → US6(T019) → Contract(T020) → US7/8(T021-T024) → Polish(T025-T026)
```

- **US1 是 MVP 基座**（无持久化则 US2/US5 无行可操作）→ 先行。
- **T004（service skeleton + export）阻塞** T005/T008/T010/T016（同文件方法）。
- **US2 内**：T008（findActive）+ T009（inspect-by-id）可并行 [P]；T010（rotate）依赖 T008；T011（usecase）依赖 T008/T009/T010；T012（controller）依赖 T011。
- **US5** 依赖 Foundational（T004）+ T001（guard）；与 US2 共改 `account-token.controller.ts`（顺序合并，非并行）。
- **Contract（T020）** 依赖 server 端点全落（T012 + T017）。
- **Client（US7/8）** 依赖 T020（typed api-client）。
- **T015（并发 IT）** 依赖 T010+T012 全落。

## Parallel Opportunities

- Foundational：T002（hasher）∥ T003（rules）。
- US2：T008（findActive）∥ T009（inspect-by-id）。
- Client：T021（device id 注入）∥ T023（logout wrapper）（不同文件）。

## Implementation Strategy

1. **MVP = US1**（签发持久化）：先让登录落库，建立可轮换/可撤销的基座。
2. **增量**：US2（轮换，含反枚举 US3 + 并发 US4 IT）→ US5（登出）→ US6（限流验证）。
3. **同步链 + client**：server 端点稳定后跑 Contract（T020）→ client 透明续期 + wrapper（US7/8）。
4. **收尾**：catalog + frontmatter + 全门 verify（T025-T026）。
5. 每 task 30min-2h，独立 commit + `[X]` flip（Constitution III + 6 步闭环）。
