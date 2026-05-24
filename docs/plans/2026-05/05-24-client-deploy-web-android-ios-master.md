# Master Plan: 客户端部署 — Cloudflare Web + Android + iOS 打包

> **统领 4 个独立子 plan**：Cloudflare Pages Web 部署 → Mobile binary 共享地基 → Android 签名 APK → iOS（simulator → TestFlight）。本文件**不下钻子 plan 内部实现**，只锁构建链路决策、跨子 plan 契约、agent/user 操作边界、依赖顺序、终局验收。每个子 plan 各自独立 `/plan` 会话 + 独立 PR + 独立 ExitPlanMode 批准。

> ⚠️ **2026-05-24 子 plan 1 host pivot**：Web 部署形态从 CF Pages 改为 **Cloudflare Workers Static Assets**（per [ADR-0025](../../adr/0025-frontend-cloudflare-pages-expo-web.md) 2026-05-24 amendment；动因：CF 合并 Workers/Pages + 2026-02 官方推「新站从 Workers 起步」）。下文凡「CF Pages / `_redirects` / `*.pages.dev`」按 Workers Static Assets 读：repo root `wrangler.jsonc` + `not_found_handling: single-page-application`（`_redirects` 已移除）+ dashboard Workers Builds（`npx wrangler deploy`）。其余（build target / 直 CORS 避 525 / 自定义域 `app.xiaocaishen.me`）不变。

## Context

**为什么现在做**：服务端 prod cutover 已于 2026-05-24 完成（mono server 上线 `https://api.xiaocaishen.me`，Aliyun SWAS，已备案，per #144/#145/#147）。后端就绪后，Plan 3 客户端部署形态进入执行：(1) Web 入口（ADR-0025 已拍板 CF Pages，playbook 已就绪但**未 bootstrap**）；(2) 原属 "Plan 4 deferred" 的 mobile binary 打包（Android + iOS）现一并启动。

**当前缺口**（已 grep 实证）：

| 维度 | 现状 | 缺口 |
|---|---|---|
| Web | `build:web` 已产出 `apps/mobile/dist/`；ADR-0025 Accepted；playbook 就绪 | `_redirects`（子 plan 1 已补）、server CORS allowlist 未含 CF 域、CF console 未创建、自定义域未绑 |
| Mobile 地基 | `app.json` 已锁 bundle id `com.xiaocaishen.novainyears`（iOS+Android）；EAS cloud 构建链路已拍板 | `apps/mobile/assets/`（4 个图标全缺，app.json 引用但文件不存在）、`eas.json` 缺、`eas-cli` 未装、`app.json` version `0.0.0` 与 `.release-please-manifest.json` 的 `0.0.1` **drift** |
| Android | — | 全新：EAS preview profile + keystore + APK 构建 + 分发 |
| iOS | — | 全新：simulator profile（阶段1）+ TestFlight（阶段2 gated on Apple 账号）|

**为什么是 4 个子 plan 而非 3 个**：Android 与 iOS 共享一块地基（`assets/` 图标、`eas.json` 全 profile、`eas init` project、version 对齐）。把它抽成前置 **Phase 0 子 plan**，避免 Android/iOS 两个子 plan 重复劳动 + 并行编辑 `eas.json` 冲突。3 个 deliverable（web / android / ios）对应子 plan 1/3/4，子 plan 2 是支撑 3+4 的共享地基。

**代码基线（2026-05-24 复核）**：本地 main 一度落后 origin/main 19 commit（server「扁平贫血范式」R-1~R-5 重构 #159~#166，已合入 origin/main）。该重构**完全没碰 `apps/mobile` / `packages`**（client 分析全部仍有效），仅拍平 server 模块目录 + 改 ADR/conventions 文档。子 plan 1 的 CORS 锚点（`main.ts:39` / `config/parse-origins.ts` / `config/app.config.ts` / `.env.production.example:24`）全部原位不变。**编号修正**：`ADR-0043` 已被 `0043-server-flat-module-paradigm.md` 占用 → mobile binary ADR 改用 **ADR-0044**。

