# 历史 Plan 状态追进（2026-05-24）

> **目的**：盘点 `docs/plans/` 内全部历史计划的真实完成状态，把**未完成的逐个过一遍**（原目标 / 已落地 / 剩余 / 建议处置），作为后续优先级决策的依据。
> **方法**：读每篇 doc 自述 → 用 `git log` PR 号 + `specs/` / `apps/server/src/` 实际产物交叉验真，不轻信 doc 自述。
> **范围**：34 个 plan（含本日晚新增并 ship 的 `05-24-speckit-preset-orchestrator-adr0043`；排除当前在做的 `05-24-client-deploy-*` master + p1-cloudflare-web）。

## 一览（按完成度分桶）

| 桶 | 数量 | 含义 | 是否需动作 |
|---|---|---|---|
| 🔴 真正待续 | 1 | 有大量未起手业务 | 是（待你给约束） |
| 🟡 有意延后 | 3 | 触发条件未到 / 被优先级挤后 | 暂不动 |
| ⚪ 已退役 / 吸收 / 参考档 | 3 | 正式关闭，无执行剩余 | 否 |
| 🟢 已 ship 缺收口 | 3 | 实质完成，仅缺闭合 / 对账文档 | 可选（文档级） |
| ✅ 已完整 ship | 20 | 核实通过 | 否 |

下面 § A-§ D 逐个过未完成项；§ E 列已闭合项备查。

---

## § A 真正待续 🔴

### A-1 account-migration master（原 `05-19-plan2-plan3-migration-deploy.md`，2026-05-25 重组为 [master](05-25-account-migration-master.md) + p1/p2/p3）— Plan 2 业务迁移

- **原目标（Done condition）**：mbw-account 后端 **16 use case** 全部 NestJS + Prisma 重写到 `apps/server/`，mobile per-feature 同步，`pnpm nx affected` 全绿。
- **已落地**：仅 **feature 批 A**（`002-account-profile`：GetAccountProfile + UpdateDisplayName）。
- **验真**：`specs/` 仅 `001-phone-sms-auth`（实为 Plan 1 PoC）+ `002-account-profile`；`apps/server/src/` 业务模块仅 `auth / account / security`，无其他业务。
- **完成度**：约 **1/5 feature 批**（A 完成；B/C/D/E 未起手 ≈ 14 use case）。

剩余 4 批（原 plan A-E 表）：

| 批 | feature spec | use case | 复杂度 | 重点 |
|---|---|---|---|---|
| B | `003-tokens` | RefreshToken + LogoutAllSessions | 中 | jose 实装 + 并发续期/全设备登出 |
| C | `004-account-deletion` | 5 个（注销/倒计时/取消/冻结匿名化） | 高 | outbox 真消费方 + 多并发断言 |
| D | `005-device-management` | ListDevices + RevokeDevice | 中 | ip2region geo 集成 |
| E | `006-realname-verification` | 3 个（实名 3 步） | 最高 | split-tx + Aliyun cloudauth |

- **阻塞**：每批起手 `/speckit-specify` **前**有强制人工 gate——需你给 server spec ↔ app spec 的**合并约束**（字段以谁为准 / UI 是否覆盖旧 spec / 错误码 / user-journey 合并）。不给约束不开 specify。
- **建议处置**：**这是唯一有实质业务待续的计划。** 若续，从批 B `003-tokens` 起手，第一步等你给合并约束。注意 scope 倒挂——Plan 3（部署）已先于 Plan 2 完成上线，续 Plan 2 时业务直接落已部署环境。

---

## § B 有意延后 🟡（触发条件未到，非废弃）

### B-1 `05-19-claude-mem-pilot-eval.md` — claude-mem PoC 评估

- **目标**：评估 claude-mem 插件做跨 session 记忆的收益（2 天 A/B + 4 维验收）。
- **状态**：NOT-STARTED。触发条件（Plan 1 收尾 + ADR + 复盘）已满足，但被 Plan 2 业务优先级**有意挤后**；无安装 / `.envrc` / A/B 数据等执行痕迹。
- **建议处置**：保留为 deferred PoC。重启窗口=业务迁移告一段落后，可不重新 plan 直接续。

### B-2 `05-19-claude-mem-w1-openrouter.md` — claude-mem W1 实地执行

- **目标**：B-1 的 W1 子 plan（install → env-gate → 2 天 A/B → killswitch 决策）。
- **状态**：NOT-STARTED，父 plan（B-1）未启则不动。
- **建议处置**：与 B-1 捆绑，同一窗口启动。

