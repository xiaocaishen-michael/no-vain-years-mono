---
adr_id: ADR-0028
status: Proposed
applies_to: [mono-wide]
sunset_trigger: |
  - Expo SDK 内部解决 pnpm strict 兼容 (官方支持 nodeLinker=isolated 等)
  - pnpm 出 expo workspace mode / 显式 RN 兼容模式
  - 切 yarn classic / bun workspaces (生态稳定后)
  - 仓内不再含 Expo / RN 项目 (e.g. mobile 切 Capacitor)
---

# ADR-0028: Monorepo pnpm Policy — `shamefully-hoist=true` + publicHoistPattern (Expo 兼容)

* Status: Proposed (PR #67 已 ship `.npmrc`,本 ADR 追溯文档化)
* Deciders: project owner
* Tags: repo / build / dependency / cross-cutting

## Context

pnpm 默认 strict workspace (`shamefully-hoist=false`) 是社区共识"正确"做法 — 每个 package 只能 require 自己 declare 的 dep,避免 phantom dep。但 Expo SDK 54 + React Native 0.81 与该默认对抗:

* RN Metro bundler 在解析时假设 `node_modules/<peer>` 在根 reachable (例 `react-native` / `react` peers)
* Expo CLI 工具 (e.g. `expo-modules-autolinking`) 扫 `node_modules/` 顶层 — strict mode 下子包 `.pnpm/` 沉淀,扫描失败
* peer dep 雪崩:Expo SDK 拉 ~11 个 peer (react / react-native / react-dom / expo-* / @react-navigation/* / ...),每个都得在 root `package.json` 显式 declare 才不被 Metro 抓不到

A-002 ship 过程中 (PR #65/#66/#67) 反复撞:
* PR #66 加 publicHoistPattern (`expo-*` / `react-*` / `@react-navigation*` 等) 半解
* PR #67 最终 `shamefully-hoist=true` 全解 (root `node_modules/` 含所有依赖 flat layout, Metro / Expo CLI 满意)

## Decision

`.npmrc`:

```ini
shamefully-hoist=true
public-hoist-pattern[]=*expo*
public-hoist-pattern[]=*react-native*
public-hoist-pattern[]=*react*
public-hoist-pattern[]=@nestjs/*
node-linker=hoisted
```

* `shamefully-hoist=true` 是兜底,确保所有 peer flat 可见
* `public-hoist-pattern` 显式列高频包,即使未来 strict 化也保 expo/react 链
* `node-linker=hoisted` 显式声明(与 shamefully-hoist 配合,跨 pnpm minor 兼容)

## Consequences

* **Phantom dep 风险**:子包代码 require 未 declare 的 dep 不会失败 — 由 `eslint-plugin-import` `no-extraneous-dependencies` rule + nx affected boundaries 校验顶替
* **Lockfile 略大**:hoisted 重复条目多;可接受
* **CI install 速度**:hoist 后稍慢;实测无显著差异
* **未来 Expo SDK upgrade**:major bump 走 dedicated session (per memory `feedback_expo_sdk_major_dedicated_session`),`.npmrc` 不动

## Sunset Path

当 Expo / pnpm 任一方解决 strict 兼容后:

1. 试 `shamefully-hoist=false` + 保 public-hoist-pattern
2. CI 全绿 + `expo start` + Metro bundle 通过 → 切回 strict
3. 本 ADR 转 Superseded by 新策略 ADR

## References

* PR #66 (`publicHoistPattern` 阶段方案)
* PR #67 (`shamefully-hoist=true` 最终方案)
* memory `feedback_expo_sdk_major_dedicated_session`
* https://pnpm.io/npmrc#shamefully-hoist
