---
adr_id: ADR-0022
status: Accepted
applies_to: [apps/server]
sunset_trigger: |
  - @nestjs/throttler 维护停滞
  - 性能瓶颈触发 distributed rate limit 需求
  - Redis 切其他 KV store (DragonflyDB / KeyDB / Memorystore)
---

# ADR-0022: 限流 — @nestjs/throttler v6 + @nest-lab/throttler-storage-redis (取代 meta Bucket4j + JCache→Redis)

- Status: Accepted (2026-05-19) — **backfill**(实装已落,本 ADR 追溯立)
- Deciders: project owner
- Tags: backend / security / cross-cutting
- Supersedes: [ADR-0011 rate-limit-jcache-then-redis](https://github.com/xiaocaishen-michael/no-vain-years-meta/blob/main/docs/adr/0011-rate-limit-jcache-then-redis.md)(meta-repo Java/Spring Bucket4j 方案)

## Context

mono Plan 1 起立栈即决定 ditch Java/Spring → NestJS + Fastify + Prisma + Nx(per [ADR-0018](0018-backend-language-pivot.md))。其中 ADR-0018 § 57 + Plan 1 § G.1 ADR cross-ref 矩阵明确:meta-repo ADR-0011(JCache→Redis Bucket4j) **留待 Plan 2 立 ADR-0022** 替代为 NestJS-friendly 方案。

W3 阶段(2026-05-17 ~ 18) US1 A1/A2 task 实装 `/sms-codes` 限流:

- `apps/server/package.json`: `@nestjs/throttler@^6.5.0` + `@nest-lab/throttler-storage-redis@^1.2.0`(pnpm-lock 6.5.0 / 1.2.0 ship)
- `apps/server/src/auth/auth.module.ts` § 57-83:`ThrottlerModule.forRootAsync` 配 3 throttler + Redis storage
- `apps/server/src/auth/web/sms-phone-throttler.guard.ts`:`extends ThrottlerGuard` override `getTracker` → `sms:<phone>` key
- `apps/server/src/auth/web/account-sms-code.rate-limit.it.spec.ts`:Testcontainers Redis IT 实证 60s 1x rule

[spec FR-S07](../../specs/001-phone-sms-auth/spec.md) 限流规则 4 条:

| #   | 规则                                  | 实装层                                                                                                                                                                |
| --- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `sms:<phone>` 60s 1 次                | ThrottlerModule default throttler + `SmsPhoneThrottlerGuard.getTracker`                                                                                               |
| 2   | `sms:<phone>` 24h 10 次               | ThrottlerModule named `sms-phone-24h` + 同 guard tracker                                                                                                              |
| 3   | `sms:<ip>` 24h 50 次                  | ThrottlerModule named `sms-ip-24h` + per-throttler `getTracker`(req.ip)                                                                                               |
| 4   | `auth:<phone>` 24h 5 次失败后锁 30min | **不**走 throttler(职责"重复失败" ≠ "请求频率");由 `AuthFailureLockService`(`apps/server/src/auth/infrastructure/auth-failure-lock.service.ts`)独立 Redis bucket 实现 |

W3 ship 时直接落 code 未先立 ADR(deferred per [Plan 1](../plans/2026-05/05-18-plan1-backend-stack-poc.md) § G.1 + ADR-0018 § 57 占位);Plan 2 Phase 0 § 2.2.2 task backfill。

## Decision

mono 限流栈固化为:

1. **NestJS module**:`@nestjs/throttler@^6.5` — NestJS 官方一等公民 module,Guard 系统 native 集成,decorator 体例(`@Throttle()` / `@SkipThrottle()`)与 NestJS controller 习惯一致
2. **Storage**:`@nest-lab/throttler-storage-redis@^1.2`(社区 nest-lab,@nestjs/throttler 文档明确 recommend 的 Redis adapter)— 支持多 throttler 共享同 Redis instance + atomic INCR + TTL
3. **多 throttler**:`ThrottlerModule.forRootAsync({ throttlers: [...] })` 同一 module 内组合多条规则(per-route 默认全部 enforce,无 `@Throttle` decorator 时 v6+ 默认 enforce 所有);per-throttler `getTracker` 让 phone-key + ip-key 混用干净
4. **Custom guard**:`SmsPhoneThrottlerGuard extends ThrottlerGuard` override module-level default tracker,从 IP 改为 `sms:<phone>` body 字段;无 phone 时保守 fallback IP(`unknown` 兜底)
5. **不复用 `REDIS_CLIENT` provider**:`ThrottlerModule.forRootAsync` useFactory 内 `new Redis(config.getOrThrow('REDIS_URL'))` 创**独立** ioredis instance(不注入 REDIS_CLIENT)— **临时妥协**,见 § Consequences Negative

## Consequences

### Positive

- **NestJS-native** — Guard / Module / DI / decorator 全在 NestJS 心智模型内,无 express middleware 阻抗;`@nestjs/throttler` 由 NestJS core team 维护,API 稳定,major bump 节奏与 NestJS core 对齐
- **Per-throttler getTracker(v6 新)** — phone-key + ip-key 混用不再需要写多个 guard;module 级 config 即可声明性表达 FR-S07 #1/2/3 完整规则
- **Atomic Redis INCR + TTL** — 多 server pod / 弹性扩缩时限流计数共享,无 split-brain;`@nest-lab/throttler-storage-redis` 内部 INCR+EXPIRE atomic Lua,符合 redis-rate-limit 共识
- **职责分离** — throttler(请求频率)与 `AuthFailureLockService`(重复失败 → 锁定)各管一层;mono FR-S07 #4 不绕 throttler,符合"业务语义 ≠ 频率限流"原则,长期可演化(锁定语义 + 解锁 + freeze 期协同)
- **测试体例** — Testcontainers Redis 实证(`account-sms-code.rate-limit.it.spec.ts`)而非 mock storage,IT 跑真 INCR / TTL 行为,catch upstream library 行为回归
- **Bucket4j 概念迁移成本 0** — meta ADR-0011 时代 Bucket4j 已 ditch,无遗留 token-bucket vs sliding-window 算法差异迁移负担;@nestjs/throttler 内置 sliding-window 等价(实为 fixed window with reset,对 SMS 这种秒级 / 小时级阈值精度无影响)

### Negative / Trade-offs

- **独立 ioredis instance 而非复用 `REDIS_CLIENT`** — auth.module.ts § 60 在 ThrottlerModule.forRootAsync useFactory 内 `new Redis(...)` 创独立连接,不复用 providers § 94 的 `REDIS_CLIENT` provider;额外 1 TCP 连接每 server pod。**根因**:ThrottlerModule 的 storage option 要求 sync 提供 `ThrottlerStorage` 实例,而 NestJS DI 在 `forRootAsync` useFactory inject 是 sync resolution 阶段,inject `REDIS_CLIENT` token 需复杂 `forwardRef` / module 依赖排序。**缓解**:单 server pod 多 1 连接对 Redis 容量无影响(< 0.01% 连接池消耗);Plan 2+ 若 module 拆分到独立 `InfraModule` 集中管 Redis,可同步消除
- **Storage adapter 是社区(non-official)package** — `@nest-lab/throttler-storage-redis` 不在 @nestjs scope 下;**缓解**:nest-lab 是 @nestjs/throttler README 明确 recommend 的 first-class adapter,GitHub 由 NestJS core contributor (kkoomen) 维护,与 throttler core lockstep 升级
- **fixed-window 计数(非 true sliding-window)** — `@nestjs/throttler` v6 内部 INCR+TTL 等价 fixed window;边界场景(window-boundary 双倍突发)理论存在。**缓解**:SMS 60s 1 次 / 24h 10 次 等阈值对 ±100% 边界突发不敏感(用户视角:60s 内最多 2 次仍 < SMS gateway 1s rate-limit);若 M2+ 需要严格 sliding 可换 `rate-limiter-flexible` 但需重写 NestJS guard wrapper
- **FR-S07 全 4 条 e2e IT 缺位** — W3 仅落 IT 覆盖第 1 条 60s 1x;第 2/3 条(24h 阈值)+ 第 4 条(auth lock)完整 e2e 验证 deferred 到 Plan 2 SC-S04 IT;**缓解**:单条 IT + module config code review 覆盖语义正确性,24h window IT 落地见 Plan 2 W2-3
- **Throttler decorator 缺位** — `@Throttle()` decorator 未在 controller 级覆盖,完全依赖 module-level default + custom guard `@UseGuards(SmsPhoneThrottlerGuard)`;**理由**:phone-sms-auth 是 mono 当前唯一限流端点,3 throttler 全部 enforce 即 FR-S07 #1-3 全覆盖,无 per-endpoint override 需求;Plan 2 多端点引入时再评估

## Alternatives Considered

- **自实现 Redis Lua INCR + TTL** — 拒绝:~200 LoC 业务无关代码,catch Redis cluster failover / Lua eval 边界场景需自测;`@nestjs/throttler` 久经验证,无 reinvent 价值
- **`rate-limiter-flexible`** — 拒绝:express-friendly,NestJS 集成需自写 guard wrapper;支持 true sliding-window 是优势但 mono 当前 fixed-window 已满足;若 M2+ 严格 sliding 需求出现可再评估迁移
- **`express-rate-limit`** — 拒绝:apps/server 走 Fastify adapter(per Plan 1 选型),@nestjs/throttler 与 platform-fastify / platform-express 双适配;express-rate-limit 强依赖 express,与 Fastify-first 选型冲突
- **`bottleneck`** — 拒绝:client-side rate-limit / job queue 工具,scope 是"出向限速",不是"入向请求计数",场景不匹配
- **Bucket4j-js port** — 拒绝:meta-repo 时代 Bucket4j(Java) 用 token-bucket 算法精度高,但 JS 生态无 first-class port;@nestjs/throttler fixed-window 对 SMS 阈值精度已够
- **NestJS interceptor 实现限流** — 拒绝:interceptor 跑在 route handler 之前 + Guard 之后,但 Guard 是 NestJS 设计中"准入控制"语义层(返 403/429 而非 transformer);用 Guard 符合 NestJS 心智
- **保留 ADR-0011 (Bucket4j + Redis)** — 不适用:Plan 1 ADR-0018 已 ditch Java/Spring 栈,Bucket4j(Java only)无路可走;此为"超出选型范围"而非"被拒绝"

## Validation

- **实装锚点**(W3 ship,2026-05-18):
  - `apps/server/package.json` § 12 + § 19:`@nest-lab/throttler-storage-redis@^1.2.0` + `@nestjs/throttler@^6.5.0`
  - `apps/server/src/auth/auth.module.ts` § 57-83:`ThrottlerModule.forRootAsync` 3 throttler config
  - `apps/server/src/auth/web/sms-phone-throttler.guard.ts`:`SmsPhoneThrottlerGuard extends ThrottlerGuard`
  - `apps/server/src/auth/web/account-sms-code.controller.ts` § 24:`@UseGuards(SmsPhoneThrottlerGuard)`
- **IT 覆盖**(W3 ship):
  - `apps/server/src/auth/web/account-sms-code.rate-limit.it.spec.ts`:Testcontainers Redis,验 60s 1 次 rule + 429 + `Retry-After` header
- **deferred 验证**:
  - FR-S07 #2 (phone 24h 10x) + #3 (ip 24h 50x) 完整 e2e IT — Plan 2 SC-S04 落
  - FR-S07 #4 (auth:<phone> 5x lock 30min) — 独立 `AuthFailureLockService`,不在本 ADR 范围,IT 由 `phone-sms-auth.usecase.spec.ts` 覆盖
- **meta ADR-0011 supersede 标记**:[Plan 1 § G.1 ADR matrix](../plans/2026-05/05-18-plan1-backend-stack-poc.md) line 385 已先标 superseded → ADR-0022(本文件);ADR-0018 § 57 reference 同步生效

## References

- [Plan 1 § G.1 ADR cross-ref 矩阵](../plans/2026-05/05-18-plan1-backend-stack-poc.md) line 385
- [ADR-0018 backend-language-pivot](0018-backend-language-pivot.md) § 57
- [spec FR-S07](../../specs/001-phone-sms-auth/spec.md) line 154-158
- [@nestjs/throttler v6 docs](https://docs.nestjs.com/security/rate-limiting) — module config / decorator / guard / storage adapter
- [@nest-lab/throttler-storage-redis](https://github.com/nest-lab/throttler-storage-redis) — Redis adapter for @nestjs/throttler
- meta ADR-0011(rate-limit-jcache-then-redis,JCache→Redis Bucket4j)— superseded
