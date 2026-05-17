[TASK CLOSURE CONVENTION — prepended by michael-speckit-presets/task-closure preset]

Every task heading uses spec-kit native checkbox state:

- `- [ ]` = pending
- `- [X]` = completed (flipped by /speckit.implement after the task ships)

**Per-task closure protocol** (executed inside /speckit.implement):

1. Complete TDD cycle (red → green); pass lint + typecheck.
2. In tasks.md, flip the task heading's `[ ]` to `[X]`.
3. `git add` implementation + tests + **tasks.md in the same stage**.
4. Proceed to commit.

**Hard rule**: tasks.md MUST be staged in the same commit as implementation
code. The /speckit-tasks-verify hook (after_implement) reports any divergence.

[END TASK CLOSURE CONVENTION]

[CONTEXT7 GROUNDING (IMPLEMENT PHASE) — prepended by michael-speckit-presets/context7-injection preset]

When /speckit.implement executes a task that uses a third-party library
class / function / API (i.e., NOT project-internal code or well-established
stdlib):

1. BEFORE writing the impl, call `mcp__context7__query-docs` with a specific
   question about the EXACT API surface needed.
2. Verify the import path + method signature match current docs.
3. If the impl-time API diverges from what plan.md cited, note the divergence
   in the impl commit message.

[END CONTEXT7 GROUNDING (IMPLEMENT PHASE)]

---

# Tasks: Phone SMS Auth (W2 server scope)

**Input**: Design documents from [`specs/auth/phone-sms-auth/`](./)
**Prerequisites**: spec.md ✅ + plan.md ✅
**Tests**: **MANDATORY**（Constitution Principle II Test-First TDD NON-NEGOTIABLE）— 不是 OPTIONAL

**Organization**: Tasks 按 spec User Story 分 phase；US1/US2/US3 是 P1 server-impl 焦点；US4 限流 defer W3；US5 client-only defer W4+。

## Format

`[ID] [P?] [Story] Description in src/path/file.ts`

- **[P]**: 可并行（不同文件 + 无依赖）
- **[Story]**: US1 / US2 / US3 / Foundational（不绑 US）
- 路径相对 mono root

## Path Conventions

- Source: `apps/server/src/auth/{domain,application,infrastructure,web}/`
- Test: 单测与源码 co-located（`*.spec.ts`）；integration test `apps/server/test/integration/`
- DB / Redis 走 mono `docker-compose.dev.yml`（已启 5433 / 6380）

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Constitution IV gate + 测试框架 + lint 闭环。Implement 前 mandatory。

- [X] T001 装 vitest 2 + @nx/vite + 配 nx test target 在 `apps/server/project.json`（Constitution II TDD prerequisite；CI 加 `Test (nx test server)` job + mono ruleset required check）
- [X] T002 装 `eslint` 9 flat config + `@nx/eslint` + `eslint-plugin-boundaries` + 配 4 类规则在 `apps/server/eslint.config.mjs`（domain ↛ infra/web / web ↛ infra / 跨 module 经 api / shared ↛ business）+ 配 nx lint target；CI 加 `Lint (nx lint server)` job + ruleset required check（Constitution IV gate）
- [X] T003 [P] 装 `class-validator` `class-transformer` 已在 W1.4 ship；verify `apps/server/main.ts` 全局 `ValidationPipe({ transform: true, whitelist: true })` 已配（spec FR-S04）— **verified** main.ts:1+18
- [X] T004 [P] 验证 W1.4 db pull 后 Prisma schema 含 `account` 表（id / phone / status enum / created_at / last_login_at）+ `event_publication` 表（id / event_type / payload Json / published_at / created_at）；缺则补 migration（FR-S11 outbox）— **verified** schema.prisma 含 model account / model event_publication

**Checkpoint**: Setup done → nx test / nx lint 在 CI 必跑；implement phase 可启动

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: 跨 US 复用基础设施（VO / ports / module skeleton / global filter）；所有 US 实现前必跑完

