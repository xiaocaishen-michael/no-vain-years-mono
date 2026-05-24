# 子 plan 3 — Android 签名 APK（EAS 云构建 + 直接分发）

> 隶属 [客户端部署 master plan](05-24-client-deploy-web-android-ios-master.md)（Track B）。前置 = 子 plan 2（#180）+ `fix(mobile)` SDK-54 对齐（#183，本 plan 执行中暴露并修复）。基准：[ADR-0044](../../adr/0044-mobile-binary-deployment.md)。

## Context

把 `apps/mobile` 的第一个**签名 Android APK** 经 EAS 云构建产出并直接分发（无商店），装真机跑登录主流程冒烟。执行中首个 build 在 Gradle 阶段失败，定位为 **bootstrap 起即存在的 Expo SDK-54 依赖漂移**（与本 plan 无关的预存仓库健康问题），单独评估 + 修复后（#183）第二次 build 通过。

## 执行结果（实证）

| 项 | 结果 |
|---|---|
| build #1 `a3cc2f2b` | ❌ **errored**（Gradle `:expo-constants:compileReleaseKotlin` — `expo-constants@18`(SDK54) 对上 `expo-modules-core@55`(SDK55 API)）。**上传 1.8MB/4s 通过**（验证子 plan 2 `.easignore` + 根 `pnpm-lock.yaml` 识别 ✓）；keystore 首次自动生成（`Build Credentials 7qwBGzI7RS`） |
| 根因修复 | `fix(mobile)` **#183**（merged `ab37875`）：`expo install --fix` 对齐 14 包到 SDK 54。详见 commit + PR body |
| build #2 `facdbc06` | ✅ **finished**（SDK 54.0.0 / Version 0.0.1 / **versionCode 3** / internal distribution）。Gradle native 编译通过，APK 产出 |
| 构建链路 | EAS Build 云构建（per ADR-0044 §1）；国内上传无瓶颈（1.8MB/4s），未触发代理灾备 |
| versionCode | EAS 远端 autoIncrement（`appVersionSource: remote`）：build#1=2 → build#2=3，**不写 app.json**（验证 ADR-0044 §4 ✓） |

## 分发（EAS internal distribution）

- **安装页（含二维码）**：`https://expo.dev/accounts/xiaocaishen/projects/no-vain-years-mobile/builds/facdbc06-0cea-4a7e-8aa2-3db8b3ea9d13`
- **APK artifact**：`https://expo.dev/artifacts/eas/wYh6WYiu3QmnhA5SQnNZiV.apk`
- 方式：Android 手机开安装页 / 扫码 → 下载 APK → sideload（首次「允许未知来源」）。无 Google Play / 国内商店（per ADR-0044 §2 + master Out of Scope）。

## 签名

- APK 由 **EAS 托管 keystore** 服务端签名（credential `Build Credentials 7qwBGzI7RS`，首次 build#1 自动生成；build#2 复用）。
- **本地 `keytool` / `apksigner` 验签未完成**：Mac 无 Android SDK（无 `apksigner`），`keytool -printcert -jarfile` 只读 v1 JAR 签名而现代 EAS APK 走 v2/v3 APK Signing Block；且经国内代理下载的本地 APK 副本被截断（`zip END header not found`，非完整 APK）。
- **替代验签**：on-device install 即签名校验（Android 安装时校验签名块；装得上 = 签名有效）→ 归入下方真机冒烟。
- **keystore 备份（建议，非阻塞，per master §子 plan 3.1）**：user 跑 `! pnpm dlx eas-cli credentials -p android` 导出留存 —— 这是 app 永久签名身份，丢失则无法以同签名更新。

## 真机冒烟（pending user device）

> ⏳ **待 user 在 Android 手机执行并回报**（本 plan ship 时尚未完成）：

1. 开安装页 / 扫码 → 装 APK（首次允许未知来源）→ 装得上即隐含签名校验通过
2. 开 app → phone-sms-auth 登录主流程 → 收 SMS 验证码 → 登录成功 → 打到 prod API `https://api.xiaocaishen.me`
3. **依赖**：prod Aliyun SMS 真实可发码。若验证码不到 → 记为 **prod-SMS 配置依赖**（与 APK 无关），不阻塞 APK 产出/分发交付

## 已知坑 / defer

- **SDK-54 依赖漂移（已修 #183）**：bootstrap #65 起 14 包超前 SDK 54，web（JS）容忍、native Kotlin 严格 → 首个 native build 才暴露。Node 全仓一致 22，未动。**SDK 升级 defer** 为独立 dedicated 项。
- **本地验签缺口**：Mac 无 Android SDK + 国内下载 flaky → 本地无法 `apksigner verify`。defer：需要硬验签时装 Android build-tools 或在能下全 APK 的网络下做；当前以 on-device install 为准。
- **真机登录冒烟**：pending user device（见上）。
- 子 plan 4（iOS simulator → TestFlight）：**明日单独起**。
