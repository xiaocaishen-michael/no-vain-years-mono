# 子 plan 3 — 逐 use case 详细迁移过程与步骤

> 隶属 [account-migration master](05-25-account-migration-master.md)(执行轨)。依赖 [子 plan 2](05-25-account-migration-p2-usecase-dependency.md)(迁移顺序 + 业务调研)+ [子 plan 1](05-25-account-migration-p1-toolchain-ralph-loop.md)(工具链)。
>
> **本轮全程手动,不用 p1 orchestrator**(orchestrator 留给后续新功能开发)。
>
> 本文 = 迁移**引擎 + 变体卡**,不是 14 个 UC 的详细步骤堆。每个 step 的"具体要求"蒸馏成下方「执行约束」(不留 verbose prompt)。

## Context

为何写 p3:p2 已定迁移顺序(批 B → C ∥ D ∥ E)+ 业务规则概览;但"每个 UC 怎么落到 mono 新范式、按什么 step、前端 port 还是新设计"无统一 SOP,逐 feature 临时摸索会 drift。p3 把这套 SOP(引擎)+ 每模式/每批增量(变体卡)固化。

现状:login(001)server 已 ship、UI 占位待补;批 A(002)已 ship;批 B-E 共 14 UC 未起。本轮目标 = 用此引擎手动推完 login/onboarding UI + 批 B-E。

## 0. 执行总则

1. **全程手动**(orchestrator 本轮不用)。
2. mono 标准流逐 feature 跑:`spec → clarify → plan → tasks → analyze → impl`。
3. 每 step 的要求 = 蒸馏后的执行约束(本文),与已锁定项去重,冲突当场标。

## 1. 一条引擎,两处分叉（Step 1 模式 + Step 4 前端形态）

所有 UC 共用同一引擎 `Step 1 → 2 → 3 → 4`(§3),只在两处分叉:

**Step 1 两模式:**

- **1a 抽取重写**(fresh,mono 无 spec):抽取 meta 三源 → 重写 spec → clarify。→ 批 B / C / D / E
- **1b de-stale**(mono spec 已存在、仅旧栈 anchor):**只 de-stale 已有 spec 的 client 段**,不重抽 → **直接走引擎 Step 2/3/4**。→ **login / onboarding**(001/002 spec 已含 client FR + server 已 ship)。因 server 已 ship、api-client 已存在,这两个是 **mobile-only 切片**([Server]/[Contract] 层留空,只 [Mobile])。

**Step 4 前端两形态:**

- **port**(有旧 app 成品):login / onboarding · 批 C(`delete-account.tsx` / `cancel-deletion.tsx`)· 批 D(`login-management/` 全套 + `DeviceIcon` + `useDevicesQuery`)→ Strangler-Fig prompt + RHF。
- **mockup**(无旧 UI):批 E realname → server 先行 + HTML mockup(详见下「批 E mockup 子流程」)。

> **login / onboarding = Golden Sample**(首个 RHF + Strangler-Fig 落地标杆),但它**不是独立轨**,而是「Step 1 走 1b de-stale + Step 4 走 port」的引擎实例。本轮范围**不含** freeze 弹窗 / OAuth 占位 / help 链接(随后续 cancel-account 阶段补)。

### 批 E mockup 子流程（无旧 UI,`006-realname-verification`)

server 先行,mockup 驱动前端:
`完整 SDD(spec→clarify→plan→tasks→analyze)` → **server impl** → **API gen(api-client regen)** → **Claude Design mockup** → **读 mock 写 RN 前端 + 流程**。

**Claude Design prompt 来源 = port meta 仓成熟模板**,不从零造:

- 内容源:`~/Documents/projects/no-vain-years/no-vain-years-app/apps/native/specs/account/realname-verification/design/mockup-prompt.md`(已写好 4 view 态 InputForm/Pending/Readonly/Frozen + GB11643 校验 + mask 格式 + DO-NOT 清单)。
- 适配 mono:输出 = **HTML preview baseline**(mono sdd.md;**非** meta 的 RN .tsx)→ 从 HTML 视觉翻为 mono RN;token 复用 **`~/theme`** 值(brand-500 `#2456E5` 等),翻译时组件用 `~/ui`、动画 reanimated v4;**文案 / FR / inspiration 截图 re-anchor 到 mono `006` spec**(批 E 起手、006 ready 后定稿,不提前)。

> meta `mockup-prompt.md` 的两段式结构(① 设计上下文表-仅 user 看 ② Prompt 拷贝块;Prompt 内:业务+状态机 / NEGATIVE+POSITIVE 约束 / 页面结构 / 状态变体 illustrate / DO-NOT per spec FR-SC / 视觉语言-0 新 token / DELIVERABLES)= mono 任何 类 1/类 2 fresh mockup 的**可复用模板**。

