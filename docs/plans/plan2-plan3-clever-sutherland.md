# Plan 2 + Plan 3: 业务迁移 + 部署上线（swap 后 outline）

> **Status**: drafted 2026-05-19，等 ExitPlanMode 审批
> **Supersedes scope**: [`Plan 1 § F + § G`](1-claude-java-claude-ai-2-meta-repo-ai-breezy-quill.md)（原 Plan 2 = mobile 迁入 / 原 Plan 3 = server 业务 + 部署）
> **存档参考**:[`plan3-pre-plan-inventory-2026-05-19.md`](plan3-pre-plan-inventory-2026-05-19.md)（16 use case 清单 + 6 ambiguous decision + drift 分析，全文设计输入）

## 1. Context

Plan 1（NestJS PoC + 4 stack 替换 + ADR-0018/0019/0020 + ADR-0023/0024 + V1-V10 全 ship 2026-05-18 完成）后,2026-05-19 user 决策 **plan2 / plan3 scope 互换**:

| | 旧 Plan 1 计划 | 新 swap 后 |
|---|---|---|
| **Plan 2** | mobile 迁入 mono | **业务迁移**(server 16 use case + mobile per-feature 同步) |
| **Plan 3** | server 业务 + 部署 | **部署上线**(server Docker→Aliyun + Expo Web export→Cloudflare Pages) |
| **app 二进制打包** | Plan 3 末 | 推到 Plan 4(IPA / APK 不在本 plan scope) |

驱动:Plan 1 收尾时 user 识别"业务可运行"应优先于"部署链路",mobile 与 server feature 强耦合,逐 feature 同步迁移比"server 先全 ship 再迁 mobile"更早暴露契约 drift。

## 2. Plan 2: 业务迁移

### 2.1 Scope & Done Condition

**Scope**:
- mbw-account 后端 16 use case 全部用 NestJS + Prisma 重写到 `apps/server/`
- mobile per-feature 同步迁入 `apps/mobile/`(per ADR-0024 三位一体 branch / spec / PR)
- 5 个旧 Expo 内部 packages(auth / ui / design-tokens / types / api-client)命名保留,**内部实现重写**(per user "激进重写"决策)
- packages/api-client 沿用 mono 已实装的 @hey-api/openapi-ts v0.97.1 链路,**OpenAPI Generator 旧客户端全弃**

**Done condition**(单选 A,无附加条件):
- 16 use case 在 NestJS 全 ship,通过新写 TS 测试套(Vitest + Testcontainers,unit + integration + e2e)
- apps/mobile 在 mono 内 `pnpm nx run mobile:start` 起来,能登录 / 完成核心 5 phase 用户流程
- `pnpm nx affected --target=test,lint,build,typecheck` 全绿
- Plan 3 部署 / orchestrator PoC / app 二进制打包**均不卡 Plan 2 graduation**

**Not in scope**(明确划线):
- 生产部署(→ Plan 3)
- mobile IPA / APK build(→ Plan 4)
- 12 个旧 spec 中纯 PKM / wealth 等非 account 模块的业务(→ Plan 4+)

### 2.2 起手准备(Phase 0,约 1 周)

