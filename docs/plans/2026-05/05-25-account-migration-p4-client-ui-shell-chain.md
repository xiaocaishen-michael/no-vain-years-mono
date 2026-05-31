# 子 plan 4 — client UI 链（settings shell + A→B→C）

> 隶属 [account-migration master](05-25-account-migration-master.md) §「子 plan 4」。**p4 = 本 master（顶层 Plan 2 业务迁移）的第 4 个子 plan，≠ 顶层「Plan 4」**（后者指 mobile IPA/APK build + PKM/wealth 等非 account 模块，见 master § Out of Scope）。
>
> 本文 2026-05-29 经独立 `/plan` 会话从占位骨架升级为真 plan（决策 + 三 feature 拆分 + 执行步骤）。与后端 use case 迁移正交。
>
> **状态（2026-05-29 收口）**：✅ **三 feature 全 ship** —— B1 `006-account-settings-shell` #221 / B2 设备管理 amend 005 #222 / B3 注销发起 amend 004 #223。**A→B→C 链闭合，p4 graduation 达成**（002 ⚙️ → settings → 账号与安全 → 登录管理 + 注销账号 全通）。下方决策表 / 执行步骤留作迁移留痕。

## Context

前端有一条**正交后端 16 use case 迁移**的 client UI 拆分链 A→B→C，定义在 `002-account-profile` spec 内部，但从未被统领规划，成隐式累积前端债：

- **A**（`002-account-profile`）✅ ship（#65）：profile 页 + tabs 骨架。⚙️ 按钮已 `router.push('/(app)/settings')` —— **目标 route 不存在**，靠 Expo Router 容错不 crash（`profile.tsx:296-299` 有 `as Parameters<...>` cast 注释说明）。
- **B**（settings shell）= 从 ⚙️ 进入的「设置 / 账号与安全」导航栈，落 `apps/mobile/app/(app)/settings/*`，在 `(tabs)/` **之外**（002 CL-006：Expo Router 自动隐藏底 tab bar，返回 profile 恢复）。**未建 —— p4 核心交付**。
- **C** = 注销/解封 UI。**部分已 ship**：cancel-deletion 屏 + FROZEN 登录拦截 modal 随 004 ship（`app/(auth)/cancel-deletion.tsx`）；**注销发起屏延后到 B**。

三个 feature 的 client 入口都已 **server-ready** 但延后挂这个壳：003 登出按钮（#196）、004 注销发起屏（#198，5 端点）、005 登录设备管理屏（#201，2 端点）。p4 补这条链的规划并执行。

**已 verify 的 ground truth**（防 subagent 幻觉，2026-05-29 grep 实证）：

| 资产 | 状态 |
|---|---|
| `apps/mobile/src/auth/logout-all.ts` | ✅ 存在（清 session + 路由 login 的 wrapper 已 ship，B1 按钮直接调） |
| `apps/mobile/src/auth/cancel-deletion.ts` | ✅ 存在（B3 新建 deleteAccount wrapper 的 mirror 范本） |
| Orval `useAccountDeletionControllerSendDeletionCodeForMe` / `SubmitDeletionForMe` | ✅ 存在于 `@nvy/api-client`（B3 用） |
| Orval `useDeviceManagementControllerList` / `Revoke` | ✅ 存在（B2 用） |
| `deleteAccount` / `requestDeleteAccountSmsCode` / `mapDeletionError` wrapper | ⬜ 不存在，B3 须新建 |
| `Card` / `Row` / `Divider` primitives | ⬜ mono 无，B1 须 port（旧 app `components/settings/primitives.tsx`） |
| `maskPhone`（`src/format/phone.ts`）/ `formatLastActive`（`src/format/datetime.ts`） | ⬜ mono 无 `src/format/`，须 port（纯 logic → vitest） |
| specs/ 现状 | 001-005；下一 sequential = **006** |

## 决策（user 确认，2026-05-29）

| # | 决策点 | 选定 |
|---|---|---|
| 1 | scope 切分 | **分 3 feature**（B1 壳骨架 / B2 设备 amend 005 / B3 注销 amend 004）；非 mega-spec |
| 2 | B2/B3 优先级 | **设备管理(B2)先**（风险低、port 高保真），注销发起(B3)后 |
| 3 | spec 编号 | **壳取 006**（`006-account-settings-shell`） |
| 4 | 范围外项 | **全做 disabled 占位**（手机号行展示 maskPhone 但 disabled / 实名·第三方·通用·通知灰置 / 省略法务页脚，避免 dangling route） |

## 三 feature 拆分 + 依赖

```text
B1  006-account-settings-shell  ─┬─►  B2  device-mgmt client (amend 005)   [设备先]
(壳骨架 + primitives + maskPhone   │
 + 登出按钮；解锁 002 ⚙️)          └─►  B3  delete-init client (amend 004)   [注销后]
```

