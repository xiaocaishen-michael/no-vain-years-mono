---
adr_id: ADR-0042
status: Accepted
applies_to: [mono-wide]
sunset_trigger: |
  - 引入第 3 个 release-please 管理的 app/package (如 apps/admin / apps/docs) → 重审是否切聚合或分组发版,manifest packages 表是否拆 group
  - M4 正式上架后 server / mobile 同步升 v1.0.0 → 重审 pre-major minor bump 默认与 release-as 路线
  - release-please v4 → v5 / 迁移到 changesets 或 semantic-release → 配置体例可能不向后兼容,需重写
  - OpenAPI URI `/api/v1/` 升 v2 时 → 重审 server SemVer 与 API SemVer 的解耦边界是否仍合理
---

# ADR-0042: Monorepo Release Strategy — release-please 双线 (server + mobile) + 内部包零版本

- Status: Accepted (2026-05-22)
- Deciders: project owner
- Tags: release / governance / cross-cutting

## Context

Meta 仓时代 release-please 装在 `my-beloved-server` (Maven, v0.3.1) + `no-vain-years-app` (Node, v0.1.0) 两个 impl 仓,meta 自身只用 annotated 里程碑 tag (`m<x.y>-<status>`) 做三仓 SHA 快照 (per meta [release-please 决策](https://github.com/xiaocaishen-michael/no-vain-years/blob/main/docs/adr/0003-release-please-conventional-commits.md))。

2026-05-17 Plan 1 pivot 到 `no-vain-years-mono` (Nx + NestJS + Fastify + Prisma + Expo) 单仓后,三仓架构被取代:

- mono 仓 commitlint + lefthook commit-msg 钩子 + [`docs/conventions/git-workflow.md`](../conventions/git-workflow.md) L74 "release-please Release PR 永远手动 merge" 例外条款已 mirror 完
- 但 release-please-config.json / manifest / workflow 全缺位,版本号 / CHANGELOG / SemVer tag 零落地
- mono 单仓后任意 commit SHA 自身即三仓快照,手工里程碑 tag 失去存在理由

本 ADR 沉淀"从 meta 规范裁剪并自包含化到 mono 单仓"的 3 项决策,并锁定 release-please 配置形态作为 baseline,后续 PR 直接落配置不再重新讨论。

## Decision

### 1. 发版单元 = `apps/server` + `apps/mobile` 双线

| 路径                   | 发版 | release-type | 理由                                      |
| ---------------------- | ---- | ------------ | ----------------------------------------- |
| `apps/server`          | ✅   | `node`       | NestJS 后端 — 独立部署 + 独立版本线       |
| `apps/mobile`          | ✅   | `expo`       | Expo 前端 — 独立发版上架 + 独立版本线     |
| `packages/api-client`  | ❌   | —            | `private: true` + `workspace:*` 软链,内部 |
| `packages/types`       | ❌   | —            | 同上                                      |
| `scripts/orchestrator` | ❌   | —            | 同上                                      |

排除 `packages/*` + `scripts/*` 的根因:**workspace 内部依赖走 `workspace:*` 协议**,运行时由 pnpm resolve 到 monorepo 内的具体路径,**外部不可见**。给它们发版本号 = 制造无消费者的 SemVer 噪声。

### 2. 手工里程碑 tag (`m<x.y>-<status>`) 废弃

meta 仓时代里程碑 tag 是"三仓 SHA 快照锚点" — 单仓后该需求自然消解(任意 commit SHA 即快照)。

mono 仓的"阶段性节点"(Plan 1/2/3 / M0-M4) 改走:

- **GitHub Milestones** — 用于 issue / PR 归类,无 SHA 强绑定
- **`docs/plans/YYYY-MM/MM-DD-<slug>.md` 文档** — 阶段性记录写在文档里,git log 自然带 SHA

组件化 tag `server-vX.Y.Z` / `mobile-vX.Y.Z` 由 release-please 自动接管(per Decision §4)。

### 3. OpenAPI URI `/api/vN/` 与 server SemVer 完全解耦

继承 meta [release-please 决策 §Decision 第 5 条](https://github.com/xiaocaishen-michael/no-vain-years/blob/main/docs/adr/0003-release-please-conventional-commits.md):

- OpenAPI URI `/api/v1/` 与 server `vX.Y.Z` 独立演进
- server 0.1.0 → 0.9.0 → 1.0.0 期间 URI 永远 `/api/v1/`
- 仅当真 HTTP 契约 breaking (字段语义变 / 必填变 / 路径删) 时**手动**升 `/api/v2/`,与 server SemVer 无关联

OpenAPI shape 由 `@nestjs/swagger` 装饰器 code-first 生成,版本字段硬编码 `1.0` (不读 `package.json`),避免被 release-please bump server version 时连带改 OpenAPI version。

### 4. release-please 配置形态 (manifest mode + separate PR)

仓根 `release-please-config.json`:

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

仓根 `.release-please-manifest.json` (初值):

```json
{
  "apps/server": "0.0.1",
  "apps/mobile": "0.0.1"
}
```

**起步版本号必须 ≥ `0.0.1`,不能用 `0.0.0`**:release-please 把 `0.0.0` 当作 "uninitialized" 信号,首次 release 直接初始化到 `1.0.0`(无视 `bump-minor-pre-major` 默认),违反 M4 v1.0.0 设计。`0.0.1` 起步则走 pre-major minor bump 拿到 `0.1.0`。详见 §Consequences 末段 "Postmortem: PR-2 首跑 mobile 1.0.0"。

关键字段:

- `separate-pull-requests: true` — server / mobile 各自起独立 Release PR(默认聚合违反双线设计)
- `include-component-in-tag: true` — 强制 tag 体例 `<component>-v<version>` (e.g. `server-v0.1.0` / `mobile-v0.2.3`)
- 顶层 `release-type: node` + `apps/mobile` override `expo` — mobile 用 expo type 是因为 release-please `expo` type **原生同步 `app.json` 的 `expo.version`**,免去 `extra-files` 6 行 jsonpath 配置;`runtimeVersion` / `buildNumber` / `versionCode` 永不动(EAS Build 接管)
- 不写 `bump-minor-pre-major` — release-please v4 pre-1.0 阶段默认 `feat` / `feat!` / `BREAKING CHANGE` 均 minor bump,无需显式

CHANGELOG 路径:`apps/server/CHANGELOG.md` + `apps/mobile/CHANGELOG.md` 各自一份。**不写根 CHANGELOG**(manifest mode 不原生支持聚合,自写脚本属过度设计)。

### 5. Token 策略 — PAT-with-fallback

`.github/workflows/release-please.yml` 用:

```yaml
token: ${{ secrets.RELEASE_PLEASE_PAT || secrets.GITHUB_TOKEN }}
```

原因:`GITHUB_TOKEN` 创建的 Release PR **不触发** `pr-validation.yml` 等 required check(GitHub 反递归保护),ruleset `required_status_checks` 会永久 block merge。PAT 可绕过;fallback 让 fork / 未配 PAT 环境仍能起 PR(虽然 CI 不绿)。

Secret 配置:`gh secret set RELEASE_PLEASE_PAT --repo no-vain-years-mono`,PAT 范围 `repo` + `workflow`。

## Consequences

### 起步状态

- server 起 `0.0.1`(与 `apps/server/package.json` 对齐)
- mobile 起 `0.0.1`(`apps/mobile/package.json` 同步从 `0.0.0` bump 到 `0.0.1`,见 §Postmortem)
- 第一个 `feat(*)` commit 改 `apps/server/**` → release-please bump server `0.1.0`
- `feat!` 或 `BREAKING CHANGE:` footer 同样 minor bump 到 `0.1.0`(pre-1.0 规则)
- M4 正式上架时手动配置 `release-as: 1.0.0`(写在 [`docs/conventions/versioning.md`](../conventions/versioning.md) 路线段)

### 边界 case 行为

| Commit 改动路径                     | server bump | mobile bump | Release PR 数 |
| ----------------------------------- | ----------- | ----------- | ------------- |
| `apps/server/**` only               | ✅          | ❌          | 1 (server)    |
| `apps/mobile/**` only               | ❌          | ✅          | 1 (mobile)    |
| `apps/server/**` + `apps/mobile/**` | ✅          | ✅          | 2 (各自独立)  |
| `packages/api-client/**` only       | ❌          | ❌          | 0             |
| `docs/**` / 根 config only          | ❌          | ❌          | 0             |

### Plan 1/2/3 节奏

- **Plan 1**(2026-05 接入):本 ADR + [`docs/conventions/versioning.md`](../conventions/versioning.md) + release-please 配置 + workflow ship,首跑无 feat 累积 → 空跑无 Release PR
- **Plan 2**(2026-06 起):每个 feature ship 触发对应 release-please bump,e2e 验证 Release PR 自动生成 + tag 体例正确
- **Plan 3**(部署):`if: ${{ steps.release.outputs['apps/server--release_created'] }}` 分支接 deploy hook(本 ADR 不预留代码)
- **M4 上架**:server + mobile 同步 `release-as: 1.0.0`(per meta [release-please 决策 Context](https://github.com/xiaocaishen-michael/no-vain-years/blob/main/docs/adr/0003-release-please-conventional-commits.md) 起步 v0.1.0 → M4 v1.0.0 路线)

### 联动 amend

- [`docs/conventions/git-workflow.md`](../conventions/git-workflow.md) L74 — "release-please Release PR" 项末尾追加"组件化 tag `server-vX.Y.Z` / `mobile-vX.Y.Z` 由 release-please 自动打,手工里程碑 tag 已废弃"
- [`docs/conventions/versioning.md`](../conventions/versioning.md) — 新建(从 meta minimal-adapt)
- `commitlint.config.mjs` scope-enum `[0]` **不变** — release-please 按 `packages` 配置的**路径**路由(`apps/server/**` 改 → server bump),不读 commit scope;约束 scope 反而误伤 `chore(repo)` / `chore(core)` 等 cross-cutting commit
- `CLAUDE.md` **不进 always-load** — versioning convention 按需 read 即可,过度 @import 违反 claude-md-audit 反模式 + 突破 always-load token 预算

## Trade-offs

| 短板                                                                             | 接受理由                                                                                                                                               |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `separate-pull-requests: true` 在两 app 同 commit 改动时刷出 2 个 PR,review 负担 | 双线独立设计的必然代价;聚合 PR 会让 server / mobile 版本号被迫同步,违反"独立版本线"基本前提                                                            |
| PAT-with-fallback 让 fork 环境 CI 永红(无 secret 时仅 GITHUB_TOKEN)              | solo dev 项目 fork 场景 ≈ 0;权衡 ruleset block merge 主流程 > fork 完美工作                                                                            |
| OpenAPI version 硬编码 `1.0` 与 server SemVer 解耦后,LLM agent 容易混淆          | 沿 meta release-please 决策既有设计,Plan 1 W1.3 已写入 [`docs/conventions/git-workflow.md`](../conventions/git-workflow.md);新人首次接触时一次澄清成本 |
| 排除 `packages/*` 让其内部 breaking 改动无 SemVer 显式声明                       | workspace:\* 协议保证 monorepo 内消费者总拿最新版本,SemVer 对内部包无消费侧意义;若未来抽出独立发布则重审                                               |

### Postmortem: PR-2 首跑 mobile 1.0.0

PR-2 ([#111](https://github.com/xiaocaishen-michael/no-vain-years-mono/pull/111)) ship 后 first workflow run 起的 mobile Release PR ([#112](https://github.com/xiaocaishen-michael/no-vain-years-mono/pull/112),已 close) 把版本算成 `1.0.0`(major),不符 M4 才升 1.0.0 的设计。

**根因**:`.release-please-manifest.json` 起步 `"apps/mobile": "0.0.0"`。release-please 把 `0.0.0` 当作 "无前序版本 → 首次 release 初始化" 路径,直接跳到 `1.0.0`,**绕过** `bump-minor-pre-major` 默认。server 起步 `0.0.1` 走 pre-major minor bump 拿到 `0.1.0`,行为正确,佐证起步值 ≥ `0.0.1` 是 release-please 的隐含约定。

**修复**(PR #114): manifest mobile `0.0.0` → `0.0.1` + `apps/mobile/package.json` `version` `0.0.0` → `0.0.1` 同步;close mobile Release PR-112 + 删 orphan branch `release-please--branches--main--components--mobile` 让 re-trigger 从干净状态开始。

**`apps/mobile/app.json` `expo.version` 仍 `0.0.0`(未手动 bump)— 设计内,非遗漏**:release-please `expo` type 以 `.release-please-manifest.json`(`0.0.1`)为版本 source-of-truth,`app.json` 是**写入目标**而非读取源 —— 下次 mobile 发版(首个 `feat` 触 `apps/mobile/**`)bump 到 `0.1.0` 时由 expo updater **自动 reconcile** 覆盖(per § Decision 4 expo type 原生同步 `expo.version`)。故 **不手动 bump**:手改 `app.json` 既无必要(下次发版即覆盖),又会让 `apps/mobile/**` 进 nx affected + 与 release-please 抢写版本号。

**Plan §G 偏差**:本 ADR + [05-22-release-please-mono-bootstrap.md](../plans/2026-05/05-22-release-please-mono-bootstrap.md) §G 原写 "mobile: `0.0.0`(同 package.json)" — package.json 是 `0.0.0` 没错,但作为 release-please manifest 输入是雷。Plan 不追溯改;ADR + [`versioning.md`](../conventions/versioning.md) 起步版本表已是 SSOT,以本 ADR 为准。

**Plan §Verification §1 偏差**:原写"首跑无 feat 累积 → 不起 Release PR,纯空跑"。实际 release-please 扫**全部** main 历史,起步 manifest ship 时即按已累积 commits 计算 → 立即起 Release PR。等价 PR-3 e2e 验证提前发生,非 bug。

**PR validation gate 漏洞**(本 PR 顺带修):release-please bot 生成的 Release PR body 是 auto-generated CHANGELOG,不含 `### 🚨 部署与存活前置确认` section,被 [`.github/workflows/pr-validation.yml`](../../.github/workflows/pr-validation.yml) 的 Enforce PR Checkboxes step 拦截 → 永远 BLOCKED on merge。本 PR 在该 step 加 `autorelease: pending` label bypass(release-please 永远附加该 label,跨 token mode 可靠)。本质是 [ADR-0040](0040-multi-layer-test-gate.md) 多层门禁 vs ADR-0042 自动化发版的边界失误,首次 release-please 落地才暴露。

## Open Questions

- **Plan 3 deploy hook 接入方式** — `if: outputs['apps/server--release_created']` 是 release-please v4 文档推荐路径,但若 [ADR-0026](0026-backend-deployment-topology.md) 决定走 Cloudflare 单边触发,可能改 webhook 反推。defer 到 Plan 3。
- **mobile EAS Build buildNumber / runtimeVersion 与 release-please 协作边界** — 当前设计 release-please 只改 `expo.version` / `package.json`,native 字段 EAS 自管,但 OTA 热更与 native build 同时发生时存在 race。defer 到首次 Plan 2 mobile feature ship。

## References

- meta [release-please 决策](https://github.com/xiaocaishen-michael/no-vain-years/blob/main/docs/adr/0003-release-please-conventional-commits.md) — 思想源,Conventional Commits + release-please 自动化的根决策
- [meta `docs/conventions/versioning.md`](https://github.com/xiaocaishen-michael/no-vain-years/blob/main/docs/conventions/versioning.md) — 双版本线 + EAS buildNumber 分工 + M4 v1.0.0 路线的源
- [`docs/conventions/versioning.md`](../conventions/versioning.md) — mono 适配后的版本号 / 发版规范
- [`docs/conventions/git-workflow.md`](../conventions/git-workflow.md) — Conventional Commits + Squash merge + release-please PR 手动 merge 例外
- [`docs/plans/2026-05/05-22-release-please-mono-bootstrap.md`](../plans/2026-05/05-22-release-please-mono-bootstrap.md) — 本 ADR 落地 plan(3-PR 路线)
- [release-please v4 manifest mode 文档](https://github.com/googleapis/release-please/blob/main/docs/manifest-releaser.md)
- [release-please `expo` release-type 文档](https://github.com/googleapis/release-please/blob/main/docs/customizing.md#expo)
