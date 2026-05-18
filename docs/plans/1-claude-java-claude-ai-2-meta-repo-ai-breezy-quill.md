# Plan 1 — 后端技术路线选型(决策 + Vertical Slice PoC,v2)

> **Plan 系列定位**:本文是「推倒重来」三连 plan 的第一份。Plan 2 = mono-repo 多语言基础设施 + 跨语言契约层 + CI/CD;Plan 3 = 现有资产分阶段迁移到新 mono-repo + 旧 Java 仓退场。
> **本 plan 仅决定 Plan 1 的执行**;Plan 2/3 作为下游接口契约方在 § F / § G 申明依赖,后续单独立 plan 落地。
> **v2 修订说明**:v1 主推 raw Fastify + Drizzle + Turborepo;经 user 6 项 push back + Web research 实证(NestJS+Fastify 性能不输 raw Fastify、Lucia 已 deprecated、Nx multi-lang 现状、新 GitHub repo lock),v2 主推 **NestJS + Fastify adapter + Prisma + Nx**,PoC 直接起新 GitHub repo `no-vain-years-mono`。

## Context

**当前状态**:
- 后端 Java 21 + Spring Boot 3.5.14 + Spring Modulith 1.4.11 + ArchUnit;严格 DDD 5 层;mbw-account 已 ship register / login / refresh / device / realname / freeze / deletion;PG 16 / Redis 7 / Aliyun SMS+cloudauth / Resend / Nimbus JOSE / Bucket4j。
- 前端 Expo SDK 54 + RN 0.81 + NativeWind v4 + zustand + TanStack Query + OpenAPI Generator client(**前端选型保持不变**,user 已 confirm)。
- meta-repo 模式(meta / server / app 三仓),`feat-open` 跨仓 worktree、`CC_NS` namespace、跨仓 spec symlink、三仓 lefthook 镜像 — 跟 Claude Code 配合实证 8 大类摩擦。
- mbw-account 当前**零真实用户**(user confirm),仅本地 + CI。

**为什么动**:
1. **Java 在 AI 编程助手时代结构性边缘化** — Anthropic Agent SDK 仅 Python + TypeScript 一等公民,Java 在 D1 (AI 适配度) 有 30%+ 差距;JetBrains Promise Index 2025 / SO 2025 Java 缺席前列。
2. **多语言诉求 → meta-repo 维护成本线性增长** — user 未来引入 Python/Go 子服务,继续 meta-repo 会让 lefthook / spec symlink / settings 镜像爆炸(`feedback_cross_repo_lint_config_mirror` 等多条 memory 实证)。Plan 2 切 mono-repo 是必然,工具锁定 **Nx**(user lock)。
3. **趁项目早期推倒重来,成本最低** — 零生产用户、业务模块仅 1 个、Java 沉淀以"DDD 设计 + spec.md + ADR 思想"形式可继承(代码不可继承)。

**Plan 1 目标**:
1. 用维度法在 8 候选中选定后端主语言 + 框架栈(完成,见 § E)
2. 落 ADR-0018(新栈 root 决策)+ ADR-0019(ORM)+ ADR-0020(模块化策略 in NestJS)
3. 跑 Vertical Slice PoC 验证关键假设(account 模块 1 use case 端到端 + Nx CI)
4. 输出 Plan 2 / Plan 3 接口契约 + 资产迁移清单
5. **不**改 prod、**不**改前端、**不**起 mono-repo 全套 infra(留给 Plan 2)
6. PoC 直接 push 到新建 GitHub repo `no-vain-years-mono`(Plan 1 完成后该 repo 即 Plan 2 起点)

**User 已 lock 的 8 项 calibration**:
| # | 决策点 | Lock 值 |
|---|---|---|
| C1 | DDD 约束硬度 | **软约束**(分层 + 模块边界即可) |
| C2 | 跨端代码复用诉求 | **重要但可妥协**(OpenAPI gen 可接受) |
| C3 | 学习曲线 vs 趋势 | **趋势优先**(愿付 3-6 月学习成本) |
| C4 | AI / Claude 生态适配度权重 | **Top tier**(跟 DDD / 生态成熟度并列 ×3) |
| C5 | 当前 Java 后端真实用户基线 | **零用户**(直接重写) |
| C6 | Plan 1 deliverable 范围 | **决策 + Vertical Slice PoC**(4-5 周) |
| C7 | 主推语言 / 框架 | **TS / NestJS + Fastify adapter** |
| C8 | mono-repo 工具 | **Nx**(锁定,不再对比 Turborepo) |
| C9 | 新 GitHub repo 仓名 | **`no-vain-years-mono`** |
| C10 | NestJS underlying HTTP | **Fastify adapter** |
| C11 | 主 ORM | **Prisma** |
| C12 | tRPC 引入 | **不引入**(OpenAPI 底座) |
| C13 | JWT 兼容旧 token | **不需要**(采用主流 NestJS auth + jose) |
| C14 | Lint/Format 等是否继承现 ADR | **不绑**(基于 TS 生态独立选最适合) |

---

## § A. 评估维度(按重要度排序)

| # | 维度 | 权重 | 1 分 | 3 分 | 5 分 |
|---|----|----|----|----|----|
| D1 | AI / Claude 生态适配度 | **×3** | 仅社区第三方 SDK | 官方 client SDK,无 Agent SDK | Agent SDK 一等 + Anthropic 内部用 + Context7 全覆盖 + MCP 主流 |
| D2 | 后端生态成熟度 | **×3** | 1-2 框架,ORM 弱 | 主流框架够用 | 多套验证过的框架 + ORM + 大厂 SDK 一等 |
| D3 | DDD / 模块化支撑 | ×2 | 弱类型 + 无 DI + 无边界工具 | 强类型 + 手搓 DI | 强类型 + 框架级 DI + 模块化原生(NestJS module / Spring Modulith) |
| D4 | 未来 5-10 年趋势 | ×2 | 长期下滑 | 横盘成熟期 | Promise Index Top 4 + 持续上升 |
| D5 | 跨端复用潜力 | ×1.5 | OpenAPI gen 差 + 无 share | OpenAPI gen 可用 | TS 原生 share + monorepo 自然 |
| D6 | Solo dev 体感 | ×1.5 | 编译 30s+ / debug 痛 | 编译 5-10s / debug 可 | 编译 <2s + hot reload + 框架抽象贴 user 经验 |
| D7 | 部署形态 | ×1 | JVM 大镜像 + 启动 5s+ | 中镜像 + 启动 1-3s | 单二进制 + 启动 <500ms |
| D8 | 阿里云 SDK 兼容 | ×1 | 仅裸 HTTP | 官方维护中等 | 完整阿里云一等公民 SDK |
| D9 | 学习曲线(对 user Spring 背景) | ×1 | 6-12 月 | 2-4 月 | 0-1 月(概念可平移) |
| D10 | 性能 ceiling(本应用轻负载) | ×1 | 几百 QPS | 1-5k QPS | 万级 QPS |

