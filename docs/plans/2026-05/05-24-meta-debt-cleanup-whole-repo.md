# Plan: 全仓 meta 历史债清理 — ADR + always-load + 活契约 去包袱

> 单 plan（一条内聚 docs/注释 清理）。**最终落位**：`docs/plans/2026-05/05-24-meta-debt-cleanup-whole-repo.md`（执行起手时 rename，per docs-organization.md）。

## Context

mono 仓从旧 Java/Spring 三仓（meta-repo）推倒重来为 NestJS+TS。`docs/plans/2026-05/05-23-adr-realign-*`（已全 ship）清掉了**显式编号引用** `ADR-0001..0017`，但留下了**散文叙事层**的 meta 历史债——典型如 ADR-0042 L20「Meta 仓时代 release-please 装在 `my-beloved-server` (Maven, v0.3.1)…」、指向旧仓的 GitHub 链接、specs 里的迁移 changelog、"未迁入参考"债务清单等。

**目标（验收北极星）**：**零历史背景的新人能顺读 ADR / 约定 / 活契约**。"关于原先过程的决策统统不要"。owner 锁定处置规则 = **承重才留、其余删**：只有删掉它当前决策就失去动机的 meta 引用才保留，且必须重写成不提旧仓的客观形式（"旧栈 X / 新栈 Y 因为 Z"）；其余一律删。

## 范围分段（全仓扫描后锁定 · owner 已确认两个边界）

全仓 700+ 命中按**性质**分三段，三者处置完全不同：

| 段 | 内容 | 处置 |
|---|---|---|
| **段 1 — 决策/契约文档散文债**（真正清理目标，~80 处） | ADR（10 篇有债 / 15 篇 clean）、conventions/rules/constitution/adr-README、specs/001+002 活契约、`.github` workflow 注释 | **清**：承重才留、其余删 |
| **段 2 — 功能性 artifact**（不是散文，动它有风险） | Prisma migration SQL + 已 drop 的 legacy 表、`docker-compose.tight.yml`/`infrastructure/`/`ops/runbook`/`.github build-image` 里的 `mbw-*` 容器名/db 名/`mbw_xcs/mbw-app` 镜像/`mbw-oss` bucket（**prod 在用**，ADR-0026 drop-in 复用设计）、旧仓资产源绝对路径 | **基本不动**：仅中和承重**源码注释措辞**；功能性命名留 Plan 3 cutover（owner 确认） |
| **段 3 — 历史档案**（带日期的过程记录，~500 命中） | `docs/plans`、`docs/experience`、`specs/**/v1-loc-report.md` 验收证据 | **不动**（owner 确认）：清掉会破坏可追溯性，且非 always-load |

## 处置规则（每处命中按此判，段 1 适用）

1. **指向旧仓的 GitHub 链接 / 绝对路径 / 旧仓名（`my-beloved-server`/`mbw-account`/`no-vain-years-meta`）** → 删。有价值内容降级为纯文字，纯指路直接删。
2. **纯历史叙事**（旧仓怎么做、迁移 LoC trivia、旧版本号、"meta 仓时代…"、"接管 meta-server"） → 删，新人零损失。
3. **Java→TS 对照** → 仅**承重**（删了当前决策失去动机）才留，重写成客观 **"旧栈 X / 新栈 Y 因为 Z"**，文中**不出现 meta/仓名/链接**；不承重则删。
4. **特例 ADR-0018**（backend-pivot）：Java→TS 转向**就是它的主题**，保留技术对照主线（用中性词"旧 Java/Spring 栈"，不留仓名），但仍清掉：迁移 trivia（192 files/5705 LoC）、旧仓代码库名、"旧 meta ADR 映射矩阵"、meta 链接。

## 禁碰清单（硬护栏 — 防误删破坏功能 / 历史）

