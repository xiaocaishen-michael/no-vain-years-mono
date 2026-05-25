# 子 plan 2 — 新范式 + 老库业务级调研 + use case 依赖/迁移顺序

> 隶属 [account-migration master](05-25-account-migration-master.md)(主轨:迁移**分析/规划层**)。基准:ADR-0043 扁平贫血 + ADR-0032 bounded context + ADR-0019 Prisma + ADR-0030 包 5→2。
>
> **定位**:本子 plan 不写代码,产出 =(a)迁移目标**新范式**锚定 +(b)老库**业务级调研**(技术预研已完成)+(c)16 use case **依赖关系与迁移顺序**(谁先谁后 / 谁可并行)。输出喂给 [子 plan 3](05-25-account-migration-p3-usecase-steps.md)(逐 use case 详细迁移步骤)。
>
> **设计输入吸收**:原 `05-19-plan3-pre-plan-inventory.md`(16 use case 清单 + 风险 + ambiguous decisions)已于 2026-05-25 吸收进本文 § 4 + § 6 后删除。

## 1. Context

mbw-account 后端 16 use case 从旧 Java/Spring 迁移到 mono(NestJS + Prisma)。Plan 1 PoC(`UnifiedPhoneSmsAuth`)+ 批 A(`002-account-profile`:GetAccountProfile + UpdateDisplayName)已 ship,剩 14 个 use case(批 B-E)待迁。

迁移走 per-feature SDD(详见 [master § 跨契约](05-25-account-migration-master.md));本子 plan 先把"**怎么迁、按什么顺序迁、每个 use case 业务上做什么**"分析清楚,避免逐 feature 起手时临时摸索。技术栈预研已在 Plan 1 完成(Prisma / jose / throttler / Testcontainers 全验证);**本子 plan 聚焦业务语义 + 依赖拓扑**。

## 2. 迁移目标:新架构 / 新范式

迁移不是 Java→TS 逐行翻译,而是**落到 mono 已确立的新范式**(大重构 ADR-0030/0032/0043 后):

| 维度 | 旧 Java | mono 新范式 | ADR |
|---|---|---|---|
| 模块内构 | hexagonal(domain/application/infrastructure/web 分层) | **扁平贫血**:`apps/server/src/<module>/` 文件平铺,无层子目录 | [0043](../../adr/0043-server-flat-module-paradigm.md) |
| 模块边界 | Spring Modulith + ArchUnit | **bounded context**(auth / account / security)+ eslint-plugin-boundaries 单向 | [0032](../../adr/0032-backend-bounded-context.md) |
| 持久层 | JPA Entity + MapStruct Mapper + Row→POJO | **Prisma raw row + `@map` camelCase**,null 穿透 UseCase/Rules 当真相,**禁 Row→POJO Entity Mapper** | [0019](../../adr/0019-orm-prisma.md) + memory `raw_prisma_row_with_map_no_entity_mapper` |
| 限流 | Bucket4j Redis | @nestjs/throttler + throttler-storage-redis | [0022](../../adr/0022-throttler-nestjs-redis.md) |
| 跨 context 通信 | Spring ApplicationEventPublisher | outbox_event 表 + cron publisher(per [0033](../../adr/0033-outbox-cross-context-comm.md)) | 0033 |
| 共享包 | 5 个 Expo 内部包直搬 | **5→2**:仅 `packages/api-client` + `packages/types`;`auth`/`ui`/`design-tokens` 内联 `apps/mobile/src/{auth,ui,theme}` | [0030](../../adr/0030-package-decomposition.md) |
| 跨 context 写护城河 | — | 两段式委托(Inspect 只读 + Commit 写),禁单 upsert use case | memory `cross_ctx_login_two_step_saga` |

> ⚠️ **不照搬旧 ORM/限流/分层**。迁移时 Java UseCase 的业务规则保留,但落地形态按上表新范式重写。

## 3. 老库业务级调研(逐 use case)

技术预研已完成 → 本节做**业务级**:从老库 `~/Documents/projects/no-vain-years/`(meta `specs/` + 旧 Java `my-beloved-server/mbw-account/` + 旧 app)逐 use case 抽取业务语义,作为子 plan 3 迁移步骤的输入。

**调研 7 维**(每个 use case 一张业务卡,子 plan 3 起手前对照 meta spec 展开):