- [X] T005 创建 `apps/server/src/auth/auth.module.ts` skeleton（NestJS `@Module({ imports: [], providers: [], exports: [] })`）+ 在 `app.module.ts` import；空 module 跑通 server bootstrap（typecheck pass）
- [X] T006 [P] 实装 RFC 9457 `ProblemDetailFilter` in `apps/server/src/auth/infrastructure/problem-detail.filter.ts`（NestJS `@Catch()` 全局 filter；映射 `BadRequestException` / `UnauthorizedException` / `HttpException` → `application/problem+json`）+ 单测 (FR-S10)
- [X] T007 [P] [Domain] 实装 Phone VO in `apps/server/src/auth/domain/phone.vo.ts`（E.164 +86 regex 校验 `/^\+861[3-9]\d{9}$/` + trim + immutable class）+ 单测覆盖合法 / 不合法 / 边界
- [X] T008 [P] [Domain] 实装 SmsCode VO in `apps/server/src/auth/domain/sms-code.vo.ts`（6 digit `^\d{6}$` + immutable + verify(other) 方法）+ 单测
- [ ] T009 [Infra] 实装 `JwtTokenService` in `apps/server/src/auth/infrastructure/jwt-token.service.ts`（封装 `@nestjs/jwt` `JwtService.sign(payload, { expiresIn: '15m' })` + `crypto.randomBytes(32).toString('base64url')` 生 256-bit refresh；从 `ConfigService.getOrThrow('AUTH_JWT_SECRET')` 拿 secret）+ 单测（FR-S09）
- [ ] T010 [P] [Domain] 实装 `Account` aggregate in `apps/server/src/auth/domain/account.aggregate.ts`（id / phone / status enum / lastLoginAt；business invariant `markLoggedIn()` / `isActive() / isFrozen() / isAnonymized()`）+ Prisma → Account adapter `Account.fromPrisma()` 工厂；单测
- [ ] T011 [P] [Domain] 实装 4 个 port interface in `apps/server/src/auth/application/ports/`：
  - `account.repository.port.ts`（`findByPhone(phone) / save(account) / updateLastLoginAt(id)`）
  - `sms-code.repository.port.ts`（`store(phone, code, ttlSec) / lookup(phone): SmsCode | null / clear(phone)`）
  - `sms-gateway.port.ts`（`send(phone, templateCode, params): Promise<void>`）
  - `outbox-publisher.port.ts`（`publish(eventType, payload): Promise<void>`）
  + 单测（interface 本身无测，但 fake 实现给后续 use case test 用）
- [ ] T012 [P] [Domain] 实装 `AccountCreatedEvent` in `apps/server/src/auth/domain/events/account-created.event.ts`（payload `{ accountId, phone, createdAt }`，类型 export 给 outbox 消费）+ 类型 test

**Checkpoint**: Foundational ready → US1/US2/US3 implementation 可启动（per 5 原则 III Atomic Task + II Test-First）

---

## Phase 3: User Story 1 — 已注册主流程 (P1) 🎯 MVP

**Goal**: ACTIVE 账号 phone+code 主流程登录，签 token + 更新 `last_login_at`

**Independent Test**: Testcontainers 启 PG+Redis+MockSms；preseed ACTIVE account → POST `/sms-codes` → POST `/phone-sms-auth` → 200 + tokens；DB last_login_at 更新

### Tests for US1 (Test-First per Constitution II)

- [ ] T013 [P] [US1] [Test] Vitest unit test for `AccountPrismaRepository.findByPhone` in `account.prisma.repository.spec.ts`（Testcontainers PG）— RED
- [ ] T014 [P] [US1] [Test] Vitest unit test for `SmsCodeRedisRepository.store + lookup + clear` in `sms-code.redis.repository.spec.ts`（Testcontainers Redis）— RED
- [ ] T015 [P] [US1] [Test] Vitest unit test for `RequestSmsCodeUseCase`（mock SmsGateway + SmsCodeRepo）— RED
- [ ] T016 [P] [US1] [Test] Vitest unit test for `PhoneSmsAuthUseCase` 已注册路径（mock AccountRepo + SmsCodeRepo + JwtTokenService）— RED
- [ ] T017 [P] [US1] [Test] Vitest e2e test `accounts.smoke.us1.e2e.spec.ts`（Testcontainers + Nest app + Fastify; preseed ACTIVE → POST endpoints → 200 assertions）— RED

