# V10 验收 — Claude Code agent loop 体感主观记录

* Plan: [Plan 1 § E.3 V10](https://github.com/xiaocaishen-michael/no-vain-years/blob/main/docs/plans/1-claude-java-claude-ai-2-meta-repo-ai-breezy-quill.md)
* Verdict: **PASS**(≥ Java baseline,big margin)
* 日期: 2026-05-18
* PoC use case: `phone-sms-auth`(Plan 1 § E.1)
* 数据 scope: mono 仓 commit #1-#19 + Java baseline `my-beloved-server` mbw-account
* Path 体例: 本文件路径 `docs/experiences/`(复数)是 Plan 1 一次性 git-tracked 验收记录,与 Plan 3 阶段才迁入的 `docs/experience/`(单数,iCloud symlink,.gitignore 排除)路径**不同**,避免与未来 convention 冲突

---

## 1. 验收门槛回顾

Plan 1 § E.3 V10:

> **主观评估 ≥ 当前 Java**(用 Claude 跑 1 个完整 task 的命中率与速度);**验证方式**: session 记录

V1-V9 全部通过(详见 [`v1-loc-report.md`](../../specs/auth/phone-sms-auth/v1-loc-report.md) + W2-W4 各 PR);V10 是最后 1 个验收门,主观维度,本文件即记录。

## 2. 速度 — 总耗时

| 阶段 | 计划(§ E.4 timebox) | 实际 wall time | commit / PR |
|---|---|---|---|
| W1.0-W1.4 setup | W1(1 周) | 同日 2026-05-17 7 commits 直跑到 SWC swap | #1 + 7 pre-PR setup commits |
| W2 SDD 全流程 + impl T001-T042 | W2(1 周) | 同日 2026-05-17 PR #2-#11 | 10 PR |
| W3 infrastructure | W3(1 周) | 同日 2026-05-17 PR #12-#15 | 4 PR |
| W4 NestJS module + ESLint + Vitest + Testcontainers + Dockerfile + Nx CI + OpenAPI(V6-V9) | W4(1 周) | 2026-05-17 末延到 2026-05-18 PR #16-#19 | 4 PR |
| **PoC 总计** | **4-5 周**(§ E.4) | **~2 天**(2026-05-17 → 2026-05-18) | **19 PR + 27 commits on main** |

**速度比**: 实际 / 计划 ≈ 2 days / 28-35 days = **~7%**(13-17 倍压缩)。

**Caveats**:

1. Plan 1 § E.4 4-5 周时间盒原本预留了"踩坑 / W5 buffer / 备选切换决策窗口";Claude+TS loop 实测踩坑代价远低于估
2. 节奏密度异常高 — 2 天内 19 PR 不是稳态 cadence,是 PoC 决战式冲刺,长周期项目不可直接套用
3. user 体感比 wall time 更累(连续决策 + ask question 触发频率高);Claude 同步是工具型 cost 不是 dev time cost

## 3. 命中率 — 关键决策回合数

### 3.1 一击中目标(0 round-trip)

| 决策点 | PR | 备注 |
|---|---|---|
| Nx workspace 初始化 + pnpm-workspace.yaml | (pre-#1) | `pnpm dlx create-nx-workspace` 一把过 |
| Prisma `db pull` 反推 V1-V14 Flyway schema(V3 验收) | (pre-#1) | 反推 1:1 等价,无 schema drift |
| NestJS + Fastify adapter + ValidationPipe + nestjs-pino 装配 | (pre-#1) | 框架级 boilerplate Claude 命中率高 |
| spec.md / plan.md / tasks.md SDD 三件 | #4 / #5 / #6 | spec-kit `/speckit-*` 一把过 |
| US1 baseline(T009-T020)— credential 模型 + bcrypt + UseCase 编排 | #7 | 单 PR 12 task |
| US2 unregistered phone auto-register | #8 | RED-GREEN 一轮 |
| FR-S07 4 条 rate limit(IP /sms /verify /auth-failure-lock) | #12 / #13 | NestJS @nestjs/throttler 抽象成熟 |
| RetryExecutor port + cockatiel adapter | #14 | port 抽象 Claude 一击拿对(详见 memory `feedback_transactional_outbox_port_shape`) |
| Aliyun SMS gateway ENV-gated skeleton | #15 | 复杂 SDK 但 mock-first 路径清 |
| @hey-api/openapi-ts codegen pipeline | #16 | 离线 dump script + 13 generated files |
| Docker 3-stage Dockerfile + pnpm deploy + cold start <3s(V7) | #17 | 一把过 |

### 3.2 1-2 回合 round-trip(踩 + 修)

| 决策点 | PR | 回合 | 关键 pivot |
|---|---|---|---|
| TS dev runtime: webpack → SWC | #1(amend 链 #137/#138/#139) | 3 回合 amend | meta 仓 Plan 1 PoC plan 提前讨论 pivot;mono 仓 1 PR 落地 |
| US3 timing defense scope CL-006 amend | #9 | 1 回合 clarify | spec 起手歧义 → user 答 → impl 一击拿对 |
| `eslint-plugin-boundaries` v5 → v6 syntax migration | #10(T040) | 1 回合 | v5 legacy 语法 silent no-op,forbidden import 验证 rule 真 fire(memory `feedback_lint_plugin_upgrade_must_verify_with_violation`) |
| `vitest` test full AppModule boot 撞 Prisma $connect | #16(2 sub-commits) | 1 回合 | 第 1 commit prisma mock,第 2 commit 改 controllers-only test module(memory `feedback_nest_app_module_full_boot_needs_external_deps`) |
| pnpm 10 + nx prune-lockfile 在 Docker 撞 ERR_PNPM_IGNORED_BUILDS | #17 | 内部 1 回合 | pivot 到 `pnpm deploy --legacy`(memory `reference_pnpm10_pnpm_deploy_for_nx_docker`) |
| monorepo dev hoist 掩盖 server prod deps(@swc/helpers + @fastify/static) | #17 | 内部 1 回合 | prune 后 fatal exit → 加显式 declare(memory `feedback_monorepo_hoist_masks_missing_prod_deps`) |
| Trivy image scan picomatch HIGH CVE | #19 | 1 回合 | base image 全局 npm 删 vs ignore — user 选严修(memory `reference_trivy_strip_base_image_npm`) |

### 3.3 静默踩坑(后判定但未撞 main 红)

| 现象 | 阶段 | 备注 |
|---|---|---|
| `pnpm -C` 不传 child cwd, nx init 错向 | W1.4 | memory `reference_pnpm_C_does_not_propagate_child_cwd` 第一次踩,后续按记忆规避 |
| `pkill -f` 对 nx serve 子进程不稳 | W1.4 smoke | memory `reference_pkill_unreliable_use_port_cleanup` |
| `nx test/build/lint` cache 假绿(新 ts 文件第一次跑) | #7 T013 | memory `feedback_nx_cache_false_green_on_new_files` 一次 fix |
| Nest 全局异常 filter 必须 `APP_FILTER` token | #9 | memory `feedback_nestjs_global_filter_needs_app_filter` |

### 3.4 整体命中率主观打分

| 维度 | 0 round-trip | 1-2 round-trip | 3+ round-trip / 大返工 |
|---|---|---|---|
| 占比 | ~70% | ~25% | ~5%(webpack → SWC swap) |

## 4. 与 Java baseline 对比(主观维度)

Java baseline: `my-beloved-server` 仓 `mbw-account` 模块 phone-sms-auth use case;Spring Boot 3 + Spring Modulith + ArchUnit + Spring Data JPA + Flyway + MapStruct + Bucket4j + Resilience4j。

| 维度 | Java baseline 体感 | NestJS+Prisma 新栈体感 | Δ |
|---|---|---|---|
| **DI 注入** | Spring `@Autowired`/`@Service` 强;Claude 命中率高 | NestJS `@Injectable` + module export white-list;同等强 + 边界更显式 | 平 |
| **持久化层** | Spring Data JPA `JpaRepository` + MapStruct + JpaEntity ↔ Domain Model 双向映射 | Prisma 直读 `prisma.account.findUnique`,类型从 `schema.prisma` 派生;repository.interface.ts 纯接口,impl 内 1:1 映射 row → domain | **新栈优**(LoC 减半;MapStruct annotation 噪声去除;Studio + migrate UX 优秀) |
| **类型系统** | Java 静态强,但 Map/Stream 等泛型样板 | TS structural + Prisma generic + Zod / class-validator 双轨;Claude 类型推断命中率高 | 平偏新栈优 |
| **测试 boilerplate** | JUnit 5 + Spring Boot Test + Testcontainers Java;`@SpringBootTest` 启动慢 | Vitest 2 + Testcontainers Node + `@nestjs/testing`;controllers-only test module 不 boot 整 AppModule | **新栈优**(单测启动 ms 级 vs Spring 5-10s) |
| **错误处理 boilerplate** | Spring `@ExceptionHandler` + `@ControllerAdvice` | NestJS `@Catch` + `APP_FILTER` 注册 — 须显式 token 注册 | 平(NestJS 隐式 gotcha 见 § 3.3) |
| **模块边界硬度** | Maven 多模块物理隔离 + ArchUnit + Spring Modulith,**硬度强** | NestJS Module export white-list + ESLint `eslint-plugin-boundaries` v6 双保险,**单 jar 内逻辑边界** | **Java 优**(物理隔离 strong),但 Plan 1 § C.3 评估"软约束版"够用于 solo dev 阶段 |
| **AI 协作命中率** | Claude 对 Spring Boot 模式熟悉;但 mbw-* 多模块 + ArchUnit 4 类自定义规则上下文负担重 | NestJS Module 范式上下文紧凑;每 module 自包含 domain/application/infrastructure/web 4 层;Claude 1 个 module = 1 个完整 mental model | **新栈优**(D1 维度 Plan 1 假设验证) |
| **生态依赖切换体验** | Bucket4j / Resilience4j / Nimbus / MapStruct 等独立选型;每个有学习曲线 | @nestjs/throttler / cockatiel / jose / class-transformer 框架级集成 | 平偏新栈优 |
| **LoC** | mbw-account 4 层 192 files / 5705 LoC | apps/server/src/auth 27 files / 680 LoC | **新栈 1/8.4**(详见 [v1-loc-report.md](../../specs/auth/phone-sms-auth/v1-loc-report.md);caveat: Java scope 含多 use case,不严格 apples-to-apples) |

**Caveat 公平性**: Java baseline 是早期项目阶段(M1 起步)产物,部分 boilerplate 反映 ADR-0001/0008 选定的"严格保留拆服务能力"约束。若用相同约束写 TS,新栈 LoC 也会涨 30-50%。**但**绝对差距 8.4x 即使打折后仍可观。

## 5. 关键加分项 / 减分项

### 加分(对 Plan 1 假设 D1"Claude+NestJS 比 Claude+Java 更顺"的实证)

* NestJS module 范式上下文极紧凑(domain/application/infrastructure/web 4 层在 1 个 module 内全包),Claude 一次 task 命中率高
* Vitest 启动毫秒级 → RED-GREEN 反馈循环紧;Java Spring Boot Test 5-10s 启动是真摩擦
* Prisma `db pull` 反推 schema 一把过 — V3 验收无返工
* `@nestjs/swagger` 注解即 OpenAPI annotation,V8 codegen pipeline 离线 dump + `@hey-api/openapi-ts` 1 链路打通
* pnpm 10 + Nx 22 + SWC 转译 dev 循环 < 3s
* Plan 1 § H R6"Spring 经验在 NestJS 概念层 0 摩擦"验证为真;细节差异(ORM / 错误处理 / Module 边界)有学习曲线但 ≤ 1 个 PR/坑 即吸收

### 减分(对 Plan 1 假设的 caveat 或反例)

* Plan 1 § C.3 写 `apps/server/src/modules/<module>/`,实际落 `apps/server/src/<module>/`(去掉 `modules/` 包装);ADR-0020 应描述实际 layout,不是 Plan 1 sketch
* 模块物理隔离比 Maven 多模块弱(单 jar / 单 dist) — Plan 1 § C.3 已主动承认"软约束版";solo dev 阶段够用,多 dev 阶段拆服务前需评估
* AI 静默踩坑非零(§ 3.3) — `pnpm -C` / `nx cache 假绿` / `eslint-plugin-boundaries` v6 silent no-op 等都触发了至少 1 次"看起来过了但实际没 fire"的假绿,**memory pool 沉淀 + 后续按记忆规避**是必要安全网
* W2.4 中 8 个 [Test] task 行(T025-T028 / T032-T035)RED commit 已 ship 但 tasks.md 未 flip [X] — 反例 `feedback_implement_owns_tasks_md_sync`,W5 收尾需 sweep

## 6. 结论

* **V10 验收 PASS**(big margin):Claude+NestJS+Prisma+Nx loop 在 PoC use case `phone-sms-auth` 上达到的"命中率 ≥ 90% + 速度 7-17 倍压缩 + LoC 1/8.4"三项,**显著优于** Claude+Java+Spring 同等 use case 的体感
* **Plan 1 D1 维度假设验证**: Claude AI coding 与新栈的协作命中率确实是后端选型可量化的新维度,且权重应当大于"Java/Spring 经验沉淀"
* **R4 风险(Claude 写 NestJS 不如 Java 准确率)未触发**: 不需切回 Plan 1 § D 备选 Python+FastAPI 或排名 #2 raw Fastify
* **下一步**: ADR-0018(本选型 root)/ ADR-0019(ORM = Prisma)/ ADR-0020(模块边界 = NestJS Module + ESLint boundaries)三件齐 lock + meta 旧 ADR-0001 / ADR-0008 + modular-strategy.md 标 superseded(per Plan 1 § G.1 cross-ref 矩阵)

## 7. 透明 — 主观偏差校验

本文件评分由本次 session 的 Claude 写作(本身即被评对象),存在自评偏差。**user 已 review + accept** 是 V10 验收的最终主观签字。