- **B1 是 B2/B3 硬前置**：建 settings 路由 + primitives + account-security index（含 login-management / delete-account 两行 **disabled 占位**）。ship 后 `/(app)/settings` 成真 route，002 ⚙️ 不再依赖 Expo Router 容错。
- **B2/B3 互不依赖**，都只依赖 B1；按决策 2 设备先。各自 PR 内把 account-security index 对应行 disabled→真 push（一行 flip = 集成点）。
- 每 feature 起手 `/speckit-specify` **前走 master 跨契约 §3 硬 gate**（user 给 server spec ↔ app spec 合并约束，否则不开 specify）。B2/B3 amend 已 ship server 契约的 004/005 spec，gate 有具体锚点。

## UI 类别（per sdd.md）

五屏全 **类 1 标准 UI**（settings 列表 / 表单，sdd.md L44 明列；注销表单虽敏感但结构是单屏 form = 类 1，敏感性靠 SDD clarify gate + 错误映射处理，非 mockup-first）。走类 1 流程：spec → plan（UI 段标占位）→ tasks → impl 占位 → 真后端冒烟 → mockup → 回填。**注**：旧 app `delete-account.tsx` / `login-management/index.tsx` 已是 PHASE-2 mockup 成品，B2/B3 可直接 port 视觉（per memory `design_tokens_reuse_not_redesign`，不重设计 token），有效跳过占位阶段。

## 路由结构（最终态，三 feature 累积）

```text
apps/mobile/app/(app)/settings/
  _layout.tsx                              # Stack；index 显 header，子 headerShown:false   [B1]
  index.tsx                                # 设置 — 4 cards + 登出（无法务页脚）            [B1]
  account-security/
    _layout.tsx                            # Stack — 账号与安全                              [B1]
    index.tsx                              # rows: 手机号(disabled) / 登录管理 / 注销账号    [B1]
    delete-account.tsx                     # 注销发起屏（RHF，2 勾选 + SMS + 确认）          [B3]
    login-management/
      _layout.tsx                          # Stack — 登录管理                                [B2]
      index.tsx                            # 设备列表 + 单行撤销                              [B2]
      [recordId].tsx                       # 设备详情 + 撤销（param 名对齐 server recordId）  [B2]
      DeviceIcon.tsx                       # deviceType → svg glyph                          [B2]
```

`settings/index.tsx` 信息架构（port 旧 app，去法务页脚）：① `账号与安全`→push（真）② `通用/通知/隐私/关于` disabled ③ `切换账号` disabled + `退出登录` destructive→`confirmLogout`（Web `window.confirm` / native `Alert.alert` 分支，**load-bearing 必 port**）→`logout-all()`→`router.replace('/(auth)/login')`。

`account-security/index.tsx`：① `手机号`(value=`maskPhone(phone)`, **disabled**) / `实名认证`·`第三方绑定` disabled ② `登录管理`（B1 disabled 占位 → B2 ship 后真 push）③ `注销账号` destructive（B1 disabled → B3 ship 后真 push）/ `安全小知识` disabled。

## 复用资产（禁重造）

- **theme/ui**：`~/theme`（tokens）+ `~/ui`（`Button`/`Spinner`/`SafeAreaView`/`ErrorRow`/`PhoneInput`/`SmsInput` 等，`apps/mobile/src/ui/index.ts`）。
- **RHF Golden Sample**：`apps/mobile/src/auth/use-login-form.ts` + `use-cancel-deletion-form.ts`（Controller 非 register / form-态 vs 副作用-态分层 / `isSubmitting` 单源）—— B3 表单照此重写，**非 verbatim port**（旧 `delete-account.tsx` 用裸 useState，须改 RHF hook `use-delete-account-form.ts`，wrapper 镜像 `cancel-deletion.ts`：复用皮、重写肉）。
- **Orval 消费**：wrapper hook 放 `~/auth/`（如 `usePhoneSmsAuth`/`useMe`/`useCancelDeletion` 模式），mutation onSuccess 不导航，caller 状态机驱动。
- **primitives**：port 到 **`apps/mobile/src/settings/primitives.tsx`**（app-local，**不进 `~/ui`**）—— 占位-UI 4 边界（sdd.md L54）禁占位阶段引 `~/ui` 抽象；NativeWind 升级 path 要求"第二个 settings 外模块复用"才升 `~/ui`。设备行（图标/badge/两行）走 B2 bespoke，不强塞通用 Row。
- **port import remap**（每个 port 文件必做）：旧 `@nvy/auth`→`~/auth`、`@nvy/design-tokens`(`colors`)→`~/theme`(`tokens.colors.*`) 或 NativeWind class（per ADR-0030）。`[recordId].tsx` param 名对齐 server `recordId`（旧 app 是 `[id]`，防 stale-ref drift）。

**旧 app port 源**（`~/Documents/projects/no-vain-years/no-vain-years-app/apps/native/app/(app)/settings/`）：`index.tsx` / `account-security/index.tsx` / `components/settings/primitives.tsx` / `account-security/login-management/{index,[id],DeviceIcon}.tsx` / `account-security/delete-account.tsx`。

## Critical files

