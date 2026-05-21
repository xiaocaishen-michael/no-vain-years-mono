# Master Plan: 测试基建 + Nx 策略 体系化建设

> **统领 3 个独立子 plan**：机制 → 策略 → 门禁；本文件**不下钻子 plan 内部**，只锁跨阶段决策、接口契约、依赖图、终局验收。

## Context

PR #79 (PR-5 tail) 之后的复盘显示：PR #65 / PR-5a/5b/5c 共 8 处 cascade bug 中 6 处源于「merged 但从未真实端到端跑过」反模式。`gh pr merge --auto` + 单元/lint/typecheck CI 全 GREEN ≠ runtime 正确。深层根因：**「成功完成」标准漏了 runtime 这一层**。

同时 Explore 审计揭示当前 Nx 策略有结构性缺失：mobile e2e target 存在但 CI 不调；server `test` 混 unit+integration；无 `--skip-nx-cache` 纪律；orchestrator 无 project.json 不在 nx affected 图；prisma schema 改动不会撕全盘缓存。

本 plan 用 **3 阶段渐进结构** 修复：

| 阶段 | 心法 | 性质 | 出错代价 |
|---|---|---|---|
| **L1 机制** | 先把验证脚本写出来、本地裸跑得通 | 能力 | 单纯不可用 |
| **L2 策略** | 再用 Nx 包装托管 + 自动触发 | 调度 | 可用但人工触发 |
| **L3 门禁** | 最后 GitHub ruleset / lefthook 强制 | 强制 | 反噬：误拦好 PR |

设计纪律：**L1 不通不写 L2；L2 不稳不上 L3**。

## 子 plan 拆分

| Phase | Sub-plan 文件 | 阶段名 | PR | 核心交付 |
|---|---|---|---|---|
| 1 | `docs/plans/2026-05/05-22-test-infra-p1-runtime-smoke.md` | 测试基建纯净落地 | PR-T1 | `scripts/ci/server-boot-smoke.ts` standalone tsx 脚本 + spec-kit templates/schemas 升级 + `state_branches` 字段引入 |
| 2 | `docs/plans/2026-05/05-22-test-infra-p2-nx-tracks.md` | Nx 工业化轨道搭建 | PR-T2 | `nx run server:runtime-smoke` + `nx run mobile:runtime-smoke` target + `nx.json` cache 失效树 + ESLint `scope:*` 边界电网 |
| 3 | `docs/plans/2026-05/05-22-test-infra-p3-ci-gates.md` | CI/CD 与门禁大合围 | PR-T3 | `.github/workflows/pr-validation.yml` + `nightly-sweep.yml` + PR template + lefthook anti-mock 正则拦 + branch ruleset required checks 更新 |

每个子 plan **独立 `/plan` 会话设计**、独立 PR、独立验收。本主 plan 不下钻细节决策。

## 跨阶段契约（master 锁定，sub-plan 不得违反）

### P1 → P2 接口

P1 输出：
- `scripts/ci/server-boot-smoke.ts` — `pnpm tsx scripts/ci/server-boot-smoke.ts` 本地裸跑 exit 0
- `apps/mobile/` 可独立跑通的 playwright runtime-smoke 形态（先建机制，nx 化在 P2）
- `.specify/templates/spec-template.md` + `.specify/schemas/spec.zod.ts` 含 `state_branches` 字段
- `.specify/templates/plan-template.md` 含 `🚨 Testing Invariants` 段（禁过度 mock 禁令）

P2 消费：
- 把 P1 的 tsx 脚本 wrap 成 `nx run server:runtime-smoke` target，不动脚本内部
- 把 P1 的 mobile playwright 调用 wrap 成 `nx run mobile:runtime-smoke` target

### P2 → P3 接口

P2 输出：
- `nx run server:runtime-smoke` 单命令本地稳定跑通
- `nx run mobile:runtime-smoke` 单命令本地稳定跑通
- `nx affected --target=runtime-smoke` 跨包传导正确（server endpoint 改 → api-client → mobile）
- `nx.json` 的 `namedInputs` 把 prisma schema 纳入 `sharedGlobals`，schema 一动全盘 cache 失效
- ESLint `@nx/enforce-module-boundaries` + project tag `scope:server` / `scope:mobile` / `scope:shared` 配齐

