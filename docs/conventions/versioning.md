# 版本号 / 发版

mono 仓双线发版:`apps/server` + `apps/mobile` 各自独立 SemVer 版本线,均由 release-please 自动化驱动(per [ADR-0042](../adr/0042-monorepo-release-strategy.md))。

## 版本号规范

`apps/server` 与 `apps/mobile` **各自独立版本线**,均走 SemVer。`packages/*` + `scripts/*` 排除发版(`private: true` + `workspace:*` 软链)。

| 组件          | 版本线                                | 格式                        | 管理方式                                                                         |
| ------------- | ------------------------------------- | --------------------------- | -------------------------------------------------------------------------------- |
| `apps/server` | 源代码版本                            | SemVer `vMAJOR.MINOR.PATCH` | release-please 自动化(`apps/server/package.json`)                                |
| `apps/server` | API 版本                              | URI 前缀 `/api/v{n}/...`    | 手动,只在真 HTTP 契约 breaking 才升 vN;OpenAPI version 硬编码 `1.0`              |
| `apps/mobile` | Marketing 版本                        | SemVer `MAJOR.MINOR.PATCH`  | release-please 自动化(同步 `app.json#expo.version` + `apps/mobile/package.json`) |
| `apps/mobile` | iOS buildNumber / Android versionCode | 整数单调递增                | EAS Build 自动递增,release-please 不动                                           |
| `apps/mobile` | Expo `runtimeVersion`                 | 仅 native 代码变化时 bump   | 手动;用于 OTA 热更边界                                                           |

**起步版本**:server `0.0.1` / mobile `0.0.1`(均 pre-1.0,未正式上线)。第一个 `feat(*)` commit 触发 minor bump 到 `0.1.0`。M4 正式上架应用商店时 server + mobile 同步手动 `release-as: 1.0.0`,之后破坏兼容变更走 `v2.0.0` 和 `/api/v2/...`。

> ⚠ **manifest 起步值不能用 `0.0.0`**:release-please 把 `0.0.0` 当 "uninitialized" → 首次 release 直接跳 `1.0.0`(绕过 pre-major minor bump 默认)。`apps/{server,mobile}/package.json` 的 `version` 字段同样起步 `0.0.1`,保持与 manifest cross-consistency。详见 [ADR-0042 §Postmortem](../adr/0042-monorepo-release-strategy.md)。

## 发版流程

由 [release-please](https://github.com/googleapis/release-please) 自动化驱动:

1. commit 遵循 [Conventional Commits](./git-workflow.md#commit-消息)
2. release-please 监听 push to main,各组件起独立 Release PR(`separate-pull-requests: true`):
   - `chore(server): release X.Y.Z` — 改 `apps/server/package.json` + `apps/server/CHANGELOG.md`
   - `chore(mobile): release X.Y.Z` — 改 `apps/mobile/package.json` + `apps/mobile/app.json` + `apps/mobile/CHANGELOG.md`
3. 维护者**手动 merge** Release PR(per [git-workflow.md](./git-workflow.md) L74,AI agent 不接 auto-merge)
4. merge 触发组件化 tag `server-vX.Y.Z` / `mobile-vX.Y.Z` + GitHub Release
5. Plan 3 阶段:`if: ${{ steps.release.outputs['apps/server--release_created'] }}` 接 deploy hook

配置文件(per [ADR-0042 §4](../adr/0042-monorepo-release-strategy.md)):

- `/release-please-config.json` — manifest mode + server (node) + mobile (expo) 双 package
- `/.release-please-manifest.json` — 当前版本号 source of truth(release-please 自动改)
- `/.github/workflows/release-please.yml` — push to main 触发,PAT-with-fallback token 策略

## 路径路由(不读 commit scope)

release-please 按 `packages` 配置的**路径**决定 bump 哪个组件,**不读 commit scope**:

| Commit 改动路径                                         | server bump | mobile bump |
| ------------------------------------------------------- | ----------- | ----------- |
| `apps/server/**` only                                   | ✅          | ❌          |
| `apps/mobile/**` only                                   | ❌          | ✅          |
| `apps/server/**` + `apps/mobile/**`                     | ✅          | ✅          |
| `packages/*` / `scripts/*` / `docs/**` / 根 config only | ❌          | ❌          |

因此 commit message scope 自由(`feat(account):` / `chore(repo):` 等),不被 release-please 约束;`commitlint.config.mjs` scope-enum 保持 `[0]` 不收紧。

## 手工里程碑 tag (废弃)

meta 仓时代用 `m<x.y>-<status>` annotated tag 做三仓 SHA 快照(per [meta `docs/conventions/versioning.md`](https://github.com/xiaocaishen-michael/no-vain-years/blob/main/docs/conventions/versioning.md))。**mono 单仓后此机制废弃**:

- 单仓任意 commit SHA 即绝对快照,无需手工 tag 锚点
- 组件化 tag `server-vX.Y.Z` / `mobile-vX.Y.Z` 由 release-please 自动接管
- 阶段性节点(Plan 1/2/3 / M0-M4)改走 **GitHub Milestones**(用于 issue / PR 归类)+ `docs/plans/YYYY-MM/MM-DD-<slug>.md` 文档(git log 自然带 SHA)

详见 [ADR-0042 §2](../adr/0042-monorepo-release-strategy.md)。

## CHANGELOG 路径

各自一份:

- `apps/server/CHANGELOG.md` — release-please 自动维护
- `apps/mobile/CHANGELOG.md` — 同上

**不写根 CHANGELOG** — manifest mode 不原生支持聚合,自写脚本属过度设计。

## M4 上架路线

M4 正式上架前一次性手动 bump 到 `v1.0.0`(server + mobile 同步):

```jsonc
// release-please-config.json
{
  "packages": {
    "apps/server": { "component": "server", "release-as": "1.0.0" },
    "apps/mobile": { "release-type": "expo", "component": "mobile", "release-as": "1.0.0" },
  },
}
```

release-please 下次跑会按 `release-as` 强制 bump;ship 后删除 `release-as` 字段恢复自动 SemVer。
