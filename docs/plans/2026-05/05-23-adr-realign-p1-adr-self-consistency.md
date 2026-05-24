# Sub-Plan P1: ADR 自检 / 自洽 / 去包袱

> 隶属 [Master: ADR 基线重对齐](05-23-adr-realign-master.md)。处置策略 = 务实重置（owner 已选）。本 plan 把 24 篇 ADR 对齐到「干净、自洽、与代码一致」，清除 meta 包袱，重生 README 索引，并修订治理规则使 in-place 改不再违规。

## Goal

P1 ship 后：全部 24 篇 ADR ① 自身内部无矛盾 ② 彼此无矛盾 ③ 与当前代码/配置一致 ④ `status` 值正确 ⑤ 0 悬空 meta 引用 ⑥ README 索引与 frontmatter 一致且有机械防护。同时**给每条 drift 打 `方向` 标**（CROSS-CONTEXT hinge 已裁决软化 → `code-gap` 当前为空，见下）。

## 对齐方法（真相源优先级）

每条 drift 修正时，按以下优先级取真相：

1. **实际代码 / 配置**（最高）——`apps/` / 根配置 / `eslint.config.mjs` / `lefthook.yml` / `*.json` 的当前内容。
2. **最近几天的 plan / PR**——冲突时查对齐源，已知相关：`05-22-server-bounded-context-governance.md`、`05-21-pr3-5to2-packages-refactor.md`、`05-22-test-infra-{master,p1,p2,p3}.md`、`05-22-release-please-mono-bootstrap.md`、`05-23-claude-config-*`、PR #131（lock 0026）/#103（PR-7 closure）/#90（0033 outbox）/#93（0034）/#87（0041）/#82（test gate）/#77（PR-3 5→2）。
3. **meta git 史**——仅用于判定悬空 `ADR-0001..0017` 引用原指什么。

> 默认「代码是真相源」仅对**已验证为正确实现**的代码成立。若发现代码本身实现错了（违反一个仍正确的决策），不在 P1 改 ADR 迁就它，而是打 `code-gap` 标另起代码 plan（本轮审计未发现此类）。

## 全量 Triage 表（24 篇 · drift / 处置 / 方向）

> `处置`：FIX=in-place 改正文/anchor；STATUS=改 frontmatter status；INDEX=README 索引；SUPERSEDE=标 Superseded 留史；DELETE=整篇删（待 owner 点名）；NONE=无动作。`方向` 见 master 分类法。