### Implementation for US1

- [ ] T018 [Infra] [US1] 实装 `AccountPrismaRepository` in `apps/server/src/auth/infrastructure/account.prisma.repository.ts`（依赖 `PrismaService`；method `findByPhone` / `save` / `updateLastLoginAt`）— GREEN T013
- [ ] T019 [Infra] [US1] 实装 `SmsCodeRedisRepository` in `apps/server/src/auth/infrastructure/sms-code.redis.repository.ts`（依赖 ioredis client；`store(phone, code, ttl=300)` 写 `sms_code:<phone>` = bcrypt hash；`lookup` 取 + compare；`clear` del）— GREEN T014
- [ ] T020 [Infra] [US1] 实装 `MockSmsGateway` in `apps/server/src/auth/infrastructure/mock-sms.gateway.ts`（in-memory Map<phone, code>；log "发出"；export `getLastCode(phone)` 给 test 读）（W2 占位，W3 替 Aliyun）
- [ ] T021 [App] [US1] 实装 `RequestSmsCodeUseCase` in `apps/server/src/auth/application/request-sms-code.usecase.ts`（gen 6 digit code → store Redis + send via SmsGateway；returns void or `{ ttl }`）— GREEN T015
- [ ] T022 [App] [US1] 实装 `PhoneSmsAuthUseCase` 已注册路径 in `apps/server/src/auth/application/phone-sms-auth.usecase.ts`（findByPhone → 若 ACTIVE + code 匹配 → `markLoggedIn()` + `updateLastLoginAt` + sign tokens；返回 `{ accountId, accessToken, refreshToken }`）— GREEN T016
- [ ] T023 [Web] [US1] 实装 `AccountSmsCodeController` in `apps/server/src/auth/web/account-sms-code.controller.ts`（`POST /api/v1/accounts/sms-codes` + DTO `RequestSmsCodeRequest`）+ `AccountPhoneSmsAuthController` `POST /api/v1/accounts/phone-sms-auth` + DTOs；class-validator 装饰器 + transform；register in `auth.module.ts`
- [ ] T024 [US1] E2E smoke pass: GREEN T017（preseed ACTIVE account via Prisma 直接 insert → 2 endpoints 200 → tokens 验证 + last_login_at DB check）

**Checkpoint**: US1 MVP — 主流程已注册登录跑通；前后端可冒烟（前端 W4+ 接入时复用）

---

## Phase 4: User Story 2 — 未注册自动注册+登录 (P1 并列)

**Goal**: 未注册号 phone+任意 code（实际 code 来自 sms-codes endpoint）→ server 静默 transactional 创建 Account ACTIVE + 写 outbox event + 签 token；响应字节级与已注册路径同

**Independent Test**: 未注册 phone → POST `/sms-codes` → POST `/phone-sms-auth` → 200 + tokens；DB 新 account row（ACTIVE）；event_publication 新 outbox row

### Tests for US2

- [ ] T025 [P] [US2] [Test] Vitest unit `EventPublicationPrismaPublisher` in `event-publication.prisma.publisher.spec.ts`（Testcontainers PG；assert outbox row 写入 with eventType + payload Json + published_at = null）— RED
- [ ] T026 [P] [US2] [Test] Vitest unit `PhoneSmsAuthUseCase` 未注册路径（mock; assert: account.save + outboxPublisher.publish 都被调；返回 token）— RED
- [ ] T027 [P] [US2] [Test] Vitest unit 并发同号自动注册 race（Testcontainers PG；2 parallel `phone-sms-auth` for same NEW phone → 仅 1 row + 同 accountId 返）— RED
- [ ] T028 [P] [US2] [Test] Vitest e2e `accounts.smoke.us2.e2e.spec.ts`（未注册 phone → 2 endpoints → 200 + tokens + DB new account row + outbox row）— RED

### Implementation for US2