| 任务 | 产出 | 备注 |
|---|---|---|
| **2.2.1 Schema 旧表清理** | `apps/server/prisma/schema.prisma` 删除 `event_publication`(Spring Modulith 老表)和其他 W1.4 `db pull` 反推进来的非业务表;`prisma migrate dev --create-only` 生成 drop migration | 一次性 destructive,user 已授权;`outbox_event` 保留 |
| **2.2.2 ADR-0022 throttler backfill** | `docs/adr/0022-throttler-nestjs-redis.md` | mono 已实装 @nestjs/throttler + @nest-lab/throttler-storage-redis(W3 A1/A2 ship),ADR 追溯立 |
| **2.2.3 conventions 按需迁入** | `docs/conventions/*.md` 按 Phase 0 实际需要逐项决定 | 候选 4 项(versioning / agent-view-usage / claude-config-layout / git-workflow-reference)+ worktree(默认不迁,单仓);**不强制全迁**,Phase 0 起手时按"撞到才迁"原则单项决断,记录在 Phase 0 实施日志 |
| **2.2.4 claude-mem W1 + 2-day A/B** | `~/.claude-mem/` 全装 + .envrc + 2-day 验证报告 | 走 [`project-next-session-starter-claude-mem-eager-charm.md`](project-next-session-starter-claude-mem-eager-charm.md) § 5-6;PASS 则启用,FAIL 则关闭并 Plan 2 仅依赖原生 memory + project-next-session-starter |
| **2.2.5 Bridge Adapter PoC** | `scripts/orchestrator/`(单文件 TS,Node + tsx,~200-400 LoC) | 输入:`specs/NNN-<slug>/tasks.md` `- [ ] T<N>` 行;输出:Wiggum 可识别的 `task-list.json` shape(W1 实地确认 Wiggum CLI 接口契约后定);**先手动跑 002 第一个 task 摸 tasks.md 真实 shape,再写**(per user "用现有栈"原则,避免 Bun 引入) |
| **2.2.6 ADR-0025 deployment 决策落** | `docs/adr/0025-frontend-cloudflare-pages-expo-web.md` | 锁定 plan 3 前端 = Expo Web export → CF Pages;mobile binary 不部署 |
| **2.2.7 quota-discipline skill ack** | 不新写文档;plan 2 期间 session 纪律完全复用 `claude-quota-discipline` skill | per memory `claude-quota-discipline`,P0-1 v3 双阶段切分 + use case 粒度 /clear |

**Phase 0 完成信号**:`.specify/` Workflows YAML(若试 spec-kit Workflows)+ Bridge Adapter 单元跑通 + claude-mem 状态决断 + ADR-0022/0025 ship。

### 2.3 Phase A-E:5 个 feature 顺序迁移(per inventory phase 分组)

每个 feature = 1 个 `specs/NNN-<slug>/` 目录(per ADR-0024 扁平布局,spec-kit 自动 `NNN-` 编号 + branch 三位一体)。

| # | feature spec | use case 包含 | 复杂度 | Java IT 移植重点 | Mobile 重写范围 |
|---|---|---|---|---|---|
| **A** | `002-account-profile-base` | GetAccountProfile + UpdateDisplayName | 低 | unit test(profile 序列化 / displayName 校验) | 设置页 - 个人信息 |
| **B** | `003-tokens` | RefreshToken + LogoutAllSessions | 中 | `RefreshTokenE2EIT` + `RefreshTokenConcurrencyIT` 业务断言移植(jose 实装) | 登录态续期 + 全设备登出 UI |
| **C** | `004-account-deletion` | SendDeletionCode + DeleteAccount + SendCancelDeletionCode + CancelDeletion + AnonymizeFrozenAccount | **高**(含 outbox 真消费方) | `AccountDeletionE2EIT` + `AccountDeletionConcurrencyIT` + `FrozenAccountAnonymizationConcurrencyIT` 多个流程断言 + outbox 消费方实证 | 注销流程 / 倒计时 / 取消注销 4 屏 |
| **D** | `005-device-management` | ListDevices + RevokeDevice | 中 | `RevokeDeviceIT` 业务断言 + ip2region geo 集成 | 已登录设备管理屏 |
| **E** | `006-realname-verification` | InitiateRealnameVerification + ConfirmRealnameVerification + QueryRealnameStatus | **最高**(split-tx + Aliyun cloudauth) | `RealnameE2EIT` 业务断言 + split-tx 拆分到 transaction service(接口形状本 feature spec/plan 阶段决) | 实名认证 3 步流程 |

**Feature 内 SDD 6 步闭环**(per ADR-0024 + sdd.md):

> **⛔ 关键人工 gate**:每个 feature 起手 `/speckit-specify` **前**,我会停下等 user 输入 server spec 与 app spec 合并的**具体约束**(如:哪些字段以 server 为准、UI 流程是否覆盖旧 spec、错误码是否重新设计、user-journey 是否合并等)。**user 不给约束我不开 specify**。