1. **业务触发**:谁在什么场景调用(client user-journey)
2. **前置状态**:依赖账号/token/code 处于何种状态(如「仅 FROZEN-in-grace 可取消注销」)
3. **核心业务规则**:状态机转换 / 不变量(如「冻结 15 天」「实名同 ID 不可多账号占用」)
4. **边界条件**:输入校验、长度/格式、码点边界(参考批 A 的 SC-006 8 边界)
5. **错误码语义**:各失败分支的 ProblemDetail code(与反枚举一致性约束)
6. **安全约束**:反枚举(响应 byte-equal / timing defense)、并发控制(乐观/悲观锁)
7. **user-journey**:旧 app 对应屏 + 跳转

**已知业务规则概览**(从旧 Java 源码实证提炼,子 plan 3 深化):

| use case | 关键业务规则(业务级) | 安全/并发要点 |
|---|---|---|
| RefreshToken | token 轮换(revoke 旧 + 签新)、设备元数据继承、IP 更新 | 乐观锁(revoke affected count) |
| LogoutAllSessions | revoke account 全部 refresh token(幂等) | 无 |
| SendDeletionCode | 生成 DELETE_ACCOUNT 码、SMS 下发(tx 外) | SHA-256 code hash |
| DeleteAccount | 验码 → 账号置 FROZEN + freezeUntil(15 天)→ revoke 全 token → 发 `AccountDeletionRequestedEvent` | outbox 同 tx |
| SendCancelDeletionCode | **反枚举 4 分支**:仅 FROZEN-in-grace 真发码,其余 200 但无 SMS + timing defense dummy | timing defense |
| CancelDeletion | 验码 → FROZEN→ACTIVE → 重发 token → 发 `AccountDeletionCancelledEvent` | **悲观锁** findByPhoneForUpdate(spec SC-007) |
| AnonymizeFrozenAccount | scheduler(每日触发)freezeUntil 过期 → FROZEN→ANONYMIZED → strategy 清 token/sms → 发 `AccountAnonymizedEvent` | **悲观锁** + REQUIRES_NEW;与 CancelDeletion 互斥 |
| ListDevices | 分页活跃 token、IP 地理解析、当前设备标记(did claim) | ip2region geo |
| RevokeDevice | 撤销单设备 token、防自撤、幂等、发 `DeviceRevokedEvent` | 乐观锁 |
| InitiateRealname | **split-tx**:TX1 存 PENDING → tx 外调 cloudauth → TX2 失败 mark FAILED;防重复验证 + 同 ID 防多账号占用;加密存 realName/idCardNo | DataIntegrityViolation(idCardHash 唯一) |
| ConfirmRealname | 轮询 provider、状态转换 VERIFIED/FAILED、幂等(已终态直接返回) | 外部 HTTP 超时传播 |
| QueryRealnameStatus | 查询 + 解密 + 掩码返回 | 无 |

> 调研产出 = 上述业务卡(逐 use case),子 plan 3 据此定义"旧业务规则 → 新 spec FR → 测试断言"的映射。

## 4. use case 依赖关系与迁移顺序（实证刷新）

> **数据源**:旧 Java `mbw-account` 16 UseCase 源码实证(`~/Documents/projects/no-vain-years/my-beloved-server/mbw-account/`)+ mono Prisma schema 现状。

### 4.1 mono 现状:迁移不卡"建表"

W1.4 `db pull` 已把旧 Java 全部 **6 张表**反推进 `apps/server/prisma/schema.prisma`:`account` / `credential` / `account_sms_code` / `refresh_token` / `realname_profile`(均 `@@schema("account")`) + `outbox_event`(`public`)。**剩余 use case 迁移 = 业务逻辑 + repository + controller + 测试,不是表 schema**。

共享基础设施(Plan 1 + 批 A **已就位**):jose token 签发 / SmsCode 存储(HMAC)/ @nestjs/throttler 限流 / timing defense(HMAC constant-time)/ refresh_token 持久化 / outbox skeleton + cron publisher。
**待建**(随对应批次):outbox **真消费方**(批 C)/ ip2region geo(批 D)/ Aliyun cloudauth + split-tx transaction service(批 E)。

### 4.2 实体读写矩阵(谁写 / 谁读 Prisma model)

