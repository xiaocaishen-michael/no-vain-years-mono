# Plan: Server 扁平范式重构（落地 ADR-0043）

> 单 plan（一条内聚重构，非 master/子）。把 server 三模块从「残留 hexagonal 目录 + repository port + 充血 aggregate」迁到 [ADR-0043](../../adr/0043-server-flat-module-paradigm.md) 的扁平 + 贫血 + 纯函数 Helper + UseCase 跨界范式。每个 sub-PR 走 TDD（per [sdd.md](../../conventions/sdd.md) /implement 闭环）。

## Context

[ADR-0043](../../adr/0043-server-flat-module-paradigm.md) 定义了 post-Hexagonal 正向范式。2026-05-23 审计实证当前代码与该范式的 gap：

- 三模块物理上仍是 `domain/application/infrastructure/web` 四层目录。
- `phone-sms-auth.usecase.ts:109` 用 `tx.account.create(...)` 直写 account 表（护城河漏洞）。
- 大量 repository port（`AccountRepository` / `SmsCodeRepository`）+ 充血 `account.aggregate.ts`。
- outbox 三件套在 `auth/`，导致 account / security 无法 publish（依赖方向禁止）。

## 前置依赖

**[ADR-0043](../../adr/0043-server-flat-module-paradigm.md) 必须先 land**（keystone，定义「正确」）。同时 realign-P1 对 0019/0033/0041 的修订须**对齐 0043 方向**（见该 plan）。本 plan 在 0043 + realign-P1 之后执行。

## 决策记录（2026-05-24 architect 拍板，源 R-2 设计 4 问）

1. **贫血数据类型 = Raw Prisma Row（否决 camelCase POJO）**：任何 Row→POJO map 层即 Hexagonal Entity Mapper 特洛伊木马。snake_case 体验在 `schema.prisma` 层用 `@map`/`@@map` 解决 —— TS client 字段 camelCase，物理列保持 snake_case，**零运行时开销 + 零 migration**（`prisma migrate diff` 实测空）。`phone: string | null` 等可空列**让它穿透**到 UseCase/Rules，编译器逼显式处理 null。详见 memory `feedback_raw_prisma_row_with_map_no_entity_mapper`。
2. **VO（Phone/DisplayName/SmsCode）全部拍平为纯校验函数**：降为 `*.rules.ts` 内 `asserts` 签名纯函数（`assertValidPhone` 等），消灭装箱/拆箱 + `.equals()`。北极星 = `apps/server/src/` 下零 Class（除 NestJS 必需 Controller/UseCase/Module）、零 Mapper、零装箱拆箱。
3. **R-2 + R-3 合并单 PR**：杀 Account 充血类即架空 repository 的 mapping 角色，再留「返回裸 row 的 repo」是无谓中间层。
4. **`@map` 全仓一次性洗牌，但走独立 Chore PR（C-1）**，不塞进 R-2。

## Sub-PR（按依赖排序 · step → verify）

| # | Sub-PR | 内容 | 依赖 | verify |
| --- | --- | --- | --- | --- |
| R-1 ✅ | outbox 迁移 | outbox 三件套 `auth/` → `security/outbox/`；改全部 import | ADR-0043 | DONE（#157）；`grep outbox auth/` 仅剩消费侧 |
| C-1 | 全仓 `@map` camelCase sweep | schema PascalCase model + `@map`/`@@map`（snake 列名保留，0 migration）；全仓 Prisma client 访问 camel 化（field + model accessor）；wire 契约（ADR-0033 envelope `trace_id`/`occurred_at` 等）不动 | ADR-0043 + 决策 1/4 | `prisma migrate diff` 空；全绿 affected |
| R-2+3 | 贫血 + 去 repository port（合并） | 杀 `account.aggregate.ts` 充血类 + `AccountStateMachine` → raw Prisma row（`Account` 生成类型）+ `account.rules.ts` 纯函数（`isActive`/`isFrozen`/`isAnonymized`）；删 `ACCOUNT_REPOSITORY` + `SmsCodeRepository` port，usecase/guard 直注 `PrismaService`；`SmsCodeStore` 改 concrete | C-1 + 决策 3 | 全包 typecheck + test + e2e 绿；无 Account class / repo port；mock 工厂同步（memory `feedback_new_export_grep_mock_factories`） |
| R-VO | 拍平所有 Value Object | `Phone`/`DisplayName`/`SmsCode` class → `*.rules.ts` `asserts` 纯校验函数；删全部 `.create()`/`.equals()` 调用点 | R-2+3 + 决策 2 | `apps/server/src` 下 0 VO class；校验单测下沉纯函数级绿 |
| R-4 | 堵护城河漏洞 | `auth` 的 `tx.account.create` → 调 `AutoCreateAccountUseCase.execute(phone, tx)` | R-2+3 | auth 内零 `tx.account.*`；phone-sms-auth e2e 绿 |
| R-5 | 拍平目录 | 三模块 `domain/application/infrastructure/web` 文件上提 module 根 | R-1~R-4 | `find apps/server/src/{auth,account} -type d` 无层子目录；build config glob 同步（memory `feedback_rename_path_sweep_build_configs`） |
| R-6 | AST 护城河（可选 / 后置） | `ts-morph` 探针：跨 ctx Prisma model 访问 + CROSS-CONTEXT 注释，合并 [ADR-0034](../../adr/0034-auth-account-operation-catalog.md) Stage C | R-4 | 故意反例能拦；全仓 0 误报 |

**保留不动**：外部 SDK port（SMS sender）、outbox port（仅迁位置不删）、ADR-0033 envelope 的 snake_case wire 字段。

## 验收

1. `apps/server` typecheck + unit + e2e 全绿；`pnpm nx affected --target=test` 绿。
2. `grep -rn 'tx\.account\.\|prisma\.account\.' apps/server/src/auth` 0 命中（护城河）。
3. `find apps/server/src/{auth,account,security} -maxdepth 1 -type d` 仅 `security/outbox`（平台基座 concern 分组），无业务 context 层子目录。
4. 充血 aggregate 0 残留；不变量在 `*.rules.ts` 纯函数 + 有单测。
5. ADR-0043 status 可翻 `Accepted`（实装 ship 后）。

## 非目标

- 不动外部 SDK port / outbox port 的接口形态（只迁位置）。
- 不引入 `src/common/`（[ADR-0041](../../adr/0041-server-common-directory-policy.md)）。
- 不碰 ADR 文件（ADR 改动属 realign-P1 / ADR-0043 本身）。
