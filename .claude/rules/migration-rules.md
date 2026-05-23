---
paths:
  - 'apps/server/prisma/migrations/**/*.sql'
  - 'apps/server/prisma/schema.prisma'
---

# Migration 治理（path-triggered，触及 prisma schema / migration 时自动加载）

## 单源真理

migration **命名** (`<yyyymmddhhmm>_<verb>_<obj>`) + **prisma generate hard gate** (lefthook `prisma-generate-gate`) + **3 层 seed idempotent UPSERT** + **spec ↔ migration 关联 `migration_refs` frontmatter** 见 [ADR-0035](../../docs/adr/0035-data-layer-governance.md)。本 rule 仅 surface 路径触发的硬 invariant + expand-migrate-contract 三步法。

> 历史 migration `0_init` / `1_add_outbox_event` / `2_drop_legacy_modulith_flyway_tables` 是 ADR-0035 ship 前的 retrofit immutable，per lefthook `migration-naming-check` 仅校验新增。

## 硬性 invariant

### 1. 已合 main 的 migration 不可变

已合 main 的 `apps/server/prisma/migrations/*/migration.sql` **禁止修改**；纠正以新 migration 实现。

强制层：当前靠 PR review 纪律（无 CI immutability check —— 候选加 `git diff origin/main --diff-filter=MD apps/server/prisma/migrations/` 在 PR validation 步骤，列入 P3 lefthook/CI 强制层 scope）。

### 2. 破坏性变更走 expand-migrate-contract 三步法

**所有破坏性 schema 变更**（删列 / 改列名 / 改列类型 / 拆表 / 合表）必须拆**三个独立 PR / 部署**，禁止单 PR 一把梭。

| 阶段         | DB 操作                              | 应用代码                                     | DB 状态            |
| ------------ | ------------------------------------ | -------------------------------------------- | ------------------ |
| **Expand**   | 加新结构（列 / 表 / 索引）           | 旧代码继续读旧字段；新代码可双写             | 新旧并存，向前兼容 |
| **Migrate**  | 数据回填                             | 写路径只写新字段（或仍双写）；读路径切新字段 | 新旧并存           |
| **Contract** | 删旧结构（drop column / drop table） | 旧字段已无引用                               | 仅新结构           |

**核心约束**：每一步独立可回滚 + 每一步部署后都能跑生产流量。

#### ❌ 反例：单 PR drop + rename column

```prisma
// schema.prisma（错误）
model Account {
  // - phone   String @db.VarChar(32)     // 删
  mobile  String @db.VarChar(32)          // 加 + rename
}
```

应用代码同 PR 把 `phone` 改 `mobile`。

**问题**：滚动部署 / 多实例场景下，旧实例还在读 `phone` 字段就被删 → 报错；rollback 必须同时回退 SQL + 代码。

#### ✅ 正例：拆三个 PR

```prisma
// PR-A: 20260520_1430_add_mobile_column（expand）
model Account {
  phone   String  @db.VarChar(32)
  mobile  String? @db.VarChar(32)         // 新加 nullable
}
// 应用：写路径双写 phone + mobile；读路径仍 phone
```

```sql
-- PR-B: 20260520_1545_backfill_mobile（migrate；prisma migrate dev --create-only 后手工编辑 migration.sql）
UPDATE "account" SET mobile = phone WHERE mobile IS NULL;
-- 应用：读路径切 mobile，写路径仍双写
```

```prisma
// PR-C: 20260521_0900_drop_phone_column（contract）
model Account {
  // phone 已 drop
  mobile  String  @db.VarChar(32)         // not null
}
// 应用：写路径只写 mobile（删双写代码）
```

### 3. 跳步条件

只有**两个条件同时满足**才允许 `expand + contract` 合并到单 PR：

1. **无真实用户数据**：M1.1 ~ M3 内测前的 dev / staging 环境，且确认无回滚需求
2. **PR 描述明示**：「跳过 expand-migrate-contract，理由：< 当前阶段 / 数据状态 >」

M3 内测起，**任何**破坏性变更必须三步走，无例外。
