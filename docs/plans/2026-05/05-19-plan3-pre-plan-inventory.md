# Plan 3 Pre-Plan Inventory(2026-05-19 存档,Plan 3 启动暂停)

> **存档说明**:本文是 Plan 3(旧 Java/Expo 资产迁移到 mono)起手前的综合 inventory + drift 分析。2026-05-19 session 在准备 Plan 3 plan 文件阶段,user 提出"对计划有新想法 大变动",Plan 3 起手暂停。本文档保留作未来 Plan 3 / 其他迁移决策的参考输入。
>
> **数据源**:3 个并行 Explore subagent + mono 现状本地 reconcile。
> - meta 仓 `/Users/butterfly/Documents/projects/no-vain-years/`
> - server 仓 `/Users/butterfly/Documents/projects/no-vain-years/my-beloved-server/`
> - app 仓 `/Users/butterfly/Documents/projects/no-vain-years/no-vain-years-app/`
> - mono 仓 `/Users/butterfly/Documents/projects/no-vain-years-mono/`(当前)

## 1. 总规模对照(Plan 1 § G estimate vs 实证)

| 维度 | Plan 1 § G 估 | 实证 | drift |
|---|---|---|---|
| Java server LoC | 5,705 | ~5,000 main + ~3,500 test ≈ 8,500 total | 主码一致,带测试 +50% |
| Java module 数 | 不明确 | 3 个(mbw-shared / mbw-account / mbw-app)+ 238 .java 文件 | — |
| use case 数 | 7 个(粗) | **16 个**(细) | +9(按 application service 切分) |
| Java 业务 use case 5 阶段顺序 | account-base → tokens → freeze+del → realname → device | **代码与顺序对齐 0 drift** | ✅ |
| Old Expo app LoC | 不明确 | 19,880 LoC TS/TSX | — |
| Old app 内部 packages | 不明确 | **5 个**(api-client / auth / ui / design-tokens / types + tsconfig) | 需合并到 mono `packages/` |
| 12 spec.md 复用承诺 | 直搬 | ✅ 12 spec + user-journey 全在 meta `specs/` | ✅ |
| 17 ADR cross-ref 矩阵 | Plan 1 § G.1 | **99% 对齐**(ADR-0011 唯一无影响 drift) | ✅ |
| Stack retire 4 块 | Bucket4j / Resilience4j / Nimbus / Springdoc | **mono PoC 已替换全 4 块** | Plan 3 主要业务搬迁 |

## 2. 16 use case 实际清单(server 仓实证)

| 阶段 | use case | LoC | 复杂度 | mono 状态 | 关键依赖 |
|---|---|---:|---|---|---|
| **A account-base** | UnifiedPhoneSmsAuth(register+login 合并) | 227 | 中 | ✅ mono 已 ship(phone-sms-auth) | dysmsapi(SMS) |
| | GetAccountProfile | 45 | 低 | ❌ 待迁 | — |
| | UpdateDisplayName | 35 | 低 | ❌ 待迁 | — |
| **B tokens** | RefreshToken | 133 | 中 | ❌ 待迁 | Nimbus → jose |
| | LogoutAllSessions | 63 | 中 | ❌ 待迁 | — |
| **C freeze + deletion** | SendDeletionCode | ~80 | 中 | ❌ 待迁 | dysmsapi |
| | DeleteAccount | 155 | 中 | ❌ 待迁 | — |
| | SendCancelDeletionCode + CancelDeletion | ~70 | 中 | ❌ 待迁 | dysmsapi |
| | AnonymizeFrozenAccount | 109 | **高** | ❌ 待迁 | **outbox 真消费方** |
| **D device** | ListDevices | 97 | 中 | ❌ 待迁 | ip2region geo |
| | RevokeDevice | ~50 | 中 | ❌ 待迁 | — |
| **E realname** | InitiateRealnameVerification | 160 | **高** | ❌ 待迁 | **Aliyun cloudauth + split-tx** |
| | ConfirmRealnameVerification | ~95 | 高 | ❌ 待迁 | cloudauth |
| | QueryRealnameStatus | ~60 | 低 | ❌ 待迁 | — |