## 2. 顺序（p2 §4.4 + “未完成先”）

```text
login UI → onboarding UI → 批 B(003-tokens) → ( 批 C(004) ∥ 批 D(005) ∥ 批 E(006) )
```

## 3. Step 执行约束

### Step 1 — spec 就位(两模式)

- **模式分流**:**1a 抽取重写**(fresh:批 B/C/D/E)= 下列全部约束;**1b de-stale**(login/onboarding,spec 已存在)= **不重抽**,只对已有 001/002 spec 的 **client 段** de-stale(清旧栈 anchor:`@nvy/auth` / `apps/native` / `--filter native` / typescript-fetch `ResponseError` → mono `~/auth` / `apps/mobile` / Orval hook)+ 校正 frontmatter `status` / `web_compat`,**完成即进 Step 2**。
- **提取源(三源交叉,仅模式 1a)**:旧 meta spec(`~/Documents/projects/no-vain-years/specs/account/<uc>/`)+ **旧 Java UseCase 实现** + **旧 IT 断言**。三源交叉补 spec 漂掉、只活在代码/IT 的铁规则(限流数值 / freeze 15 天 / 反枚举分支 / 乐观-悲观锁语义 / split-tx)。
- **净室提取**:只取业务(FR / 业务规则 / user journey / 状态机 / 数据校验 / 字段属性),**丢所有技术制品**(JPA / Hibernate / MapStruct / Spring Controller / Modulith / Nimbus JOSE / Flyway / Entity / Repository + 旧架构叙述)。
- **产出**:按 mono `.specify/templates/spec-template.md` 起草新 `spec.md`;行为导向(用户意图 / 系统行为 / 边界+错误场景);旧技术词 **0 残留**;字段列到**属性级、不带 DB 类型**;**不写代码**。
- **frontmatter 强制**:`feature_id / modules / owners / status`(+ 002 的 v2 字段如适用),per [ADR-0024](../../adr/0024-spec-feature-first-layout.md)。
- **结构**:沿用 002 双层(Server / Client 分段 + FR-S / FR-C 编号);**手动模式 → 去掉 orchestrator 用的 us-meta / fr-meta JSON**。
- **字段命名**:对齐已 db-pull 的 Prisma schema 字段名 + [business-naming.md](../../conventions/business-naming.md),**不另造名**。
- **已 ship 横切不重立**:timing defense(HMAC)/ throttler / outbox / jose 已就位,spec 引用即可。
- **spec-merge 约束 → 放 clarify 阶段做**(不单设上游 gate):clean-room draft 后用 `/speckit-clarify` 把 server↔app 合并约束(字段口径 / 错误码 / UI 覆盖 / journey)问出并写回 spec。
- **粒度**:per-feature(1 个 `NNN-slug` 覆盖该批所有 UC,如 `003-tokens` = RefreshToken + LogoutAllSessions)。

### Step 2 — plan + tasks

- **范式(ADR-0043 五条,已验证是仓内现实)**:零 class / 贫血(裸 Prisma row POJO,无 Entity/聚合/Mapper)· 无 DB repository(`PrismaService` 直注 UseCase)· 扁平目录(UseCase/Controller/rules 平铺 `apps/server/src/<module>/`)· 业务不变量 → 无状态纯函数 `<module>.rules.ts` · **Moat**(跨 context 写调目标 module 的 UseCase,禁 `tx.<他 module 表>`),per [ADR-0043](../../adr/0043-server-flat-module-paradigm.md)。
  - 验证(2026-05-25):`apps/server/src/{auth,account}` 已扁平(`sms-code.rules.ts` / `account.rules.ts` 在;`*repository*` 零命中)→ 批 B-E 同范式,无 mixed-paradigm 风险。