## 子 plan 拆分

| # | 子 plan 文件 | 轨 | 依赖 | 核心交付 | 状态 |
|---|---|---|---|---|---|
| 1 | [`…-p1-cloudflare-web.md`](05-24-client-deploy-p1-cloudflare-web.md) | A（Web，独立） | 无 | `_redirects` + server CORS + CF console bootstrap + 自定义域 + smoke test | 🚧 执行中 |
| 2 | `…-p2-mobile-foundation.md` | B（Mobile 地基） | 无 | `assets/` 图标 + `eas.json` 全 profile + `eas init` + version 对齐 + ADR-0044 | ☐ 待起 |
| 3 | `…-p3-android-apk.md` | B | **子 plan 2** | EAS preview profile → 签名 APK → 直接分发 + smoke test | ☐ 待起 |
| 4 | `…-p4-ios-simulator-testflight.md` | B | **子 plan 2** | 阶段1 simulator build（now）→ 阶段2 TestFlight（账号就绪后） | ☐ 待起 |

## 跨子 plan 契约（master 锁定，子 plan 不得违反）

1. **构建链路唯一**：Android/iOS 二进制走 **EAS Build 云构建**（用户拍板 Option 1）。**国内网络上传过慢时，第一选择是挂可靠稳定的国内代理保住云构建链路**（per memory `feedback_china_network_prefer_domestic_proxy`，用户明示）；`eas build --local` 仅作本机调试 / 代理仍不通时的次选灾备；纯 `expo prebuild` 链路**永久流放**（用户明示）。

2. **API base URL 统一**：所有 client（web + android + ios）运行时指向 prod `https://api.xiaocaishen.me`，复用 `EXPO_PUBLIC_API_BASE_URL`。
   - Web：CF Pages 项目 env var（build 时注入）
   - Binary：`eas.json` 各 profile 的 `env.EXPO_PUBLIC_API_BASE_URL`（build 时 inline，Expo public env 语义）

3. **CORS 仅约束 Web**：浏览器才走 CORS preflight；Android/iOS native HTTP client **不受 CORS 限制**。因此 server `CORS_ALLOWED_ORIGINS` 改动**只在子 plan 1**，mobile 子 plan（3/4）**不碰** server CORS。

4. **版本 / release**：per [ADR-0042](../../adr/0042-monorepo-release-strategy.md)，mobile 走 `release-type: expo` + component tag `mobile-vX.Y.Z`，release-please 管 `app.json` version。子 plan 2 必须把 `app.json` `0.0.0 → 0.0.1` 对齐 `.release-please-manifest.json`（已是 `0.0.1`）。

5. **视觉资产来源优先级**：(1) **优先复用 meta app 仓已有资产** `/Users/butterfly/Documents/projects/no-vain-years/no-vain-years-app/apps/native/assets/`（已确认含全部 4 个：`icon.png` / `splash-icon.png` / `adaptive-icon.png` / `favicon.png`）；(2) meta 仓缺的资产 → **可用 claude-design 设计**。design **token**（色彩/间距视觉系统）仍直搬不重写（per memory `feedback_design_tokens_reuse_not_redesign`，该约束仅针对已稳定的 token 系统，不限制缺失启动图标的生成）。

6. **bundle id / package 锁定**：`com.xiaocaishen.novainyears`（iOS `bundleIdentifier` + Android `package`，app.json 已锁，不改）。

7. **`eas.json` 由子 plan 2 一次性建全 profile**（`development` / `preview` / `production`），子 plan 3/4 只消费不重建，避免并行编辑冲突。

8. **ADR**：新建 **ADR-0044**（mobile binary 部署形态，子 plan 2 落地，含构建链路 + Android 直分发 + iOS 两阶段决策）；**ADR-0043 已被 server 扁平贫血范式占用（#162），勿复用**。Web 复用 **ADR-0025**（已 Accepted，无需新 ADR）。