- [ ] T029 [Infra] [US2] 实装 `EventPublicationPrismaPublisher` in `apps/server/src/auth/infrastructure/event-publication.prisma.publisher.ts`（Prisma `eventPublication.create({ data: { eventType, payload, publishedAt: null } })`；在 outer transaction 内调）— GREEN T025
- [ ] T030 [App] [US2] PhoneSmsAuthUseCase amend 未注册路径（findByPhone returns null → wrap in `prisma.$transaction` with `isolationLevel: 'Serializable'`: account.create + outboxPublisher.publish(AccountCreatedEvent) + sign tokens；catch unique constraint violation → fallback to login path per FR-S08 sub-clause）— GREEN T026 + T027
- [ ] T031 [US2] E2E smoke pass: GREEN T028（响应 body / headers / status 与 US1 ACTIVE 路径**字节级一致**断言）

**Checkpoint**: US2 跑通；FR-S08 并发兜底验证；outbox event 写入

---

## Phase 5: User Story 3 — FROZEN/ANONYMIZED 反枚举 (P1 并列)

**Goal**: FROZEN / ANONYMIZED 账号即使提交正确 code 也返回 401 INVALID_CREDENTIALS（与码错完全一致字节级 + 时延 ≤50ms）

**Independent Test**: preseed FROZEN account + ANONYMIZED account；POST `/phone-sms-auth` with correct code → 401 与 ACTIVE+错码完全同响应；timing P95 差 ≤ 50ms

### Tests for US3

- [ ] T032 [P] [US3] [Test] Vitest unit `PhoneSmsAuthUseCase` FROZEN 路径（mock FROZEN account + correct code → throw `UnauthorizedException('INVALID_CREDENTIALS')`，不签 token，不调 markLoggedIn）— RED
- [ ] T033 [P] [US3] [Test] Vitest unit `PhoneSmsAuthUseCase` ANONYMIZED 路径（同上 mock + ANONYMIZED）— RED
- [ ] T034 [P] [US3] [Test] Vitest unit timing defense（mock 不存在的 phone + correct code → dummy bcrypt compare 走完 → timing 与已注册码错路径差 ≤ 5ms in-process）— RED
- [ ] T035 [P] [US3] [Test] Vitest e2e `accounts.smoke.us3.e2e.spec.ts` 反枚举 4 路径字节级一致（已注册+码错 / FROZEN+正确码 / ANONYMIZED+正确码 / 未注册号+任意码 NOT — 后者自动注册成功）；diff response body+headers+status 3 个 401 路径 100% equal — RED

### Implementation for US3

- [ ] T036 [App] [US3] PhoneSmsAuthUseCase amend FROZEN/ANONYMIZED 路径（findByPhone returns account；若 status !== ACTIVE → 仍走 SmsCodeRepo.lookup + 比对（time-equalize）→ throw UnauthorizedException('INVALID_CREDENTIALS')，不签 token）— GREEN T032+T033
- [ ] T037 [App] [US3] PhoneSmsAuthUseCase timing defense（"已注册码错 / FROZEN+正确码 / ANONYMIZED+正确码" 3 路径走完全相同 code path until throw；用 dummy bcrypt + same-shape exception）— GREEN T034
- [ ] T038 [US3] E2E smoke pass: GREEN T035（4 路径响应字节级 diff assertion；timing P95 测量 in-process）

**Checkpoint**: US3 反枚举验收；SC-S03 字节级一致 satisfied

---

## Phase N: Polish & V1/V2 Acceptance

**Purpose**: Plan 1 § E.3 V1/V2 验收 + cross-cutting cleanup

