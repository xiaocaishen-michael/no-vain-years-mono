---
adr_id: ADR-0043
status: Proposed
applies_to: [apps/server]
sunset_trigger: |
  - 单个 bounded context use case 数 > 20（扁平单层开始失焦，需内部再分组）
  - 团队规模 > 1（多人协作下贫血 + 约定护城河风险升高，需重引编译期隔离）
  - 引入第 2 个非 Prisma 持久化（贫血 POJO 类型来源不再单一）
---

# ADR-0043: Server 模块内构范式 — 扁平 + 贫血数据 + 纯函数 Helper + UseCase 跨界

- Status: Proposed
- Deciders: project owner
- Tags: server / architecture / module-internal / llm-ergonomics

## Context

[ADR-0032](0032-backend-bounded-context.md) 退役了 hexagonal **层强制**（ESLint elements 由 layer 切 module）并永久埋葬四层（§ 架构历史决议对齐），但只说了「不要什么」：当前模块物理上仍残留 `domain/application/infrastructure/web` 子目录 + repository port + 充血 aggregate。本 ADR 补上「要什么」—— 定义 post-Hexagonal 的**正向**模块内构范式，目标是对 LLM Agent 的上下文聚焦最优 + 反过度设计。

核心根因（为何不在 TS 里搞重型分层）：

1. TS 结构化类型 + Zod 契约 + Prisma 生成类型 + DI 已在 module 内部提供天然解耦，不需要 Port-Adapter 做「换库」的虚无隔离（换库概率 ≤ 1%，而分层拖慢开发概率 100%）。
2. 极度碎片化的文件树（一个 CRUD 跨 5 层文件夹）是 LLM 产生「依赖幻觉」+ 注水 boilerplate 的孵化器，内耗 token 与 Ralph-loop 算力。
3. 范式从「纵向分层」转「横向切片」：以 Bounded Context 为最高物理红线，模块内部扁平内聚。

## Decision

### 1. 模块内构扁平化

业务 context（`auth` / `account` / ...）内**禁** `domain` / `application` / `infrastructure` / `web` 层子目录。文件平铺于 module 根：`*.controller.ts` / `*.usecase.ts` / `*.dto.ts` / `*.store.ts`（自有非 DB 基建）/ `*.rules.ts`（纯函数不变量）/ 存活的 `*.port.ts` + `*.adapter.ts`。

### 2. 贫血数据 + 纯函数 Helper

数据 = Prisma 原始 POJO（绝对贫血）。不变量校验抽成**无状态纯函数**置于 `<ctx>.rules.ts`。**禁**带状态 Domain Class、**禁** Entity Mapper（Prisma ↔ Class 转换一旦出现即复活 Hexagonal 噩梦）。

```typescript
// account/account.rules.ts —— 纯函数，无状态，不碰 DB
import type { account as AccountRow } from '../generated/prisma';

export const isFrozen = (a: AccountRow): boolean =>
  a.status === 'FROZEN' && (a.freezeUntil?.getTime() ?? 0) > Date.now();
export const isAnonymized = (a: AccountRow): boolean => a.status === 'ANONYMIZED';
```

### 3. 三条跨界规则

1. **R1 同 ctx + 自己的表** → 直注 `PrismaService` 读写，无 repository 接口。
2. **R2 跨 ctx 同步**（同 tx 强一致）→ DI 注入对方 **UseCase**（受 [ADR-0032](0032-backend-bounded-context.md) 单向放行），传 `tx`；**禁** `tx.<otherTable>.*`。
3. **R3 跨 ctx 副作用** → Outbox 异步，发布方 `publish(tx, eventType, payload)`，消费方按 event-type 字符串契约响应，双方互不 import。

### 4. Port 三分法（替代「封杀所有 port」）

| 场景                                                             | 处理                                        |
| ---------------------------------------------------------------- | ------------------------------------------- |
| 自己 context 的 DB 表                                            | 直注 PrismaService，无 port                 |
| 自己的非 DB 基建（Redis + HMAC 等）                              | concrete service，无 interface              |
| 外部 3rd-party 厂商 SDK（阿里云 SMS 等）                         | 保留薄 port + adapter（可换厂商 + 可 mock） |
| 跨 ctx 发布契约（[ADR-0033](0033-outbox-cross-context-comm.md)） | 保留 port，落 `security/outbox/`            |

### 5. 强制层级（诚实声明）

- 跨 module **import 方向**（`account ↛ auth`、`security ↛ 业务`）→ ESLint `boundaries` 机器硬卡。
- **「只碰自己 owns 的 Prisma model」**（禁 `tx.account.*` in auth）→ boundaries 看不见 Prisma 调用，**当前仅约定**；待 `ts-morph` AST 探针（与 [ADR-0034](0034-auth-account-operation-catalog.md) Evolutionary Path Stage C 注释扫描器合并）上线后转机器强制。

## Consequences

- **amends [ADR-0019](0019-orm-prisma.md)**：撤销其「DDD repository interface + infra impl」边界，改 PrismaService 直连。
- **amends [ADR-0033](0033-outbox-cross-context-comm.md)**：outbox 三件套物理位置 `auth/` → `security/outbox/`（让 account / security 也能 publish，符合依赖方向）。
- **触发 [ADR-0041](0041-server-common-directory-policy.md) sunset**：outbox 迁入使 security 非 JWT 成员 > 7 → 按其预设「拆 security/ 子目录」应对（`security/outbox/`），仍不引入 `src/common/`。
- 触发一次跨模块重构（见 `docs/plans/2026-05/05-24-server-flat-paradigm-refactor.md`）。

## Trade-offs

- 贫血失去编译期不变量封装 → 由纯函数 helper + 单测补偿；不变量集中在 `*.rules.ts` 不散落。
- 数据护城河在 AST 探针上线前是「约定」→ R2「调 UseCase 不碰表」靠 CR + Golden Sample 引导。
- 扁平在单 context use case 暴增时会失焦 → sunset trigger 兜底。

## References

- [ADR-0032](0032-backend-bounded-context.md) bounded context 拆分 + hexagonal 永久退役
- [ADR-0033](0033-outbox-cross-context-comm.md) Outbox 跨 ctx async
- [ADR-0019](0019-orm-prisma.md) ORM Prisma（repository 边界被本 ADR amend）
- [ADR-0041](0041-server-common-directory-policy.md) `src/common/` 禁用 + security 平台基座
- [ADR-0034](0034-auth-account-operation-catalog.md) 跨 ctx 注释规则 + Stage C 扫描器
