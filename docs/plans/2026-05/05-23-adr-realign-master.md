# Master Plan: ADR 基线重对齐 + meta 包袱清理

> **统领 2 个独立子 plan**：Phase 1「ADR 自检 / 自洽 / 去包袱」→ Phase 2「以干净 ADR 指导的代码 drift 重构」。本文件**不下钻子 plan 内部**，只锁处置策略、drift 方向分类法、跨阶段契约、跨切主题、终局验收。

## Context

mono 仓从 Java/Spring 三仓推倒重来为 NestJS + Fastify + Prisma + Nx 单仓（per memory `project_plan_pivot_nestjs_mono`）。`docs/adr/` 现有 24 篇 ADR（0018–0042，0021 历史空缺），其中 0026 起的治理类（0026–0042）是 2026-05-21~23 三天内一条条新建的，且大量正文是从 meta 仓迁移而来。

2026-05-23 对全部 24 篇 ADR 做了**逐项 vs 真实代码/配置**的实证审计（5 路 subagent，每条 finding 带 grep/find 命令级证据）。结论与直觉相反：

1. **drift 方向以「ADR 错、代码对」为主**（约 80%）。治理 ADR 写得比代码落定快，加上 meta 迁移带入的旧文件名/包名/Java 风类名，导致 ADR 正文 anchor 大面积 stale；代码反而是当前正确状态。
2. **少数「代码缺、ADR 要求的」**（主要是 0033/0034 强制的 `// CROSS-CONTEXT-*` 注释，全仓 0 实例）才是真正需要动代码的。
3. **meta 包袱实证**：6 篇 ADR（0018/0019/0020/0022/0026/0042）引用了 mono 根本不存在的旧 meta ADR（`ADR-0001/0002/0003/0006/0008/0011/0012`，mono 从 0018 起编号）；README 索引只覆盖到 0039（缺 0040–0042）且 `status` 列与实际 frontmatter 大面积不符。

**目标**：把 ADR 基线重对齐到「干净、自洽、与代码一致」，删除 meta 迁移带来的不必要历史负担，**轻装上阵**，保留 mono 完整稳定的基础技术架构 / 方案 / 决策。

**重要校准（写入 master 防止误解）**：审计**未发现整篇无价值的 ADR**——24 篇都编码真实决策。可删的"包袱"集中在**文件内陈旧内容**（悬空 meta 引用、stale anchor、过时 README 索引、不可变仪式负担），而非整文件。`DELETE` 整篇的口子在 P1 triage 表保留，待 owner 点名。

## 处置策略（master 锁定 · owner 已选「务实重置」）

2026-05-23 owner 决策：当前整套 ADR 视为**尚未冻结的基线**（pre-1.0 greenfield post-meta-pivot；且治理 ADR-0031 本身仍是 `Proposed`）。据此：

1. **Proposed 草稿 + Accepted 里的 meta 导入错误 / anchor typo / 版本陈旧** → **in-place 直接改**，不走 supersede 仪式。
2. **真正无价值的整篇 ADR** → **直接删**（审计当前无候选；口子保留）。
3. **唯一的真决策变更**（ADR-0020 hexagonal 四层 → 被 ADR-0032 bounded-context 取代）→ **保留 `Superseded` 标记当历史**，不删（删了会丢"代码为何长这样"的 rationale）。
4. **修订治理本身**：把 `docs/adr/README.md` L3「每条 ADR 是不可变的」与 ADR-0031 的不可变语义，改为分层规则——
   - `Proposed` → 自由 in-place 改 / 删；
   - `Accepted` → 原则上 supersede-not-delete，但 **meta 导入纠错 / anchor typo / 版本号更新 / 路径名更正** 这类「不改变决策本身」的修订**豁免**，允许 in-place。
   - 这条修订本身在 P1 的治理 PR 内落地，使后续 in-place 改不再与自家规则冲突。

> 这条策略覆盖 P1 全程（P2 已退役，见下「子 plan 拆分」决策更新）。

## 子 plan 拆分

| Phase | Sub-plan 文件 | 阶段名 | 性质 | 核心交付 |
|---|---|---|---|---|
| 1 | `docs/plans/2026-05/05-23-adr-realign-p1-adr-self-consistency.md` | ADR 自检 / 自洽 / 去包袱 | 文档本体（重头） | 24 篇 ADR vs 代码/彼此/frontmatter 全对齐 + 悬空 meta 引用清除 + README 索引重生 + 治理规则修订 + CROSS-CONTEXT 全生命周期软化 + app.json 微调并入 |
| ~~2~~ | `docs/plans/2026-05/05-23-adr-realign-p2-code-drift-refactor.md` | ~~干净 ADR 指导的代码重构~~ | **已退役（tombstone）** | **`[Hinge 选型降级 → P2 无实质内容，已并入 P1 统一交付]`**（见下「决策更新」） |

> **决策更新（2026-05-24）**：CROSS-CONTEXT hinge 裁决 = **全生命周期软化为 SHOULD，本次不补代码注释**（先退后进：Stage A 软化 / Stage B Plan 2 锚 Golden Samples / Stage C Post-Plan-2 上 `ts-morph` 扫描器恢复 MUST）。连锁后果：P2 唯一残留 micro 项（app.json）并入 P1，**P2 子 plan 退役**。整个 effort 坍缩为单 Phase（P1 改文档）。

P1 子 plan **独立 `/plan` 会话设计、独立 PR、独立验收**。本主 plan 不下钻细节决策。

## drift 方向分类法（master 锁定 · P1 给每条打标 → 决定改 ADR 还是改代码）