| ADR | status(现→应) | drift 摘要（审计实证） | 处置 | 方向 |
|---|---|---|---|---|
| 0018 backend-pivot | Accepted | OpenAPI codegen `@hey-api`→实际 **orval**；Auth `jose` 从未引入；`Vitest 2`→`^4.1.6`；`packages/shared-types`→`types`；含 `ADR-0001/0003/0006/0008/0011` 悬空引用 | FIX | ADR-stale |
| 0019 orm-prisma | Accepted | 标题 `@nestjs/prisma` 与正文「不依赖」自相矛盾；「PoC 不写 migration」框定已过时（migrations 已存在）；含 `ADR-0008` 悬空。**repository 边界对齐 [ADR-0043](../../adr/0043-server-flat-module-paradigm.md)**：撤 DB repository port 表述，改 PrismaService 直连（**勿**改成 `*.repository.port.ts`——那会被 0043 删） | FIX（对齐 0043） | ADR-stale |
| 0020 module-boundary | Accepted→**Superseded** | 整个 Layer-2 hexagonal 四层 ESLint 决策 PR-4 已退役，被 0032 bounded-context 取代；`auth/domain/{model,policy,port}` 目录树不存在；含 `ADR-0001/0008` 悬空 | SUPERSEDE（标 Superseded + link 0032，留史） | ADR-stale |
| 0022 throttler | Accepted | 「3 throttler」→实际 **5**；「`new Redis()` 独立连接」整套 trade-off 叙事建立在已不存在的代码上（实际 `ThrottlerStorageRedisService(cfg.url)`）；「唯一限流端点 / `@Throttle` 缺位」→ `/me` 端点 + decorator 已存在；含 `ADR-0011` 悬空 | FIX（叙事重写） | ADR-stale |
| 0023 sms-hmac | Accepted | `ConfigService.getOrThrow`→实际 Zod `authConfig.KEY`；`SingleEndpointEnumerationDefenseIT` 类→实际 `timing-defense.p95.it.spec.ts`（meta Java 风遗留） | FIX | ADR-stale |
| 0024 spec-layout | Accepted | clean（frontmatter 实有 5 字段 vs 文中"必填三字段"，additive 非矛盾，可顺手补注） | NONE/微 FIX | OK |
| 0025 cf-pages | Accepted | nx target `export-web` / `--configuration=web`→实际 `build`(`expo export -p web`)；CF/CORS 缺失是正确 defer，非 drift | FIX | ADR-stale |
| 0026 deployment | Accepted | D4 secrets「volume mount `.env.production`」→实际 `--env-file` CLI；`infrastructure/docker-compose.yml` stub 与 tight compose 分歧需澄清哪个权威；含 `ADR-0002/0012` 悬空 | FIX | ADR-stale |
| 0027 fe-data-test | Accepted | 「api-client `.gitignore` 忽略 codegen」→无 `.gitignore`，`src/generated/` 已提交 | FIX | ADR-stale |
| 0028 pnpm-policy | **Proposed→Accepted** | `.npmrc` 决策块列 5 指令→实际只有 `shamefully-hoist=true`；phantom-dep 兜底 `eslint-plugin-import no-extraneous`→实际 `@nx/enforce-module-boundaries`；已 ship | FIX + STATUS | ADR-stale + status |
| 0029 ts-module-res | Accepted | 历史步骤引 nonexistent target `mobile:bundle:web`→`build` | FIX | ADR-stale |
| 0030 package-decomp | **Proposed→Accepted** | 内容 clean，但 PR-3 已 ship 5→2 | STATUS | status |
| 0031 adr-governance | **Proposed→Accepted** | 治理已 ship（lefthook gate + script）；schema 路径 `.specify/schemas/adr.zod.ts`→实际 `.../adr-governance/adr.zod.ts`；**本篇承载务实重置策略落地 + README 不可变声明修订** | FIX + STATUS | status + governance |
| 0032 bounded-context | Accepted | Decision 文件树命名多个 never-landed 文件：`Account.ts`→`account.aggregate.ts`、`account.controller.ts`→`account-profile.controller.ts`、`SmsCode.ts`→`sms-code.vo.ts`；`auto-create.service.ts`/`token-issuer/revocation.service.ts`/`jwt.strategy.ts` 不存在；`refresh-token.usecase.ts` 未实装（标 future）。**已 done early**：追加「架构历史决议对齐」永久退役补丁（hexagonal 永久退役 + 作废 governance plan O3 carry-over） | FIX | ADR-stale |
| 0033 outbox | Accepted | L32「强制层」+ L37「显式注释」需随 0034 软化为建议；旗舰示例 `account.autoCreate-or-get`（L37）实际 inline `tx.account.create`，标示意。**outbox 物理位置 `auth/`→`security/outbox/` 对齐 [ADR-0043](../../adr/0043-server-flat-module-paradigm.md)**（实际迁移在重构 plan R-1） | FIX（软化 + 示例 + 位置注） | ADR-stale |
| 0034 op-catalog | Accepted | 强制 `CROSS-CONTEXT-(SYNC\|ASYNC)` 注释 0 实例。**hinge 已裁决（2026-05-24）= 全生命周期软化为 SHOULD**：R2/R3 表降级 + Consequences 软化 + 追加 Stage A/B/C 演进路径（解耦已废 O3） | FIX（软化 + Evolutionary Path） | ADR-stale |
| 0035 data-layer | **Proposed→Accepted** | 全 Decision 已 ship（lefthook gates + `db:migrate` wrapper + seeds）；`git add generated/prisma` 步骤被 gitignore 方案取代 | FIX + STATUS | ADR-stale + status |
| 0036 observability | Accepted | censor `[PII_REDACTED]`→实际 `[REDACTED]`；§2 手写 `src/security/cls.middleware.ts`+`AsyncLocalStorage` 从未存在（实际第三方 `nestjs-cls`）；声称的 redact-verify smoke test 未找到 | FIX | ADR-stale |
| 0037 security-creds | Proposed（保持） | 核心 JWT 双 token 决策未实装（Proposed 正确，**不进本 effort**——属 net-new feature）；但 `.gitleaks.toml` 「配 AWS/GCP/.. 自定义规则」→实际仅 `useDefault+allowlist`；`core/config/config.module.ts` 路径错 + 无 `/run/secrets` reader | FIX（仅修已 ship 基建的失实声明） | ADR-stale |
| 0038 error-ux | Accepted | `core/api/problem-guards.ts`→实际 `core/api/errors.ts`；`core/i18n/errors.ts`→同上；error code `AUTH_LOCKED`→实际 `AUTH_ATTEMPT_LOCKED`/`ACCOUNT_IN_FREEZE_PERIOD` | FIX | ADR-stale |
| 0039 perf-latency | Proposed（待定） | cron `0 19`→`0 20`；`server:test:perf`→`server:test`；`orchestrator/scripts/plan-compiler.ts`→`scripts/orchestrator/plan-compiler.ts`；部分已 ship，status 待定 Accepted/Proposed | FIX +（STATUS?） | ADR-stale + status |
| 0040 test-gate | Accepted | References footer preset `0.2.2`/`0.3.0`→实际 `0.3.1`（建议改成 version-agnostic 表述免再漂） | FIX（minor） | ADR-stale |
| 0041 server-common | Accepted | 全 clean（`src/common/` 不存在符合决策；security/ 5 个非 JWT 成员核对一致）。注：[ADR-0043](../../adr/0043-server-flat-module-paradigm.md) 把 outbox 迁入 security 会触发其 `>7` sunset → 按 0041 自身预设「拆 security/ 子目录」用 `security/outbox/` 应对（**非 drift，仍不引入 common/**） | NONE（仅记联动） | OK |
| 0042 release-strategy | Accepted | `packages/shared-types`→`types`；postmortem 未提 `apps/mobile/app.json` 仍 `0.0.0`（package.json/manifest 已 0.0.1）；含 `ADR-0003` 悬空 | FIX | ADR-stale +（app.json→并入 PR-8） |

### 整篇 DELETE 候选

审计当前 **0 篇**整体无价值。口子保留：owner 若认定某篇整篇无价值，在此点名，P1 删除并从 README 索引剔除。

## 跨切清理任务（不绑单篇 ADR）

1. **悬空 meta 引用 sweep**：`ADR-0001..0017` 引用散落 0018/0019/0020/0022/0026/0042。逐条判 (a) 改成 mono ADR 号 / (b) 删引用 + inline 仍有价值的 rationale。
2. **README 索引重生 + 机械防护**：补 0040–0042 行；status 列从各文件 frontmatter 反推重写；加一个校验（lefthook hook 或扩 `check-adr-frontmatters.ts`）确保 index 行数与 status == 实际文件，防再漂。
3. **`packages/shared-types`→`types` 全 ADR sweep**：`grep -rn 'shared-types' docs/adr/` 清零。
4. **务实重置策略落地**：改 `docs/adr/README.md` L3 不可变声明为分层规则（Proposed 自由改 / Accepted supersede-not-delete + meta 纠错豁免 in-place）；ADR-0031 正文同步该语义。

## Sub-PR 拆分（每条 step → verify · 顺序可调）

> 全部走 `docs/<slug>` 分支（per git-workflow）。docs-only，commit 前跑 markdownlint preflight（per memory `feedback_markdownlint_preflight`）。

1. **PR-1 治理与索引地基**：改 README L3 + ADR-0031 务实重置语义 → 重生 README 索引（补 0040-42 + status 反推）→ 加 index↔frontmatter 机械校验。
   - verify：`check-adr-frontmatters.ts` 绿 + 新校验脚本对当前 24 篇绿 + README status 列逐篇 == frontmatter。
2. **PR-2 status 值校正**：0028/0030/0031/0035 → Accepted；0039 决定 Accepted/Proposed（查 nightly-perf 是否算 ship）。
   - verify：4-5 篇 frontmatter status 改对 + README 索引随动一致。
3. **PR-3 悬空 meta 引用清除**：sweep 0018/0019/0020/0022/0026/0042 的 `ADR-0001..0017`。
   - verify：`grep -rE 'ADR-00(0[1-9]|1[0-7])\b' docs/adr/` 0 命中。
4. **PR-4 anchor / 命名 stale 批修**（轻改正文）：0018（orval/jose/vitest/shared-types）、0019（标题+port+PoC框定）、0023（config+类名）、0025（target）、0029（target）、0038（路径+error code）、0042（shared-types+app.json 注）、0040（preset 版本去硬编码）。
   - verify：抽查改后 anchor `grep` 能命中真实文件（orval.config.ts / timing-defense.p95.it.spec.ts / errors.ts / AUTH_ATTEMPT_LOCKED）。
5. **PR-5 叙事重写**（正文逻辑建立在已不存在代码上）：0022（throttler 5 个 + storage 真相）、0036（nestjs-cls + `[REDACTED]`）、0028（.npmrc Decision 块重写）、0026（secrets `--env-file` + 澄清权威 compose）、0027（.gitignore 失实）、0037（gitleaks/config 路径失实）、0035（git add 步骤）。
   - verify：每篇改后 Decision/Validation 段 grep 对应代码/配置一致。
6. **PR-6 决策变更 supersede**：0020 标 Superseded + link 0032；0032 文件树替换为真实 landed 文件名 + refresh-token 标 future。**0032「架构历史决议对齐」永久退役补丁已 done early**（hexagonal 永久退役 + 作废 plan O3，owner 2026-05-24 裁决）。
   - verify：0020 frontmatter `status: Superseded` + 正文顶链接 0032；0032 文件树每个文件名 `ls` 命中（`account.aggregate.ts` / `account-profile.controller.ts` / `sms-code.vo.ts`）；0032 含 `## 架构历史决议对齐` 段。
7. **PR-7 CROSS-CONTEXT 全生命周期软化**（hinge 已裁决 = 降级为建议，见下节）。本 PR 对 **4 处**地毯式同步软化，缺一处即制造新 ADR↔convention 矛盾。（注：ADR-0034 L51 的 **O3 解耦已 done early**（2026-05-24），本 PR 在此基础上续做软化措辞 + 补 Evolutionary Path。）
   - **ADR-0033**：L32「强制层 → ADR-0034」改「演进层（详见 ADR-0034）」；L37 改「允许跨 context 调用，但**强烈建议**显式写 `// CROSS-CONTEXT-*` 注释以利影响面分析，当前阶段不做 CI 刚性卡点」。
   - **`server-bounded-context-catalog.md`**（SoT）：L36/L53「必加注释」→「**Should（建议）**级别，沉淀模式，人工 CR 抽检；达收网里程碑后经自动化脚本升级为 Must」；决策树 Q5/Q6/Q7 + L120 闭环 check 同步降级措辞；顺手把 `account.autoCreate-or-get`（L98）标 `// 示意伪代码，真实落地为 inline tx.account.create`。
   - **`.claude/rules/server-bounded-context-decision.md`**（agent 自动加载）：L25「## 强制注释（PR review 拒缺失）」→「## 跨上下文注释引导（PR Review 建议项）」+「触及跨 context 调用时请尽量按规范写注释；当前主干无刚性 CI 拦截，旨在为后续自动化门禁沉淀样本」。抹除「拒缺失」。
   - **ADR-0034**：R2/R3 表加「渐进式强制定位」+「建议添加」；Consequences 把「未来上 lint rule」改为明确演进计划；References 上方追加 **`## 落地演进路径 (Evolutionary Path)`**：Stage A（M1.1 现在 → SHOULD，靠 Nx 标签电网卡物理边界）/ Stage B（Plan 2 首个跨域 feature → 人类/AI 手写 3 个 Golden Samples）/ Stage C（Post-Plan-2 → 上线**独立 `ts-morph` 注释扫描器，从已废弃的 Hexagonal Layer ESLint(O3) 完全解耦**，挂 lefthook，status 翻 `Enforced via CI`，恢复 MUST）。
   - verify：4 处 grep 均无残留「强制/必加/拒缺失」措辞（`grep -rnE '强制注释|必加注释|拒缺失' docs/adr/0033* docs/adr/0034* docs/conventions/server-bounded-context-catalog.md .claude/rules/server-bounded-context-decision.md` 0 命中）；0034 含 Evolutionary Path 段且 Stage C 不引用 O3 作为活跃前提。

8. **PR-8 app.json 版本 sync（P2 并入项）**：先确认 release-please `expo` type 是否在首次 mobile 发版自动同步 `apps/mobile/app.json` expo.version（查 `release-please-config.json` mobile override + memory `project_*release*`）。会 → 仅在 0042 fix 注明「release-please 自动 reconcile，无需手动」；不会 → 1 行 bump `0.0.0`→`0.0.1`。
   - verify：决策记录在案；若手动改则 `grep version apps/mobile/app.json` == manifest（0.0.1）。

## CROSS-CONTEXT hinge — 已裁决（2026-05-24）

owner 决策 = **全生命周期软化为 SHOULD，本次重对齐不往代码补注释**。理由：当前全仓跨 context 高价值实例极少，0 golden sample 下开 CI 刚性拦截会逼 LLM 因无模仿对象而注水幻觉。采「先退后进」：

- **现在（PR-7）**：4 处文书同步降级为建议；物理越界仍由 Nx 标签电网（`@nx/enforce-module-boundaries`）硬卡。
- **Plan 2 首个跨域 feature**：人类/AI 手写 3 个 Golden Samples，让全仓长出 Few-shot 肌肉。
- **Post-Plan-2**：上线独立 `ts-morph` 扫描器，恢复 MUST（详见 0034 Evolutionary Path Stage C）。

**连锁后果**：P2 的 CROSS-CONTEXT 代码任务**直接砍**；唯一残留 micro 项（app.json 版本）并入本 P1（PR-8）。**P2 子 plan 正式退役**（见其 tombstone）。

## 验收

1. `pnpm tsx scripts/check-adr-frontmatters.ts` 全绿。
2. README 索引 == frontmatter（机械校验通过）；覆盖 0018–0042 全部。
3. `grep -rE 'ADR-00(0[1-9]|1[0-7])\b' docs/adr/` 0 命中；`grep -rn 'shared-types' docs/adr/` 0 命中。
4. 0020 `Superseded`→0032 链可点；0032 文件树 anchor 全部 `ls` 命中。
5. CROSS-CONTEXT 软化：4 处 `grep -rnE '强制注释|必加注释|拒缺失'` 0 命中；0034 含 Evolutionary Path（Stage A/B/C，Stage C 不挂活跃 O3 前提）。
6. triage 表每篇 `处置` 已 ship；hinge 裁决为软化 → 无 `code-gap` 项遗留至下游（P2 已退役，app.json 微调在 PR-8 闭环）。