**权重设计**:D1/D2 ×3 直接反映 user calibration(AI Top tier + 生态决定生死);D3/D4 ×2 是 DDD 软约束 + 5-10 年方向;D9 在 user calibration "趋势优先"下被放低权重 ×1(但 D9 改成"对 user Spring 背景的可迁移度",对 NestJS 是正分)。

---

## § B. 评估矩阵(8 候选 × 10 维度,加权总分)

| 候选 | D1×3 | D2×3 | D3×2 | D4×2 | D5×1.5 | D6×1.5 | D7×1 | D8×1 | D9×1 | D10×1 | **总分 /81** | 排名 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **NestJS + Fastify adapter**(主推) | 13.5 | 15 | 10 | 10 | 7.5 | 5.25 | 2.5 | 4 | 4.5 | 3 | **75.25** | **1**(对 user 个性化 +1) |
| TS / Fastify raw(原 v1 主推) | 15 | 15 | 7 | 10 | 7.5 | 6 | 3 | 4 | 5 | 3 | **75.5** | 2 |
| TS / Bun + Hono | 15 | 12 | 7 | 9 | 7.5 | 7.5 | 4 | 3.5 | 4 | 3.5 | **73.0** | 3 |
| Python / FastAPI | 15 | 15 | 7 | 9 | 3 | 6.75 | 3 | 4 | 3.5 | 3 | **69.25** | 4 |
| Kotlin / JVM | 7.5 | 15 | 10 | 7 | 3.75 | 3.75 | 2.5 | 5 | 4.5 | 4 | **63.0** | 5 |
| Java 21(baseline) | 7.5 | 15 | 10 | 5 | 3.75 | 3.75 | 2.5 | 5 | 5 | 4 | **61.5** | 6 |
| Go 1.23+ | 9 | 12 | 6 | 8 | 3.75 | 5.25 | 5 | 4 | 3 | 4.5 | **60.5** | 7 |
| Rust 1.80+ | 10.5 | 10.5 | 9 | 9 | 3 | 3 | 5 | 1.5 | 2 | 5 | **58.5** | 8 |

### NestJS+Fastify 与 raw Fastify 打分差异说明

| 维度 | NestJS+Fastify | TS/Fastify raw | 变化原因 |
|---|---|---|---|
| D1 AI 适配 | 4.5 | 5 | **-0.5**:NestJS 不是 Anthropic Agent SDK 一级公民(Agent SDK 官方示例是 Express/Fastify) |
| D3 DDD 支撑 | 5 | 3.5 | **+1.5**:NestJS module + DI + AOP 直接对标 Spring,模块边界框架级而非手搓 dep-cruiser |
| D6 Solo 体感 | 3.5 | 4 | **-0.5**:NestJS 样板量比 raw Fastify 大(module / provider / decorator),但对 Spring 老用户体感为零 |
| D7 部署形态 | 2.5 | 3 | **-0.5**:NestJS bundle ~80M / 冷启 500-2000ms(可用 SWC 优化到 ~50ms),raw Fastify 更轻 |
| D9 学习曲线 | 4.5 | 5 | **-0.5**:NestJS 概念多但对 user Spring 经验是平移加分,绝对值仍高 |

**结论**:绝对分 NestJS+Fastify 略低 0.25 分,但 **D3 +1.5 分**是对 user 真实价值最大单项(Spring 经验复用 + DDD 软约束下仍想要框架级模块化)。**主推 NestJS+Fastify(C7 user lock)**。raw Fastify 列入"次级备选"。

---

## § C. 主推方案 — TS / NestJS + Fastify adapter + Prisma + Nx

### C.1 框架栈(锁定 / 已 user confirm)

| 角色 | 选型 | 理由 |
|---|---|---|
| Runtime | **Node 22 LTS** | LTS 到 2027-04;生态最厚;Bun 推迟到 M3 复评 |
| HTTP 框架 | **NestJS v11+ with Fastify adapter** | NestJS module/DI/AOP 对 Spring 老用户 0 概念阵痛;Fastify adapter 性能 2x Express |
| ORM | **Prisma v6+** | `@nestjs/prisma` 是 NestJS 事实标准;类型安全 + Prisma Studio + migrate 体感优秀 |
| Validation | **class-validator + class-transformer** | NestJS 原生,DTO 装饰器风格,对标 Spring `@Valid` + Bean Validation |
| DI 容器 | **NestJS 内置** | 框架级,不需要 tsyringe |
| Auth | **Passport.js + @nestjs/passport** | NestJS 官方推荐;Strategy 抽象与 Spring Security Filter 类似 |
| JWT | **@nestjs/jwt + jose** | jose 现代化 JWT 库;不要求兼容旧 nimbus token |
| Hash | **@node-rs/argon2**(Rust 加速) | 不再用 BCrypt(Argon2id 是 2025+ 推荐) |
| Rate limit | **@nestjs/throttler** + Redis storage | NestJS 官方;Redis backend |
| Queue | **BullMQ + ioredis** | NestJS 官方推荐(`@nestjs/bullmq`);ioredis 1550 万周下载 |
| Cache | **@nestjs/cache-manager** + Redis | NestJS 官方 |
| Resilience | **cockatiel**(retry/circuit breaker) | 替代 Resilience4j(Opossum 可选但 NestJS 无官方) |
| Observability | **OpenTelemetry SDK** + **pino**(via `nestjs-pino`) | OTel 跨语言通用;pino 性能 + NestJS 集成 |
| Migration | **Prisma Migrate** | Prisma 内置;`prisma db pull` 反推现 PG schema |
| Test | **Vitest 2** + **Testcontainers Node** + **MSW** + **@nestjs/testing** | NestJS 模块级 e2e 测试支持 |
| OpenAPI | **@nestjs/swagger** | NestJS 官方,装饰器即 OpenAPI annotation |
| Boundary check | **NestJS module 边界**(原生) + ESLint `eslint-plugin-boundaries`(辅助) | NestJS module 只能 export 显式声明的 provider,边界框架级强制(不需要 dep-cruiser) |
| Logger | **pino** via `nestjs-pino` | JSON 日志 + RequestId 中间件 |
| Package mgr | **pnpm 10**(2026-05-17 amend,原 pnpm 9) | TS 生态主流(此项独立选,不绑旧 ADR-0005);v10 是 2025+ default,lockfile v10 + auto-install-peers=true |
| Monorepo 工具 | **Nx 21+** | C8 user lock |