### B-3 `05-25-account-migration-p1-toolchain-ralph-loop.md`（原 `05-19-plan2-model-routing-ralph-loop.md`）— 模型路由 + orchestrator 2b

- **目标**：spec-kit preset 定制 + implement 阶段 halt-log + orchestrator 2b（`scripts/orchestrator/run-implement.ts` 接管 halt-retry）。
- **状态**：触发条件未满足。2b 设计为"halt-log ≥ 3 同形态 OR ≥ 1 unrecoverable"才写；因 Plan 2 只跑了批 A，门槛从未达到，`run-implement.ts` 未建、`.specify/implement-halts.log` 未初始化。
- **关键判断**：**与 Plan 2 强耦合**，不是独立废弃——Plan 2 续跑、halt 累积到门槛时它才自然激活。
- **建议处置**：随 Plan 2 续跑联动，不单独追。

---

## § C 已退役 / 吸收 / 参考档 ⚪（正式关闭，无执行剩余）

| Plan | 状态 | 说明 | 建议 |
|---|---|---|---|
| `05-23-adr-realign-p2-code-drift-refactor.md` | RETIRED | 2026-05-24 正式退役；hinge 软化后 P2 scope 归零，唯一执行项（app.json bump）并入 P1 PR #156 | 无需动作 |
| `05-19-plan3-pre-plan-inventory.md` | **DELETED (2026-05-25)** | 16 use case 清单 + 风险 + 6 ambiguous decision **已吸收进 `05-25-account-migration-p2-usecase-dependency.md` § 4 / § 6**;快照部分大面积 drift(大重构 ADR-0030/0032/0043 后),价值内联刷新后删除 | 已删除 |
| `05-20-spec-kit-template-review.md` | 大体被吸收 | `spec.zod state_branches` 等设计项已随 test-infra（#80-82）落地；剩余无独立价值 | 无需动作 |

---

## § D 已 ship 缺收口 🟢（实质完成，仅缺闭合 / 对账文档）

> 这几项的代码 / 配置都已落地，只是当初的"统领 / 闭合"承诺没在文档上对齐。属文档级尾巴，非功能缺失。

### D-1 `05-22-server-bounded-context-governance.md`

- **实情**：Part A（PR #72 拆分）+ carry-over O1-O4 已分散随 #87/#90/#93 落地。
- **尾巴**：缺一份统一"基线已稳"的闭合记录；per-feature governance checklist 仍是软约束。
- **建议**：补一段 closure 备注（或确认软约束即可），非阻塞。

### D-2 `05-23-adr-realign-master.md`

- **实情**：P1 已 ship（#149-156）；P2 已正式退役（见 C 桶）。
- **尾巴**：master 正文未注明"P2 已 RETIRED（2026-05-24）"，目前该决策只在 P2 tombstone 里。
- **建议**：master 加一行 P2 退役注记，使 master ↔ 子 plan 状态对齐。

### D-3 `05-21-review-tech-stack-post-a002.md`

- **实情**：PR-1 ~ PR-5 干净 ship（#69-79）。
- **尾巴**：PR-6（Data/Security/Perf infra）+ PR-7（ADR-0026 stub / Catalog / Maestro）的条目散落在 #100-103 落地，未作为标号 PR 收口——破坏了原 plan 的 Critical Path 序列契约。
- **建议**：核对 #100-103 是否已覆盖 PR-6/7 全部条目，补一段映射；缺项再补。**此项部分基于 git log 归纳推断，落实前先核 commit。**

---

## § E 已完整 ship ✅（核实通过，备查）

Plan 1 backend-stack-poc · graphify-knowledge-graph · orchestrator-ndjson-stream（#60）· orchestrator-poc-a002（A-002）· pr3-5to2-packages-refactor（#77）· pr5-tail-orval-stabilize（#79）· test-infra master/p1/p2/p3（#80/#81/#82）· meta-config-mono-migration（#94/#96）· mono-meta backend/frontend-gap-audit（#106/#107/#110，B/C 有意延后）· release-please-mono-bootstrap（#109/#111/#114）· adr-realign-p1（#149-156）· claude-config-meta-to-mono master/p1/p2/p3（#118-135）· prod-cutover-meta-to-mono-swas（#144/#145/#147，prod 已上线）· sdd-path-trigger-split（#138/#139）· meta-debt-cleanup-whole-repo（#174/#176）· server-flat-paradigm-refactor（#157-168，ADR-0043 Accepted）· speckit-preset-orchestrator-adr0043（上游 presets#16 + mono #181/#182/#185/#186，2026-05-24 晚新增并 ship；详见下节）

