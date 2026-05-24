# 子 plan 2 — Mobile binary 共享地基(EAS 地基)

> 隶属 [客户端部署 master plan](05-24-client-deploy-web-android-ios-master.md)(Track B,Phase 0)。基准:新立 [ADR-0044](../../adr/0044-mobile-binary-deployment.md)(mobile binary 部署形态)+ [ADR-0042](../../adr/0042-monorepo-release-strategy.md)(发版版本所有权)。**子 plan 3(Android APK)/ 子 plan 4(iOS simulator→TestFlight)的硬前置** —— `eas.json` 在此一次性建全 profile,3/4 只消费不重建。

## Context

服务端已上线 `https://api.xiaocaishen.me`(Aliyun SWAS,已备案),[子 plan 1](05-24-client-deploy-p1-cloudflare-web.md) 的 CF Pages Web 已 live 于 `app.xiaocaishen.me`。本子 plan 铺 Android + iOS 二进制 EAS Build 云构建的**共享地基**:让 `apps/mobile` 能被 EAS 识别并链接到 EAS 项目。抽成独立 Phase 0 子 plan,避免子 plan 3/4 重复劳动 + 并行编辑 `eas.json` 冲突。

## 关键现状核实(2026-05-24 grep 实证)

| 项 | 现状 | 影响 |
|---|---|---|
| `apps/mobile/assets/` | 目录**不存在**;`app.json` 引用 `icon.png`/`splash-icon.png`/`adaptive-icon.png`/`favicon.png` 但文件全缺 | 从 meta app 仓 `no-vain-years/no-vain-years-app/apps/native/assets/` 复制 4 个图标(均已确认存在) |
| `apps/mobile/eas.json` | **不存在** | 一次性建全 3 profile |
| EAS 项目链接 | `app.json` 无 `extra.eas.projectId` | `eas login`(user)+ `eas init`(agent)后回填 |
| `app.json` `expo.version` | `0.0.0`,与 [`.release-please-manifest.json`](../../../.release-please-manifest.json) 的 `0.0.1` **drift** | EAS display 版本必读 `app.json` → 一次性对齐 `0.0.1` |
| `bundleIdentifier` / `package` | 已锁 `com.xiaocaishen.novainyears`(iOS+Android) | **不改** |
| `.npmrc` | `shamefully-hoist=true`(per [ADR-0028](../../adr/0028-monorepo-pnpm-policy.md)) | 根 `node_modules` 扁平,满足 EAS 安装期 Metro 解析,无需额外 hoist 配置 |
| `pnpm-workspace.yaml` | 含 `apps/*` / `packages/*` / `scripts/orchestrator` / `scripts/checks` 4 类 workspace 包 | `.easignore` **不得**排除任一,否则 `pnpm install --frozen-lockfile` break |

**两处 master plan 与权威源冲突,已 user 拍板(均落 ADR-0044)**:

1. **版本号来源**:master plan 让 bump `app.json` + 加静态 `ios.buildNumber`/`android.versionCode`,但 ADR-0042 postmortem 明说「不手动 bump app.json,native 字段 EAS 自管」,其 open question 把这条边界 defer 到「首次 mobile build」——正是现在。→ 选 **`appVersionSource: remote`**:`version` 归 release-please 写 `app.json`,`buildNumber`/`versionCode` 归 EAS 远端 `autoIncrement`(不进 app.json、无 git churn、无 race)。`app.json` `0.0.0→0.0.1` 一次性对齐(display 版本,任一模式都要做)。ADR-0044 §4 显式 supersede ADR-0042 postmortem「不 bump」陈述。
2. **eas-cli 交付**:master plan 写 devDep,但 EAS CLI 官方明确「strongly discouraged to install as a project dependency」,且 `shamefully-hoist=true` 会让其依赖树污染根树。→ 选 **`cli.version` 钉版本 + `pnpm dlx eas-cli` / 全局**,不进 workspace 依赖。

## A. Repo 侧(agent,本 PR)