### C.2 阿里云 + 三方 SDK 替换矩阵

| 当前 Java | 新栈替代 | 状态 |
|---|---|---|
| `dysmsapi:4.5.1` | `@alicloud/dysmsapi20170525`(官方 npm,Feb 2026) | 一等 |
| Aliyun cloudauth(实名认证) | `@alicloud/cloudauth20190307`(官方 npm) | 一等 |
| Resend SDK | `resend`(npm 官方) | 一等 |
| Nimbus JOSE | `jose`(panva 维护) | 一等;**不强求 token 兼容**(C13) |
| Resilience4j | `cockatiel` | 主流 |
| Bucket4j | `@nestjs/throttler` + Redis | 官方 |
| ip2region | `ip2region` Node port + 同 `.xdb` | 社区维护(中等成熟) |
| Spring Data JPA | **Prisma** | Prisma `db pull` 反推现 PG schema(C11) |
| Spring Modulith outbox | **`@nestjs/bullmq` + 自写 outbox 表** | 显式 outbox pattern(~150 LoC) |
| MapStruct | Prisma 行类型 + class-transformer 自动派生 | 不需要 |

### C.3 DDD 实施 — NestJS Module 范式(软约束版)

NestJS module 系统天然提供"DDD 限界上下文"边界:每个 module 只 export 显式 provider,跨 module import 必须显式声明,**框架级强制**(不再依赖 ArchUnit / dep-cruiser)。

```text
apps/server/
  src/
    modules/
      account/
        domain/                     # 纯函数 + interface,无 NestJS 装饰器
          model/                    # 类型 + 工厂函数 (Account / PhoneNumber / RealnameStatus)
          policy/                   # 规则函数 (PasswordPolicy / RateLimitPolicy)
          repository.interface.ts   # 仓储接口 (Java 风 abstract)
        application/                # Use Case 类(@Injectable)
          register-account.use-case.ts
          phone-sms-auth.use-case.ts
        infrastructure/             # Prisma repo impl + 外部 SDK adapter (@Injectable)
          prisma/                   # PrismaService + repo impl
          aliyun-sms/               # AliyunSmsClient adapter
        api/                        # Controllers + DTO + 跨 module 公开 service
          account.controller.ts
          account-api.service.ts    # 跨 module 调用入口 (exported by AccountModule)
        account.module.ts           # @Module() 装配 + 显式 export api 子集
      pkm/                          # 未来模块
      ...
    shared/                         # SharedModule (跨模块工具,如 RequestId / OTel)
    bootstrap.ts                    # 装配 + 启动
  prisma/
    schema.prisma                   # Prisma schema (db pull 反推后维护)
    migrations/                     # Prisma Migrate 产物
  test/
  Dockerfile
  project.json                      # Nx 项目配置
```

**关键约束**(由 NestJS module 系统 + ESLint boundaries 双保险):
1. `domain/` 不能 import 任何 NestJS / Prisma / Aliyun SDK,只允许纯 TS 与 zod(若用)
2. `api/` 不能 import `infrastructure/` 直接(走 application use case)
3. 跨 module 通信只能经过对方 module 的 `api/` exported provider
4. `shared/` 不能 import 任何 business module

跨模块异步通信:`@nestjs/event-emitter`(本地 in-process)+ outbox 表 + BullMQ 消费(异步、可重试、可拆服务时改 MQ)。

### C.4 推迟到 PoC 后再决的次级决策

| 待决 | 候选 | PoC 数据驱动 |
|---|---|---|
| Auth 库 | Passport.js(NestJS 官方) vs Better Auth(更现代,NestJS 原生支持) | PoC W3 比较 boilerplate 量与 OAuth 接入难度 |
| OpenAPI generator 选项 | `@nestjs/swagger` 自动 vs nestjs-zod 派生 | PoC W2 试,看 DTO 描述准确度 |
| Logger 配置 | nestjs-pino 默认 vs 自定义 transport | PoC W4 看体感 |
| Bun 实验 | NestJS on Bun 1.2 是否可用 | PoC W5 buffer 期试,M3 再评 |

---

## § D. 备选触发条件 — Python 3.13 / FastAPI

**触发到备选的条件(任一)**:
1. **PoC 阶段** Prisma `db pull` 反推现 PG schema 失败 / 类型质量差 **AND** Drizzle / TypeORM 兜底也都不可接受
2. **PoC 阶段** NestJS module 边界 + ESLint boundaries 表达力不足以覆盖当前 ArchUnit 全部 rule(可能性极低,NestJS 模块边界天然强)
3. **PoC 阶段** Anthropic Agent SDK 在 6 周内官宣 Python 显著领先 TS

**Python 主推栈预案**(以备 PoC 切换):
- Web: FastAPI + uvicorn workers
- ORM: SQLAlchemy 2.0 (async) + Alembic
- Validation: Pydantic v2
- DI: dependency-injector
- Auth: python-jose + passlib[argon2]
- Test: pytest + testcontainers-python + respx
- Package mgr: uv

---

## § E. Vertical Slice PoC — 范围 + 验收 + 时间盒(本 Plan 1 包含)

### E.1 PoC 选用 use case

**选定**:`phone-sms-auth`(手机号短信认证)。

**理由(三票决定)**:
1. **覆盖率最广** — 涵盖 SMS adapter (Aliyun) / Redis 验证码 / JWT 颁发 / Prisma 写 account+credential / @nestjs/throttler 限流 / 反枚举吞 status / Use Case 编排 / Domain Policy / Module 边界 / OpenAPI 生成 — 几乎所有关键栈点
2. **当前实现完整** — Java mbw-account 内已有完整 PhoneSmsAuthUseCase,可逐函数对照重写、验证等价
3. **业务真实** — 不是 Hello World,真实 SMS / Redis state / DB write,真踩坑

**PoC 不做的**:
- 不重写 device-management / realname-verification / deletion(留给 Plan 3)
- 不接前端 RN 端到端(OpenAPI gen → mobile client 在验收清单内,不做端到端 mobile integration)
- 不部署到生产 / 阿里云 SWAS

### E.2 PoC 物理布局 — 直接起 Nx 最小 mono-repo,push 新 GitHub repo

PoC repo **直接** 按 mono-repo 布局起,**push 到新 GitHub repo `no-vain-years-mono`**(C9 user lock)。研究实证:PoC-B 最小 Nx 起步成本 < 1 hour,等同单包,但为未来 Python/Go 子服务零成本预留。

