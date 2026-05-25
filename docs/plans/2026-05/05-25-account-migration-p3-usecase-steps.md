# 子 plan 3 — 逐 use case 详细迁移过程与步骤

> 隶属 [account-migration master](05-25-account-migration-master.md)(执行轨)。依赖:[子 plan 2](05-25-account-migration-p2-usecase-dependency.md)(迁移顺序 + 业务调研)+ [子 plan 1](05-25-account-migration-p1-toolchain-ralph-loop.md)(工具链就绪)。
>
> ## 🚧 STUB — 内容待填充
>
> **本子 plan 目标**:针对**每一个 use case** 定义详细的迁移过程与步骤,确保单个 use case 正确迁移(旧 Java 业务规则 → 新范式 spec/impl/test,server + mobile 同步)。
>
> **本次仅占位**。具体内容**待 [子 plan 2](05-25-account-migration-p2-usecase-dependency.md) 完成后**,由 user 切入 `/plan` 模式给出逐 use case 输入(优先级 / 字段口径 / 错误码 / spec 合并约束等),再据此填充。

## 待填充结构(预留)

填充时,每个 use case(按 p2 § 4.4 迁移顺序:批 B → C ∥ D ∥ E)预期产出一份迁移 SOP,候选维度:

1. **旧 → 新映射**:旧 Java UseCase(`my-beloved-server/mbw-account/.../XxxUseCase.java`)→ 新 mono 落点(`apps/server/src/<module>/`,扁平贫血 per ADR-0043)
2. **业务规则 → spec FR**:p2 § 3 业务卡的核心规则 → `specs/NNN-<slug>/spec.md` Functional Requirements
3. **Prisma 持久层**:raw row + `@map`(禁 Row→POJO Mapper);涉及的 model + 查询 + 索引 + 并发控制(乐观/悲观锁)
4. **controller / DTO / OpenAPI 装饰器** → api-client regen
5. **测试移植**:Java IT 业务断言 → Vitest + Testcontainers(unit + integration + e2e);并发 IT / 反枚举 / timing defense 按需
6. **mobile 同步**:对应 feature 屏(占位 UI 4 边界 per ADR-0017)+ hooks/状态重写
7. **验收**:tasks.md `[X]` 全 flip + `pnpm nx affected` 全绿 + 真后端冒烟

> 实际 use case 清单 / 顺序 / 复杂度 / 依赖 / 并发要点已在 [p2 § 4](05-25-account-migration-p2-usecase-dependency.md) 给出;业务规则概览在 p2 § 3。本子 plan 填充时直接引用,不重复。
