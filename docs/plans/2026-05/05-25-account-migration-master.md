# Master Plan:mbw-account 16 use case 业务迁移

> **统领 4 个子 plan**:p1-p3 后端迁移三层(p1 工具链 POC Ralph loop / p2 新范式 + 业务调研 + 依赖顺序 / p3 逐 use case 迁移步骤)+ p4 client UI 链(settings shell A→B→C,**占位待建**)。本文**不下钻子 plan 内部**,只锁主目标 / 跨契约 / 执行顺序。
>
> **主目标**:旧 Java `mbw-account` **16 use case 全部迁移**到 mono(NestJS + Prisma),mobile per-feature 同步,`pnpm nx affected` 全绿。
> **子目标(先行)**:搭 Ralph loop 工具链 POC,支撑迁移自动化(已大体落地,见 p1)。

## Context

Plan 1(NestJS PoC + 4 stack 替换 + ADR-0018/0019/0020/0023/0024)2026-05-18 ship 后,2026-05-19 user 决策 plan2/plan3 scope 互换(业务迁移优先于部署)。当前状态:

| 维度 | 现状 |
|---|---|
| Plan 1(后端栈 PoC) | ✅ ship(`UnifiedPhoneSmsAuth` + 4 stack 替换) |
| **Plan 3(部署上线)** | ✅ **已先行完成**:server 上阿里云(`05-23-prod-cutover-meta-to-mono-swas` #144/#147)、Web 上 CF Pages(`05-24-client-deploy-p1` #177,live `app.xiaocaishen.me`)、mobile EAS/APK(`p2`/`p3` #180,🟡 真机冒烟 pending) |
| **Plan 2(本 master,业务迁移)** | 🟡 **进行中**:批 A `002-account-profile` ✅(#65);剩批 B-E 14 use case 待迁 |

**迁移目标新范式**(大重构后):ADR-0043 扁平贫血 + ADR-0032 bounded context + ADR-0019 Prisma 贫血层 + ADR-0030 包 5→2。**业务调研源**:旧 meta 仓 `~/Documents/projects/no-vain-years/`(meta specs + Java `my-beloved-server/` + 旧 app)仍在。

**为什么拆 4 个子 plan**:后端迁移有三层关注点 —— 工具链(怎么自动化跑)、分析(按什么顺序迁、每个业务做什么)、执行(单 use case 逐步骤),各自独立演进 + 各自 review gate。**p4 是后加的正交维度** —— 前端 client UI 链(settings shell 聚合容器),不在后端 use case 迁移拓扑内(详见下 §「子 plan 4」)。

## 子 plan 拆分

| # | 子 plan | 轨 | 依赖 | 核心交付 | 状态 |
|---|---|---|---|---|---|
| 1 | [`p1-toolchain-ralph-loop`](05-25-account-migration-p1-toolchain-ralph-loop.md) | 工具链(先行) | 无 | 模型路由 + orchestrator + Ralph loop + workflow override | ✅ 大体落地;缺 workflow.yml 2 步 + run-implement.ts(待触发) |
| 2 | [`p2-usecase-dependency`](05-25-account-migration-p2-usecase-dependency.md) | 分析/规划 | 无(可与 p1 并行) | 新范式锚定 + 业务级调研 + 16 uc 依赖关系 + 迁移顺序 | 🟡 依赖/顺序已成;业务卡逐 uc 待展开 |
| 3 | [`p3-usecase-steps`](05-25-account-migration-p3-usecase-steps.md) | 执行 | **p2(顺序)+ p1(工具链)** | 逐 use case 详细迁移过程 + 步骤 | 🟢 **已填充**(2026-05-25 plan 会话:一条引擎 + Step 1 两模式 + Step 4 两形态;本轮全程手动不用 orchestrator) |
| 4 | [`p4-client-ui-shell-chain`](05-25-account-migration-p4-client-ui-shell-chain.md) | client UI(前端,正交后端迁移) | 002 spec A 已 ship;可与批 E 并行 | settings shell(spec B)+ A→B→C 链规划:聚合 003/004/005 延后 client 入口 | 🟢 **已填充**(2026-05-29 plan 会话:分 3 feature B1 壳/B2 设备/B3 注销 + 决策 4 项) |

## 跨契约(master 锁定,子 plan 不得违反)

1. **per-feature SDD 6 步**:每个 use case 走 `/speckit-specify → clarify → plan → tasks → analyze → implement`(per sdd.md),TDD 红绿循环。
2. **server + mobile 同 1 PR**:每个 `NNN-<slug>` feature 的 server impl + api-client regen + mobile 消费 + tasks.md `[X]` flip 同 1 PR(ADR-0024 三位一体)。
3. **⛔ 硬 gate**:每个 feature 起手 `/speckit-specify` **前**,停下等 user 给 server spec ↔ app spec 合并的**具体约束**(字段以谁为准 / UI 是否覆盖旧 spec / 错误码 / user-journey 合并)。**user 不给约束不开 specify**。
4. **新范式落地**:迁移按 ADR-0043 扁平贫血(无分层子目录)+ ADR-0019 Prisma raw row + `@map`(禁 Row→POJO Mapper)+ ADR-0032 bounded context 边界。
5. **共享包 5→2**(ADR-0030):仅 `api-client` + `types` 独立包;`auth`/`ui`/`design-tokens` 内联 `apps/mobile/src/`。
6. **Java IT 作业务断言源,不直搬**:抽业务规则/边界/安全/性能,TS 等价重写(Testcontainers)。
7. **模型路由**:Stage 1 Opus / Stage 2 `/speckit-implement` 切 Sonnet(user 手敲 `/model sonnet`,LLM 无法自切)。

## Sequencing + Dependency Graph

```text
工具链轨(先行,已大体就绪)
  └─ 子 plan 1（Ralph loop 工具链）── 收尾缺口(workflow.yml 2 步 / run-implement.ts 待 halt 触发)
        │
分析轨（可与 p1 并行）                  │ 两轨都是 p3 的前置
  └─ 子 plan 2（依赖 + 顺序 + 业务调研）─┤
        │                              │
        └──────────────┬───────────────┘
                       ▼
执行轨：子 plan 3（逐 use case 迁移步骤）
  循环执行迁移顺序(p2 § 4.4):批 B → 批 C ∥ 批 D ∥ 批 E
                       │
                       ▼
              16 use case 全 ship → Plan 2 graduation
```

**关键**:p1 ∥ p2 可并行(互不依赖);p3 依赖 p2(迁移顺序)+ p1(工具链就绪);实际迁移执行(批 B-E)= p3 步骤 × p1 工具链。批 D/E 在批 B 后可与批 C 并行(p2 § 4.4)。

## 子 plan outline（detail 在各自文件）

### 子 plan 1 — Ralph Loop 工具链

✅ **大体落地**。orchestrator 框架 / ralph-loop / model routing / preset 0.4.0 / graphify 已建并经批 A 实跑;缺 workflow.yml clarify/analyze 2 步 + run-implement.ts(2b,待 halt 数据触发)。详见 [`p1`](05-25-account-migration-p1-toolchain-ralph-loop.md)。

### 子 plan 2 — 新范式 + 业务调研 + 依赖/顺序

🟡 **分析层**。新范式锚定(ADR-0043/0032/0019/0030)+ 老库逐 use case 业务调研(7 维)+ 16 uc 依赖关系/迁移顺序(批 B 下一个、批 C 串行链、批 D/E 可并行)。详见 [`p2`](05-25-account-migration-p2-usecase-dependency.md)。

### 子 plan 3 — 逐 use case 迁移步骤

🟢 **已填充**(2026-05-25)。定义为**一条手动迁移引擎 + 两处分叉**:Step 1 两模式(1a 抽取重写 fresh / 1b de-stale 已有 spec 的 client 段)→ Step 2 plan+tasks(ADR-0043 扁平 + 三位一体同 tasks.md)→ Step 3 analyze → Step 4 impl(server 9 条并发/事务手译注意 + 前端 Strangler-Fig + RHF Golden Sample);Step 4 前端两形态(port 旧 app 成品 / 批 E mockup)。**本轮全程手动,不用 p1 orchestrator**。详见 [`p3`](05-25-account-migration-p3-usecase-steps.md)。

### 子 plan 4 — client UI 链（settings shell）

🟢 **已填充**（2026-05-29 plan 会话；**本段 p4 = 本 master 第 4 子 plan，≠ 下 § Out of Scope 的顶层「Plan 4」mobile build/PKM**）。前端有一条**正交后端迁移**的 client UI 拆分链 A→B→C(源 `002-account-profile` spec 内部),从未被统领规划 —— **spec B(`account-settings-shell`,从 profile ⚙️ 进入的「设置 / 账号与安全」导航栈,落 `(app)/settings/*`、`(tabs)` 之外)** ,而 003(登出)/ 004(注销发起屏)/ 005(登录设备管理屏)三个 feature 的 client 入口**都已 server-ready(#196 / #198 / #201)、都延后挂这个壳**,曾使 settings shell 成隐式累积的前端债。

p4 已定:**分 3 feature** —— B1 `006-account-settings-shell`(壳骨架 + primitives + maskPhone + 登出按钮,解锁 002 ⚙️) / B2 设备管理(amend 005) / B3 注销发起(amend 004);设备先于注销;realname 让号顺延 `007`;范围外项全 disabled 占位。每 feature 起手 `/speckit-specify` **前走跨契约 § 硬 gate**;p4 与批 E(`007` realname server)可并行(前端正交,无共享可变状态)。详见 [`p4`](05-25-account-migration-p4-client-ui-shell-chain.md)。

## Out of Scope（整体不做）

- ❌ 生产部署(Plan 3 已先行完成)
- ❌ mobile IPA/APK build(Plan 4,EAS foundation 已起)
- ❌ 12 个旧 spec 中纯 PKM / wealth 等非 account 模块业务(→ Plan 4+)
- ❌ orchestrator 2b `run-implement.ts` 提前写(数据驱动,halt 门槛未达不写)

## Verification（master plan 自身)

- ☐ 4 子 plan 文件齐全(p4 为占位骨架) + 顶部均回指 master + master 表 4 链接可达
- ☐ p3 在 p2 完成后经独立 `/plan` 会话 + ExitPlanMode 填充
- ☐ Plan 2 graduation:16 use case 全 ship + `pnpm nx affected --target=test,lint,build,typecheck` 全绿 + mobile 登录→5 phase 主流程跑通

## Risk + Rollback

| 风险 | 缓解 |
|---|---|
| 16 use case 工作量超期 | Phase B 完成时若已 4 周 → 与 user review 拆 Plan 2.5(批 D/E 推后) |
| realname split-tx 接口形状卡住 | 批 E `007` spec/plan > 1 周未定 → 暂跳,先 ship 批 B-D（`006` 已让号给 p4 settings shell，per §子 plan 4） |
| spec 合并 gate 阻塞 | 硬 gate 不可绕;user 不给约束则该 feature 暂停,转其他可并行批次 |
| orchestrator 2b 写完体感 worse 于 2a | 收益 < 30% → 回滚 2a manual(详 p1) |

## On Ship 备注

- 本 master + p1(改造)+ p2(重聚焦)+ p3(stub)随同 1 PR ship(`docs/` 分支)。
- p3 具体内容由后续独立 `/plan` 会话填充(p2 完成后,user 给逐 use case 输入)。
- 引用更新:CLAUDE.md / business-naming.md / ADR-0025/0026 等指向本 master 或对应子 plan。