```text
no-vain-years-mono/                  # 新 GitHub repo (C9)
  .github/
    workflows/
      ci.yml                         # Nx affected build/test/lint
  apps/
    server/                          # NestJS + Fastify + Prisma (本 PoC 唯一 app)
      src/
        modules/account/
          domain/
          application/
          infrastructure/
          api/
          account.module.ts
        shared/
        main.ts                      # NestJS bootstrap
      prisma/
        schema.prisma                # `prisma db pull` 反推 PG schema
        migrations/                  # 不动旧 Java Flyway,Prisma 接管未来
      test/
      Dockerfile
      project.json                   # Nx
      tsconfig.app.json
      tsconfig.spec.json
  packages/
    shared-types/                    # 跨包共享 TS 类型(目前空,Plan 2 充实)
      src/index.ts
      project.json
      tsconfig.json
  docker-compose.dev.yml             # PG 16 + Redis 7(独立 db `mbw_poc`,不冲突现有)
  nx.json                            # Nx 全局
  tsconfig.base.json                 # TS path aliases
  package.json                       # pnpm workspaces root
  pnpm-workspace.yaml
  .gitignore
  CLAUDE.md                          # 新仓 Claude 约定(M1 起)
  README.md
```

**关键设计选择**(根据 multi-lang monorepo 研究):
- **`apps/server` 隐式语言** — 不带 `-ts` 后缀,functional domain 命名(Vercel/Shopify 模式),为未来 Python/Go 子服务无歧义共存做准备(`apps/data-pipeline/` `apps/gateway/` 可任意语言)
- **`packages/shared-types`** — PoC 阶段先空,Plan 2 充实 OpenAPI 生成的 types + zod schema + 跨模块 DTO
- **Docker Compose 本地数据栈** — 独立 db `mbw_poc`,不冲突现有 `mbw_dev`,可与 Java 后端 docker-compose 并存
- **CLAUDE.md 极简骨架重写** — 严格遵守现 `no-vain-years/CLAUDE.md` 体例:
  - **知识类 / 约束类完全分离** — 知识类(架构 / 技术栈 / 部署细节)**不写入 CLAUDE.md**,只在"按需 read"表格列路径;约束类经 `@docs/conventions/xxx.md` import 自动装载到 Claude context
  - **严格遵守 `claude-md-audit` skill 4 维度评估 + 7 反模式扫描原则**(避免后续 CLAUDE.md 爆炸,user 已优化好几轮的硬经验)
  - PoC 阶段 `docs/conventions/` 仅迁**必要约束**:`business-naming.md` / `git-workflow.md` / `sdd.md` 三件(直接物理 copy);其他 conventions(worktree.md / agent-view-usage.md / claude-config-layout.md 等)Plan 2/3 阶段按需补
  - 旧仓 `no-vain-years/CLAUDE.md` Plan 3 完成后标 superseded(`> Superseded by no-vain-years-mono/CLAUDE.md on YYYY-MM-DD`)

**cwd 启动 + memory 跨仓桥接策略**(混合模式,关键):

新仓 `no-vain-years-mono` 启动后,Claude Code session 的 cwd 选择走**混合模式**:

| 任务 | cwd | 原因 |
|------|-----|------|
| PoC 大头(NestJS / Prisma / Nx / Vitest / Docker / `gh pr create`) | `no-vain-years-mono/` | 操作权限自然,Bash workflow 贴 cwd |
| 改旧 meta ADR(0001/0006/0008/0011 加 superseded 头部) | `no-vain-years/`(本仓) | 跨仓任务一次性,从源仓直接改 |
| knowledge-vault 写(`~/knowledge-vault/`) | 任一 cwd | user-level path,不受 cwd 限制 |

**关键约束**:**必须用 `memory-cluster-bridge` skill 把 mono 仓 cwd 桥接到主 `no-vain-years` 的 memory pool**(否则新 cwd memory pool 空,70+ 条历史 memory 丢失,新仓变"上下文孤岛")。在 W1.0 启动前预设(详 § E.4 + § H R14)。

permission allowlist 策略:`~/.claude/settings.json`(user-level)的全局 allowlist 对所有 cwd 生效;mono 仓只需在 `.claude/settings.json` 加该仓**专属**新条目(`pnpm dlx nx`、`prisma db pull`、`@nestjs/cli` 等)。`CC_NS` 不设(走默认),last-session-notes 按 cwd 物理隔离不冲突。

### E.3 PoC 验收门槛(必须全部 pass 才能 lock ADR-0018)

| # | 验收点 | Pass 阈值 | 验证方式 |
|---|---|---|---|
| V1 | account 模块 LoC 不暴涨 | 新栈 LoC ≤ 当前 Java 等价代码 1.5x | `cloc` 对比 |
| V2 | NestJS module 边界对标 ArchUnit | NestJS module export 显式声明 + ESLint boundaries 覆盖 ArchUnit 4 类规则(domain 零依赖 / web ↛ infra / 跨 module 经 api / shared ↛ business module) | rule-by-rule 对照表 |
| V3 | Prisma db pull | `prisma db pull` 反推现 V1-V14 Flyway schema 100% 等价 | diff schema.prisma |
| V4 | Aliyun SMS 端到端 | mock + real 双链路 + cockatiel retry + 反枚举 status code 与 Java 1:1 | Testcontainers + e2e |
| V5 | JWT 颁发 + 验证 | @nestjs/jwt + jose 颁发 access + refresh token,可在 Postman/curl 全流程跑通 | manual + e2e |
| V6 | Nx dev 循环速度 | `nx serve server` 改代码到生效 < 3s 冷启 < 30s | 体感计时 |
| V7 | Docker image + cold start | image < 250M(NestJS bundle 80M + node + alpine)/ 启动 < 3s / 常驻内存 < 250M | docker stats |
| V8 | OpenAPI gen → 现 mobile client | @nestjs/swagger 产 OpenAPI 3.1 → 现 `@nvy/api-client` pipeline 生成的 TS client 编译过 + endpoint shape 1:1 | typecheck + diff |
| V9 | Nx CI 全绿 | `nx affected --target=lint,test,build` + Docker build + trivy 都过 | GH Actions |
| V10 | Claude Code agent loop 体感 | 主观评估 ≥ 当前 Java(用 Claude 跑 1 个完整 task 的命中率与速度) | session 记录 |

### E.4 时间盒