---

## 处置汇总（2026-05-24 决策：D → C → B → A，先简后难）

### 本轮已执行（D 收口 + C/B 标状态）

| 项 | 动作 | 落点文件 |
|---|---|---|
| D-1 governance | 加闭合 Status banner：O1-O4 全 resolved（O1 Outbox trace_id #90 / O2 catalog #93 / O3 **VOID** / O4 ADR-0041 #87），per-feature checklist 毕业为常驻约定 `server-bounded-context-catalog.md` | `05-22-server-bounded-context-governance.md` |
| D-2 adr-realign-master | 开篇 tagline 补标「P2 已退役」（body L31-85 早已对齐，缺口仅在开篇行） | `05-23-adr-realign-master.md` |
| D-3 review-tech-stack | 加闭合 banner：**PR-6 拆成 #100/#101/#102 按钢钉落地**、**PR-7 = #103**；并标注 PR-6 清单里的 JWT 双 token/refresh usecase 实为 Plan 2 batch B 业务、归 Plan 2 | `05-21-review-tech-stack-post-a002.md` |
| C-1 adr-realign-p2 | 已是 RETIRED（title + status blockquote），无需改 | —（已自带） |
| C-2 plan3-inventory | 加 `> **Status**: archived`(2026-05-25 续:该文件已**删除**,内容吸收进 plan2-plan3 § 2.3/§ 7) | `05-19-plan3-pre-plan-inventory.md`(已删除) |
| C-3 spec-kit-template-review | stale `DRAFT v1` → `SUPERSEDED`（被 test-infra #80-82 吸收） | `05-20-spec-kit-template-review.md` |
| B-1 / B-2 / B-3 | 各加 `处置: deferred` 行（claude-mem ×2 等窗口 / model-routing 耦合 Plan 2 自然激活） | 三个 `05-19-*` plan |

**校正**：原审计把 D-2 / D-3 列为「半成」偏重——D-2 实为 body 已对齐仅缺开篇 tagline；D-3 的 PR-6/PR-7 其实已全落地（#100-103），只是从未在 plan 内映射。两者均为纯文档对账，无功能缺失。

### 待办

- **A-1 续 Plan 2**（唯一 live 业务）— 从批 B `003-tokens` 起手，**等你给 server ↔ app spec 合并约束**后再 `/speckit-specify`。

> 上述「本轮」8 处编辑 + 本文档已 commit（#179）。

### 后续轮（2026-05-24 晚）：spec-kit preset + orchestrator 对齐 ADR-0043

A-1 暂停期间插入的工具链清债 —— 新计划 `05-24-speckit-preset-orchestrator-adr0043.md`（master + PRESET / MONO 子计划），已全 ship：

| PR | 内容 |
|---|---|
| `michael-speckit-presets#16` | preset `mono-orchestrator-ready` 0.3.1→0.4.0：删 DDD entity 词汇（`aggregate_root`）+ 修扁平 `src/<module>` 路径 + `eslint-plugin-boundaries`(ADR-0032/0043) + 新增 fierce ADR-0043 范式 banner |
| #181 | orchestrator 删 `aggregate_root` + 全仓扫 stale `src/modules`→`src/account` + prompt-assembler 注入静态范式段；历史 `specs/001`+`002` 挂 deprecation banner + 修 002 路径 / ADR-0020 链 |
| #182 | re-install preset 0.4.0 到 mono vendored |
| #185 | `eslint.config.mjs` 注释去 stale hexagonal/ADR-0020；`05-20`+`05-21` 挂 HISTORICAL 布局 banner |
| #186 | `.prettierignore` 修 `verify.sh` 误报的 2 个 cosmetic drift（vendored 文件被 prettier 单引号化） |

净效果：spec-kit preset + orchestrator 从「旧范式默认引力」翻转为「新范式默认引力」，权威面无残留 stale `src/modules` / hexagonal 引用；`verify.sh` 转绿。**A-1 仍暂停**，工具链已就绪。

## confidence 声明

- 🔴 § A-1 Plan 2 为**直接核实**（`specs/` 目录 + server 模块），最高可信。
- 🟢 § D 的 D-1/D-3 部分基于 subagent 对 git log 的归纳；精确定责前需再核 commit。
- ✅ 后续轮（ADR-0043）5 PR 全 merged，**直接核实**（`verify.sh` green + 全仓 grep `src/modules`/hexagonal 权威面 0 残留），最高可信。
