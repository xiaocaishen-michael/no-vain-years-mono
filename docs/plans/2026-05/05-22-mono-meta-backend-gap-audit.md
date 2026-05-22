# Plan: mono backend vs meta backend 能力 Gap Audit (post tech-stack review)

> **Provenance**: 由 plan-mode 自动生成（原临时路径 `docs/plans/server-review-*.md`），2026-05-22 归档迁入此路径以符 [`docs/conventions/docs-organization.md`](../../conventions/docs-organization.md) 体例。

## Context

05-21-review-tech-stack-post-a002 plan 自下而上从 A-002 ship 踩坑反推 7 钢钉 + 13 新 ADR + 7 chore PR(已 ship PR #99/#100/#102/#103/#104 等)。本审计自上而下盘点 **meta 仓 Java/Spring backend 全量能力面** vs **mono NestJS backend 当前态**,识别 review plan **没有 cover 但 meta 已具备** 的能力 gap。

**用户决策**(2026-05-22):
- A 类(infra gap)→ 本 plan 详写 meta / mono / gap 三段对照,作为后续 PR 输入
- B / C 类(业务+架构 deferred)→ **只沉淀为 ADR draft 候选**,本 plan 不进 impl scope

## Verification: subagent claims fact-checked

| Subagent 报告 | grep 实证 | 修正 |
|---|---|---|
| "mono Trivy 未配置" | `.github/workflows/ci.yml:73-101` V9 Trivy gate 已存在 | ✅ 已有,**不算 gap** |
| "mono 无 /api/v1/" | `apps/server/src/openapi.config.spec.ts:63` `/api/v1/accounts/*` | ✅ 已有(controller 级),**不算 gap** |
| "mono 无 @nestjs/terminus" | `apps/server/package.json` 0 命中 | ❌ 确认 gap (A1) |
| "mono 无 prom-client / micrometer" | `apps/server/package.json` 0 命中 | ❌ 确认 gap (A2) |
| "mono 无 CORS" | `apps/server/src/` `enableCors`/`@fastify/cors` 0 命中 | ❌ 确认 gap (A3) |
| "mono 用 key-by-key config.get" | `apps/server/src/` 0 `ConfigModule.forRoot({ validationSchema })` | ❌ 确认 gap (A4) |
| "mono 无 coverage threshold" | `apps/server/vitest.config.ts` coverage 段无 thresholds | ❌ 确认 gap (A5) |
| "mono 无 @nestjs/schedule" | 仅 `outbox-event-cron.publisher.ts` stub + `:31` `TODO W3+ dispatch` | ❌ 确认 (→ B5/C1) |
| "mono 无 email/KMS/cloudauth/ip2region" | `apps/server/` 全 0 命中 | ❌ 确认 (→ B1-B4) |

---

## A 类: Plan 1 残留 infra gap (5 项,本 plan 详写)

### A1 · Health / Liveness / Readiness 端点

**Meta 实现**
- `application.yml:114` `management.endpoints.web.exposure.include: health,info,metrics,prometheus`
- `application.yml:116-120` `management.endpoint.health.probes.enabled: true` 启 `/actuator/health/{liveness,readiness}` 双端点
- Spring Boot Actuator 自动注入 DataSource / Redis 健康检查
- 用途: k8s pod probe + docker compose healthcheck + ALB target group

**Mono 现状**
- `apps/server/package.json` 无 `@nestjs/terminus`
- `apps/server/src/` 0 health/liveness/readiness controller
- `apps/server/Dockerfile` 无 `HEALTHCHECK` 指令
- 后果: docker-compose / k8s 起容器后无法判定真 ready;Prisma/Redis 挂了 HTTP 仍 200

**Gap 实质**: 容器编排时无 readiness 信号 → 流量切到死实例;Plan 3 部署(ADR-0026)前必须补

**架构批注 (2026-05-22)**:
- Terminus 默认兼容 Fastify;若用 `HttpHealthIndicator` 探活下游 HTTP 依赖,底层 client 须显式装 `@nestjs/axios`(Terminus 11+ 不再 bundle axios)
- `Dockerfile` `HEALTHCHECK CMD wget --quiet --spider http://localhost:3000/healthz/live || exit 1` — 让 docker swarm / k8s 能物理重启僵死容器(应用层 deadlock 但 TCP 仍开的场景)
- 划分: `/healthz/live` 仅返 200(进程活着即可,不查依赖);`/healthz/ready` 查 Prisma + Redis,挂任一 503 — k8s liveness 用前者(挂了重启),readiness 用后者(挂了切流量)

---

### A2 · Prometheus metrics 端点

**Meta 实现**
- `mbw-app/pom.xml:91-93` `io.micrometer:micrometer-registry-prometheus`
- `application.yml:113` `# prometheus exposed for scrape; in prod restrict via Nginx/SLB allowlist`
- `/actuator/prometheus` 自动暴露 JVM + HTTP server + DataSource + JDBC pool 等 ~50 维标准指标
- 用途: Grafana/VictoriaMetrics 拉取 → 监控面板 + 告警

**Mono 现状**
- `apps/server/package.json` 无 `prom-client` / `@willsoto/nestjs-prometheus`
- 0 `/metrics` endpoint
- 后果: 无 req count / p95 / 错误率 / event-loop lag / RSS / Prisma pool util 的标准时间序列

**Gap 实质**: 上线后任何 perf 问题黑盒;Plan 3 上线后第一次 SRE 类问题就撞

**架构批注 (2026-05-22)**:
- `@willsoto/nestjs-prometheus` `PrometheusModule.register({ defaultMetrics: { enabled: true } })` 自动覆盖 Node.js 内存 / event-loop lag / process CPU / GC
- **额外**手写 `HttpMetricsInterceptor`(全局 APP_INTERCEPTOR)统一暴露 `http_request_duration_seconds` Histogram,labels: `route` / `method` / `status_code` — 排查 p95 / 慢路由 / 5xx 分布的成本从"跨多个工具拼数据"降到"PromQL 一行"
- Route label 须用 NestJS 的 `controller.path + handler.path`(模板路径如 `/api/v1/accounts/:id`),**禁用** `req.url`(具体 ID 会爆 cardinality)
- prod env `/metrics` 端点须配 nginx/SLB allowlist(只让 Prometheus scrape 源 IP 进),不暴露公网

---

### A3 · Profile-aware CORS

**Meta 实现**
- `mbw-app/src/main/java/com/mbw/app/web/DevCorsConfig.java`(宽 allowedOrigins:`*`)
- `mbw-app/src/main/java/com/mbw/app/web/ProdCorsConfig.java`(白名单)
- `mbw-app/src/test/java/com/mbw/app/web/ProdCorsConfigTest.java` 验证 prod 拒非白名单 Origin
- `@Profile("dev")` / `@Profile("prod")` 编译期切换,prod bundle 不含 Dev 配置

**Mono 现状**
- `apps/server/src/main.ts` 无 `app.enableCors(...)` 也无 `@fastify/cors` register
- 默认 Fastify 不发 `Access-Control-Allow-Origin` header,任何跨域 fetch 必被浏览器 CORS preflight 拒
- 当前不撞,因为只有 e2e 跑本地 + Postman 类工具不走 CORS

**Gap 实质**: 一旦 Expo Web build 部署 CF Pages(per ADR-0025)→ 跨域 fetch 全死;须**在 Expo Web 第一次 deploy 前**有 prod CORS 白名单 + dev 宽松开关

**架构批注 (2026-05-22)**:
- `await app.register(fastifyCors, { origin: parseOrigins(env.CORS_ALLOWED_ORIGINS) })` **必须在任何 controller 路由挂载之前**;Fastify 插件注册顺序敏感,挂错后 preflight 请求会被业务路由拦截
- 一套代码兼容 dev / prod:`CORS_ALLOWED_ORIGINS` 支持逗号分隔多 origin,dev 设 `*` 或 `http://localhost:8081,http://localhost:19006` 等 Expo 端口,prod 设 `https://mbw.app,https://www.mbw.app`
- `parseOrigins` helper:`*` → `true`(放任) / 否则 split + trim → string[];禁用 origin reflect-back(不要 `(origin, cb) => cb(null, true)`,等于关 CORS)

---

### A4 · Typed config (`@ConfigurationProperties` 等价)

**Meta 实现**
- 9 个 `*Properties.java`,例 `JwtProperties.java`:
  ```
  @ConfigurationProperties(prefix = "mbw.auth.jwt")
  @Validated
  public class JwtProperties {
    @NotBlank String secret;
    @Positive Duration accessTtl;
    ...
  }
  ```
- `@Validated + @NotBlank/@Positive` 让 Spring 在 **boot phase** 就 fail-fast(配置缺失/类型错/范围越界 立即 NPE,不能进 listen)
- 业务代码注入 typed bean:`@Autowired JwtProperties props; props.getSecret()` — IDE 补全 + 编译期类型安全

**Mono 现状**
- `apps/server/src/security/jwt-token.service.ts` 用 `configService.get<string>('AUTH_JWT_SECRET')`
- 返回类型 `string | undefined`,业务代码到处 `!` 断言或 `if (!secret) throw`
- 缺/typo 不在 boot 时 fail,撞到第一次 sign token 才报错
- `ConfigModule.forRoot()` 没传 `validationSchema`(Zod / Joi 都行)

**Gap 实质**: 配置错配晚到运行时才暴露;新加 env 没人统一收口 → `.env.example` 漂移又会触发 check-env-sync(已有,PR #100)但只校验 keys,**不校验 values**

**架构批注 (2026-05-22)** — 消除 LLM 与人类的"环境配置幻觉"最强武器:
- **不允许**业务代码出现裸 `configService.get('...')`;凡 env 消费一律 typed Provider 注入
- 目标态调用范式:
  ```typescript
  // apps/server/src/config/app.config.ts
  import { registerAs } from '@nestjs/config';
  import { z } from 'zod';

  const schema = z.object({
    jwt: z.object({
      secret: z.string().min(32),
      accessTtlSec: z.coerce.number().int().positive(),
    }),
    db: z.object({ url: z.string().url() }),
    // ...
  });
  export type AppConfigType = z.infer<typeof schema>;

  export const appConfig = registerAs('app', () =>
    schema.parse({
      jwt: { secret: process.env.AUTH_JWT_SECRET, accessTtlSec: process.env.AUTH_JWT_ACCESS_TTL_SEC },
      db:  { url: process.env.DATABASE_URL },
    })
  );

  // 业务消费:
  constructor(@Inject(appConfig.KEY) private readonly config: AppConfigType) {}
  // this.config.jwt.secret — 强类型 / IDE 补全 / boot phase fail-fast / 运行时 100% 存在
  ```
- `AppModule.imports: [ConfigModule.forRoot({ load: [appConfig], cache: true })]`;Zod `parse` 在 boot 阶段抛 → 进不了 listen,fail-fast 达成
- 模块化:可拆 `authConfig` / `dbConfig` / `redisConfig` 分别 `registerAs`,各 module 独立注入

---

### A5 · Coverage threshold CI gate

**Meta 实现**
- `pom.xml:359-376` JaCoCo plugin:
  ```
  LINE >= 0.60
  BRANCH >= 0.50
  ```
  注释:"M1.1 起手 60%/50%,M2 业务代码量上来后收紧 75%/65%"
- `mvn verify` 阶段触发,`<haltOnFailure>true</haltOnFailure>` 让 CI 红
- 报告产物上传 GitHub Actions artifact

**Mono 现状**
- `apps/server/vitest.config.ts` coverage 段:
  ```
  coverage: { provider: 'v8', reporter: ['text','html','lcov'], include: ..., exclude: ... }
  ```
- **无 thresholds 字段** → 即使覆盖率跌到 0% test job 仍绿
- `.github/workflows/ci.yml` 也无独立 coverage check job

**Gap 实质**: 测试覆盖率回退完全靠 review 肉眼;新 feature 不写测试也能合入

---

## A 类执行序列建议

**单 PR 即可**,5 项相互独立,无依赖,1 day 完成:

| 子改动 | 关键文件 | 工作量 |
|---|---|---|
| A1 health module | 新 `apps/server/src/observability/health.module.ts`(`@nestjs/terminus` PrismaHealthIndicator + RedisHealthIndicator;`@nestjs/axios` 给 HttpHealthIndicator);`/healthz/live` + `/healthz/ready` 分离;amend `Dockerfile` 加 `HEALTHCHECK CMD wget --quiet --spider http://localhost:3000/healthz/live \|\| exit 1` | 2h |
| A2 metrics module | 新 `apps/server/src/observability/metrics.module.ts`(`@willsoto/nestjs-prometheus` + default metrics);新 `HttpMetricsInterceptor`(APP_INTERCEPTOR) 暴露 `http_request_duration_seconds` Histogram(labels: route/method/status_code,route 用 controller 模板路径不用 req.url) | 2.5h |
| A3 CORS | amend `main.ts` `await app.register(fastifyCors, ...)` **必须**在 controller mount 前;`parseOrigins` helper 支持 `*` 与逗号分隔;.env.example 加 `CORS_ALLOWED_ORIGINS`;prod 拒未授权 Origin e2e test | 1h |
| A4 typed config | 新 `apps/server/src/config/{app,auth,db,redis}.config.ts` 用 `registerAs` + Zod schema;`AppModule.imports: [ConfigModule.forRoot({ load: [...configs], cache: true })]`;业务代码改用 `@Inject(appConfig.KEY)` typed 注入;**全仓 grep `configService.get` 替换** | 4h |
| A5 coverage threshold | amend `vitest.config.ts` coverage 段加 `thresholds: { lines: 60, branches: 50, functions: 60, statements: 60 }`;一次性 sanity baseline | 30min |

**复用既有 utility**:
- Schema pattern: `.specify/schemas/` 已有 Zod + lefthook 校验(A4 复用)
- Lefthook env hook: PR #100 `check-env-sync` + `gitleaks` 段位(A3 新 env 自动覆盖)
- CI: `.github/workflows/ci.yml` build+test job(A5 通过 vitest 退出码自然带入,无新 workflow)

---

## B 类: 业务集成 gap → 沉淀为 ADR draft (不进本 plan impl)

跟 [Plan 2/3](05-19-plan2-plan3-migration-deploy.md) 16 use case 顺序迁入。本 plan 只记账,避免 Plan 2 起手"以为有"。

| # | Gap | Meta 实现锚点 | 建议 ADR 沉淀 |
|---|---|---|---|
| B1 | Email ESP 集成 | `ResendEmailClient` + WireMock IT + `Mock` fallback (`mbw.email.resend.*` properties) | 新 ADR: `ESP 选型 (Resend vs Aliyun DirectMail vs SES) + adapter 模式`,trigger=第一个含 email 通知 use case |
| B2 | Aliyun Cloud Auth 实名 | `@alicloud/cloudauth20190307` SDK + `BypassRealnameClient` dev mode + `AliyunRealnameProperties` | 跟随 realname-auth use case 进 spec,不立独立 ADR(SDK 选型由 ADR-0018 Java→TS 通用决策已覆盖) |
| B3 | Aliyun KMS / DEK cipher | `AliyunKmsCipherService` + `EnvDekCipherService` SPI + `RealnameDekProperties`(身份证号 at-rest 加密) | 新 ADR: `Field-level encryption strategy (KMS vs env-DEK vs no-encrypt)` + PII 字段清单,trigger=B2 启动前 |
| B4 | GeoIP (ip2region) | ip2region offline 2.7.0(`refresh_token.ip_address` 解析) | 跟随 device-management / 异地登录预警 use case;库选型 ADR 轻量(npm `node-ip2region` 现成) |
| B5 | 业务 Scheduler | `@Scheduled` + `FrozenAccountAnonymizationScheduler` + `PendingRealnameRecoveryScheduler` + `Asia/Shanghai` TZ | 新 ADR: `Scheduler infra (@nestjs/schedule vs BullMQ vs k8s CronJob)`,trigger=第一个真业务 scheduler |

---

## C 类: 架构 deferred → 沉淀为既有 ADR amend (不进本 plan impl)

| # | Gap | 现状 | ADR 沉淀建议 |
|---|---|---|---|
| C1 | Outbox consumer (subscriber side) | `outbox-event-cron.publisher.ts:31` 注释 `TODO W3+: dispatch to real subscriber` | **amend 既有 ADR-0033** (Cross-Context Communication via Outbox) 加 "consumer side W3+ 触发条件" 段:第一个真跨 context 异步消费者(welcome SMS / search-index update / metrics aggregation)出现时启动 |

C2 慢测试 tag isolation **不算 gap**:mono `RUN_PERF_IT` env-gate (per [`feedback_env_gated_perf_it_pattern`](../../.claude/memory/feedback_env_gated_perf_it_pattern.md)) + `.github/workflows/nightly-perf.yml` (PR #102 ship) 与 meta `@Tag("slow")` + `mvn -Pfull-tests` 等价。

---

## Verification (A 类全 ship 后 e2e smoke)

```bash
# A1 health
curl -sf http://localhost:3000/healthz/live | jq '.status == "ok"'
curl -sf http://localhost:3000/healthz/ready | jq '.info.prisma.status == "up"'
docker inspect --format '{{.State.Health.Status}}' <container>  # 应 "healthy"

# A2 metrics
curl -s http://localhost:3000/metrics | grep -E '^(nodejs_eventloop_lag_seconds|process_cpu_user_seconds_total|http_request_duration_seconds_bucket)'

# A3 CORS
NODE_ENV=prod CORS_ALLOWED_ORIGINS=https://mbw.app pnpm exec nx run server:serve &
curl -X OPTIONS -H "Origin: https://evil.com" -H "Access-Control-Request-Method: POST" \
  http://localhost:3000/api/v1/accounts/phone-sms-auth -i | grep -i "access-control-allow-origin" # 应 0 命中

# A4 typed config — 故意删 AUTH_JWT_SECRET
unset AUTH_JWT_SECRET && pnpm exec nx run server:serve  # 期望 immediate exit non-zero, 日志含 "AUTH_JWT_SECRET is required"

# A5 coverage threshold — 临时砍一个 spec
pnpm exec nx run server:test --coverage  # 期望 exit non-zero with threshold report
```

### 关键 assertion

1. **k8s readiness probe 模拟**: Prisma 关 connection (`docker stop pg-dev`)→ `/healthz/ready` 应 503,`/healthz/live` 仍 200
2. **Prometheus scrape pull-test**: 起 prometheus container 配 scrape `/metrics`,5 min 后 `up{job="server"}` 应回 1
3. **CORS prod 拒未授权 Origin**: 上述 e2e
4. **Typed config 缺 env**: boot phase 红,不能进 listen
5. **Coverage gate**: 临时删测试 → CI 红

---

## Out of scope (本 plan 不做)

- B 类全部 → 跟 Plan 2 use case 触发,ADR 先沉淀
- C1 outbox consumer → ADR-0033 amend "consumer trigger" 段
- Helmet / CSRF / HSTS 等 HTTP 安全头 → 不在 meta backend 中,不属对标 gap
- 分布式 tracing (Jaeger/Tempo) → meta 也只 Micrometer Observation infrastructure ready,未接 tracer;mono `nestjs-cls` 已覆盖伪 trace
- API gateway / BFF 层 → 不在 meta backend 中