| model | 写入方 use case | 读取方 use case |
|---|---|---|
| `account` | UnifiedPhoneSmsAuth(create+lastLogin)✅ · UpdateDisplayName✅ · DeleteAccount(→FROZEN) · CancelDeletion(→ACTIVE) · AnonymizeFrozenAccount(→ANONYMIZED) | GetAccountProfile✅ · RefreshToken · DeleteAccount · CancelDeletion · InitiateRealname |
| `refresh_token` | UnifiedPhoneSmsAuth(save)✅ · RefreshToken(rotate) · LogoutAllSessions(revoke all) · DeleteAccount(revoke all) · CancelDeletion(save) · AnonymizeFrozenAccount(strategy) | ListDevices · RevokeDevice · RefreshToken |
| `account_sms_code` | SendDeletionCode · SendCancelDeletionCode · DeleteAccount(used) · CancelDeletion(used) · AnonymizeFrozenAccount(delete all) | DeleteAccount · CancelDeletion |
| `realname_profile` | InitiateRealname(PENDING) · ConfirmRealname(VERIFIED/FAILED) | QueryRealnameStatus · ConfirmRealname |
| `credential` | UnifiedPhoneSmsAuth(register 分支)✅ | — |
| `outbox_event` | DeleteAccount · CancelDeletion · RevokeDevice · AnonymizeFrozenAccount(事件发布) | outbox cron publisher(skeleton ✅,真消费方批 C) |

(✅ = 该读/写路径已随 Plan 1 / 批 A 在 mono ship)

### 4.3 use case 间依赖链(有向:A → B 表示 B 依赖 A)

强时序前置(迁移 + 测试必须遵守):

1. **RequestSmsCode → UnifiedPhoneSmsAuth**(验码消费发码)— ✅ 均已 ship
2. **UnifiedPhoneSmsAuth → RefreshToken**(登录发的 refresh token 由 refresh 流轮换)
3. **UnifiedPhoneSmsAuth/RefreshToken → {LogoutAllSessions, ListDevices, RevokeDevice}**(共操作 `refresh_token` 同一资源)
4. **SendDeletionCode → DeleteAccount**(发码 → 验码冻结)
5. **DeleteAccount(→FROZEN) → {SendCancelDeletionCode, CancelDeletion}**(仅 FROZEN-in-grace 可取消)
6. **CancelDeletion → RefreshToken**(恢复 ACTIVE 后重发 token)
7. **DeleteAccount(→FROZEN) → AnonymizeFrozenAccount**(freezeUntil 过期后 scheduler 转 ANONYMIZED;与 CancelDeletion **悲观锁互斥**)
8. **InitiateRealname → ConfirmRealname → QueryRealnameStatus**(PENDING → 轮询 → 查询)

**批 C 内核心串行链(不可并行)**:`SendDeletionCode → DeleteAccount → SendCancelDeletionCode → CancelDeletion`;`AnonymizeFrozenAccount` 是该链下游清理 + outbox 真消费侧(scheduler 触发,REQUIRES_NEW + 悲观锁)。

### 4.4 Phase A-E 迁移顺序(依赖校准 + mono 状态）

顺序逻辑:批 A/B 立 account + token 基座 → 批 C 依赖 token 基座做删除/冻结 → 批 D 复用 refresh_token 读侧 → 批 E 自成一域(realname,仅依赖 account)。**批 D / E 在批 B 完成后可与批 C 并行**(无共享可变状态)。

