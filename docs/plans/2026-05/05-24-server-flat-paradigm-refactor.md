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

## Sub-PR（按依赖排序 · step → verify）

| # | Sub-PR | 内容 | 依赖 | verify |
| --- | --- | --- | --- | --- |
| R-1 | outbox 迁移 | `auth/{ports,infrastructure}/outbox*` + `outbox-event-envelope.schema` → `security/outbox/`；改全部 import | ADR-0043 | 全绿；`auth`/`account` 经 SecurityModule 拿到 publisher；`grep outbox auth/` 仅剩消费侧 |
| R-2 | 贫血化 + helper | `account.aggregate.ts` 等充血类 → 裸 POJO；不变量迁纯函数 `account.rules.ts`（`isFrozen`/`isAnonymized`/`markLoggedIn`→`withLastLogin`） | — | 不变量单测下沉到纯函数级，绿；无带状态 domain class |
| R-3 | 去 DB repository port | 删 `AccountRepository`/`SmsCodeRepository` port；account usecase 直注 Prisma；`SmsCodeStore` 改 concrete service | R-2 | 全包 typecheck + test；mock 工厂同步（memory `feedback_new_export_grep_mock_factories`） |
| R-4 | 堵护城河漏洞 | `auth` 的 `tx.account.create` → 调 `AutoCreateAccountUseCase.execute(phone, tx)` | R-2/R-3 | auth 内零 `tx.account.*`；phone-sms-auth e2e 绿 |
| R-5 | 拍平目录 | 三模块 `domain/application/infrastructure/web` 文件上提 module 根 | R-1~R-4 | `find apps/server/src/{auth,account} -type d` 无层子目录；build config glob 同步（memory `feedback_rename_path_sweep_build_configs`） |
| R-6 | AST 护城河（可选 / 后置） | `ts-morph` 探针：跨 ctx Prisma model 访问 + CROSS-CONTEXT 注释，合并 [ADR-0034](../../adr/0034-auth-account-operation-catalog.md) Stage C | R-4 | 故意反例能拦；全仓 0 误报 |

**保留不动**：外部 SDK port（SMS sender）、outbox port（仅迁位置不删）。

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