## Agent / User 操作边界（master 锁定）

外部 dashboard / 交互式登录 agent 不能代劳；agent 负责 repo 内文件 + 本地验证 + 文档化 console 步骤。

| 类别 | Agent 能做（repo + CLI） | User 手动（dashboard / 交互登录 / 付费） |
|---|---|---|
| Web | `_redirects`、`.env.production.example`、本地 `pnpm -C apps/mobile build:web` 验证、playbook 文档 | CF console 创建项目 + env vars + 自定义域；SWAS `.env.production` CORS 更新 + `docker compose --env-file .env.production up -d` 重启 |
| Mobile 地基 | `eas.json`、`app.json` version、`assets/` 复制、`eas-cli` devDep、`.easignore`、ADR-0044 | `eas login` + `eas init`（建议 session 内 `! eas login`） |
| Android | `eas build --platform android`（user 登录后 agent 可跑）、分发文档 | （keystore 默认 EAS 托管，无需手动） |
| iOS | 阶段1 `eas build --platform ios --profile preview`、`xcrun simctl install` | 阶段2：Apple Developer Program 注册（$99/yr）+ App Store Connect app record |

> 交互式登录（`eas login` 等）：用户在 session 内输入 `! eas login`，输出直接进对话，之后 agent 可跑非交互式 `eas build`。

## Sequencing + Dependency Graph

```text
Track A（Web，独立）
  └─ 子 plan 1: CF Pages Web 部署 ── 可立即 / 与 Track B 并行 ship

Track B（Mobile）
  子 plan 2 (Phase 0 共享地基) ── 必先 ship
    ├─→ 子 plan 3 (Android 签名 APK)
    └─→ 子 plan 4 (iOS 阶段1 simulator → 阶段2 TestFlight)
  子 plan 3 / 4 在子 plan 2 merge 后可并行（eas.json 已全建，无文件冲突）
```

**Track A 与 Track B 完全独立**，可并行推进。Track B 内部：子 plan 2 是 3+4 的硬前置；3 与 4 之间无依赖。

## 子 plan outline（detail 在各自文件）

### 子 plan 1 — Cloudflare Web 部署（Workers Static Assets，per ADR-0025 amend）

详见 [`05-24-client-deploy-p1-cloudflare-web.md`](05-24-client-deploy-p1-cloudflare-web.md)。要点：repo 侧加 root `wrangler.jsonc`（assets 指向 `apps/mobile/dist` + `not_found_handling: single-page-application`，`_redirects` 已移除）；server CORS 接线 + allowlist 经实测**已就位**（live 返回 `access-control-allow-origin: https://app.xiaocaishen.me`）；user 手动步骤 = dashboard Workers Builds（Git 连接自动构建）+ 自定义域从旧 meta 项目 `no-vain-years-app` 迁到新 worker；smoke test 走 curl + 浏览器登录主流程。

### 子 plan 2 — Mobile binary 共享地基（Phase 0，子 plan 3+4 硬前置）

1. `apps/mobile/assets/` ← 从 meta app 仓 `no-vain-years/no-vain-years-app/apps/native/assets/` 复制 4 个图标（均存在）；缺新资产走 claude-design
2. `app.json` version `0.0.0 → 0.0.1`（对齐 manifest）+ `ios.buildNumber`/`android.versionCode` + `extra.eas.projectId`
3. `eas.json` 全 profile：`development` / `preview`（android apk + ios simulator）/ `production`（android apk + ios device；`EXPO_PUBLIC_API_BASE_URL=https://api.xiaocaishen.me`）+ `cli.appVersionSource`
4. EAS monorepo 适配：`eas-cli` devDep + `.easignore` + 验证 EAS 识别 root `pnpm-lock.yaml`
5. `eas login` + `eas init`（user 交互登录 → agent 跑 init）→ 回填 `extra.eas.projectId`
6. ADR-0044（mobile binary 部署形态）