| # | feature spec | use case | mono 状态 | 复杂度 | 关键依赖 / 风险 | 并发控制 |
|---|---|---|---|---|---|---|
| **A** | `002-account-profile` | GetAccountProfile + UpdateDisplayName | ✅ **已 ship**(#65) | 低 | 仅 `account` 读写 | 无 |
| **B** | `003-tokens` | RefreshToken + LogoutAllSessions | ⬜ 待迁(**下一个**) | 中 | token 基座(jose 已有)+ 并发续期 | 乐观锁(revoke count) |
| **C** | `004-account-deletion` | SendDeletionCode / DeleteAccount / SendCancelDeletionCode / CancelDeletion / AnonymizeFrozenAccount | ⬜ 待迁 | **高** | outbox **真消费方** + 串行链 + 反枚举 timing | **悲观锁**(CancelDeletion ⟷ Anonymize 互斥)+ outbox 同 tx |
| **D** | `005-device-management` | ListDevices + RevokeDevice | ⬜ 待迁(可与 C 并行) | 中 | ip2region geo + DeviceRevokedEvent | 乐观锁(revoke count) |
| **E** | `006-realname-verification` | Initiate + Confirm + QueryRealnameStatus | ⬜ 待迁(可与 C/D 并行) | **最高** | **split-tx**(外部 HTTP 不可在 tx 内持锁)+ cloudauth + 加密字段 | DataIntegrityViolation(idCardHash 唯一) |

每个 feature = 1 个 `specs/NNN-<slug>/` 目录(per ADR-0024 扁平布局)。逐 use case 的详细迁移步骤见 [子 plan 3](05-25-account-migration-p3-usecase-steps.md)。

## 5. 迁移测试策略 + mobile 同步范式

### 5.1 测试策略(Java IT 作业务断言源,不直搬)

- **新写 TS 测试通过 = 合格信号**(unit + integration + e2e via Vitest + Testcontainers)
- **抽取** Java IT 的业务规则 / 边界 / 安全约束 / 性能指标(如 timing P95 ≤ 50ms / 反枚举三路径统一 / outbox 并发原子性),TS 等价断言重写(Testcontainers PG+Redis+WireMock)
- **不复刻** Java 测试代码结构(@SpringBootTest → `@nestjs/testing` + supertest / Fastify inject)
- 关键安全 IT:`SingleEndpointEnumerationDefenseIT` → per-feature 业务等价(refresh/logout/delete 须各自决是否需同等 timing defense,per [ADR-0023](../../adr/0023-sms-code-storage-hmac.md));4 个并发 IT(refresh/deletion/anonymization)→ 新写 vitest 并发测试
- **mobile 测试新写**:旧 34 个 vitest 全弃(mock-first 已与新 server API drift),per feature 新写 Vitest + RTL

### 5.2 mobile per-feature 同步范式

1. 每个 `NNN-<slug>` feature **同 1 PR 包 server + mobile**(ADR-0024 三位一体)
2. 共享代码 per [ADR-0030](../../adr/0030-package-decomposition.md) 5→2:`api-client`(hey-api)+ `types` 独立包;`auth`/`ui`/`design-tokens` 内联 `apps/mobile/src/{auth,ui,theme}`,内部实现重写
3. mobile 路由沿用旧 Expo Router 结构(login/onboarding/tabs/settings),hooks/components/状态管理重写
4. 占位 UI 4 边界(per [ADR-0017]):phase 1 裸 RN 占位,phase 2 mockup 回填

## 6. Open questions(含原 inventory § 9 的 ambiguous decisions,2026-05-25 结算)

| # | 问题 | 状态 |
|---|---|---|
| 1 | 起手 use case 粒度(1 PR / batch / 严格 SDD) | ✅ 已定:per-feature SDD,server+mobile 同 1 PR(批 A 实证) |
| 2 | mobile 迁入时机 | ✅ 已定:Phase A 同期迁入(`apps/mobile` 已 bootstrap) |
| 3 | api-client 冲突(hey-api vs OpenAPI Generator) | ✅ 已定:hey-api 为准,旧客户端全弃 |
| 4 | `packages/types` 用 prisma-nestjs-graphql / 手写 / `@prisma/client` 直 export | ⬜ **open**:批 B 起手时决 |
| 5 | ADR-0022 throttler backfill | ✅ 已立(#30) |
| 6 | realname split-tx transaction service 接口形状 | ⬜ **open**:批 E `006` spec/plan 阶段决 |
| 7 | 每个 use case 的 server spec ↔ app spec 合并约束 | ⬜ **open**:每 feature `/speckit-specify` 前 user 给(硬 gate,详 master) |

## 7. Critical files + Verification

**Critical files**:

```
docs/plans/2026-05/05-25-account-migration-master.md       # 主 plan(统领)
docs/plans/2026-05/05-25-account-migration-p3-usecase-steps.md  # 子3:本子 plan 输出的下游
~/Documents/projects/no-vain-years/                        # 旧 meta 仓(业务调研源:meta specs + Java + 旧 app)
~/Documents/projects/no-vain-years/my-beloved-server/mbw-account/  # 旧 Java 16 UseCase 源码
docs/adr/0019-orm-prisma.md / 0030 / 0032 / 0043           # 迁移目标新范式锚定
apps/server/prisma/schema.prisma                           # 6 表已 db pull
specs/002-account-profile/                                 # 批 A 已 ship,迁移参考样板
```

**Verification**(本子 plan 自身):

- ☐ § 2 新范式表覆盖 ORM/边界/限流/通信/包 5 维,各锚 ADR
- ☐ § 3 业务调研 7 维框架 + 12 use case 业务规则概览表齐全
- ☐ § 4 依赖图自洽(实体读写矩阵 + 有向链 + 批次顺序 + 并行性),无 TypeORM/Bucket4j 错栈词
- ☐ 迁移顺序结论:批 B 下一个、批 C 串行链、批 D/E 可与 C 并行 — 与依赖链一致
- ☐ 输出可直接喂子 plan 3(每 use case 有业务卡 + 依赖 + 复杂度 + 并发要点)
