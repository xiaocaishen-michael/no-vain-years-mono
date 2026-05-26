# Master：p3 精华 → SDD 全流程通用 impl guardrails（沉淀 + command/orchestrator 双流应用）

> **Master plan**：定目标 + 全局不变量 + 子 plan 拆分。统领 [p1](05-26-feature-impl-guardrails-p1-mono-source.md)（mono 单源）/ [p2](05-26-feature-impl-guardrails-p2-preset-templates.md)（preset template 烘焙）/ [p3](05-26-feature-impl-guardrails-p3-dogfood.md)（全流程 dogfood）。仿 [account-migration master](05-25-account-migration-master.md) 的主-子结构。

## 1. 目标（Why）

`05-25-account-migration-p3-usecase-steps.md`「手动迁移引擎」在 003/004/005 沉淀了大量高质量工程约束（Prisma 并发/事务、反枚举/加密、RHF/Strangler、Claude Design mockup、stop-signals），但**绑死 Java→TS 迁移语境**，且部分只活在 agent auto-memory（不持久 / 不团队共享 / 不进 LLM 上下文）。

**目标**：把通用精华 + 成功经验**去 Java 化、沉淀成仓内持久制品**（规则 / 约束 / 规范），并让 SDD **全流程**经**两大应用载体**自动应用：

- **Command 流（手动）**：`/speckit-specify·plan·tasks` 读 template（带精华）+ impl 时 path-triggered `.claude/rules` 自动加载。
- **Orchestrator 流（自动）**：`prompt-assembler` 经既有 `specSection` / `architectureNotesSection` 注入 template 内容。

二者共享同一「template + conventions/rules」底座 → **一次沉淀，双流应用**。

## 2. 全局设计不变量（所有子 plan 遵守）

1. **去重**：只收"尚无单一可复用家"的真新知；已被 constitution / conventions / rules / ADR 覆盖的**只引用不复述**（守单源）。
2. **全流程吸纳，phase-sliced**：spec 收 **WHAT**（要求 / state_branches，**绝不写 HOW**）· plan 收 **HOW**（impl callout）· tasks 收**结构**（per-branch IT）。详版唯一在 conventions，template 只放短提示 + 链接。
3. **三层同步 home，照 ADR-0043 范式**（详版 convention/ADR · template 烘焙 · orchestrator defense-in-depth）。
4. **应用双载体**：command（手动）+ orchestrator（自动）都吃到，靠共享底座。
5. **不 SKILL fork**：经 template/rules 应用，不改 vanilla speckit skills。

## 3. 精华 × SDD 阶段映射（核心可复用制品；phase-sliced 不重复）

| 精华 | spec (WHAT/要求) | plan (HOW/架构 callout) | tasks (任务结构) |
|---|---|---|---|
| 并发/竞态 | race 分支（"N 并发→恰一"）入 `state_branches` | conditional UPDATE affected-count；禁 FOR UPDATE/Serializable 单行 | 每条 race 分支独立 `[Server-IT]` |
| 反枚举 | 字节级等价分支入 state_branches/SC | 折叠 + dummy-pad timing + HMAC constant-time | 独立反枚举 `[Server-IT]` |
| 事务/outbox | 事件作为 SC | `publish(tx,…)` 同 tx 原子，任一失败回滚 | 并入 IT（原子回滚断言） |
| PII/加密 | 加密存 + 掩码返回（FR/SC） | AES-GCM + 唯一 hash 防占位 + 终态解密 | — |
| 前端 RHF/Strangler | UI 场景（user story） | RHF 4 铁律 + Strangler（`~/theme`+`~/ui` 复用、Orval 函数式、axios 不删） | RHF 逻辑测 task 绑定 |
| Mockup | （UI 类别 per sdd.md） | UI 段引 Claude Design mockup 2 段模板 | Mobile task 含 mockup 步 |
| stop-signals | — | — | →`implement-task-closure.md`（非 template） |

> **守纪律**：spec **绝不**收 HOW 机制（affected-count/AES-GCM = plan callout）；三 template 各放 phase-appropriate 短提示 + 链接，零重复。

## 4. 精华三分类

| 处置 | 内容 |
|---|---|
| **✅ 收** | 后端 Prisma 并发/事务 8 法 + 安全（反枚举/HMAC/AES-GCM）；前端 RHF 4 铁律 / Strangler / mockup 2 段模板（去 meta 化）；impl 期 stop-signals |
| **↩ 引用不复述** | SDD 6 步 / TDD 闭环 / moat + CROSS-CONTEXT-* / `nx affected` 4 层 gate / api-client regen / Metro `.js`（各有单一家：constitution / sdd.md / catalog / ADR-0040 / rules / memory） |
| **🗑 丢弃** | 旧 Java 仓路径 / meta 净室提取 / 旧 IT 抽取 / mbw-account / 旧栈 de-stale / 批 A-E 编号 / 6 表 db-pull |

## 5. 子 plan 索引（按依赖排序）

依赖链：**p1（mono 单源）→ p2（preset template 烘焙，link 指向 p1）→ p3（dogfood）**。mono-first 因 template link 指向 mono conventions（目标须先在）+ p1 单独 ship 即让手动流受益。

| 子 plan | 范围 | 依赖 | PR | 状态 |
|---|---|---|---|---|
| [p1](05-26-feature-impl-guardrails-p1-mono-source.md) | mono 单源：2 conventions + 2 rules + 扩 closure(stop-signals) | 无 | mono docs PR（含 master + 3 子 plan 文件）| 🟡 进行中 |
| [p2](05-26-feature-impl-guardrails-p2-preset-templates.md) | preset 仓 3 template phase-sliced + bump 0.5.0 + 同步回 mono | p1 | preset PR + mono install 同步 PR | ⬜ 待 |
| [p3](05-26-feature-impl-guardrails-p3-dogfood.md) | sacrificial `999-guardrail-smoke` 跑完整 SDD 验全流程 | p1+p2 | throwaway（不 merge）| ⬜ 待 |

## 6. 跨 plan Verification

- 各 mono PR：`pnpm exec nx affected -t lint typecheck test build --base=origin/main` 绿 + markdownlint（CI mirror）绿。
- preset PR：`michael-speckit-presets` CI 绿 + 0.5.0 merge。
- 去重/去 Java 自检：grep 新 conventions 无复述已覆盖项（只链接）+ 0 残留 Java/meta/mbw-account；grep spec-template 新段无 HOW 机制词。
- **全流程有效**（p3 dogfood）：spec/plan/tasks 三烘焙各生效 + command 路径触发 + orchestrator 注入 + 产出守 guardrail + 去 Java。

## 7. Out of scope（按目标定 —— 确实不用动的才出）

- **p3 原文不动**（仍驱动批 D `005` / 批 E `006` 迁移）。
- **已有单一家的精华只引用**（不复述，守单源）。
- **spec-template 不收 HOW**（机制归 plan callout / conventions —— 守 spec WHAT 纪律）。
- **schemas / constitution 不动**（state_branches 已 free-form `string[]`，无需新字段；TDD/moat 原则已覆盖）。
- **speckit skills 不 fork**（经 template/rules 应用）。
- `paradigmSection()`：默认新增并列 `guardrailsSection()`、不动其既有无条件注入；若合并更干净则允许改（**目标导向，非教条**）。
- memory 条目精简：落 repo 后另行评估（不在本 master）。

## 8. 执行序

p1（本 PR）→ p2（preset roundtrip + 同步）→ p3（dogfood 验收）。每子 plan 独立 PR。