P3 消费：
- ci.yml 调 `nx affected ... runtime-smoke`，不需要重新写脚本
- PR validation Action 调用上述 target，不需要复制配置

### P1 ↔ P3 直接契约（跳过 P2）

- P1 引入的 `state_branches` 字段在 P3 lefthook 阶段加 commit-msg 校验拦
- P1 引入的 `🚨 Testing Invariants` 段在 P3 lefthook anti-mock 正则配套配齐

## Sequencing + Dependency Graph

```
PR-T1 (机制)
  ├─ 脚本可裸跑 (无 Nx / 无 CI 依赖)
  ├─ spec.zod schema 升级 (兼容现有 spec — state_branches optional)
  └─ ADR-0040 stub Proposed
       ↓ merged into main
PR-T2 (策略)
  ├─ Nx target 包装 PR-T1 脚本
  ├─ nx.json cache 树
  └─ ESLint scope 边界
       ↓ merged into main
PR-T3 (门禁)
  ├─ GH Actions pr-validation + nightly-sweep
  ├─ PR template + unchecked-blocker
  ├─ lefthook anti-mock 正则拦
  ├─ branch ruleset required checks 加 runtime-smoke
  └─ ADR-0040 amend → Accepted
```

**严格串行，不并行**：每 PR merge + 主 plan 文件勾掉 + 下一阶段开 `/plan` 会话。

## 跨阶段决策（master 一次性锁定）

### ADR 位置

- **ADR-0040 — Multi-layer test gate strategy**
- 起草：PR-T1 stub Proposed（5 nails + status / applies_to / sunset_trigger）
- 终态：PR-T3 amend → Accepted（含三阶段实际 ship 证据）
- 单 ADR 跨三阶段，不拆 3 个 ADR（避免决策碎片化）
- `applies_to: mono-wide` — 影响 server + mobile + CI + spec-kit
- `sunset_trigger`：(a) Nx EOL / Anthropic Agent SDK 改框架 / (b) 测试基建被某新框架（如 Playwright Component Testing）一站式替代 / (c) e2e gate 误伤率 > 5% 持续 1 月

### 文件命名 + 落点

| 文件 | 路径 | ship 时 |
|---|---|---|
| 本主 plan | scratch `docs/plans/pr-5-...-declarative-creek.md` | PR-T1 内 `git mv` → `docs/plans/2026-05/05-22-test-infra-master.md` |
| Sub-plan 1 | 各自 `/plan` 会话起手时由 plan mode 分配 scratch | 子 PR 内 `git mv` → `docs/plans/2026-05/05-22-test-infra-p1-runtime-smoke.md` |
| Sub-plan 2 | 同上 | `05-22-test-infra-p2-nx-tracks.md` |
| Sub-plan 3 | 同上 | `05-22-test-infra-p3-ci-gates.md` |
| ADR | `docs/adr/0040-multi-layer-test-gate.md` | PR-T1 stub，PR-T3 amend |

主 plan 跟随 PR-T1 ship，不单独提 PR（避免 4 个 PR 串行）。

### 边界裁定（什么由 master 锁、什么留 sub-plan）

**Master 锁定**（sub-plan 不得改）：
- 3 阶段顺序 + 内容边界（机制 / 策略 / 门禁）
- Sub-plan 之间的接口契约（上面 § 跨阶段契约 部分）
- ADR-0040 单 ADR 跨阶段，不拆
- 文件命名 + 落点
- Sandbox E2E 终局验收方法

**留给 sub-plan 决策**（master 不锁）：
- Sub-plan 1：`/health` endpoint 加不加 / `state_branches` 字段结构 / `🚨 Testing Invariants` 段具体禁令清单
- Sub-plan 2：mobile `runtime-smoke` 走 static export vs dev server / 是否保留旧 `e2e` target / project tag 详细配 / cache `namedInputs` 哪些 file 纳入 sharedGlobals
- Sub-plan 3：GH Actions 用 official action vs 自写 / lefthook anti-mock 正则精度 / PR template 复选框具体措辞 / branch ruleset required checks 名单

## Out of Scope（整体不做）