P1 triage 表对每条 drift 必打方向标，区分"改 ADR"与"改代码"（后者经 hinge 软化后当前为空）：

| 标 | 含义 | 归属 |
|---|---|---|
| `ADR-stale` | ADR 正文/anchor 错，代码才是对的 | **P1 改 ADR 即闭环，不动代码** |
| `status` | ADR `status` 值与现实生命周期不符（如已 ship 仍 Proposed） | **P1 改 frontmatter** |
| `index` | README 索引与 frontmatter 脱节 | **P1 重生索引** |
| `code-gap` | 代码缺失/违反一个**仍保留**的决策 | ~~P2 改代码~~ —— hinge 软化后**当前 0 项**（唯一候选 CROSS-CONTEXT 已降级为 SHOULD，留待 Plan 2 Stage B/C） |
| `OK` | 验证一致，无动作 | — |

## 跨阶段契约（P2 退役后简化）

原 P1→P2 契约因 hinge 裁决软化、P2 退役而**失效**——effort 现为单 Phase（P1 自包含）。仅保留一条向未来生效的原则：

- **代码追 ADR，不反向偷改 ADR**：若 Plan 2 Stage B/C 复活跨 context 注释工作（届时另起新 plan），改代码走完整 TDD（per `docs/conventions/sdd.md` /implement 闭环）；若发现某项该改 ADR，回 docs PR 改 ADR，不在代码 PR 里偷改 ADR。
- P1 自身仍守纪律：默认「代码是真相源」仅对**已验证为正确实现**的代码成立；对"代码实现错了"的不在 P1 改 ADR 迁就（但本轮审计未发现此类，故 P1 全为改 ADR）。

## 跨切主题（master 视角，P1 内具体落地）

1. **meta 悬空引用**：`ADR-0001..0017` 引用散落 6 篇（0018/0019/0020/0022/0026/0042）。每条需判定：(a) 该决策已迁入某 mono ADR → 改引用号；(b) meta 决策未迁/无关 → 删引用 + 把仍有价值的 rationale inline。判定时查 meta git 史 + 最近几天的 plan。
2. **status 值错位**：0030/0031/0035 等已 ship 仍标 `Proposed`；README 索引 status 列整体过时。统一从「代码/CI 是否已 ship」反推正确 status。
3. **README 索引漂移**：缺 0040–0042 + status 列错。重生索引并加机械防护（lefthook/CI 校验 index == frontmatter），避免再漂移（per memory `feedback_hook_before_claude_md`：能机械执行的规则进 hook）。
4. **`packages/shared-types` 旧名**：0018/0042 残留，实际只有 `api-client + types`。全 ADR grep sweep。
5. **`CROSS-CONTEXT-*` 强制注释名存实亡 → 已裁决软化（2026-05-24）**：0033/0034 列为"强制"但 0 实例。hinge 裁决 = 降级为 SHOULD，须在 **4 处**同步软化（ADR-0033 + ADR-0034 + `server-bounded-context-catalog.md` SoT + `.claude/rules/server-bounded-context-decision.md`），缺一处即制造新 ADR↔convention 矛盾。0034 追加 Evolutionary Path（Stage A/B/C），收网器从已废 O3(hexagonal ESLint) 解耦为独立 `ts-morph` 探针。落地见 P1 PR-7。

## 关联工作：ADR-0043 扁平范式 + 重构 plan（2026-05-24）

本 realign 进行中 owner 拍板了一条**新正向架构范式**（post-Hexagonal），衍生两条独立但耦合的工作：

1. **[ADR-0043](../../adr/0043-server-flat-module-paradigm.md)**（扁平模块 + 贫血数据 + 纯函数 Helper + UseCase 跨界 + port 三分法）—— keystone，定义「正确」。
2. **[重构 plan](05-24-server-flat-paradigm-refactor.md)**（R-1~R-6 跨模块代码迁移）。

**sequencing 纪律**：ADR-0043 先 land → realign-P1 的 0019/0033/0041 修订对齐 0043 方向（不是迁就 stale 代码）→ 重构 plan 执行代码迁移。realign-P1 triage 表 0019/0033/0041 行已注此联动。

## 终局验收（整个 master 完成判据）

1. `pnpm tsx scripts/check-adr-frontmatters.ts` 全绿（schema 合规）。
2. README 索引行数 == `ls docs/adr/00*.md` 篇数，且每行 status == 对应文件 frontmatter（机械校验通过）。
3. `grep -rE 'ADR-00(0[1-9]|1[0-7])\b' docs/adr/` 0 命中（无悬空 meta 引用）。
4. P1 triage 表每篇 `处置` 列均 ship；CROSS-CONTEXT 已在 4 处同步软化为 SHOULD + 0034 含 Stage A/B/C 演进路径；app.json 微调（PR-8）闭环。`code-gap` 当前 0 项（P2 退役）。
5. 抽查若干被修的 anchor（如 0018 orval、0023 spec 文件名、0032 真实文件名）grep 能命中，0020 `Superseded` 链指向 0032 可点击。

## 风险 / 回滚

- **风险：in-place 改 Accepted ADR 丢历史**。缓解：务实重置策略下仅对「非决策变更」in-place；唯一真决策变更（0020）保留 Superseded。所有改动走 git，可 `git revert`。
- **风险：P1 把某条 drift 方向判错（该改代码的当成改了 ADR）**。缓解：方向标在 PR review 时必复核「是改 ADR 迁就代码、还是改代码迁就 ADR」；默认「代码是真相源」仅适用于**已验证为正确实现**的代码，对"代码本身实现错了"的需另起代码 plan（本轮审计未发现此类）。
- **回滚**：P1 各 sub-PR 独立、可单独 revert，互不影响。
