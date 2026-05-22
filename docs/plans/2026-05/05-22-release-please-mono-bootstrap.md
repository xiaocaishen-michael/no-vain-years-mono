---
name: meta-release-please-versioning-mono-encapsulated-boot
created: 2026-05-22
status: planned
owners: ['@xiaocaishen-michael']
---

# Mono 仓 release-please 版本管理对齐 meta 规范

## Context

Meta 仓时代 release-please 装在 `my-beloved-server` (Maven, v0.3.1) + `no-vain-years-app` (Node, v0.1.0) 两个 impl 仓，meta 自身只用 annotated 里程碑 tag (`m<x.y>-<status>`) 做三仓 SHA 快照。2026-05-17 Plan 1 pivot 到 `no-vain-years-mono` (Nx + NestJS + Fastify + Prisma + Expo) 单仓后，三仓架构被取代，但 mono 仓的 release-please / CHANGELOG / SemVer tag 全缺位 — commitlint + lefthook + git-workflow.md L65-74 的 release-please 例外条款已 mirror 完，但配置层零落地。

本计划做的是从 meta 规范裁剪并自包含化（"encapsulated boot"）到 mono 仓内 — 不绑定旧 meta-ADR-0003，按 mono 单仓上下文重新写 ADR + convention + config，让 mono 仓在 release-please 维度自给自足。

## 已定型决策（用户已确认，落地阶段不重审）

1. **发版单元 = `apps/server` + `apps/mobile` 双线**。`packages/api-client` / `packages/types` / `scripts/orchestrator` 全部排除（`private: true` + `workspace:*` 软链，内部版本号语义为 0）。
2. **手工里程碑 tag 废弃**。mono 单仓后任意 commit SHA 自身就是绝对快照；组件化 tag `server-vX.Y.Z` / `mobile-vX.Y.Z` 由 release-please 自动接管；阶段性节点 (Plan 1/2/3 / M0-M4) 走 GitHub Milestones + 文档。
3. **OpenAPI URI `/api/vN/` 与 server SemVer 完全解耦**（继承 meta-ADR-0003 设计）。OpenAPI 硬编码 1.0、URI `/api/v1/` 与 server `vX.Y.Z` 独立演进，仅真 HTTP 契约 breaking 时手动升 v2。
4. **新立 mono ADR `0042-monorepo-release-strategy.md`**（下一可用编号已验，当前最大 0041-server-common-directory-policy.md）。开头引用 meta-ADR-0003 为思想源，正文聚焦 mono 单仓适配差异（双线、里程碑废弃、内部包排除）。

## 设计细节

### A. Mobile release-type = `expo`（非 node）

| 维度 | `expo` | `node` |
|------|--------|--------|
| `app.json` `expo.version` 同步 | ✅ 自动 | ❌ 需 `extra-files` 手写 jsonpath |
| `package.json` version | ✅ | ✅ |
| `runtimeVersion` / `buildNumber` / `versionCode` | ❌ 永不动（EAS Build 接管） | ❌ 同左 |
| 配置行数 | 1 行 (`"release-type": "expo"`) | 6+ 行（含 extra-files 节） |

选 `expo`：少 6 行 + 对齐工具原生意图。`runtimeVersion` 仅 native 变化时手动 bump，`buildNumber` / `versionCode` 由 EAS Build 自增 — 与 meta-ADR-0003 设计一致。

### B. Workflow + token 策略

`.github/workflows/release-please.yml`：

```yaml
name: release-please
on:
  push:
    branches: [main]
permissions:
  contents: write
  pull-requests: write
jobs:
  release-please:
    runs-on: ubuntu-latest
    steps:
      - uses: googleapis/release-please-action@v4
        with:
          token: ${{ secrets.RELEASE_PLEASE_PAT || secrets.GITHUB_TOKEN }}
          config-file: release-please-config.json
          manifest-file: .release-please-manifest.json
```

**Token 策略：PAT-with-fallback**（对齐 meta app 仓）。原因：`GITHUB_TOKEN` 创建的 Release PR **不触发 `pr-validation.yml` 等 required check**（GitHub 反递归保护），ruleset `required_status_checks` 会永久 block merge。PAT 可绕过；fallback 让 fork / 未配 PAT 环境仍能起 PR（虽然 CI 不绿）。

**Secret 配置**：`gh secret set RELEASE_PLEASE_PAT --repo no-vain-years-mono`，PAT 范围 `repo` + `workflow`。

