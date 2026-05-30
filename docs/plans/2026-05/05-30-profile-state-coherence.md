# 修复计划：profile 状态单真相源重构（displayName 回跳 + 跨账号泄漏）

> 分支：`fix/profile-state-coherence`（新开，与 `fix/settings-header-back-fallback` 无关）
> 类型：`fix`（移动端状态架构修复，不改后端 / 不改 API 契约）
> 日期：2026-05-30

## Context（为什么做这个改动）

手测中发现两个用户可见 bug，服务端访问日志逐秒坐实，根因同一处系统设计错误：

1. **回跳**：新号 onboarding 设名 → 进 profile → 点「账号安全」→ 弹回 onboarding（设名后 30s 内）。
2. **跨账号泄漏**：登出旧号后 30s 内登录新号 → 新号跳过 onboarding、显示**上个账号**的昵称 / 性别 / 简介 / 设备列表。

**底层错误**：`displayName`（及 `phone`）同时活在 **zustand store 快照** 和 **React Query `/me` 缓存** 两处真相源，`use-me.ts` 用一个 `useEffect` 把 `/me` 缓存强行回写 store——但这个缓存 (A) onboarding 改名时不更新、(D) query key 全局静态不含 accountId、(E) 登出从不清。三者叠加产出上述两 bug。这正是 TanStack Query 维护者 TkDodo 点名的 **"deriving/syncing server state into a client store" 反模式**（[Deriving Client State from Server State](https://tkdodo.eu/blog/deriving-client-state-from-server-state)）。

**目标终态**：`/me` React Query 缓存 = 服务端态的**唯一运行时真相源**；zustand store 只保留**客户端态**（tokens / isAuthenticated）+ 一份**仅用于冷启动播种**的持久化快照。彻底消除双真相源这一类 bug。

## 5 个缺陷 → 业内标准解法对应

| # | 缺陷 | 解法（业内标准） |
|---|------|-----------------|
| A | onboarding 改名后不更新 `/me` 缓存 | mutation onSuccess 走 **write-through `setQueryData`**（缓存即真相源） |
| B | `use-me` useEffect 无条件把缓存回写 store | **移除运行时 server→store 同步**；改为 read-from-`useMe`（derive, don't sync） |
| C | `setSession` 不重置 displayName/phone | login 时重置（防账号直切） |
| D | `/me`（及设备列表）query key 静态、不含 accountId | **per-account key**：`[...meKey, accountId]`（Query Key Factory，把身份放进 key） |
| E | 登出/注销/刷新失败只清 store、不清缓存 | logout/delete/refresh-fail 调 **`queryClient.clear()`**（绑定缓存生命周期到 auth） |

US12 防闪屏：store 降为冷启动 seed，经 React Query **`initialData`** 喂给 `/me` query —— 返回用户冷启动 profile.data 立即就绪、直接进 profile，不退化成 splash。

## 关键约束（已 Explore 验证）

- **Orval hook 支持 call-site 传 `query.queryKey`**，无需重新 gen 即可加 accountId 维度（`useAccountProfileControllerGetProfile({ query: { queryKey, ... } })`）。
- **冷启动确实依赖持久化 displayName**（`store.ts` partialize + `_layout.tsx` US12 注释），故 store 的 displayName/phone/accountId **保留在 partialize 里作 seed**，但不再作运行时读取源。
- **`select: r => r.data` 与 initialData 的 shape 交互**：initialData 是 queryFn 返回前（pre-select）的 shape。实现时二选一：① 合成最小 response 包裹 `{ data: seed }` + `initialDataUpdatedAt: 0`（立即后台 revalidate 补全 gender/bio）；② 去掉 `select`、useMe 返回 raw 并在消费点取 `.data`。**推荐 ①**（改动面小）。

## 实施步骤（step → verify）

> 每步遵循 mobile-impl-playbook + TDD；测试分层 per memory（vitest=逻辑，Playwright Expo Web=UI/路由）。

1. **per-account /me key（缺陷 D）** → 在 `apps/mobile/src/core/api/use-me.ts` 导出 `meQueryKey(accountId)` = `[...getAccountProfileControllerGetProfileQueryKey(), accountId]`；`useMe` 用之。
   `verify`: 单测 meQueryKey 含 accountId；两账号 key 不同。

2. **initialData seed（US12）** → `useMe` 增 `initialData`（从持久化 store seed 合成）+ `initialDataUpdatedAt: 0`，仅当持久化 accountId+displayName 存在（返回用户）时提供。
   `verify`: 冷启动返回用户 `profile.data.displayName` 同步就绪、不经 splash（Playwright 冷启动 e2e）。

3. **AuthGate 读 /me 为真相源（缺陷 B 之一）** → `apps/mobile/app/_layout.tsx` 把 `decideAuthRoute` 的 displayName 入参改为 `profile.data?.displayName`（不再读 `store.displayName`）；`apps/mobile/src/core/auth-gate-decision.ts` **删除/简化 `resolveDisplayName`**（不再 merge store）。保留 `wait` 态给真·新用户（无 seed、data undefined、未 fetched）。
   `verify`: `auth-gate-decision.spec.ts` 更新；新用户 → wait→onboarding，老用户 → profile，路由真值表全绿。

4. **移除运行时 store-clobber（缺陷 B 主体）** → `use-me.ts` 删除"把 query.data 回写 store"的运行时 useEffect；改为**仅维护冷启动 seed**（从 profile.data 写 displayName/phone/accountId 到 store，唯一消费者是下次 boot 的 initialData）。因运行时已无人读 store.displayName，clobber 彻底无害。
   `verify`: onboarding→profile→账号安全 **停在 profile 不回跳**（Playwright，复现原 bug 1）。

5. **写路径 write-through（缺陷 A）** → `apps/mobile/src/auth/update-display-name.ts` onSuccess 改为 `queryClient.setQueryData(meQueryKey(accountId), 写入新 displayName)`（取代裸 `setDisplayName`）；`apps/mobile/src/settings/{use-name-edit-form,use-bio-edit-form,use-gender-edit}.ts` 的 invalidate/setQueryData 统一用 **scoped key**（带 accountId）。consolidate：去掉各 caller 重复的 invalidate，集中到 wrapper。
   `verify`: onboarding 设名后 `/me` 缓存即含新名；3 个 edit form spec mock 更新为 scoped key 后绿。

6. **登出清缓存（缺陷 E）** → `apps/mobile/src/auth/logout-all.ts`、`src/auth/delete-account.ts`、`src/auth/token-refresh.ts`（clearSession 两处）在清 store 的同时 `import { queryClient } from '~/core/api/query-client'` 并调 `queryClient.clear()`。
   `verify`: 登出 A→登录 B，B **看不到 A 的任何缓存**（profile + 设备列表）；复现原 bug 2 转绿（Playwright 跨账号 e2e）。

7. **setSession 重置（缺陷 C）** → `apps/mobile/src/auth/store.ts` `setSession` 增 `displayName: null, phone: null`（displayName/phone/accountId 仍留 partialize 作 seed）。
   `verify`: `store.spec.ts` 加断言 setSession 清 displayName/phone。

8. **消费点切到 useMe（缺陷 B 收尾）** → `apps/mobile/app/(app)/(tabs)/profile.tsx`（昵称）、`apps/mobile/app/(app)/settings/account-security/index.tsx`（昵称 + phone）从 `useAuthStore(s=>s.displayName/phone)` 改读 `useMe().data`。
   `verify`: profile / 账号安全卡片显示当前账号真值（e2e 已覆盖）。

## 复用既有设施（不新造）

- `getAccountProfileControllerGetProfileQueryKey()`（`@nvy/api-client`）—— 作为 scoped key 的基底。
- 单例 `queryClient`（`apps/mobile/src/core/api/query-client.ts`）—— 非 hook 的 logout/refresh 直接 import 调用。
- 既有 stateful `/me` mock 模式（`apps/mobile/e2e/profile*.spec.ts`）—— 扩展为「按 method 区分 + 多账号」即可，不重写。
- 无新 runtime 依赖。（更纯的 RQ official persister 方案留作后续可选，不在本 PR。）

## 受影响测试

- **更新**：`auth-gate-decision.spec.ts`（删 resolveDisplayName store-wins 断言）、`update-display-name.spec.ts`（onSuccess 改 setQueryData）、`use-{name,bio}-edit-form.spec.ts` + `use-gender-edit.spec.ts`（scoped key mock）、`store.spec.ts`（setSession 重置）。
- **新增**：跨账号 no-bleed e2e（登出 A→登录 B）、post-onboarding 进设置不回跳 e2e、logout clears cache 单测。
- 现有 `onboarding.spec.ts` / `login.spec.ts` 主体不变（mock 单 `/me` 端点仍成立）。

## End-to-End 验证

1. 本地起栈（`ops/runbook/local-dev.md`：docker compose dev + `nx serve server` + `nx run mobile:serve --args="--web"`，背景跑加 `CI=1`）。
2. **手测复现两 bug 转绿**：
   - 新号注册→设名→进 profile→点账号安全 → **停在 profile**。
   - 登出→换新号登录 → **走 onboarding、不显示上个号资料**。
3. `pnpm nx test mobile --skip-nx-cache`（vitest 逻辑层）。
4. `pnpm nx run mobile:e2e`（Playwright；含新增跨账号 + 设置导航用例）。
5. `pnpm nx affected -t typecheck,lint`。

## 风险 / 注意

- AuthGate 是安全关键路由，改动后**路由真值表 4 态 + wait 态**必须单测全覆盖，e2e 冷启动/新用户/老用户/跨账号四路径都跑。
- initialData 的 pre-select shape 坑（见上）—— 实现首步先验证 `useMe().data` 在冷启动同步就绪，再往下。
- `queryClient.clear()` 会清掉**所有** query（含设备列表等）——这正是 E 想要的；确认无"登出后仍需保留的全局查询"，若有则改 `removeQueries` 白名单。