- **context 放置**:每 feature 用 [server-bounded-context-catalog.md](../../conventions/server-bounded-context-catalog.md)(3 传播规则 + 7 决策问题)定 UC 落 auth/account/security 哪个 context + 跨 context 传播;`.claude/rules/server-bounded-context-decision.md` 路径触发。
- **schema 复用**:6 表已 db-pull(p2 §4.1)→ 数据模型复用现有 model + `@map`,仅缺字段才加 migration。
- **横切复用**:throttler / outbox / jose / timing-defense(HMAC)已 ship → 引用 + 加 per-UC throttler config,不重立。
- **plan.md**:按 `.specify/templates/plan-template.md`;**手动模式 → 去掉 orchestrator_config 块**。
- **tasks.md(三位一体,同 1 pass / 同 1 PR)**:001 式简洁(`- [ ] T0NN [层] 描述`,无 task-meta JSON);**TDD 强制**(每 impl task 绑 RED 测试 → 红→绿→typecheck/lint→`[X]`→commit,constitution II)。三层:
  - `[Server]`:UseCase + `*.rules.ts` + controller + DTO(ADR-0043 扁平)
  - `[Contract]`:openapi 导出 + `pnpm nx affected --target=generate`(api-client regen)
  - `[Mobile]`:port 屏 + RHF;约束 = **定稿的 Strangler-Fig 前端 prompt**(login/onboarding/C/D 有旧 UI;批 E 无 → 走 §批 E mockup 子流程)

### Step 3 — analyze

- 跑 `/speckit-analyze` 跨 spec / plan / tasks 一致性扫描 + review gate(mono 标准流第 5 步)。

### Step 4 — impl

- **后端**:照 `apps/server/src/auth/` 现成扁平范式(usecase + `*.rules.ts` + controller + DTO 平铺,port 只给外部 I/O);完全按新逻辑 + ADR-0043 重写(TDD 红→绿)。**并发/事务语义是迁移翻车点(Java JPA/Spring → Prisma 无等价物,必手译):**
  1. **Prisma 无原生悲观锁** → `$queryRaw` 写 `SELECT…FOR UPDATE` + interactive `$transaction`(CancelDeletion ⟷ Anonymize 互斥,批 C 最硬)
  2. **Serializable race 双形态**:catch P2002 **+ 外层 retry P2034**(否则 ~50% flaky;memory `prisma_serializable_p2002_and_p2034`)
  3. **outbox 同 tx**:`publish(client, eventType, payload)` caller 传 tx client,与状态写同 `$transaction`(memory `transactional_outbox_port_shape`)
  4. **乐观锁 = affected-count**:revoke 用 `updateMany.count`,count=0 = 幂等 200 / 竞争失败,不报错不重发事件
  5. **REQUIRES_NEW**:Anonymize scheduler 每行独立 `$transaction`,不包大 tx
  6. **split-tx(批 E)**:TX1 存 PENDING → **tx 外**调 cloudauth → TX2 mark FAILED;外部 HTTP 不在 tx 内持锁(接口形状 = master open Q#6)
  7. **反枚举 + timing**:复刻 SendCancelDeletionCode 4 分支 + dummy hash;复用 HMAC constant-time([ADR-0023](../../adr/0023-sms-code-storage-hmac.md)),**禁再引 bcrypt**
  8. **PII 加密(批 E)**:AES-GCM;`idCardHash` 唯一防占用;解密仅 VERIFIED + 掩码
  9. **Moat 两段式**:Inspect(读)+ Commit(写),禁单 upsert(memory `cross_ctx_login_two_step_saga`)
  - 每批热点:B=token 轮换原子性 + raw token 只存 hash;C=悲观锁 + 串行链 + freeze-window race;D=ip2region 选 Node 替代 + 防自撤;E=split-tx + cloudauth + 加密
- **前端**:**= 定稿的 Strangler-Fig mono 校准 prompt**(2 硬约束:Orval 函数式 hook 非 class / axios 不删;skin 复用 `~/theme`+`~/ui` / muscle+nervous+engine 重写 API·数据适配·路由)+ **RHF Golden Sample 4 铁律**(Controller 非 register / 表单态副作用态分层 / isSubmitting 单源 / 错误+a11y)。依赖 gate:补装 `@hookform/resolvers`(核 zod4 兼容)。

## Critical files

- `~/Documents/projects/no-vain-years/specs/account/<uc>/` + `…/my-beloved-server/mbw-account/`(Step 1 模式 1a 三源提取)
- [`specs/002-account-profile/`](../../../specs/002-account-profile/)(批 A spec/plan/tasks 范式样板)
- `apps/server/prisma/schema.prisma`(6 表已 db-pull,迁移不卡建表)
- `apps/server/src/auth/`(ADR-0043 扁平范式样板:usecase + `*.rules.ts` + controller + DTO)
- meta `…/realname-verification/design/mockup-prompt.md`(批 E Claude Design 模板源)
- memory `project_rhf_form_standard_login_golden_sample`(RHF 4 铁律)

## Verification

- 每 feature ship:tasks.md `[X]` 全 flip + `pnpm nx affected --target=test,lint,build,typecheck` 全绿 + 真后端冒烟(server)/ **web e2e**(mobile)。
- Plan 2 graduation:16 UC 全 ship。