```text
specs/002-account-profile/spec.md                                        # A→B→C 链 + CL-006
specs/004-account-deletion/spec.md                                       # B3 amend：FR-C01/C02 + US10
specs/005-device-management/spec.md                                      # B2 amend：登录管理屏延后段
specs/003-tokens/spec.md                                                 # 登出控件随 settings shell
apps/mobile/app/(app)/(tabs)/profile.tsx                                 # 002 ⚙️ 入口（B1 解锁）
apps/mobile/src/auth/{logout-all,cancel-deletion}.ts                     # B1 调 / B3 mirror
apps/mobile/src/ui/index.ts                                              # 复用源（primitives 不进这）
~/Documents/projects/no-vain-years/                                      # 旧 app 设置/login-management port 源
```

## 执行步骤（step → verify）

> 每 feature 走 master 跨契约：per-feature SDD 6 步 + server+mobile 同 1 PR（本 3 feature 纯 mobile，无 server 改）+ /implement 每 task 闭环 6 步 + tasks.md `[X]` flip。模型路由：Stage 1 Opus / Stage 2 implement 切 Sonnet。

1. **B1 `/speckit-specify`（前过硬 gate）** → verify：user 给 settings shell server↔app 约束（本壳无 server 改，约束=确认 IA + 登出复用 #196 wrapper + disabled 占位边界）→ spec.md frontmatter `modules:[auth]` + status。
2. **B1 plan→tasks→analyze→implement** → verify：port `src/settings/primitives.tsx` + `src/format/phone.ts`(`maskPhone`，vitest 绿) + settings/account-security 两 index + `_layout` + 登出按钮；`pnpm nx affected --target=test,lint,typecheck` 绿；Playwright `e2e/settings-shell.spec.ts`（profile→⚙️→settings 底 tab 隐 → 账号与安全 → maskPhone 显 → 登出→confirm→mock logout-all→redirect login）绿。
3. **B2 设备（amend 005）/speckit-specify→…→implement** → verify：port `login-management/{index,[recordId],DeviceIcon}` + `formatLastActive`(vitest，含 legacy `deviceName=null`→"未知设备"/`UNKNOWN`→fallback 图标)；wrapper 包 `useDeviceManagementControllerList/Revoke`；account-security index 登录管理行 disabled→真 push；Playwright（mock `GET /auth/devices` 混 current/legacy 行 → 本机 badge + 图标 → 撤销 → mock `DELETE /auth/devices/{recordId}` → 行移除；409 current→error row）绿。
4. **B3 注销（amend 004）/speckit-specify→…→implement** → verify：新建 `deleteAccount`/`requestDeleteAccountSmsCode` wrapper（包 Orval 两 hook）+ `mapDeletionError`(vitest，覆 429/400 invalid-code/network/unknown) + `use-delete-account-form.ts`(RHF) + `delete-account.tsx`(2 勾选→解锁发码→6 位码→确认→清 session→login)；FR-C02 统一错误展示；account-security 注销行 disabled→真 push；Playwright（双勾选→发码 enabled→mock deletion-codes→输码→确认→mock deletion→session 清→redirect login + 统一错误路径）绿。
5. **p4 graduation** ✅ **达成**(2026-05-29)：三 feature 全 ship(#221/#222/#223)；002 ⚙️→settings 全链跑通；`nx affected` lint/typecheck/test/build/runtime-smoke 全绿(26 e2e passed,B3 #223)。

## Verification（端到端）

测试分层 per memory `mono_mobile_test_layering`：**vitest=logic（`maskPhone`/`formatLastActive`/`mapDeletionError`/RHF hook 态机），Playwright Expo Web=UI/render/导航**（mock API 走 `apps/mobile/e2e/_support/api-mock.ts` 的 `mockJson`，仿 `cancel-deletion.spec.ts`/`profile.spec.ts`）。冒烟截图归 `runtime-debug/2026-05-XX-settings-shell/`（per 002 SC-012）。**关键 E2E** = B1 shell smoke（见 step 2）—— 这是 A→B 链打通的单一最高价值断言。

## Risk + Rollback

| 风险 | 缓解 |
|---|---|
| B3 RHF 重写偏离 Golden Sample | 严格 mirror `use-cancel-deletion-form.ts`；form-态 vs 副作用-态分层 + `isSubmitting` 单源铁律 |
| port import remap 漏改（运行时 className 解析不报 typecheck） | per memory `repo_wide_scan_on_rename`：port 后全仓 grep `@nvy/auth`/`@nvy/design-tokens` 残留 |
| 设备 `[recordId]` param 名 drift（旧 app `[id]`） | specify 前 `/speckit-baseline-audit 005` 对齐 server recordId 命名 |
| disabled 占位行后续激活遗漏 | B2/B3 PR 内 flip 对应行作显式 task + tasks.md `[X]` |
| Metro web 不解析 `.js` 扩展 import（假绿） | per memory `metro_web_cannot_resolve_js_extension_imports`：mobile 侧 extensionless，ESLint 已机械拦 |
```
