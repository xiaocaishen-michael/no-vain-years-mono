# 子 plan 4 — client UI 链（settings shell + A→B→C）【占位 · 待后续 session 建真 plan】

> 隶属 [account-migration master](05-25-account-migration-master.md)。**p4 = 本 master（顶层 Plan 2 业务迁移）的第 4 个子 plan，≠ 顶层「Plan 4」**（后者指 mobile IPA/APK build + PKM/wealth 等非 account 模块，见 master § Out of Scope）。
>
> **本文为占位骨架** —— 记录"为什么需要 p4" + 建真 plan 所需的全部 context；真正的 plan（user story 拆分 / 接入顺序 / mockup 策略 / 排期）由**后续独立 session** 据本文 + master §「子 plan 4」段填充。

## 0. 占位说明（给后续 session 的起手指引）

读完本文 + master §「子 plan 4」段后，按 SDD 规划这条 client UI 链：

1. 先定 **spec B（settings shell）的 scope 边界 + user story 拆分**（§ 4 开放点）。
2. 再排期把 003 / 004 / 005 三个**已 server-ready** 的延后 client 入口聚合接入（§ 3）。
3. 起手任一 feature `/speckit-specify` **前走 master 跨契约 § 硬 gate**（user 给 server spec ↔ app spec 合并约束，否则不开 specify）。
4. 前端范式沿用 p3 § Step 4：Strangler-Fig port（复用 `~/theme` + `~/ui`，Orval 函数式 hook）+ RHF Golden Sample + 占位 UI 4 边界（per [sdd.md](../../conventions/sdd.md) UI 类别）。

## 1. 为什么需要 p4（规划盲点）

p1/p2/p3 是**后端 16 use case 迁移**的三层关注点（工具链 / 分析 / 执行）。但前端有一条**正交的 client UI 链**从未被统领规划：

- 后端迁移 dependency（p2 § 4.4）= mbw-account 16 个 business use case 的拓扑，**不含前端导航容器**。
- 前端 client UI 体系只在 `002-account-profile` spec **内部**定义了 A→B→C 拆分链，**无独立规划文档、无排期**。
- 结果：003 / 004 / 005 三个 feature 各自把 client 入口"延后到 settings shell"，settings shell（spec B）成了**隐式累积的前端债** —— 无 owner、无排期、对任何 plan 不可见。

**p4 = 补这条 client UI 链的规划维度**（与后端 16 use case 迁移正交，可与批 E `006` server 迁移并行，无共享可变状态）。

## 2. client UI 拆分链 A→B→C（源：`002-account-profile` spec 内部）

| spec | 名字 | 内容 | 状态 |
|---|---|---|---|
| **A** | `002-account-profile` | "我的"页（profile）+ tabs 骨架 + ⚙️ 入口（仅 `router.push('/(app)/settings')` 占位） | ✅ ship（#65） |
| **B** | **account-settings-shell** | 从 ⚙️ 进入的「设置 / 账号与安全」导航栈（落 `apps/mobile/app/(app)/settings/*`，在 `(tabs)/` **之外**、Expo Router 自动隐藏底 tab bar，per 002 CL-006） | ⬜ **未建（p4 核心交付）** |
| **C** | delete-account / cancel-deletion UI | 注销 / 撤销屏（入口「账号与安全 → 注销账号」**经 B 中转**） | 🟡 部分（cancel-deletion 屏 + FROZEN 登录拦截 modal 已随 004 ship；**注销发起屏延后到 B**） |

**入口拓扑**（002 spec）：A→B 入口 = 「我的 → ⚙️ → 设置」；A→C 入口经 B 中转。当前 `profile.tsx` 的 ⚙️ 按钮已 `router.push('/(app)/settings')`（强转占位，目标 route 未建，Expo Router 容错不 crash）。

## 3. settings shell 要聚合的延后挂载项（都已 server-ready，就等这个壳）

| 来源 feature | 延后的 client 入口 | server 状态 | spec 标记 |
|---|---|---|---|
| `003-tokens` | 登出按钮（logout-all） | ✅ #196（`logout-all` wrapper 逻辑已 ship，无可见 UI） | "登出控件随 settings shell" |
| `004-account-deletion` | 注销账号发起屏（FR-C01 / FR-C02 + US10） | ✅ #198（5 端点全 ship） | spec 标 `[DEFERRED → settings shell]` |
| `005-device-management` | 登录设备管理屏（设备列表 + 单设备撤销 + DeviceIcon） | ✅ #201（2 端点，server-only） | clarify 2026-05-26 定延后 |
| （未来）`006-realname` | 实名认证入口 | ⬜ 待迁（批 E，server 先行） | — |

**UI 参考源**：旧 meta 仓 `~/Documents/projects/no-vain-years/` 旧 app 的设置类屏（005 spec 提"port 旧 app `login-management/`"）；视觉资产复用约定见 memory `design_tokens_reuse_not_redesign`（不重设计 token）。

## 4. 建真 plan 时要决的开放点（TODO，后续 session）

- **spec B scope 边界**：settings shell 一次建全（壳 + 003/004/005 入口同 spec）vs 分批（壳先行 + 入口逐个独立 feature 接）。
- **user story 拆分 + 优先级**：哪个入口 P1（设备管理 / 注销发起 / 登出）；账号与安全详情页本身的信息架构。
- **UI 类别**（per sdd.md）：settings 列表大概率「类 1 标准 UI」（spec → plan 占位 → impl → mockup 回填）；若账号与安全是重设计页则走类 2。
- **spec 编号**：spec B 走 SDD 自动 `NNN-account-settings-shell`（下一个 sequential）；spec C 的注销发起屏接 004 已 ship 端点（`me/deletion-codes` / `me/deletion`）。
- **与后端并行性**：p4 可与批 E（`006` server）并行（前端正交，无共享可变状态）。

## 5. Critical files + 参考

```text
docs/plans/2026-05/05-25-account-migration-master.md            # § 子 plan 4（本文上游，必读）
specs/002-account-profile/spec.md                               # A→B→C 链定义 + 入口拓扑 + settings stack 路由决议(CL-006)
specs/004-account-deletion/spec.md                              # FR-C01/C02 + US10 [DEFERRED → settings shell] + 注销发起屏前瞻文档
specs/005-device-management/spec.md                             # 登录管理屏延后(§ Out of Scope) + port 旧 app login-management
specs/003-tokens/spec.md                                        # 登出控件随 settings shell
apps/mobile/app/(app)/(tabs)/profile.tsx                        # ⚙️ 按钮现 router.push('/(app)/settings') 强转占位(route 未建)
~/Documents/projects/no-vain-years/                             # 旧 app 设置/login-management 屏 UI 参考源
```

## 6. Verification（本占位文件自身）

- ☐ § 1 说清"为什么 p4"（前端 client UI 链规划盲点 + 三 feature 延后债）
- ☐ § 2 A→B→C 链 + 状态 + 入口拓扑齐全，源指向 002 spec
- ☐ § 3 三延后挂载项 + server 状态 + spec 标记，可直接喂真 plan
- ☐ § 4 开放点覆盖 scope / user story / UI 类别 / 并行性
- ☐ 真 plan 由后续独立 session 据本文 + master 段经 `/plan` 或 `/speckit-specify` 填充后，本文降级为历史留痕 / 删除