1. ✅ `apps/mobile/assets/` ← 从 meta 仓复制 4 个 PNG(`icon` / `splash-icon` / `adaptive-icon` / `favicon`)
   → verify:`ls apps/mobile/assets/` 4 文件齐 + `app.json` 4 处引用命中
2. ✅ `app.json` `expo.version` `0.0.0 → 0.0.1`(对齐 manifest;**不加**静态 buildNumber/versionCode);`extra.eas.projectId` 由 B-2 `eas init` 回填
3. ✅ `apps/mobile/eas.json` —— `cli.appVersionSource: remote` + 3 profile:
   - `development`:dev client + internal + android apk + ios simulator(无 env,走 Metro dev server)
   - `preview`:internal + autoIncrement + android apk + ios simulator + `EXPO_PUBLIC_API_BASE_URL=https://api.xiaocaishen.me`
   - `production`:autoIncrement + android apk(直分发非 aab)+ ios device + 同 prod env
   - `submit.production: {}` 占位(子 plan 4 阶段2 用)
   - `cli.version` 钉版本 → 待 B-1 `eas --version` 实测回填
4. ✅ 仓根 `.easignore` —— 重述 `.gitignore` 要点(EAS 用 `.easignore` **替换** `.gitignore`)+ trim 非 workspace 目录(`docs/`/`specs/`/`ops/`/`.github/`/`.claude/`/`.specify/`);**保留**全部 workspace 包 + 根 `pnpm-lock.yaml`/`pnpm-workspace.yaml`/`.npmrc`
5. ✅ [ADR-0044](../../adr/0044-mobile-binary-deployment.md)(mobile binary 部署形态)+ docs/adr/README.md 索引行 + ADR-0042 open question 标 Resolved
6. ✅ master plan 子 plan 表状态更新 + 本 sub-plan doc 落 `docs/plans/2026-05/`

## B. Host / CLI 侧(user 交互登录 → agent 接力非交互)

> agent 不能交互登录 EAS;user 在 session 内输入 `! <cmd>`,输出进对话后 agent 接力。

1. **`! eas login`**(user)—— 登录 Expo 账号。之后 agent 跑 `eas whoami` 确认 + `eas --version` 取版本回填 `eas.json` `cli.version`(A-3)
2. **`eas init`**(agent,登录态)—— 在 `apps/mobile/` 下创建 / 链接 EAS 项目(slug `no-vain-years-mobile`)→ 回填 `app.json` `extra.eas.projectId`
   - 若 `--non-interactive` 仍需交互确认建项目 → fallback user `! eas init`
   → verify:`app.json` `extra.eas.projectId` 已写 + `eas project:info` 可查

## C. Smoke test(本子 plan 验收)

1. `apps/mobile/assets/` 4 PNG 齐 + `pnpm -C apps/mobile typecheck` 绿
2. `app.json` `expo.version` = `0.0.1` 对齐 manifest
3. `pnpm dlx eas-cli@<ver> config -e preview` / `-e production` —— `eas.json` schema 校验过
4. `eas whoami` 已登录 + `eas project:info` linked(`extra.eas.projectId` 已回填)
5. `pnpm -C apps/mobile lint` + repo `typecheck` 绿(仅资产 + 配置,无业务代码改动)

## 已知坑 / defer

- **`.easignore` 正确性只能靠首个真实 `eas build` 上传验证**(无 dry-run upload 命令)→ 验证随**子 plan 3 首个 `eas build --profile preview`**(master plan risk #2)。本子 plan 按推理写对(保全部 workspace 包目录),不跑 build。
- **不 bump 根 `package.json` `0.0.0`** —— 根非 release-please 发版单元(manifest 仅 `apps/server`+`apps/mobile`),与 EAS/发版无关。
- **不加 `runtimeVersion` / 不配 expo-updates** —— OTA 不在本轮 scope;EAS Build 无 expo-updates 时不要求 runtimeVersion(ADR-0044 Open Questions 承接)。
- **不跑首个 `eas build`** —— 子 plan 3 的交付。
- **commit type `build(mobile)`**(非 `feat`)→ 不触发 release-please mobile bump,`app.json` 保持本 PR 写入的 `0.0.1`。