1. `/speckit-specify` → `specs/NNN-<slug>/spec.md`(自动建 branch `NNN-<slug>`)
   - 起手用 Opus
   - 输入源:meta-repo `specs/<auth | account>/<usecase>/spec.md`(12 spec 复用) + 旧 app `specs/` 同 feature 对应 spec + 12 个 Java IT 断言抽取
   - **server spec + app spec 合并必须以 user 在前置 gate 给的约束为准**
   - 必填 frontmatter:`modules: [account]` 或 `modules: [auth]`(per business-naming.md 值域)
2. `/speckit-clarify` → spec.md `## Clarifications` 段(Opus,人工 review)
3. `/speckit-plan` → `plan.md`(Opus,含 NestJS module 边界 + Prisma migration + Expo Router 路由 + 占位 UI 4 边界 per ADR-0017)
4. `/speckit-tasks` → `tasks.md`(Opus,每条标 `[Server]` / `[Mobile]` / `[Contract]`)
5. `/speckit-analyze` → `analysis.md`(Opus,跨 spec/plan/tasks/constitution 一致性扫,**人工 gate**)
6. `/speckit-implement` → 代码 + 测试 + tasks.md `[X]` flip
   - **切到 Sonnet**(per `/model sonnet` mid-session 切换,context 保留)
   - Bridge Adapter 接管 Wiggum CLI Ralph loop(若 Phase 0 PoC PASS),否则手动逐 task
   - 每 task 6 步闭环(per sdd.md § /implement 每 task 闭环):红 → 绿 → typecheck/lint → tasks.md [X] → git add → commit

**Per-feature PR 边界**:Server impl + api-client regen + mobile 消费 + tasks.md `[X]` flip **同 1 PR**(per sdd.md "mono 单仓内可同 PR")。Auto-merge per `docs/conventions/git-workflow.md`(CI 全绿自动 squash merge)。

### 2.4 工作流编排(per-feature)

**Stage 1**(spec → tasks,Opus,人工 gate 主导):
```
/speckit-specify → /speckit-clarify → 人工 review →
/speckit-plan → 人工 review → /speckit-tasks → /speckit-analyze → 人工 gate
```

**Stage 2**(implement,Sonnet,Bridge Adapter + Wiggum Ralph loop 主导):
```
/model sonnet                                # mid-session 切,保留 context
/speckit-implement                            # 进入 tasks.md 闭环
  ↓
Bridge Adapter 读 tasks.md `- [ ]` 任务
  ↓
Wiggum CLI 起 Ralph loop:
  per task → 调 claude CLI → typecheck/test → flip [X] → commit → 下一 task
  ↓
claude-mem(若 PASS): session 满时 auto-compact + 跨 session 召回
原生 memory: project-next-session-starter 写最终 handoff
```

**Session 纪律**:完全遵循 `claude-quota-discipline` skill 的 P0-1 v3(双阶段切分 + use case 粒度 /clear)。Plan 不重复发明。

### 2.5 测试策略(per user 修正)

- **新写 TS 测试通过 = 合格信号**(单元 + integration + e2e via Vitest + Testcontainers)
- **Java IT 不直搬,作"业务断言源"合理移植**:
  - 抽取 Java IT 的**业务规则 / 边界条件 / 安全约束 / 性能指标**(如 timing P95 ≤ 50ms / 反枚举三路径统一 / outbox 并发原子性)
  - 在 TS 测试用等价断言重写(Testcontainers PG + Redis + WireMock 等价替代)
  - **不复刻 Java 测试代码结构**(@SpringBootTest / TestRestTemplate → NestJS `@nestjs/testing` Module + supertest)
- **关键安全 IT 全覆盖**:
  - `SingleEndpointEnumerationDefenseIT` → 002 / 003 各 feature spec 内业务等价(per ADR-0023 HMAC 0.20ms 已覆盖 unified auth,refresh / logout / delete 须 per-feature 决策是否需同等 timing defense)
  - 4 个并发 IT(refresh / deletion / anonymization)→ 新写 vitest 并发测试
- **mobile 测试新写**(per user 激进重写):旧 34 个 vitest 测试**全弃**(全 mock-first 已与新 server API drift),per feature 新写 Vitest + React Testing Library 测试

