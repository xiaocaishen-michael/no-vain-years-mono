# Plan: 技术架构 + 技术栈 + 技术框架 全面 Review (post-A-002 retro)

## Context

A-002 (account-profile + mobile bootstrap) 已 ship (PR #65/#66/#67)，但 ship 过程踩了 5 类集成坑：

1. **pnpm strict workspace × Expo** 默契对抗 — `shamefully-hoist=true` 才解
2. **`@hey-api/openapi-ts` `.js` 后缀** Metro 解不开 (Issue #68)
3. **packages/auth 内部 `.js` 后缀** + tsconfig nodenext base 反前端生态
4. **NativeWind v4 配置 orphan** (tailwind.config / global.css / nativewind-env.d.ts 全缺)
5. **`@nvy/auth` web localStorage fallback 缺**, **11+ Expo peer dep 雪崩补**

并发现 ADR-0018 SWC 语义被误读为 mono-wide (实际 backend-only)，暴露 ADR scope 模糊问题。

**目标**：从根本上解决 + 为长远发展保驾护航（user 选 "全面 review + 策略 spike" scope，accept Plan agent 警告的 over-correction 风险）。

## Locked Decisions（不 re-evaluate）

TS / Node 22 LTS / NestJS 11 + Fastify / Prisma v7 / pnpm 10 / Nx 22 / Expo SDK 54 + RN 0.81 / NativeWind v4（红线触发再换）/ Vitest 2 + Testcontainers / CF Pages frontend deploy / @hey-api → **Orval**（本 review 切换）

## 7 钢钉 + 1 元规则 架构 verdicts

| 钢钉 | 主题 | 关键 ADR |
|---|---|---|
| 1 | **可观测性** — stdout JSON + AsyncLocalStorage 伪 trace + cross-context Outbox trace 串联 + PII redact + log level 治理 | ADR-0036 |
| 2 | **模块隔离** — pnpm shamefully-hoist + TS base bundler + 5→2 packages + 后端 bounded context (security+account+auth) + Outbox 仅跨 context async + operation catalog | ADR-0028/0029/0030/0032/0033/0034 |
| 3 | **数据治理** — prisma migrate dev --name 半自动 + timestamp-hybrid 命名 + lefthook generate hard gate + 3 层 seed idempotent UPSERT | ADR-0035 |
| 4 | **安全合规** — gitleaks + .env/.env.example 同步校验 + JWT HS256 双 token + Redis jti 白名单 + refresh rotation + 5s race grace + secrets volumes mount | ADR-0037 |
| 5 | **错误契约** — RFC 9457 ProblemDetail + 顶层 5 + 业务扩展 6 (code/traceId/freezeUntil/retryAfterSeconds/invalidAttributes) + OpenAPI allOf per-endpoint code union + 客户端 fallback chain | ADR-0038 |
| 6 | **性能预算** — spec frontmatter `perf_budgets:` SSOT + plan.md derived + lefthook ≤ 30s + CI fast ≤ 10min + nightly perf IT 软预警 | ADR-0039 |
| 7 | **Ergonomics 审计** — spec frontmatter `agent_friction_observed` + `docs/conventions/ai-friction-catalog.md` v1 (6 模式) | ADR-0024 amend + catalog |
| 元规则 | **ADR Governance** — frontmatter `applies_to` / `sunset_trigger` 强制 + Zod schema + lefthook 校验 + orchestrator programmatic filter | ADR-0031 |

附属：**Frontend Data + Test Layer**（Orval 替换 @hey-api + react-query / Zustand 职责分工 + Maestro Plan 4 lock + testID 现起强制）= ADR-0027；**Backend Deployment Topology** stub = ADR-0026。

## 13 个新 ADR + 8 个 existing ADR backfill

### 新立 ADR

| ADR | 主题 | applies_to | 状态 |
|---|---|---|---|
| 0026 | Backend Deployment Topology (stub) | apps/server, infrastructure | Proposed (Plan 3 Phase 1 决) |
| 0027 | Frontend Data + Test Layer (Orval + RQ + Maestro) | apps/mobile, packages/api-client | Proposed |
| 0028 | Monorepo pnpm Policy (shamefully-hoist + sunset trigger) | mono-wide | Proposed (PR #67 已 ship，补文档) |
| 0029 | TS Module Resolution Policy (bundler base) | mono-wide | Proposed |
| 0030 | Package Decomposition (5→2 + apps/mobile/src/{auth,ui,theme,core}/) | mono-wide | Proposed |
| 0031 | ADR Governance & Programmatic Filtering | mono-wide | Proposed |
| 0032 | Backend Bounded Context Split (security + account + auth) | apps/server | Proposed |
| 0033 | Cross-Context Communication via Outbox (event metadata.trace_id 强制) | apps/server | Proposed |
| 0034 | Auth/Account Operation Catalog (3 传播规则 + LLM decision tree) | apps/server | Proposed |
| 0035 | Data Layer Governance (migrate + naming + seed + types regen gate) | apps/server | Proposed |
| 0036 | Observability and Logging Governance | apps/server, apps/mobile | Proposed |
| 0037 | Security and Credentials Governance | apps/server, apps/mobile, security | Proposed |
| 0038 | Full-Stack Error Handling and UX Contract | apps/server, apps/mobile, packages/api-client | Proposed |
| 0039 | Performance and Latency Governance | mono-wide | Proposed |

### Existing ADR backfill (frontmatter 4 必填字段: adr_id / status / applies_to / sunset_trigger)

| ADR | applies_to | sunset_trigger |
|---|---|---|
| 0018 backend-language-pivot | `[apps/server]` | Anthropic Agent SDK Java/Kotlin 出一等公民 / NestJS 生态新框架显著超越 & LLM 命中率 90%+ 等价 / Bun M3 业务稳态 PoC 通过 |
| 0019 orm-prisma | `[apps/server, packages/types]` | Prisma v8+ break change / 复杂 query 占 backend > 30% / Drizzle 等在 LLM 命中率显著超越 |
| 0020 module-boundary-nestjs | `[apps/server, packages/api-client, packages/types]` | 切非 NestJS 框架 / hexagonal layer 对 LLM 命中率反向负担实证 |
| 0022 throttler-nestjs-redis | `[apps/server]` | @nestjs/throttler 维护停滞 / 性能瓶颈触发 distributed rate limit / Redis 切其他 KV store |
| 0023 sms-code-storage-hmac | `[apps/server]` | SMS code 6→8+ 位 / 引入 TOTP / WebAuthn 取代 / 监管要求短信内容加密存储 |
| 0024 spec-feature-first-layout | `mono-wide` | spec-kit EOL / 切其他 SDD 工具 / 多产品线需 layer 命名 |
| 0025 frontend-cloudflare-pages-expo-web | `[apps/mobile]` | CF Pages 撤免费 tier / Plan 4 引入 mobile binary 分发 / Expo SDK EOL |

### 关键 amend

- **ADR-0019**：加 "DTO / Domain VO / Request DTO 三类区分；不引入 prisma-class-generator"
- **ADR-0024**：加 spec frontmatter SSOT 原则（perf_budgets / web_compat / agent_friction_observed 等字段；plan.md derived 禁手 edit）
- **ADR-0030**：amend `apps/mobile/src/` 顶层加 `core/` 目录（基础设施层 — api client / i18n / telemetry）
- **ADR-0033**：amend Outbox event payload schema 强制 `metadata.trace_id` 字段
- **ADR-0036**：amend ProblemDetailFilter 注入 traceId 联动
- **ADR-0037**：amend secrets 通过 volumes mount 注入容器，禁 image ENV baking

## Schema + Catalog + Templates 落点

### 关键文件

| 路径 | 说明 |
|---|---|
| `.specify/templates/adr-template.md` | 新建。ADR frontmatter 4 字段固化（adr_id / status / applies_to / sunset_trigger）|
| `.specify/templates/spec-template.md` | amend。frontmatter 加 `web_compat` / `agent_friction_observed` / `agent_friction_notes` / `perf_budgets[]` |
| `.specify/templates/plan-template.md` | amend。Phase 0 加 Integration smoke gate + Cross-stack vendor intersection 6Q card + Legacy→mono delta sweep checklist + ADR-deferred-mitigation scan step |
| `.specify/schemas/adr.zod.ts` | 新建。Zod schema 校验 ADR frontmatter |
| `.specify/schemas/spec.zod.ts` | 新建。Zod schema 校验 spec frontmatter（含 fallback chain：web_compat=stub/untested 必须 web_compat_notes）|
| `docs/conventions/ai-friction-catalog.md` | 新建 v1（6 模式）：TS-Bundler-Mismatch / Typecheck-Boot-Gap / Pnpm-Strict-vs-Expo-Hoist / Interactive-CLI-Block / Untyped-Error-Code-Hallucination / Indirect-Spec-Module-Mapping |
| `docs/adr/README.md` | amend。指向 `.specify/templates/adr-template.md` |
| `lefthook.yml` | amend。加 gitleaks (staged) + check-env-sync + spec.zod 校验 + adr.zod 校验 + prisma generate gate + tasks-md-drift（已有） |
| `scripts/check-env-sync.ts` | 新建。.env ↔ .env.example keys 对齐 |
| `scripts/inject-perf-env.ts` (or vitest global setup) | 新建。spec frontmatter perf_budgets → EXPECTED_P95_MS env 注入 perf IT |
| `orchestrator/scripts/plan-compiler.ts` | 新建。spec frontmatter → plan.md orchestrator_config 自动生成 |

### Critical 现有文件改动

| 路径 | 改动 |
|---|---|
| `tsconfig.base.json` | `moduleResolution: nodenext → bundler` + `module: nodenext → esnext` |
| `apps/server/tsconfig.json` | 显式 override `moduleResolution: nodenext` + `module: nodenext`（仅 server 端继续 nodenext）|
| `apps/server/src/security/{security.module, jwt.strategy, jwt-auth.guard}.ts` | 新建（前轮 `src/auth/web/jwt-auth.guard.ts` 移入）|
| `apps/server/src/account/*` | 新建。从 `src/auth/{domain,application,infrastructure,web}` 移 ~13 文件 |
| `apps/server/src/auth/web/dto/problem-detail.response.ts` | amend。加 code / traceId / freezeUntil / retryAfterSeconds / invalidAttributes 字段 |
| `apps/server/src/auth/infrastructure/problem-detail.filter.ts` | amend。注入 traceId + invalidAttributes pass-through + log level 按异常类型分流 |
| `apps/server/prisma/seeds/{dev,staging}.ts` | 新建。idempotent UPSERT seed 骨架 |
| `apps/server/prisma/seeds/local-personal.ts` | 新建 + `.gitignore` 加 |
| `apps/server/src/app.module.ts` | amend。LoggerModule.forRoot 配 redact + reqCustomProps traceId |
| `apps/mobile/src/{auth,ui,theme}/` | 新建。从 packages/{auth,ui,design-tokens}/src/ 移入 |
| `apps/mobile/src/core/api/{client.ts, problem-guards.ts}` | 新建。axios interceptor + type guards |
| `apps/mobile/src/core/i18n/errors.ts` | 新建。ERROR_DISPLAY_MAP 中文 |
| `apps/mobile/app/_layout.tsx` | amend。`import 'react-native-get-random-values'` + Error Boundary + trace_id 灰字底部 |
| `apps/mobile/tsconfig.json` | amend。删 @nvy/{auth,ui,design-tokens}* paths，加 `~/*: ["src/*"]` |
| `apps/mobile/tailwind.config.ts` | amend。content path 加 `./src/**/*.{ts,tsx}` |
| `packages/auth/`、`packages/ui/`、`packages/design-tokens/` | 物理删除 |
| `packages/api-client/` | Orval 重新 codegen 配置（替换 @hey-api/openapi-ts）|
| `.npmrc` | 已 ship `shamefully-hoist=true` (PR #67)，文档化进 ADR-0028 |
| `eslint.config.mjs` | amend。删 pkg-auth/pkg-ui/pkg-design-tokens depConstraints 段；apps/server boundaries 加 security + account elements |

## 5 Chore PR 执行序列

### Critical path

```
PR-1 ADR Governance + 8 ADR backfill + Schemas + Templates
       ↓
PR-2 tsconfig.base nodenext → bundler (1.5h)        ← unblocks PR-5
       ↓
PR-3 5→2 packages 重构 (1-1.5 day)                   ← unblocks PR-5
       ↓
PR-4 Server bounded context split (3-4h)             ← 与 PR-3/5 并行
       ↓
PR-5 Orval migration + 联动 ADR-0036 / 0037 / 0038 (3-5 day)
       ↓
PR-6 Data + Security + Performance infra (lefthook hooks + scripts + seed) (1-1.5 day)
       ↓
PR-7 ADR-0026 stub doc + Catalog v1 + Maestro testID convention 文档落地 (30min)
```

并行可能：PR-3 与 PR-4 完全独立；PR-5 与 PR-6 部分独立。

### 详细 PR 范围

**PR-1 治理基础设施**（最高 leverage，必须最先）
- 8 existing ADR backfill (0018-0025) frontmatter
- 新立 ADR-0027 ~ 0039 (13 个 stub + 详细内容)
- `.specify/templates/adr-template.md` 新建
- `.specify/templates/spec-template.md` amend
- `.specify/templates/plan-template.md` amend  
- `.specify/schemas/adr.zod.ts` + `spec.zod.ts`
- `docs/conventions/ai-friction-catalog.md` v1 (6 entries)
- `docs/adr/README.md` pointer
- spec 001 + 002 frontmatter backfill (web_compat / agent_friction_observed / perf_budgets)
- Lefthook ADR schema + Spec schema 校验 hook

**PR-2 TS resolution swap**
- `tsconfig.base.json` swap
- `apps/server/tsconfig.json` override
- 各 workspace tsconfig 清理（删 packages/auth 之前 PR #67 加的 bundler override 等）
- nx run mobile + server typecheck GREEN

**PR-3 5→2 packages 重构**
- `git mv` packages/{auth,ui,design-tokens}/src/* → apps/mobile/src/{auth,ui,theme}/*
- 删 3 个 packages dirs + project.json
- imports rewrite (`@nvy/auth` → `~/auth` etc.)
- apps/mobile/tsconfig paths amend (加 `~/*`)
- apps/mobile/tailwind.config content path amend
- eslint.config.mjs 删 3 个 depConstraints 段
- 002 plan.md module_boundaries 段 mark historical

**PR-4 Server bounded context split**

> **[已迁出 2026-05-22]** 本 PR 内容（含 PR #72 物理 split + PR #79 cascade 修 + ADR-0033 / 0034 / 0041 + hexagonal layer ESLint reintroduce + governance checklist）已并入独立 plan：[05-22-server-bounded-context-governance.md](05-22-server-bounded-context-governance.md)。Plan 2 业务迁入每个 feature 触发的 bounded context 评估走新 plan，本段保留作历史 trace。

- 新建 src/security/{module, strategy, guard}.ts
- mv ~13 files src/auth → src/account/
- 新建 src/account/account.module.ts
- src/auth/auth.module.ts imports [SecurityModule, AccountModule]
- src/account/account.module.ts imports [SecurityModule]
- eslint.config.mjs boundaries elements 加 security/account
- 001 + 002 spec.md modules 字段调整（按主导方顺序）
- test/integration/* imports 改

**PR-5 Orval migration + 数据流重构**
- 装 orval + 配 orval.config.ts (mode: tags-split, client: react-query, httpClient: axios)
- packages/api-client 重 codegen 替换 @hey-api
- apps/mobile/src/core/api/client.ts axios interceptor + x-trace-id
- apps/mobile/app/_layout.tsx 加 `import 'react-native-get-random-values'`
- QueryClient global error handler + Error Boundary + trace_id 显示
- Mobile useAuthStore 重构（loadProfile → useQuery '/me'）
- ProblemDetailResponse + ProblemDetailFilter amend (traceId / invalidAttributes / log level)
- FormValidationException 新建
- type guards (isFormValidationError / isFreezePeriod / isAuthLocked / isRetryable)
- ERROR_DISPLAY_MAP 中文 inline map
- LoggerModule redact 配 + reqCustomProps traceId
- (closes Issue #68 — Orval 不卡 Metro 因 bundler resolution)
- 验证 T040 e2e runtime GREEN

**PR-6 Data + Security + Performance infra**
- prisma migration 命名 convention（timestamp-hybrid）+ 文档化
- `apps/server/prisma/seeds/{dev,staging}.ts` + `.gitignore` `local-personal.ts`
- lefthook prisma generate gate
- lefthook gitleaks + check-env-sync
- `scripts/check-env-sync.ts`
- SecurityModule JWT HS256 双 token + Redis jti whitelist + rotation + 5s grace
- refresh-token usecase
- secrets volumes mount docker-compose 模板（infrastructure/ stub）
- `scripts/inject-perf-env.ts` 或 vitest setup
- `orchestrator/scripts/plan-compiler.ts`
- `.github/workflows/nightly-perf.yml`

**PR-7 文档收口**
- ADR-0026 stub (7 决策点列出 + Plan 3 Phase 1 deadline)
- Catalog v1 完整 6 entries with bidirectional ADR links
- PR template 加 spec frontmatter sync checklist
- (已写入 PR-1 但 final review consistency check)

## Deferred Backlog

```markdown
### D1. Bun runtime 取代 Node 22
- 触发: Node 22 性能瓶颈实证 / Anthropic Agent SDK 一等 Bun 支持 / 用户量 > 1000 启动延迟成本可见
- 责任: ADR-0018 sunset trigger 路径
- 工作量: 1-2 周 PoC (reflect-metadata + Fastify on Bun + NestJS swagger decorator 兼容验)
- 现起 0 动作
```

（D2 Argon2id / D3 Kysely / D5 Native E2E 已删除 — 触发条件遥远或已被 ADR-0027 cover）

## Verification

### PR-by-PR success criteria

| PR | verify |
|---|---|
| PR-1 | `pnpm exec node .specify/schemas/check-all-frontmatters.ts` GREEN; lefthook schema hooks 触发拒非法 frontmatter |
| PR-2 | `nx run-many --target=typecheck --all` GREEN |
| PR-3 | `nx run mobile:typecheck + test` GREEN; `grep '@nvy/auth\|@nvy/ui\|@nvy/design-tokens' apps/mobile/` 应 0 命中 |
| PR-4 | `nx run server:typecheck + test + lint` GREEN; `nx run server:test:e2e` 5 e2e spec 全 GREEN with Testcontainers; eslint boundaries 验 auth → account 单向 |
| PR-5 | T040 e2e runtime GREEN (`nx run mobile:e2e --skip-nx-cache`)；浏览器 console 含 x-trace-id；后端 stdout log 含同 trace_id；form 400 error → 自动 form.setError invalidAttributes |
| PR-6 | lefthook 全链路 staged 含 schema.prisma → 自动 prisma generate；staged .env 触发 hard fail；seed 跑 2 次无 PK conflict (idempotent)；nightly-perf workflow dry run |
| PR-7 | grep `agent_friction_observed` in spec 001/002 yields filled values; manual ADR cross-link check |

### End-to-end smoke

`pnpm install` 全 clean → `pnpm nx run-many --target=build,test,lint --all` 全 GREEN → `pnpm nx run mobile:e2e` runtime GREEN → 7 大宪法 ADR 全部 status: Accepted（status 转换由 PR review approve 触发）

### Critical assertions

1. **LLM agent regression check**: 写一个测试 prompt "给 spec 003 加 module"，验证 LLM agent 直接找 `apps/server/src/<module>/` 而不创 `src/auth/` 子目录（ADR-0032 物理拆生效）
2. **Schema 校验 regression**: 故意提交一个缺 `applies_to` 的新 ADR，lefthook 必须拒
3. **Trace 串联**: mobile e2e 触发 5xx → screenshot 含 trace_id 灰字 → 后端 docker logs grep 一次命中
4. **PII redact 验**: server log 中 grep `+861[0-9]{10}` 应 0 命中（被 [PII_REDACTED]）
5. **catalog 完整性**: 6 entries 全有 ADR back-link，ADR 中有 catalog entry 引用