**Post-release deploy hook 本期不接**。Plan 3 部署阶段加 `if: ${{ steps.release.outputs['apps/server--release_created'] }}` 分支即可，零预留代码。

### C. 配置文件

`release-please-config.json`（仓根）：

```json
{
  "$schema": "https://raw.githubusercontent.com/googleapis/release-please/main/schemas/config.json",
  "release-type": "node",
  "separate-pull-requests": true,
  "include-component-in-tag": true,
  "packages": {
    "apps/server": { "component": "server" },
    "apps/mobile": { "release-type": "expo", "component": "mobile" }
  }
}
```

`.release-please-manifest.json`（仓根）：

```json
{
  "apps/server": "0.0.1",
  "apps/mobile": "0.0.0"
}
```

关键字段释义：

- `separate-pull-requests: true` — 强制 server / mobile 各自起独立 Release PR。默认聚合违反双线设计。
- `include-component-in-tag: true` — 强制 tag 体例 `<component>-v<version>`。manifest mode 默认即如此，显式写 1 行做防御（避免未来版本默认值变化）。
- 顶层 `release-type: node` + `apps/mobile` override 为 `expo` — server 默认 node，mobile 单独切。
- 不写 `bump-minor-pre-major` — release-please v4 默认 pre-1.0 阶段就是 minor bump，无需显式。

### D. CHANGELOG 路径

各自一份：`apps/server/CHANGELOG.md` + `apps/mobile/CHANGELOG.md`（release-please 自动生成首次）。**不要根 CHANGELOG** — manifest mode 不原生支持聚合，自写脚本属于过度设计。

### E. Commitlint scope-enum 保持 `[0]` 不约束

release-please 按 `packages` 配置的**路径**路由（`apps/server/**` 改动 → server bump），不读 commit scope。约束 scope 反而误伤 `chore(repo)` / `chore(core)` 等 cross-cutting commit。当前 `commitlint.config.mjs` 已是 `[0]`，不动。

### F. 边界 case 验证表

| Commit 改动路径 | server bump | mobile bump | Release PR 数 |
|-----------------|-------------|-------------|---------------|
| `apps/server/**` only | ✅ | ❌ | 1 (server) |
| `apps/mobile/**` only | ❌ | ✅ | 1 (mobile) |
| `apps/server/**` + `apps/mobile/**` | ✅ | ✅ | 2 (各自独立) |
| `packages/api-client/**` only | ❌ | ❌ | 0 |
| `docs/**` / 根 config only | ❌ | ❌ | 0 |

### G. 初始版本号

- server: `0.0.1`（manifest 初值，与现 `apps/server/package.json` version 对齐）
- mobile: `0.0.0`（同上）
- 第一个 `feat(*)` commit 后 → `0.1.0`（pre-major minor bump，release-please v4 默认）
- `feat!` 或 `BREAKING CHANGE:` footer → 同样 `0.1.0`（pre-1.0 阶段 major bump 仍走 minor，与 SemVer pre-release 规则一致）
- M4 上架时手动配置 `release-as: 1.0.0`（写在 ADR-0042 路线图段）

## 实施 PR 拆分（3 个，串行）

| # | 分支名 | 范围 | 副作用 |
|---|--------|------|--------|
| 1 | `docs/release-please-foundation` | `docs/adr/0042-monorepo-release-strategy.md` 新 + `docs/conventions/versioning.md` 新 + `docs/conventions/git-workflow.md` L74 amend | 零运行时副作用 |
| 2 | `chore/release-please-config` | `release-please-config.json` + `.release-please-manifest.json` + `.github/workflows/release-please.yml` 新 + 配置 `RELEASE_PLEASE_PAT` secret | 合入后下次 push to main 触发 release-please 首跑（首跑无 feat 累积 → 不起 Release PR，纯空跑） |
| 3 | 不单独开 — 混入下一个正常 feature PR 验证 e2e | 任意 `feat(account/pkm/...):` commit 改 `apps/server/**` 或 `apps/mobile/**` | 期望：release-please bot 自动起 `chore(server): release 0.1.0` 或 `chore(mobile): release 0.1.0` PR |

**理由**：PR-2 单独可回滚（删 3 文件即净），与文档解耦；一把梭则 ADR rationale 与 config 体例同 review 模糊焦点。

## 待修改 / 新建文件清单