### 2.6 mobile per-feature 同步规则

per user "mobile per-feature 同步"决策:

1. **每个 NNN-<slug> feature 同 PR 包 server + mobile**(同 ADR-0024 三位一体 spec/dir/PR,sdd.md 已支持)
2. **5 packages 内部实现重写**(命名保留 `@nvy/auth` / `@nvy/ui` / `@nvy/design-tokens` / `@nvy/types` / `@nvy/api-client`):
   - api-client:沿用 mono @hey-api/openapi-ts(旧 OpenAPI Generator 全弃)
   - auth:zustand v5 + secure-store + token refresh 中间件直搬业务流,代码重写
   - ui / design-tokens:NativeWind v4 + Tailwind 配色直搬,组件重写
   - types:从 Prisma 派生(`packages/types` 引用 `@prisma/client` 或单独 generator)— Phase 0 决方向
3. **mobile feature 路由**:沿用旧 Expo Router 路由结构(per inventory § 3),但**hooks / components / 状态管理重写**
4. **占位 UI 4 边界**(per ADR-0017 类 1):每个 feature impl phase 1 写裸 RN component 占位,phase 2 mockup 落地后回填

### 2.7 风险 + Stop signal

| 风险 | 触发信号 | 应对 |
|---|---|---|
| Wiggum CLI 与 Claude Code subprocess 接口不兼容 | Phase 0 第一个 task 跑不通 | 退化为手动 `/speckit-implement` per task,保留 Bridge Adapter 半成品作未来选项 |
| claude-mem 2-day A/B 红线触发 | OpenRouter > $1/day 或起手延迟 > 5s 或 observer error | `unset CLAUDE_MEM_ENABLE`,Plan 2 仅原生 memory |
| api-client @hey-api 与 mobile RN 不兼容 | 002 起手时 import 报 RN runtime error | 升 SDK 56(顺手 fix Zustand v5 import.meta footgun)或回退 @openapitools/openapi-generator-cli 临时 |
| realname split-tx 接口形状卡住 | 006 spec/plan 阶段 > 1 周未定 | 暂跳 006,先 ship 002-005;Plan 2 graduation 待 006 完成 |
| 16 use case 总工作量超 6 周 | Phase B 完成时已 4 周 | 与 user review 是否拆 Plan 2.5(005/006 推后)或缩减 mobile 覆盖度 |

**Plan 2 Stop signal**:任一 feature spec → tasks → impl 任何一步连续 3 天无进展,主动 escalate user。

### 2.8 工作量估算(粗,phase 0 实证后校准)

| Phase | 工作量 | 起止 |
|---|---|---|
| Phase 0 起手准备 | 1 周 | 2026-05-19 ~ 05-26 |
| Phase A(002-account-profile-base) | 3-5 天 | tooling 验证 + Java→TS 流程跑通 |
| Phase B(003-tokens) | 1 周 | 含并发 IT 移植 |
| Phase C(004-account-deletion) | 2 周 | 最复杂,outbox 真消费方落地 |
| Phase D(005-device-management) | 1 周 | |
| Phase E(006-realname-verification) | 2 周 | split-tx + Aliyun cloudauth 集成 |
| **总** | **8-9 周** | 含 mobile per-feature 同步 |

## 3. Plan 3: 部署上线

### 3.1 Scope & Done Condition

**Scope**:
- 后端:`apps/server` Docker(mono 已 ship V7 multi-stage Dockerfile + V9 Trivy)→ 阿里云生产(部署形态待 ADR-0026 决定)
- 前端:**Expo Web export** → Cloudflare Pages(per user 决策,SDK 54+ 原生支持)
- CI/CD:`.github/workflows/` 新增 deploy job,基于现有 ci.yml `docker-image` 链路扩展
- mobile binary 打包 不在 Plan 3 scope(→ Plan 4)