- 现有 server `apps/server/test/integration/*.e2e.spec.ts` 8 个 e2e 不重写（保留独立 `test:integration` target 路径）
- 不替换 Playwright / Testcontainers / Vitest 框架
- 不修复原 review tech stack plan 残留的 PR-6 (lefthook gitleaks / check-env-sync / seed / JWT / refresh / secrets) / PR-7 (ADR-0026 / Catalog v1 / Maestro / PR template)
- 不触碰 spec-kit slash command 自身（只改 templates + schemas）
- 不引入跨进程真 client↔server round-trip 测试（mobile e2e 仍 stub 后端 mock；真 round-trip 是 sub-plan 3 之后单独议题）
- 不做视觉回归 baseline（Playwright screenshot 仅故障证据用，不参与 diff gate）

## Sandbox E2E 终局验收（3 PR 全 merge 后）

模拟 Agent 给一个最小 feature ship 一遍，验证体系拦截能力：

1. **Feature**：新增 `GET /api/v1/ping` endpoint，要求 admin-only auth + 返回 `{ pong: true, traceId: <cls> }`
2. **流程**：Agent 走 `/speckit-specify` → `/speckit-plan` → `/speckit-tasks` → `/speckit-implement`
3. **强制点**：
   - `state_branches` 必填（schema 拦） — sub-plan 1 验
   - `🚨 Testing Invariants` 禁止 mock JwtAuthGuard 直接 `new` — sub-plan 3 lefthook 拦
   - `nx affected` 触发 server runtime-smoke + mobile runtime-smoke — sub-plan 2 验
   - PR template 三复选框未勾 → 阻 merge — sub-plan 3 Action 验
4. **逆向测试**（故意写错）：
   - 故意在 spec 漏 `state_branches` → /speckit-specify 拦
   - 故意在 ping.guard.spec.ts 写 `new JwtAuthGuard()` 不 `createTestingModule` → lefthook 拦
   - 故意改 server endpoint 但不 regenerate api-client → nx affected 触发 mobile e2e RED
   - 故意 PR 描述留 unchecked → CI Action RED
5. **通过门槛**：4 类逆向至少 3 类被对应 gate 拦住（≥75% 拦截率）

## Verification（master plan 自身）

- ☐ 3 sub-plans 各自完成 `/plan` 会话 + Accepted（user 在每个 sub-plan 单独 ExitPlanMode 批准）
- ☐ 3 PR 依次 merge（顺序 T1 → T2 → T3）
- ☐ ADR-0040 在 PR-T1 stub Proposed、PR-T3 amend Accepted
- ☐ Sandbox E2E 终局验收 ≥ 3/4 gate 拦截
- ☐ 本主 plan + 3 sub-plans 全部 `git mv` 到 `docs/plans/2026-05/` 约定路径

## Risk + Rollback

| 风险 | 缓解 |
|---|---|
| P1 `state_branches` schema 升级时撞现有 spec drift | P1 schema 字段先 optional；P3 阶段才转 required + 同步 backfill spec 001/002 |
| P2 nx.json cache `sharedGlobals` 过宽导致整仓 cache 雪崩 | P2 sub-plan 内单独验证 cache 命中率 metric；过宽时回退到 per-project namedInputs |
| P3 lefthook anti-mock 正则误伤合法用法（如 `new SomeError()`） | P3 sub-plan 内提前 dry-run 整仓现有 spec 文件、零误报后才 ship |
| 3 PR 之间 main drift 累积导致 PR-T3 大量 conflict | 每 PR merge 后下一 sub-plan 起手强制 `git rebase main` |
| 子 plan 设计阶段发现 master 锁定边界不合理 | 允许子 plan 通过修改本主 plan「跨阶段决策」段反推（不允许默默偏离） |

## On Ship 备注

本 plan 当前在 plan-mode scratch 路径。**PR-T1 ship 时**同 PR 内 `git mv`：

```
docs/plans/pr-5-05-21-review-tech-stack-post-a002-declarative-creek.md
  → docs/plans/2026-05/05-22-test-infra-master.md
```

子 plan 各自 PR 内同样按 [docs-organization](../conventions/docs-organization.md) 约定 `git mv`。