- [ ] T039 [P] V1 验收：`cloc apps/server/src/auth` 测量 LoC + 对比旧 Java `mbw-account/src/main/java/com/mbw/account/{domain,application,infrastructure,web}` 等价类（`UnifiedPhoneSmsAuthUseCase` + `RequestSmsCodeUseCase` + 配套 Repository / Service / Controller / DTO / Config）；ratio ≤ 1.5x 才 pass；写报告到 `specs/auth/phone-sms-auth/v1-loc-report.md`
- [ ] T040 [P] V2 验收：`pnpm nx run server:lint` 0 violation；手测 4 类规则各写 1 个 forbidden import → 验证 lint err；写报告到 `specs/auth/phone-sms-auth/v2-boundary-report.md`
- [ ] T041 [P] AccountCreatedEvent outbox subscriber placeholder（W3+ 真消费方 — 例：写 search-index / send welcome SMS — 都是后续 use case 范围；W2 placeholder 仅留 cron job skeleton scan `published_at IS NULL` 并 mark as published 即可，避免 W3+ 加 subscriber 时找不到 trigger）
- [ ] T042 V3 (CI required): mono main-protection ruleset amend 加 `Lint (nx lint server)` + `Test (nx test server)` 2 个 required check（W2 implement 全跑完后 add；此前 PR 不被卡）

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 Setup** (T001-T004)：无依赖 → 立即可启
- **Phase 2 Foundational** (T005-T012)：依赖 Phase 1 → blocks all US
- **Phase 3-5 US1/US2/US3**：均依赖 Phase 2；US 之间**可并行**（不同 user 可写 — solo dev 顺序 P1 priority 同级，按 US1 → US2 → US3 顺序更稳）
- **Phase N Polish** (T039-T042)：依赖所有 US 完成

### Within Each US

- Test tasks（[Test]）MUST 在 implementation 前写完并 RED
- Domain → Infrastructure → Application → Web 自下而上
- 每 task 走 /implement 6 步闭环（红→绿→typecheck/lint→tasks.md `[X]`→stage→commit）

### Parallel Opportunities

- Phase 1 [P] tasks T003 / T004 可并行
- Phase 2 [P] tasks T006 / T007 / T008 / T010 / T011 / T012 可并行（不同文件）
- Phase 3-5 US 之间可并行（solo dev 串行更可控）
- Each US 内 [Test] tasks 都 [P]（不同 *.spec.ts 文件）
- Polish T039 / T040 / T041 可并行

---

## Implementation Strategy

### MVP 顺序

1. Phase 1 Setup → CI 加 lint + test job + ruleset required check（T042 在 polish 也再 amend 一次）
2. Phase 2 Foundational → 跑通空 module + global filter + VOs + ports
3. **US1 (T013-T024)** → MVP 第一刀，主流程跑通；ship 后 STOP-VALIDATE
4. **US2 (T025-T031)** → 加自动注册+outbox
5. **US3 (T032-T038)** → 加反枚举 + timing defense
6. Polish (T039-T042) → V1 LoC + V2 lint 验收报告

### Per-Task Closure 6 步（per task-closure preset + Constitution II/III）

每 task 走：

1. RED：写 *.spec.ts → vitest 跑 → 必报错
2. GREEN：写 impl → vitest 跑过
3. typecheck + lint pass（`pnpm nx run server:typecheck && pnpm nx run server:lint`）
4. tasks.md 该 task `[ ]` 翻 `[X]`
5. `git add` impl + spec + tasks.md 同 stage
6. commit message `feat(auth): <task summary> — T0NN`（per Conventional Commits + Constitution Quality Gates）

每 task 独立 commit；多 task 不混 commit；W2.4 implement 阶段全程禁止 PR 重 scope，每 task = 1 commit + 1 push（PR 累计 commits）

### Stop / Surface 信号（W2.4 implement 期间）

- 任何 task 撞 spec 歧义 → 停 + 问 user（不私自补 spec）
- 任何 task 需新增 npm dep → 停 + 问 user（per memory `feedback_complex_external_dep_migration_last`）
- 任何 task 是 destructive op（rm -rf / drop table / force push） → 停 + 问 user
- 任何 task 跨 PR scope（如改 mono main-protection ruleset） → 停 + 问 user

---

## Notes

- `[Story]` label 映射 spec User Stories 实现 traceability
- 每 US 应能独立 ship（US1 不依赖 US2 实装；US3 amend 接到 US1+US2 已实装的 PhoneSmsAuthUseCase）
- 测试 RED 必先于 impl GREEN（Constitution II NON-NEGOTIABLE）
- per-task closure protocol mandatory（task-closure preset hard rule + Constitution III）
- `[P]` tasks 表示不同文件可并行（solo dev 串行更稳，[P] 标记给未来多 dev 参考）

**Total tasks**: 42（Setup 4 + Foundational 8 + US1 12 + US2 7 + US3 7 + Polish 4）
