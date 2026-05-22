# Plan: mono backend vs meta backend 能力 Gap Audit (post tech-stack review)

> **Provenance**: 由 plan-mode 自动生成（原临时路径 `docs/plans/server-review-*.md`），2026-05-22 归档迁入此路径以符 [`docs/conventions/docs-organization.md`](../../conventions/docs-organization.md) 体例。

## Context

05-21-review-tech-stack-post-a002 plan 自下而上从 A-002 ship 踩坑反推出 7 钢钉 + 13 新 ADR + 5 chore PR (近半数已 ship: PR #99/#100/#102 等)。本审计自上而下盘点 **meta 仓 Java/Spring backend 全量能力面** vs **mono NestJS backend 当前态**,识别 review plan **没有 cover 但 meta 已具备** 的能力 gap,按 Plan 1/2/W3+ 分级安排。

不重复 review plan 已覆盖的 7 钢钉。

## Verification (subagent claims fact-checked)

| Subagent 报告 | grep 实证 | 修正 |
|---|---|---|
| "Trivy 未配置" | `.github/workflows/ci.yml:73-101` 有 V9 Trivy image scan | ✅ 已有,不算 gap |
| "无 /api/v1/" | `openapi.config.spec.ts:63` `/api/v1/accounts/*` | ✅ 已有 (controller 级),不算 gap |
| "无 @nestjs/terminus" | package.json 0 命中 | ❌ 确认 gap |
| "无 prom-client / micrometer" | package.json 0 命中 | ❌ 确认 gap |
| "无 email/resend" | apps/server 0 命中 | ❌ 确认 (Plan 2 scope) |
| "无 cloudauth/KMS/ip2region" | apps/server 0 命中 | ❌ 确认 (Plan 2 scope) |
| "无 @nestjs/schedule" | 仅 outbox-cron stub,无业务 scheduler | ❌ 确认 gap |
| "Outbox 仅 publisher" | `outbox-event-cron.publisher.ts:31` 注释自承 `TODO W3+: dispatch to real subscriber` | ❌ 确认 (intentional defer) |
| "无 CORS" | apps/server 0 命中 (`enableCors` / `@fastify/cors`) | ❌ 确认 gap |
| "无 coverage threshold" | `vitest.config.ts` coverage 段无 thresholds | ❌ 确认 gap |

## Gap 清单 (12 项, 按 scope 分级)

### A 类: Plan 1 残留 infra gap (review plan 漏覆盖, 应近期补)

| # | Gap | meta 现状 | mono 现状 | 影响 |
|---|---|---|---|---|
| A1 | **Health / Liveness / Readiness 端点** | Spring Boot Actuator `/actuator/health/{liveness,readiness}` | ❌ 完全缺失 | 容器编排 (k8s probe / docker healthcheck) 无 hook;Plan 3 部署即撞 |
| A2 | **Prometheus metrics 端点** | Micrometer + `/actuator/metrics/prometheus` | ❌ 完全缺失 | 无生产指标 (req 数 / p95 / 错误率) → 出问题黑盒 |
| A3 | **Profile-aware CORS** | `DevCorsConfig` + `ProdCorsConfig` @Profile 隔离 | ❌ 完全缺失 (Fastify 默认无 CORS) | mobile web build (Expo Web on CF Pages) 跨域必撞 |
| A4 | **Typed config (`@ConfigurationProperties` 等价)** | `JwtProperties` / `RealnameDekProperties` 类型化 binding | ⚠️ `configService.get<string>('AUTH_JWT_SECRET')` key-by-key, 拿到 string\|undefined | typo / 缺 env 不在 boot 时 fail-fast,运行时 NPE |
| A5 | **Coverage threshold CI gate** | JaCoCo line 60% / branch 50% enforced in `mvn verify` | ❌ vitest coverage 报告但无 threshold | 测试覆盖率回退无门禁,只能 review 肉眼 catch |

### B 类: Plan 2 业务迁移触发 gap (跟随 use case 顺序迁入)

| # | Gap | meta 现状 | mono 现状 | 触发 feature |
|---|---|---|---|---|
| B1 | **Email ESP 集成** | `ResendEmailClient` + WireMock IT + Mock fallback | ❌ 完全缺失 | 任何含 email 通知的 use case (e.g., 密码重置, welcome) |
| B2 | **Aliyun Cloud Auth (实名)** | `cloudauth20190307` SDK + `BypassRealnameClient` dev mode | ⚠️ 仅 `realname_profile` schema 占位 | 实名认证 use case |
| B3 | **Aliyun KMS / DEK cipher** | `AliyunKmsCipherService` + `EnvDekCipherService` (data-at-rest 加密) | ❌ 完全缺失 | 实名认证 (身份证号字段) / 任何 PII at-rest 加密 |
| B4 | **GeoIP (ip2region offline)** | ip2region 2.7.0 offline DB | ❌ 完全缺失 (`refresh_token.ip_address` 存了但不解) | 设备管理 / 异地登录预警 / 风控 |
| B5 | **业务 Scheduler** | `FrozenAccountAnonymizationScheduler` / `PendingRealnameRecoveryScheduler` + `@Scheduled` | ❌ 无 `@nestjs/schedule`, 仅 outbox cron stub | 冻结清算 / 实名挂起恢复 等定时业务 |

> B 类**不应**现在补,跟 Plan 2 [Plan 2/3](2026-05/05-19-plan2-plan3-migration-deploy.md) 16 use case 顺序迁入即可。审计目的是显式记账,避免 Plan 2 起手"以为有"。

### C 类: W3+ 架构 deferred (intentional, 不动)

| # | Gap | 现状 | defer 原因 |
|---|---|---|---|
| C1 | **Outbox consumer (subscriber side)** | publisher + cron stub 都有,但 `outbox-event-cron.publisher.ts:31` `TODO W3+: dispatch to real subscriber` | Plan 1 PoC 只需 publish 端 (auth 发完事件落库就算完),consumer (search-index / welcome SMS) 等 Plan 2 真业务触发 |
| C2 | **慢测试 tag 隔离 + nightly-full-tests workflow** | meta `@Tag("slow")` + `mvn verify -Pfull-tests` | mono `RUN_PERF_IT` env-gate 已有 (per [`feedback_env_gated_perf_it_pattern`](../../.claude/memory/feedback_env_gated_perf_it_pattern.md));`.github/workflows/nightly-perf.yml` 已存在 (PR #102 ship) | 已 cover,不算 gap |

## 关键文件 (按 gap 分组)

### A1+A2 (health + metrics) 实现锚点
- 新建 `apps/server/src/observability/health.module.ts` (依赖 `@nestjs/terminus` + Prisma/Redis indicator)
- 新建 `apps/server/src/observability/metrics.module.ts` (依赖 `@willsoto/nestjs-prometheus` 或 `prom-client`)
- amend `apps/server/src/app/app.module.ts` import 两 module
- amend `apps/server/Dockerfile` HEALTHCHECK 指 `/healthz`

### A3 (CORS)
- amend `apps/server/src/main.ts` 注册 `@fastify/cors` + 配置 from env (`CORS_ALLOWED_ORIGINS`)
- amend `apps/server/.env.example` 加 `CORS_ALLOWED_ORIGINS`
- amend `lefthook.yml` check-env-sync 自动覆盖

### A4 (typed config)
- 改 `@nestjs/config` 模式: `ConfigModule.forRoot({ validationSchema })` + Zod schema (复用 `.specify/schemas/` pattern)
- 或者每个模块 export `XxxConfigService` 把 raw `configService.get` 收口到 typed getter

### A5 (coverage threshold)
- amend `apps/server/vitest.config.ts` coverage 段加 `thresholds: { lines: 60, branches: 50, functions: 60, statements: 60 }`
- 仅 fail CI,本地 dev 不影响

## 复用既有 utility

- **Schema 校验 pattern**: 复用 `.specify/schemas/` 已有 Zod 配 lefthook 校验的模式,A4 typed config 可复刻
- **Lefthook hook 模板**: 复用 `lefthook.yml` 已有 `check-env-sync` + `gitleaks` 段位 (PR #100 ship),A3 CORS env 自动覆盖
- **CI workflow**: 复用 `.github/workflows/ci.yml` 现有 build + test job,A5 coverage threshold 通过 vitest 退出码自然带入,无新 workflow
- **Nightly job 框架**: `nightly-perf.yml` (PR #102 ship) + `nightly-sweep.yml` 已存在,A 类不需要新 nightly

## Verification

### 端到端 smoke (A 类全 ship 后)
```bash
# A1 health
curl -sf http://localhost:3000/healthz | jq '.status == "ok"'
curl -sf http://localhost:3000/healthz/ready | jq '.info.prisma.status == "up"'

# A2 metrics
curl -s http://localhost:3000/metrics | grep -E '^http_server_requests_seconds_count'

# A3 CORS
curl -X OPTIONS -H "Origin: https://mobile.dev.local" -H "Access-Control-Request-Method: POST" \
  http://localhost:3000/api/v1/accounts/phone-sms-auth -i | grep -i access-control-allow-origin

# A4 typed config — boot with missing AUTH_JWT_SECRET 应 fail-fast
AUTH_JWT_SECRET= pnpm exec nx run server:serve   # 期望 immediate exit non-zero

# A5 coverage threshold — 故意删除一个 spec 让 coverage 跌破 60%
pnpm exec nx run server:test --coverage  # 期望 exit non-zero
```

### B 类不在本 plan 验证 scope (Plan 2 触发时再做)

### 关键 assertion
1. **k8s readiness probe 模拟**: Prisma 关 connection → `/healthz/ready` 应返 503 而非 200
2. **Prometheus scrape pull-test**: 起一个 prometheus container 配 scrape `/metrics`,5 min 后 `/api/v1/query?query=up{job="server"}` 应回 1
3. **CORS prod 模式**: `NODE_ENV=prod` + `CORS_ALLOWED_ORIGINS=https://mbw.app` 时 `Origin: https://evil.com` 必须被拒
4. **Typed config 缺 env**: 删任意必填 env → boot phase 红,不能进入 listen phase
5. **Coverage gate**: artificially 删测试 → CI test job 红

## Out of scope (本 plan 不做)

- B 类业务集成 (Email/KMS/GeoIP/实名/业务 scheduler) — Plan 2 use case 触发
- C1 outbox consumer — W3+ 真订阅方出现时
- Helmet / CSRF / 其他 HTTP 安全头 — 不在 meta backend 中,不属对标 gap
- Distributed tracing (Jaeger/Tempo) — meta 也只有 Micrometer Observation infrastructure ready,未接 tracer;mono `nestjs-cls` 已覆盖伪 trace
- API gateway / BFF 层 — 不在 meta 中