1. **Prisma migration `*.sql` + `migration_lock.toml`** — 已实证 3 个 applied migration + lock 文件存在；改 SQL 注释触发 Prisma checksum mismatch → 一律不改。
2. **spec frontmatter + `<!-- us-meta / fr-meta -->` HTML 元数据** — spec-kit 编排依赖。
3. **功能性 `mbw-*` 生产命名**（container/db/image/OSS/ACR namespace，散布 `docker-compose.tight.yml`/`infrastructure/`/`ops/runbook/`/`.github/workflows/build-image.yml`）— 段 2，留 Plan 3 cutover。
4. **`docs/plans` + `docs/experience` + `specs/**/v1-loc-report.md`** — 段 3 历史档案 / 验收证据，保留原样。

## Sub-PR（每条 step → verify · 全走 `docs/<slug>` 分支 · commit 前跑 markdownlint preflight per memory）

> PR-1~3 纯 docs（可按 owner 偏好合并为 1 PR）；PR-4 触及源码注释 + workflow，需 CI 绿，独立成 PR。各 PR 独立可 revert。

1. **PR-1 — ADR 散文去 meta**（10 篇有债 ADR，每篇一次改完）
   - 0042：删/重写 release-please meta 叙事（L20 等）；References 段 meta GitHub 链接 → 纯文字。
   - 0022：Bucket4j 历史叙事精简（删"meta Bucket4j 已 ditch""保留 meta Bucket4j——不适用"等不承重项）；Supersedes/References 的 meta GitHub 链接 → 纯文字"旧栈 Bucket4j JCache→Redis 限流方案已被本 ADR 取代"。
   - 0026：清"接管 meta-server"散文 + 指向 meta 部署 ADR 的链接（**保留**功能性 `mbw_xcs`/`mbw-oss` 命名描述 = 段 2）。
   - 0018（特例）：留 Java→TS 正题；清迁移 trivia + 旧仓名 + 旧 ADR 映射矩阵（L67）+ meta 链接。
   - 0019/0020：Java→TS 承重对照重写为客观式，去"详旧 meta 仓 Spring Modulith ADR"链接、去"DDD 思想 0 流失"等仓名措辞。
   - 0024/0031/0033/0039：零星纯历史精简（0031 L81/L87、0024 L117「保留旧路径」说明、0033/0039 顺带项）。
   - **verify**：`grep -rn 'github.com/xiaocaishen-michael/no-vain-years\(-meta\)\?/' docs/adr` 0 命中；`grep -rniE 'my-beloved-server|mbw-account|mbw-pkm' docs/adr` 0 命中；`pnpm tsx scripts/check-adr-frontmatters.ts` + `scripts/checks/check-adr-index.ts` 仍绿；人工通读 0018/0042 顺畅。

2. **PR-2 — always-load 文档去 meta**（conventions + rules + constitution + adr/README）
   - `constitution.md` L65（"从 Java meta-repo 推倒重来…0001-0017 不继承"整段）删/压成一句中性；L40 Nx target 链说明去"meta 时代 preset 失效"措辞。
   - `docs/adr/README.md` L8："meta 导入纠错" → 通用"笔误 / 路径名 / 版本号纠正"。
   - `versioning.md` L52-59：整段"手工里程碑 tag 旧三仓机制已废弃" → 删（旧仓做法 + 已废，新人零损失）。
   - `sdd.md` L84/L40/L3、`business-naming.md`、`.claude/rules/implement-task-closure.md` L30、`api-contract-trigger.md` L28：Java→TS 对照按承重判，去"从 meta 迁入""替代旧 Springdoc"等仓向措辞（保留功能事实如 `@nestjs/swagger` 本身）。
   - **verify**：上述文件 `grep -niE 'meta|my-beloved|Spring|Maven|Modulith'` 残留均为功能性词（如 swagger 说明）或已中性化，无"旧仓怎么做"叙事。