**Controllers**(8):AccountAuth / Auth / AccountProfile / DeviceManagement / Realname / AccountDeletion / CancelDeletion / AccountSmsCode

**Flyway 高水位**:V14(从 mono 角度看 Prisma `db pull` 已反推过 V1-V14)

## 3. Old Expo app 内部 monorepo 结构(19,880 LoC)

### 5 个内部 packages 需迁入 mono

| 旧路径 | 内容 | mono 目标 | 处理策略 |
|---|---|---|---|
| `packages/api-client/` | OpenAPI Generator v7.22.0 + Springdoc spec 生成 client(7 controller API) | `packages/api-client/`(**冲突:mono 已用 @hey-api/openapi-ts v0.97.1**) | 旧客户端**全弃**,mobile 切到 mono `@nvy/api-client` import |
| `packages/auth/` | zustand v5 + secure-store + token refresh middleware | `packages/auth/` | 直搬 |
| `packages/ui/` | NativeWind v4 reusable components | `packages/ui/` | 直搬 |
| `packages/design-tokens/` | Tailwind 配色/spacing/shadow | `packages/design-tokens/` | 直搬 |
| `packages/types/` | shared TS types | `packages/types/` 或 `packages/shared-types/` | 命名对齐讨论 |
| `packages/tsconfig/` | 基础 tsconfig.json | `packages/tsconfig/` 或复用 mono `tsconfig.base.json` | 二选一 |
| `apps/native/` | Expo Router 应用主体 | `apps/mobile/` | 改名 native → mobile,Expo Router 重新初始化 |

### Expo Router 路由结构

```
apps/native/app/
├── _layout.tsx (root + AuthGate)
├── index.tsx (redirect stub)
├── (auth)/
│   ├── _layout.tsx
│   ├── login.tsx
│   └── cancel-deletion.tsx
└── (app)/
    ├── _layout.tsx
    ├── onboarding.tsx
    ├── (tabs)/ (home / pkm / profile / search)
    └── settings/
        ├── account-security/ (phone / delete-account / login-management)
        └── legal/
```

### 关键版本(per package.json)

| 依赖 | 版本 | 说明 |
|---|---|---|
| Expo SDK | ~54.0.33 | Plan 1 ADR-0014 inherit |
| React Native | 0.81.6 | |
| NativeWind | ^4.2.3 | Plan 1 ADR-0014 inherit |
| Tailwind | ~3.4.19 | |
| Zustand | ^5.0.13 | |
| @tanstack/react-query | ^5.100.10 | 当前仅 device list use(M1.2 scope) |
| expo-router | ^6.0.23 | |
| @openapitools/openapi-generator-cli | ^2.16.4 | OpenAPI Generator 7.22.0(待切换到 mono @hey-api/openapi-ts) |
| Vitest | 4.1.6(happy-dom) | 34 测试文件 |

## 4. mono 当前状态(Plan 1 V1-V10 ship 后 + W3 deferred 5 项延后)

### apps/server/src/ 结构

```
apps/server/src/
├── app/
├── assets/
├── auth/                     ← phone-sms-auth use case ship 在此
│   ├── application/
│   ├── domain/
│   ├── infrastructure/
│   ├── web/
│   └── auth.module.ts
├── generated/
├── main.ts
├── openapi.config.ts
└── openapi.config.spec.ts
```

23 个 `*.spec.ts` 文件。`apps/mobile/` 尚不存在(Plan 3 起手才建)。

### packages/api-client(mono 已存在)

- **生成器**:@hey-api/openapi-ts v0.97.1
- **消费**:`apps/server` 自身 + 未来 `apps/mobile`
- **结构**:`src/generated/` 13 个 .gen.ts 文件
- **命令**:`pnpm api:gen`(依赖 apps/server `pnpm export-openapi` 先跑)

### 已替换的 stack(对应 Plan 1 § G.2 ⚪️ 废弃区)

