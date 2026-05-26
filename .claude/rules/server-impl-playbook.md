---
paths:
  - 'apps/server/src/**/*.usecase.ts'
  - 'apps/server/src/**/*.service.ts'
  - 'apps/server/src/**/*.scheduler.ts'
---

# Server 实现 guardrails（path-triggered，改 server impl 文件自动加载）

> 🚨 **CRITICAL — 写 server use case / service / scheduler 时严守。** 详版 + 实证锚 + 反模式见 [`docs/conventions/server-impl-playbook.md`](../../docs/conventions/server-impl-playbook.md)（单源，本 rule 不复述）。

## 并发 / 事务

- **单行状态转换 = conditional UPDATE + affected-count**（`updateMany where {id,<前置>}` → `count===1` won / `0` lost），READ COMMITTED。**NEVER** 单行上 `SELECT … FOR UPDATE` / Serializable（偏索引 SSI 假冲突，004 实证 72/100 假失败）。
- **并发 insert 确需 Serializable 时**：catch **P2002 + P2034 双形态**（只 catch P2002 → ~50% flaky）；⚠️ Prisma 7+adapter-pg 下 P2034 = `DriverAdapterError`（code undefined），检测要兼容。
- **outbox 事件**：`publish(tx, eventType, payload)` —— caller 传 tx，事件行与状态写**同 `$transaction`**，任一失败回滚。
- **scheduler**：批扫后**逐行独立 tx**（单行失败隔离）；与并发用户操作互斥靠谓词互斥 + 行写锁。
- **外部 I/O**：split-tx（TX1 PENDING → tx 外调 HTTP → TX2 标结果），**NEVER** tx 内持锁等 HTTP。
- **跨 ctx 写**：两段式 Inspect（读）+ Commit（写），**禁单 upsert**；护城河/传播细则见 [catalog](../../docs/conventions/server-bounded-context-catalog.md) + [`server-bounded-context-decision.md`](server-bounded-context-decision.md)。

## 安全

- **反枚举**：失败分支字节级一致折叠（剥 traceId 后深等）；public 无 token 流跑 **dummy-hash constant-time pad**（非 wall-clock sleep）。
- **哈希**：码/token 比较用 **HMAC-SHA256 constant-time**（ADR-0023），**NEVER bcrypt** 新代码。
- **PII**：AES-GCM 加密存 + 唯一 hash 防占位 + 终态才解密 + 掩码返回。