**Done condition**:
- 阿里云生产环境通过 HTTPS 访问 `apps/server` 任一健康检查 endpoint,P95 cold-start ≤ 2s(per mono V7 验收基准)
- Cloudflare Pages 通过 HTTPS 访问 Expo Web export 主入口,登录 → 主流程跑通
- 任一 mono PR squash merge 到 main 自动触发 staging 部署(staging 与 prod 是否同环境 Phase 0 决)
- 备案 / SSL 证书 / 域名解析 全就位

### 3.2 Phase 1:后端 Docker → 阿里云(约 1-2 周)

| 任务 | 产出 |
|---|---|
| **3.2.1 部署形态决策(ADR-0026)** | ECS / SWAS / 容器服务 ACK 三选一(per memory `reference_aliyun_swas_ufw_incompat` SWAS 有 ufw 不兼容历史限制) |
| **3.2.2 ECR / ACR 容器镜像仓库选** | 阿里云 ACR 个人版(免费)足够,vs 第三方(GHCR / DockerHub)成本评估 |
| **3.2.3 部署 IaC**(Terraform / Pulumi) | `infra/` 目录(若选 ECS);若选 SWAS / ACK 走 Web 控制台 + 文档化步骤 |
| **3.2.4 域名 + HTTPS + 备案** | 备案进度 user 推进(独立任务);备案完成前 staging 用 Aliyun 海外节点或 staging.no-vain-years.com 测试 |
| **3.2.5 CI workflow 加 deploy job** | `.github/workflows/deploy-server.yml`,main push 触发(可加 manual approval gate) |
| **3.2.6 监控 + 告警** | Aliyun ARMS 或 Sentry / Better Stack 接入;outbox cron + Aliyun SMS 限流告警 |

### 3.3 Phase 2:Expo Web export → Cloudflare Pages(约 1 周)

| 任务 | 产出 |
|---|---|
| **3.3.1 Expo Web export 验证** | `apps/mobile` 加 `expo export --platform web` script;Plan 2 期间 phase-by-phase 验 Web 兼容性(NativeWind v4 web build 已知坑点提前识别) |
| **3.3.2 Cloudflare Pages 配置** | `wrangler.toml` 或 CF Pages 控制台连仓 + build command(`pnpm nx run mobile:export-web`) |
| **3.3.3 跨域 + Cookie 域** | 海外用户 CF Pages → 阿里云后端 API 路径设计(per memory `reference_cf_workers_to_aliyun_ecs_525` 525 issue,Plan 3 起手前 fact-check 是否仍存在) |
| **3.3.4 CI workflow 加 deploy job** | `.github/workflows/deploy-web.yml`,与 server deploy 共享 staging/prod gate |

### 3.4 ADR 待立

| ADR | 主题 | 触发时机 |
|---|---|---|
| **ADR-0026** | 后端部署形态(ECS / SWAS / ACK) | Plan 3 Phase 1 起手 |
| **ADR-0027** | CI/CD deploy 流(staging / prod gate / rollback 策略) | Plan 3 Phase 1 中 |
| **ADR-0028** | 跨境网络架构(CF Pages → 阿里云 API,海外 + 国内分流) | Plan 3 Phase 2 中 |

### 3.5 风险

| 风险 | 应对 |
|---|---|
| 备案延后阻塞生产部署 | staging 走未备案海外节点先跑;备案完成切 prod 域 |
| CF Workers → 阿里云 525(memory ref) | 海外用户走 staging,国内用户备案后走 prod;或 Plan 3 后期评估 CF Workers 反代代替直连 |
| Aliyun SMS 配额超限 | Plan 3 起手前确认 SMS 模板 / 配额 |

## 4. Plan 2/3 共用工具链