新建：

- `/release-please-config.json`
- `/.release-please-manifest.json`
- `/.github/workflows/release-please.yml`
- `/docs/adr/0042-monorepo-release-strategy.md`（引用 meta-ADR-0003 为思想源；记录"为何排除 packages/* + orchestrator"、"为何废弃里程碑 tag"、"为何 OpenAPI URI 解耦"三决策；列 Plan 1/2/3 节奏 + M4 上架 v1.0.0 路线）
- `/docs/conventions/versioning.md`（minimal-adapt from meta `docs/conventions/versioning.md`；删三仓表 → 改双组件表；保留 OpenAPI 解耦段 + EAS buildNumber 分工段；显式声明手工里程碑 tag 废弃）

Amend：

- `/docs/conventions/git-workflow.md` L74 — 在 `release-please Release PR` 项末尾追加一句：「组件化 tag `server-vX.Y.Z` / `mobile-vX.Y.Z` 由 release-please 自动打，手工里程碑 tag 已废弃」

不动：

- `CLAUDE.md` — versioning convention **不进 always-load**（发版触发时按需 read 即可；过度 @import 违反 claude-md-audit 反模式 + 突破 always-load token 预算）
- `commitlint.config.mjs` — scope-enum `[0]` 不变
- `lefthook.yml` — commit-msg 钩子不变
- `.github/pull_request_template.md` — release-please 自动接管版本字段，无需 PR 体例改动

## Verification

PR-2 合入后：

1. `gh workflow view release-please.yml --repo xiaocaishen-michael/no-vain-years-mono` — 确认 workflow 注册成功
2. `gh workflow run release-please.yml --ref main` 手动触发一次空跑 — 期望：exit 0，无 Release PR（因无 feat 累积）
3. 检查 Actions tab → action 内 `googleapis/release-please-action@v4` step 无 error

PR-3（混入下个 feat PR）合入后：

1. 等待 `release-please` workflow 自动跑（push to main 触发）
2. `gh pr list --label 'autorelease: pending' --repo xiaocaishen-michael/no-vain-years-mono` — 期望出现 `chore(server): release 0.1.0` PR
3. 检查 Release PR body 含 CHANGELOG diff（`apps/server/CHANGELOG.md` 新增段 + `apps/server/package.json` version 0.0.1 → 0.1.0）
4. 手动 merge Release PR（per git-workflow.md L74 "永远手动 merge"）
5. `git fetch --tags && git tag -l 'server-*'` 本地验 — 期望出现 `server-v0.1.0`
6. `gh release view server-v0.1.0` — 期望含 GitHub Release notes（CHANGELOG 内容）

边界 case 验证：

7. 同时改 `apps/server/**` + `apps/mobile/**` 的 commit → 期望两个独立 Release PR
8. 只改 `packages/api-client/**` 的 commit → 期望零 Release PR（release-please workflow 跑但 noop）

## 风险与回滚

| 风险 | 触发条件 | 回滚 |
|------|----------|------|
| RELEASE_PLEASE_PAT 未配 → Release PR CI 永红 | PR-2 合入但忘配 secret | 1 分钟内 `gh secret set RELEASE_PLEASE_PAT`，无需 workflow 改动 |
| release-please-action v4 行为与预期不符 | 首次 e2e 验证不通过 | PR revert（删 3 配置文件），文档 PR-1 保留作 spec |
| ADR-0042 编号被并行 PR 抢占 | 多人同时开 ADR PR | 起 PR 前 `ls docs/adr/` 再次校准最大编号；本仓 solo dev 风险接近 0 |

## 参考

- meta 仓 `docs/conventions/versioning.md` — 思想源，重点保留 OpenAPI 解耦 + EAS buildNumber 分工段
- meta 仓 `docs/adr/0003-release-please-conventional-commits.md` — ADR-0042 在引言段 reference
- meta 仓 `my-beloved-server/.github/release-please-config.json` — 单包 maven 配置对比样本（mono 不复用 maven，仅参考结构）
- meta 仓 `no-vain-years-app/.github/release-please-config.json` — 单包 node 配置对比样本（mono 用 manifest mode 升级版）
- release-please v4 manifest mode 文档：<https://github.com/googleapis/release-please/blob/main/docs/manifest-releaser.md>
- release-please `expo` release-type 文档：<https://github.com/googleapis/release-please/blob/main/docs/customizing.md#expo>