| 周次 | 工作 |
|---|---|
| W1 | **W1.0**(启动前预设)跑 `memory-cluster-bridge` skill 配 `autoMemoryDirectory` + zsh wrapper,把 mono 仓 cwd 桥接到主 `no-vain-years` memory pool;**W1.1** `gh repo create no-vain-years-mono --public` + 本地 `git clone`;**W1.2** 在 mono cwd 启新 claude session + validate memory bridge(70+ 主仓 memory 可见);**W1.3** 新仓 `.claude/settings.json` 初始化(仅 mono 专属 allow)+ CLAUDE.md 极简骨架(严格按 claude-md-audit 4 条)+ 3 个 conventions copy;**W1.4** Nx workspace 初始化 + Prisma `db pull` 反推 V1-V14 schema(V3 验收)+ NestJS app + Fastify adapter + class-validator + pino |
| W2 | phone-sms-auth domain + application 层重写(V1 / V2 验收) |
| W3 | infrastructure 层:Prisma repo impl + AliyunSmsClient adapter + @nestjs/jwt + cockatiel retry + Passport.js JWT strategy(V4 / V5 验收) |
| W4 | NestJS module 边界 + ESLint boundaries + Vitest + Testcontainers + Dockerfile + Nx CI + @nestjs/swagger(V6-V9 验收) |
| W5 | buffer(踩坑 / 备选切换决策窗口 / V10 主观体感记录 / ADR 落地撰写) |

**总时长**:4-5 周(C6 user 已 confirm)。

**Plan 1 完成定义**:V1-V10 全 pass + ADR-0018/0019/0020 落地 + Plan 2/3 接口契约 finalize + 旧 ADR cross-ref 矩阵完成。

---

## § F. Plan 1 → Plan 2(mono-repo infra)接口契约

Plan 2 必须从 Plan 1 拿到以下决策才能开干(本 Plan 1 完成时 lock):