### 子 plan 3 — Android 签名 APK 直接分发（前置：子 plan 2）

1. keystore：EAS 托管（首次 build 自动生成）；建议导出备份
2. `eas build --platform android --profile preview` → signed APK（国内慢 → 优先国内代理；仍不通再 `--local`）
3. 分发：EAS build page 链接 / 自托管 + 扫码
4. Smoke test：真机/emulator 装 APK 登录主流程 + 打 prod API + `apksigner verify`

### 子 plan 4 — iOS 两阶段（前置：子 plan 2）

- **阶段 1（now，无 Apple 账号）**：`eas build --platform ios --profile preview`（`ios.simulator: true`）→ `.tar.gz` → `xcrun simctl install` → Simulator 登录主流程 + 打 prod API（核心目标：验证连通性）。国内慢 → 优先国内代理；仍不通再 `--local`（需本机 Xcode）
- **阶段 2（账号就绪后，gated）**：Apple Developer Program 注册（$99）+ App Store Connect app record → `production` profile device build → `eas submit` → TestFlight

## Out of Scope（整体不做）

- ❌ Google Play / 国内应用商店上架（选 Android 直分发 APK；defer）
- ❌ iOS App Store 正式上架（阶段2 仅到 TestFlight；App Store 元数据/审核 defer）
- ❌ 跨境网络优化（国内访问 CDN 镜像 / Vercel 迁移，CF 上线后多省实测再立；真要立 ADR 取下一可用号）
- ❌ CI 自动化 EAS build（GitHub Actions `eas build --non-interactive`，稳态后再接）
- ❌ release-please deploy hook 接 web/mobile（ADR-0042 open question，defer）

## Verification（master plan 自身）

- ☐ 4 sub-plans 各自完成 `/plan` 会话 + ExitPlanMode 批准
- ☐ 子 plan 1：smoke test 3 条 curl 绿 + 浏览器登录主流程跑通
- ☐ 子 plan 2：`eas.json` schema 校验过 + `app.json` version=`0.0.1` 对齐 manifest + `eas whoami` 已登录 + project linked
- ☐ 子 plan 3：真机/emulator 装 APK 登录主流程 + 打 prod API + 签名校验过
- ☐ 子 plan 4 阶段1：Simulator 装 build 登录主流程 + 打 prod API
- ☐ ADR-0044 ship；本 master + 4 sub-plans 全部落 `docs/plans/2026-05/`

## Risk + Rollback

| 风险 | 缓解 |
|---|---|
| EAS 云构建国内上传过慢 / flaky | **优先挂可靠稳定的国内代理**保住云构建链路；代理仍不通再 fallback `eas build --local`（次选灾备） |
| EAS monorepo（pnpm + Nx）构建坑 | `eas.json` `cli.appVersionSource` 显式 + `.easignore` + 首次用 preview profile 试错；验证 root `pnpm-lock.yaml` 被识别 |
| icon 资产 | 4 个均已在 meta app 仓存在 → 直接复制复用，无阻塞；缺新资产走 claude-design |
| `app.json` version drift（0.0.0 vs manifest 0.0.1） | 子 plan 2 对齐，保 release-please 首次 mobile run 正常 |
| Apple 账号审核延迟 | iOS 阶段1（simulator）不依赖账号先做；阶段2 gated 不阻塞主线 |
| CF preview URL CORS 通配缺失 | playbook 务实路径 (a) 临时加 URL / (b) 扩 parseOrigins regex（YAGNI defer） |

## On Ship 备注

- 本 master + 子 plan 1 随 `chore/cf-pages-web-deploy` PR 一起 ship（master 跟随 Phase 1 第一个 sub-PR）。
- 子 plan 2/3/4 各自 `/plan` 会话产出，各自 PR 内落 `docs/plans/2026-05/05-24-client-deploy-p{2,3,4}-*.md`。