3. **PR-3 — 活契约 specs 去 meta**（specs/001 spec.md+plan.md+tasks.md、specs/002 plan.md）
   - spec.md Change Log：删 2026-05-15 / 2026-05-17 两条 meta-migration 条目；2026-05-19 两条去掉"保留旧路径 / Modulith 老表保留不动"的 meta 论述，只留 mono 现实（路径已是 001、表已是 outbox_event）。
   - spec.md References（L378-386 "未迁入参考"债务清单 + 指向 meta GitHub 的 spec 链接）→ 删，压成一句"相关上游决策待对应 ADR 迁入时补充"。
   - specs/002 plan.md L253-256 旧仓绝对路径 → 中和为"复用既有移动端 auth/ui/design-tokens 架构"（去 `~/Documents/projects/no-vain-years/...`）。
   - plan.md L101/L117-118/L276/L309、tasks.md T039：去"对标 Java mbw-account""Modulith 老表"措辞；V1 LoC 对照**保留为验收口径**但措辞改"前身实现 / 基线"。
   - **禁碰** frontmatter + `<!-- us-meta/fr-meta -->`。
   - **verify**：`grep -rn 'no-vain-years/\|no-vain-years-app' specs/001 specs/002` 0 命中；spec-kit 元数据完好（`grep -c 'us-meta' specs/002/.../spec.md` 不变）。

4. **PR-4 — `.github` + 承重源码注释中和**
   - `.github/workflows`：删纯历史措辞（build-image.yml "Same rationale as meta-server" / "meta-server used pure v0.X.Y"）；功能性资源复用 rationale **保留**但去"meta"字眼（改"既有 ACR namespace"）；deploy.yml "停 meta-server compose→起 mono" 保留（实际部署关键事实，去仓向措辞即可）。
   - `apps/server/src/security/outbox/outbox-publisher.port.ts:8`：注释去"Spring Modulith 老 event_publication" → 中性"legacy event-publication 表已废弃，本 outbox 用独立 `outbox_event` 表"。
   - **禁碰** migration SQL（checksum）+ 功能性 `mbw-*` 命名。
   - **verify**：`git diff --stat apps/server/prisma/migrations` 空（migration 0 改动）；workflow/源码注释无"旧仓怎么做"纯历史措辞；`pnpm nx affected --target=build,test` 绿（注释改动不应破坏，但全包验证 per memory）。

## 终局验收

1. **段 1 清零**（排除段 2/3）：
   `grep -rniE 'my-beloved-server|mbw-account|mbw-pkm|no-vain-years-meta' docs/adr docs/conventions .claude/rules .specify/memory/constitution.md docs/adr/README.md specs/001*/spec.md specs/001*/plan.md specs/001*/tasks.md specs/002*` → **0**（当前 16）。
2. **无旧仓 GitHub 链接**：`grep -rn 'github.com/xiaocaishen-michael/no-vain-years\(-meta\)\?/' docs/adr docs/conventions specs` → 0。
3. **migration 未动**：`git diff --stat apps/server/prisma/migrations` 空。
4. **ADR 结构未坏**：`check-adr-frontmatters.ts` + `check-adr-index.ts` 绿；`nx affected build/test` 绿。
5. **段 2/3 仍有命中 = 预期**（功能性 `mbw-*` + 历史档案 + v1-loc-report），**不算遗漏**——验收 grep 已显式排除这些路径。
6. **人工新人测试**（质性，不可机械化）：通读 0018/0019/0020/0022/0026/0042 + specs/001 spec.md，零历史背景能顺读，无需理解 meta 仓即懂当前决策。

## 非目标

- 不重命名功能性 `mbw-*` 生产资源（容器/db/镜像/OSS/ACR）— 属 Plan 3 cutover，动线上有风险。
- 不改 Prisma migration / lock（checksum）、不改 spec-kit 元数据。
- 不清理 `docs/plans` / `docs/experience` / `v1-loc-report.md` 历史档案。
- 不改任何技术决策本身（纯措辞 / 引用 / 散文层；决策变更走独立 ADR，不在本 effort 偷改）。
- （可选 / 不在本 plan）若想进一步降新人成本，可在 CLAUDE.md "按需 read" 表给历史 plan 加一行角色说明——additive，不碰档案；本次不做。