| 必须 lock 的决策 | Plan 1 给定 | Plan 2 直接消费 |
|---|---|---|
| 后端主语言 | **TypeScript on Node 22 LTS** | 决定 monorepo 工具链 |
| 后端框架 | **NestJS v11+ + Fastify adapter** | Plan 2 在 `apps/server` 基础上扩展 |
| 主 ORM | **Prisma v6+** | `prisma/schema.prisma` 单一来源 |
| Monorepo 工具 | **Nx 21+**(C8 user lock) | `nx.json` + `project.json` 体系 |
| Package manager | **pnpm 10**(2026-05-17 amend,原 pnpm 9) | `pnpm-workspace.yaml`;单一 lockfile;`packageManager: pnpm@10.33.2` |
| TS dev runtime | **@nx/js:swc + .swcrc**(2026-05-17 W2.0 amend,撤回 #138;原 NestJS 内置 SWC) | NestJS 官方推荐;手工 project.json executor 改(Nx 21 nest generator 默认仍 webpack,nrwl/nx#29263);转译不打包 = pino-pretty worker.js 自然 OK;legacyDecorator + decoratorMetadata 配 .swcrc |
| 包目录骨架 | `apps/server`(NestJS)+ `apps/mobile`(现 no-vain-years-app 物理迁入)+ `packages/shared-types`(OpenAPI gen + cross-module DTO)+ `packages/api-client`(前端消费)+ `packages/eslint-config` + `packages/tsconfig` | Plan 2 充实 |
| 命名规约 | **`apps/<functional-domain>` 隐式语言**(Vercel/Shopify 模式)— 不带 `-ts/-py/-go` 后缀,project.json 标语言 | Plan 2 加 Python/Go service 时同样按 functional domain 命名 |
| 跨语言 contract | **当前阶段 OpenAPI(@nestjs/swagger)**;未来引入 Python/Go 子服务时按需评估升级到 **Protobuf**(自动生成多语言 SDK) | Plan 2 加新 service 时再评估 contract 升级 |
| Lint / Format | **ESLint 9 flat config + Prettier 3**(不绑现 ADR-0007,但独立分析 TS 生态选 ESLint+Prettier 仍最适合 NestJS) | `packages/eslint-config` 共享;后端 ESLint 加 `eslint-plugin-boundaries` 限制 module import |
| Build | **@nx/js:swc 转译**(2026-05-17 W2.0 amend,撤回 #138;原 NestJS 内置 SWC) | 不 bundle,保留源码目录结构,node_modules 直接 ship;Docker 多阶段 copy node_modules;V6 nx serve 冷启 <5s 实测;V7 image 大小 W3+ 验 |
| Test runner | **Vitest 2**(前后端一致) | Plan 2 CI 模板 |
| Pre-commit hooks | **lefthook**(继承现工具但**单仓单 lefthook**,不再三仓 mirror) | Plan 2 mono-repo 单 lefthook.yml |
| CI provider | **GitHub Actions** + Nx affected | Plan 2 reusable workflows |
| 容器 base image | `node:22-alpine`(production)+ `pnpm` corepack | Plan 2 Dockerfile 模板 |
| Bun 是否 1st class | **否**,M3 复评(NestJS on Bun reflect-metadata 需验证) | Plan 2 不预留 Bun 工具链 |
| Python/Go 子服务预留 | **Nx plugin** 时序:Python(`@nxlv/python` + uv)、Go(`nx-go/nx-go` v4 beta);**真正引入时再装,PoC 阶段不装** | Plan 2 引入第一个非 TS 服务时再做 |

**Plan 1 必须 ship 给 Plan 2 的物理产物**:
1. **GitHub repo `no-vain-years-mono`** main 分支(含可工作的 phone-sms-auth use case)
2. ADR-0018(本选型 root)、ADR-0019(ORM = Prisma)、ADR-0020(模块化策略 = NestJS Module + ESLint boundaries)
3. 选定依赖白名单(`apps/server/package.json` template + 阿里云 SDK 验证清单)
4. Nx workspace 基线(`nx.json` + `tsconfig.base.json` + `pnpm-workspace.yaml`)
5. 边界规则(NestJS module + `.eslintrc` boundaries plugin 配置)
6. Vitest config + Dockerfile + GH Actions reusable workflow snippet

---

## § G. Plan 1 → Plan 3(资产迁移)接口契约

Plan 3 必须从 Plan 1 拿到以下决策才能开干:

| 必须 lock 的决策 | Plan 1 给定 | Plan 3 直接消费 |
|---|---|---|
| 旧 Java 服务运行模式 | **冻结 main 不再发 PR**;`my-beloved-server` GitHub repo 保留 12 月作 rollback 安全网(不删);**不双跑、不灰度**(C5 零用户) | 单向迁移,无双写 |
| DDD spec.md 保留度 | spec.md **全部直接复用**;plan.md / tasks.md / analysis.md 因技术栈变需**重新生成** | Plan 3 spec 物理拷贝到 `no-vain-years-mono/specs/`,plan/tasks 重做 |
| 业务功能迁移优先级 | account 基础 → phone-sms-auth → tokens(refresh / logout)→ freeze + deletion(cancel + anonymize)→ **realname**(Aliyun cloudauth 复杂外部依赖,Plan 3 后期)→ **device**(ip2region + 地理位置 + revoke event,最复杂,Plan 3 最后)| Plan 3 sprint 顺序 |
| 数据库 schema 迁移 | Postgres schema **零变更**(Prisma `db pull` 反向生成 `schema.prisma`) | 数据零停机切换(零用户场景下"停机"无意义,但 schema 兼容性保留) |
| 认证 token 兼容 | **不要求兼容**(C13)— 新 token 体系 from scratch | 用户(若有)需重登;PoC 之外的环境无须考虑 |
| API contract 兼容 | OpenAPI 3.1 schema 逐 endpoint 兼容,NestJS controller 复刻 path/method/payload | Expo app 在 mono-repo 内 `apps/mobile` 直接消费新 client,旧 client 弃用 |
| Migration 工具切换 | Flyway → Prisma Migrate(`prisma migrate dev` + `prisma migrate deploy`) | Plan 3 数据库治理迁移 |
| 旧仓退场 | `my-beloved-server` + `no-vain-years` + `no-vain-years-app` 三仓 Plan 3 完成后 **archive 不删** 12 月 | Plan 3 退场 checklist |

### G.1 ADR cross-ref 矩阵

| 旧 ADR | 主题 | 处理 | 新对应 ADR |
|---|---|---|---|
| ADR-0001 | Modular Monolith with Spring Modulith + ArchUnit | **superseded** | ADR-0020(NestJS Module + ESLint boundaries) |
| ADR-0002 | M1 Deployment A-Tight | superseded by ADR-0012,本 Plan 不动 | (Plan 2 deployment 决策另立) |
| ADR-0003 | Release-Please + Conventional Commits | **直接继承** | 同名沿用 |
| ADR-0004 | Tamagui + Expo | 已被 ADR-0014 superseded | — |
| ADR-0005 | pnpm Exclusive | **直接继承**(pnpm 仍是 TS 生态主流;独立 verify) | 同名沿用 |
| ADR-0006 | Meta CLI Multi-Repo | **superseded by 新 mono-repo 决策** | ADR-0021(Nx mono-repo,Plan 2 立) |
| ADR-0007 | ESLint + Prettier(defer Biome) | **重新评估后继续**(Biome 在 NestJS 装饰器场景仍未完美支持,ESLint 必需);独立选 = 同结论 | 同名沿用 |
| ADR-0008 | Pure Repository Interface in Domain(Java) | **superseded** | (DDD 思想保留;NestJS 实现差异在 ADR-0020 描述) |
| ADR-0009 | Lefthook as Git Hook Runner | **直接继承** | 同名沿用 |
| ADR-0010 | SDD via GitHub Spec-Kit | **直接继承**(SDD 流程语言无关) | 同名沿用 |
| ADR-0011 | 限流 JCache→Redis (Bucket4j) | **superseded** | ADR-0022(@nestjs/throttler + Redis,Plan 2 立) |
| ADR-0012 | M1 部署 A-Split | **暂保留**,Plan 2 重新评估部署形态 | TBD |
| ADR-0013 | SMS 绑企业资质 | **直接继承**(业务决策无关栈) | 同名沿用 |
| ADR-0014 | NativeWind v4 + Tailwind | **直接继承**(前端不动) | 同名沿用 |
| ADR-0015 | Claude Design M1.2 账号中心 | **直接继承**(设计 workflow 无关栈) | 同名沿用 |
| ADR-0016 | 统一 mobile-first phone-SMS auth | **直接继承**(产品决策无关栈) | 同名沿用 |
| ADR-0017 | SDD 业务流先行 + mockup 后置 | **直接继承** | 同名沿用 |

### G.2 资产迁移红黄绿分类

| 类别 | 资产清单 | 处理 |
|---|---|---|
| 🟢 **必迁** | 17 ADR 中 11 个"直接继承"(0003/0005/0007/0009/0010/0013/0014/0015/0016/0017 + 0012 待评)/ SDD spec.md 全部 / business-naming 等 conventions / agent-view 配额纪律 / 14 个 spec-kit skill / 17 个通用 user skill / michael-speckit-presets 4 个 preset(改 path) | Plan 3 直搬 |
| 🟡 **需适配** | worktree 脚本(改项目名/容器名;但 mono-repo 场景下可能不再必要,Plan 2 评估)/ lefthook 三仓合一为 1 份 / .claude/settings.json 合并 / iCloud symlink 重接 | Plan 3 改配置 |
| 🔴 **重写** | DDD 5 层骨架(Java Maven module → NestJS module 结构)/ ArchUnit rules → NestJS module exports + ESLint boundaries / MapStruct → class-transformer / Spring Modulith outbox → BullMQ + 自写 outbox / Spring Security → Passport.js + @nestjs/jwt | Plan 3 在 Plan 1 PoC 基础上扩展 |
| ⚪️ **废弃** | Maven 配置 / Spotless + Palantir / Checkstyle / Flyway(被 Prisma Migrate 替)/ Nimbus JOSE(替 jose)/ Bucket4j(替 @nestjs/throttler)/ Resilience4j(替 cockatiel)/ Spring Modulith / ArchUnit / MapStruct / Springdoc(替 @nestjs/swagger) | Plan 3 不迁 |

---

## § H. 风险与不确定性

| # | 风险 | 概率 | 影响 | mitigation |
|---|---|---|---|---|
| R1 | Prisma `db pull` 反推现 PG schema 失败 / migration UX 差 | Mid | Mid | PoC W1 先验证;ADR-0019 PoC 后落;失败兜底 Drizzle Kit introspect |
| R2 | NestJS Fastify adapter 与某中间件兼容性踩坑 | Low | Mid | PoC W4 实测;失败兜底 Express(性能损失但功能完整) |
| R3 | NestJS 装饰器 metadata reflect 在 SWC / Vite / Bun 兼容性 | Low | Low | W2.0 实测 SWC + .swcrc(legacyDecorator + decoratorMetadata) GET /api + ValidationPipe + nestjs-pino 全工作;Vite / Bun 不预留 |
| R4 | Claude Code 写 NestJS 准确率主观体感不如预期(D1 维度论点不成立) | Low-Mid | Mid | V10 主观验收;失败 → 评估切回 raw Fastify(原 v1 主推,排名 #2) |
| R5 | Anthropic Agent SDK 在 2-3 年内出 Java/Go 一等公民版,user 后悔 | Low-Mid | Low | TS 仍是 Anthropic top-2 一等公民;NestJS 即使 Anthropic 生态非一级也不掉队 |
| R6 | solo dev 转 NestJS 不顺(虽然概念对标 Spring,细节差异多) | Mid | Mid | PoC 4-5 周完整重写 1 个 use case 是直接体感验证;V10 主观评分;Spring 经验在 NestJS 概念层 0 摩擦,Node 生态细节(ORM / 错误处理)是真学习 |
| R7 | Aliyun Node SDK 在国内出问题 / 文档滞后 | Low | Mid | PoC V4 实测;infra 层隔离,实在不行裸 HTTP fallback,只动 1 个 adapter |
| R8 | NestJS bundle / 冷启动在 SWA / Aliyun ECS 体感不可接受 | Low | Low | NestJS 不部 Lambda;传统 VPS 冷启 2-3s 可接受;SWC 优化进一步降到 500ms-1s |
| R9 | Nx 学习曲线对 solo dev 是负担 | Low | Low | 研究实证 PoC-B 最小 Nx <1h 起步成本;Nx generators 现成 |
| R10 | Plan 1 PoC 完成后 Plan 2/3 启动延迟 | Mid | Mid | § E.4 4-5 周硬时间盒;W5 buffer;超 5 周走备选 Python 重启 |
| R11 | `no-vain-years-mono` 新 repo 启动后,旧 meta-repo 仍持续生产 friction(double maintenance 期) | High | Low | Plan 1 PoC 不需要旧 repo 参与;Plan 3 启动后 1-2 sprint 内迁完 |
| R12 | NestJS 在 Anthropic / MCP 生态非一级公民(Agent SDK 官方示例是 Express/Fastify) | Mid | Low | 选 NestJS = 失 D1 边际 0.5 分(NestJS module 自身仍是主流 + Anthropic SDK 一级 TS);若 user 后续真做 MCP server,可单独起 raw Fastify 微服务 |
| R13 | 新仓 CLAUDE.md 重写后体例漂移,知识类被塞进 CLAUDE.md 又爆炸(user 已优化好几轮的硬经验) | Mid | Mid | 严格按 `claude-md-audit` skill 7 反模式 + 4Q 评估;CLAUDE.md 硬 token 上限 < 1000;只放入口骨架 + `@docs/conventions/` import + "按需 read"表格,所有知识类外置;PoC 完成前必跑 claude-md-audit skill 一遍 |
| R14 | mono 仓新 cwd 启动 claude 后 memory pool 空(70+ 条历史 memory 看不见,新仓变"上下文孤岛"),Claude 在 PoC 期反复踩 user 已沉淀的坑 | **High** | Mid | **W1.0 必跑**:`memory-cluster-bridge` skill 配 `autoMemoryDirectory` user setting + zsh wrapper 桥接 mono 仓 cwd 到主 `no-vain-years` memory pool;W1.2 启 claude 后第一件事 validate 桥接成功(提问旧 memory 内容看 Claude 是否命中);**未桥接成功不进 W1.3** — 否则 PoC 期 4-5 周大概率反复踩 70+ 条已知坑 |

---

## § I. Verification(Plan 1 完成的判定标准)

按"step → verify"形式给出 Plan 1 内部里程碑:

1. **W0 完成**:Plan 1 plan 文件 user 审批通过 → verify: ExitPlanMode 后 user explicit ack
2. **W1 完成**:W1.0 `memory-cluster-bridge` 桥接成功(新 cwd claude session 能看到主 `no-vain-years` 70+ 条 memory) + W1.1 `no-vain-years-mono` GitHub repo 建仓(public,user 已 confirm)+ W1.3 `.claude/settings.json` + CLAUDE.md 骨架建立(严格按 claude-md-audit 原则)+ `docs/conventions/{business-naming,git-workflow,sdd}.md` 三件 copy + W1.4 Nx workspace + Prisma `db pull` 反推 V1-V14 schema → verify: (a) V3 验收对照表 100% match;(b) repo URL 给定;(c) CLAUDE.md 跑 claude-md-audit 通过;(d) **memory bridge 验证 — 在 mono cwd 新 claude session 内提问任一旧 memory 中的内容(如"feat-open 端口分配"),Claude 能命中**
3. **W2 完成**:phone-sms-auth domain + application 重写 → verify: V1 LoC 比、V2 NestJS module 边界对照表通过
4. **W3 完成**:infrastructure 层 + Aliyun SMS + @nestjs/jwt + cockatiel retry → verify: V4 + V5 端到端通过
5. **W4 完成**:Nx CI 全绿 + Docker + Vitest + @nestjs/swagger OpenAPI → verify: V6-V9 全部 pass
6. **ADR 落地**:`no-vain-years-mono/docs/adr/0018-backend-language-pivot.md` + 0019(ORM = Prisma)+ 0020(模块化 = NestJS Module + ESLint boundaries)写入并 commit → verify: 3 个 ADR 文件存在且 status = Accepted
7. **旧 ADR 标 superseded**:`no-vain-years/docs/adr/0001/0006/0008/0011.md` 头部加 `> Superseded by [no-vain-years-mono ADR-00XX](https://github.com/.../docs/adr/00XX-...md) on YYYY-MM-DD` → verify: head grep
8. **接口契约 ship**:§ F / § G 表格成为 Plan 2 / Plan 3 启动文档输入 → verify: Plan 2 文档新建时 cite Plan 1 § F
9. **资产迁移清单 ship**:§ G.2 表格作为 Plan 3 启动 inventory → verify: Plan 3 文档 cite
10. **CLAUDE.md 起草**:`no-vain-years-mono/CLAUDE.md` 写入新栈 Claude 入口骨架(NestJS / Prisma / Nx / 不再 meta-repo),**严格按 `claude-md-audit` skill 4Q + 7 反模式扫描通过**:
    - (a) 知识类(架构 / 技术栈 / 部署 / 模块细节)**不**写入 CLAUDE.md,只在"按需 read"表格列路径
    - (b) 约束类经 `@docs/conventions/<file>.md` import,Claude 自动装载;**不允许**把约束散写在 CLAUDE.md 正文
    - (c) 跨仓公共约定段(business-naming / git-workflow / sdd)三件直接 @import,体例与旧 CLAUDE.md 一致
    - (d) CLAUDE.md 文件 token 估算 < 1000(硬上限,防爆炸)
    → verify: 在 `no-vain-years-mono` cwd 跑 `claude-md-audit` skill 一遍 + 文件存在 + token 计数符合

**完成后下一步**:
- **立即**:启动 Plan 2(mono-repo infra)plan 文件撰写,§ F / § G 直接作为输入
- **延后到 Plan 2 中期**:Plan 3 启动(等 Plan 2 mono-repo 骨架完整)

---

## § J. Critical Files

### 新建(本 Plan 1 阶段;PoC 完成后落地)
- **新 GitHub repo**: `no-vain-years-mono`(`https://github.com/xiaocaishen-michael/no-vain-years-mono`,user 建)
- `no-vain-years-mono/apps/server/`(NestJS PoC)
- `no-vain-years-mono/apps/server/prisma/schema.prisma`(Prisma db pull 反推)
- `no-vain-years-mono/packages/shared-types/`(空骨架)
- `no-vain-years-mono/nx.json` / `tsconfig.base.json` / `pnpm-workspace.yaml`
- `no-vain-years-mono/.github/workflows/ci.yml`
- `no-vain-years-mono/docker-compose.dev.yml`(独立 db `mbw_poc`)
- `no-vain-years-mono/docs/adr/0018-backend-language-pivot.md`
- `no-vain-years-mono/docs/adr/0019-orm-prisma.md`
- `no-vain-years-mono/docs/adr/0020-module-boundary-nestjs.md`
- `no-vain-years-mono/CLAUDE.md`(极简骨架,严格按 claude-md-audit 原则)
- `no-vain-years-mono/docs/conventions/business-naming.md`(从旧仓 `no-vain-years/docs/conventions/` 物理 copy)
- `no-vain-years-mono/docs/conventions/git-workflow.md`(同上 copy)
- `no-vain-years-mono/docs/conventions/sdd.md`(同上 copy)

### 修改(本 Plan 1 阶段,在旧 meta-repo `no-vain-years/`)
- `docs/adr/0001-modular-monolith.md`(头部加 `> Superseded by ADR-0020 in no-vain-years-mono`)
- `docs/adr/0006-meta-cli-multi-repo.md`(同上,by ADR-0021 in mono-repo,Plan 2 立)
- `docs/adr/0008-pure-repository-interface-in-domain.md`(同上)
- `docs/adr/0011-rate-limit-redis-bucket4j.md`(同上,by ADR-0022 in mono-repo,Plan 2 立)
- `docs/architecture/tech-stack.md`(后端章节标"已 supersede,见 no-vain-years-mono")
- `docs/architecture/modular-strategy.md`(尾部加"已 supersede,见 no-vain-years-mono ADR-0020")

### 不动(本 Plan 1 阶段)
- `my-beloved-server/**`(Java 仓冻结 main,不在本 Plan 修改)
- `no-vain-years-app/**`(前端不动)
- 所有 spec.md(直接复用,Plan 3 阶段物理 copy 到新 repo)
- meta 仓 `docs/conventions/*.md`(等 Plan 2 一起改)

---

## § K. Sources(主要 web research 引用)

### NestJS / Fastify adapter / 中间件验证
- [Meduzzen — NestJS vs Fastify vs Express 2026](https://meduzzen.com/blog/nestjs-vs-fastify-vs-express-backend-2026/) — NestJS+Fastify 2x 吞吐量证据
- [Medium — Scaling NestJS to 500K req/min with Fastify](https://medium.com/@ThinkingLoop/scaling-nestjs-apis-to-500k-requests-minute-with-fastify-260c9590aa40)
- [NestJS Official Docs — Performance (Fastify)](https://docs.nestjs.com/techniques/performance)
- [DEV — From Spring Boot to NestJS](https://dev.to/digvijay25182316/from-spring-boot-to-nestjs-the-chameleon-phase-of-my-backend-life-15d6)
- [Wisp Blog — Lucia Auth is Dead (2025-03 deprecation)](https://www.wisp.blog/blog/lucia-auth-is-dead-whats-next-for-auth)
- [Encore — NestJS Auth Guide 2026 (Passport.js)](https://encore.dev/articles/nestjs-authentication-guide)
- [Oneuptime — node-redis vs ioredis 2026](https://oneuptime.com/blog/post/2026-03-31-redis-choose-node-redis-vs-ioredis/view)
- [BullMQ Docs — NestJS](https://docs.bullmq.io/guide/nestjs)
- [NestJS tRPC Docs](https://www.nestjs-trpc.io/)(确认 tRPC + NestJS 价值有限)
- [Encore — NestJS vs Encore.ts (cold start)](https://encore.dev/articles/nestjs-vs-encore)
- [Leapcell — NestJS in 2025](https://leapcell.io/blog/nestjs-2025-backend-developers-worth-it)

### Anthropic / Claude / MCP 生态
- [Anthropic Client SDKs (Py/TS/Java/Go/Ruby/C#/PHP)](https://platform.claude.com/docs/en/api/client-sdks)
- [Claude Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview)(确认 NestJS 非一级公民)
- [MCP 97M downloads — Digital Applied](https://www.digitalapplied.com/blog/mcp-97-million-downloads-model-context-protocol-mainstream)
- [Anthropic Agent SDK Docs](https://code.claude.com/docs/en/agent-sdk/overview)

### 趋势与生态
- [JetBrains Promise Index 2025](https://visualstudiomagazine.com/articles/2025/10/21/typescript-tops-rust-in-promise-index-of-jetbrains-survey.aspx) — TS #1
- [Stack Overflow Developer Survey 2025](https://survey.stackoverflow.co/2025/technology)
- [JetBrains State of Developer Ecosystem 2025](https://devecosystem-2025.jetbrains.com/)

### Nx 跨语言 monorepo
- [Nx 2026 Roadmap](https://nx.dev/blog/nx-2026-roadmap)
- [Nx Plugin Registry](https://nx.dev/docs/plugin-registry)
- [Nx Folder Structure 官方文档](https://nx.dev/docs/concepts/decisions/folder-structure)
- [@nxlv/python NPM (v22.1.3)](https://www.npmjs.com/package/@nxlv/python)
- [nx-go/nx-go GitHub (v4.0.0-beta)](https://github.com/nx-go/nx-go)
- [Nx TypeScript Monorepo 新体验](https://nx.dev/blog/new-nx-experience-for-typescript-monorepos)
- [Vercel Monorepo Blog](https://vercel.com/blog/monorepos)
- [Sylhare — Nx Multi-Lang Monorepo](https://sylhare.github.io/2024/10/21/Nx-multilang-monorepo.html)
- [Aha.io — Multi-Repo to Monorepo 迁移成本](https://www.aha.io/engineering/articles/monorepo)
- [Docker + Nx Compose 指南](https://www.codefeetime.com/post/using-docker-compose-with-nx-monorepo-for-multi-apps-development/)

### 备选方案
- [FastAPI vs Litestar 2026 — byteiota](https://byteiota.com/litestar-vs-fastapi-python-speed-test-2026-analysis/)
- [Best Python API Framework 2026 — uvik](https://uvik.net/blog/python-api-framework/)