| 旧(Java) | mono(TS) | 状态 |
|---|---|---|
| Bucket4j Redis | @nestjs/throttler + @nest-lab/throttler-storage-redis | ✅ ship(W3 A1/A2) |
| Resilience4j | cockatiel | ✅ ship(W3 A3) |
| Nimbus JOSE | @nestjs/jwt + jose | ✅ ship(W2) |
| Springdoc | @nestjs/swagger | ✅ ship(W4 V8) |
| MapStruct | class-transformer + 手写 mapper | 等 Plan 3 use case 迁时落地 |
| Spring Modulith outbox | 自写 outbox_event 表 + cron publisher | ✅ skeleton ship(W2 T041),真消费方 W3+ defer |
| Spring Security | Passport.js + @nestjs/passport + jose | ✅ ship(W2) |
| ArchUnit 4 categories | NestJS Module exports + eslint-plugin-boundaries v6 | ✅ ship(W2 T040)|

## 5. 17 ADR cross-ref 实证(meta `docs/adr/`)

99% 对齐 Plan 1 § G.1 矩阵。仅 1 处可忽略 drift:

| ADR | Plan 1 § G.1 预期 | 实际状态 | drift 说明 |
|---|---|---|---|
| 0001 Spring Modulith+ArchUnit | superseded by mono ADR-0020 | ✅ Superseded(meta PR #140) | 无 |
| 0008 Pure Repo Interface(Java) | superseded by mono ADR-0020 | ✅ Superseded(meta PR #140) | 无 |
| **0011 Bucket4j Redis** | superseded by **future ADR-0022** | Accepted, amended 2026-04-28(Redis 从 M1.1 直接起,跳过 in-memory 阶段) | **无需新建 ADR-0022**;但 Plan 3 中可能想沉淀"mono throttler 选 @nestjs/throttler"决策,可考虑立 0021/0022 顺一下 |
| 0013(SMS 绑企业资质) | inherit | Amended 3x(Resend email fallback / 由 0016 收窄) | 业务决策,跨栈不影响 |
| 0016 unified mobile-first phone-SMS auth | inherit | Accepted 2026-05-04 | post-Plan-1,**实际是 mono phone-sms-auth 已应用的设计源** |
| 0017 SDD 业务流先行 + mockup 后置 | inherit | Accepted 2026-05-04 | post-Plan-1 |
| 其他 0002-0007 / 0009-0010 / 0012 / 0014-0015 | inherit / superseded by 0014 / hold | 全 ✅ | 无 |

## 6. meta 仓 conventions / scripts / skills 需迁清单

| 资产 | 路径 | 迁入 mono 建议 |
|---|---|---|
| `conventions/business-naming.md / git-workflow.md / sdd.md` | mono 已有(@import) | ✅ 已迁 |
| `conventions/versioning.md` | mono 缺 | 推荐 per-read 表引用迁入 |
| `conventions/worktree.md` | mono 缺 | mono 单仓不必 worktree 重型流程,可瘦身迁入或弃 |
| `conventions/agent-view-usage.md` | mono 缺 | 推荐 per-read 表引用迁入(quota 纪律跨栈) |
| `conventions/claude-config-layout.md` | mono 缺 | 推荐 per-read 表引用迁入 |
| `conventions/git-workflow-reference.md` | mono 缺 | 推荐 per-read 表引用迁入(gh api / branch protection 参考) |
| `conventions/daily-logs.md` | meta 专属 | 不迁(personal workflow) |
| `conventions/experience-docs.md` | meta 专属 | 不迁(personal playbook) |
| `conventions/api-contract.md` | Java-era(Springdoc) | 不迁 |
| `scripts/link-spec.sh / link-all-specs.sh / unlink-spec.sh` | meta-only(三仓 symlink) | 单仓不需要,全弃 |
| `.claude/skills/speckit-*` 18 个 | michael-speckit-presets 已含 | 无需手动迁 |
| `.claude/commands/speckit-link-spec.md` | meta-only | 弃 |
| `.claude/rules/plan-lifecycle-rules.md` | governance | 推荐迁(plan 命名/归档规则跨栈) |
| `lefthook.yml`(meta `spec-only-in-meta` 规则) | mono 已有自己 lefthook | meta 规则单仓不必 |
| `docs/experience/ + docs/daily/` | mono-native git-tracked（iCloud symlink 跨设备同步形态 2026-05-23 作废；meta 历史不迁入）| ✅ 不迁 |

## 7. 新增风险点(Plan 1 § H 未列出,Plan 3 plan 需收纳)

1. **TimingDefenseExecutor 400ms pad** 在 Java `UnifiedPhoneSmsAuthUseCase` wrap **整个 auth 流水线**。mono `phone-sms-auth` 已 ship HMAC verify <1ms 让 3 反枚举路径自然均一(PR #25 + ADR-0023),但 Plan 3 迁其他 use case(refresh / logout / delete 等)时需逐 use case **确认是否需要同等 timing defense** — 不复刻可能 spec drift,复刻无差别贴可能性能不必要

2. **Realname split-tx pattern** — `InitiateRealnameVerificationUseCase`:Tx1 PENDING commit → Tx2 异步调 Aliyun cloudauth → 失败 mark FAILED。NestJS Prisma 实现需拆 transaction service,**至少比典型 use case 多 1.5x effort**;不能用单 transaction wrap(外部 HTTP call 在 tx 内会持锁)

3. **MapStruct 4 mapper 无显式 pom dependency**(annotation processor 管)— `AccountMapper / RefreshTokenMapper / RealnameProfileMapper / AccountSmsCodeMapper`。Plan 3 重写时找不到 dep 易**漏判工作量**;实际是必重写到 class-transformer / 手写 mapper

4. **Zustand v5 + babel `unstable_transformImportMeta` 黑盒**(SDK 54 workaround)— 旧 app 已踩过(Zustand v5 monolithic middleware.js 用 `import.meta.env.MODE` 即使只用 `persist`)。mobile 迁入 mono 时考虑顺手升 SDK 56(默认 fix 此 footgun)

5. **OpenAPI Generator → @hey-api/openapi-ts client cutover 面**:旧 app 7 generated API 在业务代码中可能散落 import。mobile 迁入第一刀全量切换 client import,**TS error 是天然 catch net**(per memory `feedback-repo-wide-scan-on-rename` 全仓 grep 必走)

## 8. ADR cross-ref 待立(Plan 3 / Plan 2 内嵌)

| 新 ADR | 主题 | 触发时机 | 替代旧 ADR |
|---|---|---|---|
| ADR-0021 | mono-repo(Nx + pnpm workspaces) | Plan 2 内嵌增量 | ADR-0006(Meta CLI Multi-Repo) |
| ADR-0022 | 限流栈(@nestjs/throttler + Redis storage) | mono PoC 实际已 ship,可补 ADR | ADR-0011(Bucket4j → 已 amend skip)|
| (TBD) | deployment(NestJS + Fastify + Prisma Docker 部署形态) | Plan 3 realname 迁完后 ADR-0012 重评 | ADR-0012(Java A-Split) |

## 9. Ambiguous Decisions(Plan 3 起手前需 user 决定,session 暂停未答)

1. **起手 use case 粒度**:Phase A 同 1 PR(profile + displayName 2 use case) vs Phase A + B 一起(4 use case) vs 严格 SDD 6 步每 use case 1 PR
2. **mobile 迁入时机**:Phase A 起手同期 vs Phase A server 完后 vs Phase B/C 后 vs Plan 3 最后(Plan 1 § F 原意)
3. **packages/api-client 冲突处理**:mono hey-api 为准旧 app OpenAPI Generator 全弃 vs 新建 api-client-v2 并行过渡期
4. **conventions 5 项迁不迁**(versioning / worktree / agent-view-usage / claude-config-layout / git-workflow-reference)
5. **ADR-0022 是否补建**(throttler 已实装但 ADR 缺)
6. **realname split-tx 拆 transaction service 接口形状**(Plan 1 § C.3 没具体设计)

## 10. 引用

- Plan 1 → [`2026-05/05-18-plan1-backend-stack-poc.md`](2026-05/05-18-plan1-backend-stack-poc.md) § F(Plan 2 接口契约)/ § G(Plan 3 接口契约)/ § H(风险)
- mono ADR-0018/0019/0020/0023
- meta ADR 0001-0017
- meta `specs/<auth | account>/<use case>/spec.md + user-journey.md` 共 12 use case
- mono `specs/auth/phone-sms-auth/{spec,plan,tasks}.md`(W2-W4 完整 SDD artifacts)
- 旧 server `src/main/resources/db/migration/V1-V14.sql`
- 旧 app `apps/native/app/` Expo Router + 5 个 internal packages