| 工具 | 用途 | 已装 |
|---|---|---|
| spec-kit 0.8.7(vendored) | SDD 6 步 | ✅ |
| michael-speckit-presets | task-closure / context7-injection / user-journey-mermaid | ✅(3 preset 装) |
| graphify | 代码知识图谱召回(Phase 0 验证是否能喂 LLM context) | ✅(commit 46781a1) |
| claude-mem | 跨 session memory(W1 + 2-day A/B Phase 0 决断) | drafted,未启 |
| Wiggum CLI(或 ralph-loop 等价 OSS) | Ralph loop 执行器 | Phase 0 起手装 |
| spec-kit Workflows(YAML 编排) | 多步流程 + resumable + human gate | 待 fact-check 是否覆盖 mono 场景 |
| Bridge Adapter(自写 ~200-400 LoC Node + tsx) | tasks.md → Wiggum config | Phase 0 PoC |
| Nx affected | server / api-client / mobile 跨包变更传导 | ✅ |
| Testcontainers | PG + Redis e2e 测试 | ✅ |
| lefthook(tasks-md-drift) | commit-time 硬拦 | Phase 0 起手装(mono 当前未装) |

## 5. Verification

Plan 2 / Plan 3 完成的端到端验证步骤:

```bash
# Plan 2 graduation 验证
git -C /Users/butterfly/Documents/projects/no-vain-years-mono pull --ff-only
pnpm nx affected --target=lint,test,build,typecheck --base=origin/main~1
# 期望:全绿,无 affected miss

pnpm nx run server:export-openapi
pnpm nx run api-client:generate
# 期望:openapi.json 14+ endpoint(对应 16 use case)

pnpm nx run mobile:start
# 期望:Expo dev server 起,iOS simulator / Android emulator 跑通登录 + 5 phase 主流程

# Plan 3 graduation 验证
curl -fsS https://<prod-host>/healthz                  # 200 OK
curl -fsS https://<cf-pages-domain>/                   # Web 主入口 200
# CI pipeline:PR merge 到 main 自动跑 deploy-server / deploy-web
```

## 6. Critical files

```
docs/plans/plan2-plan3-clever-sutherland.md             # 本文(决策源)
docs/plans/plan3-pre-plan-inventory-2026-05-19.md       # 16 use case + 6 ambiguous decision 输入
docs/plans/project-next-session-starter-claude-mem-eager-charm.md  # claude-mem W1
docs/adr/0022-throttler-nestjs-redis.md                 # Phase 0 新建
docs/adr/0023-sms-code-storage-hmac.md                  # 已 ship,timing defense 范式
docs/adr/0024-spec-feature-first-layout.md              # specs/NNN-<slug>/ 扁平布局
docs/adr/0025-frontend-cloudflare-pages-expo-web.md     # Phase 0 新建,plan 3 前端决策
docs/adr/0026-server-deploy-aliyun.md                   # plan 3 Phase 1 新建
docs/adr/0027-cicd-deploy-flow.md                       # plan 3 Phase 1 新建
docs/adr/0028-cross-border-network-cf-aliyun.md         # plan 3 Phase 2 新建
docs/conventions/{versioning,agent-view-usage,claude-config-layout,git-workflow-reference}.md  # Phase 0 迁
apps/server/prisma/schema.prisma                        # Phase 0 drop event_publication
specs/002-account-profile-base/{spec,plan,tasks,analysis}.md  # 起手第一个 feature
scripts/orchestrator/bridge-adapter.ts                  # Phase 0 PoC
.github/workflows/{deploy-server,deploy-web}.yml        # plan 3 新建
lefthook.yml                                            # Phase 0 起手加 tasks-md-drift
```

## 7. Open questions to resolve during Phase 0

(本 plan 不阻塞 ExitPlanMode,但 Phase 0 必须 close)

1. spec-kit Workflows YAML 是否覆盖 mono "spec → analyze human gate → implement Sonnet 切换 → Bridge Adapter 接管"的全链路?Phase 0 fact-check + 实测一遍
2. Wiggum CLI 的 task input shape(JSON / YAML / Markdown)+ subprocess 调 claude CLI 的协议(stdin / arg / mcp)→ Phase 0 PoC 时实地确认
3. packages/types 用 prisma-nestjs-graphql 还是手写 generator(或 @prisma/client 直 export)→ Phase A 002 起手时决
4. Cloudflare Pages 525 issue(per memory)是否对国内用户 cold-start 有影响 → Plan 3 Phase 2 起手前实测
5. Aliyun 部署形态(ECS / SWAS / ACK)→ Plan 3 Phase 1 第一周决并写 ADR-0026
