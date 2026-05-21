# Sub-plan 1: 测试基建纯净落地（机制层 / PR-T1）

> 主 plan「机制层」阶段详细设计。本 sub-plan 由主 plan §跨阶段决策 锁定 + user 2026-05-22 详细输入 commit；**不变更**主 plan 跨阶段契约。

## Context

主 plan 锁定 PR-T1 核心交付：standalone tsx smoke 脚本 / spec-kit templates 插桩 / spec.zod `state_branches` 字段 / ADR-0040 stub。本 sub-plan 把每项细化到可执行级，配合 user 给的 server-boot-smoke 代码草稿 + 3 处 spec-kit 模板插桩 snippet。

设计纪律：本子 plan 不动 Nx / CI / 任何门禁 — 那些是 P2/P3 范围。L1 不通不写 L2。

## 8 项交付清单（PR-T1 全量）

### A. spec-kit preset 3 处模板插桩
落点：`.specify/presets/mono-orchestrator-ready/templates/{spec,plan,tasks}-template.md`（strategy: replace；version bump 0.2.1 → 0.2.2）

**A.1 `spec-template.md`** — 在 v2 fields 区 `perf_budgets` 注释块下方追加 `state_branches` 注释块（user 给定 snippet 直接 copy-paste，YAML 注释形式 4 行示例）

**A.2 `plan-template.md`** 2 处插桩：
- `json orchestrator_config.verify_commands` 加 `"smoke": "pnpm tsx scripts/ci/server-boot-smoke.ts"` —— **P1 阶段直引 tsx**；P2 sub-plan 改 `pnpm nx run server:runtime-smoke`（理由：L1 不通不写 L2 — P1 不能依赖未存在的 nx target）
- `## Architecture Notes *(mandatory)*` 段下方新增 `### 🚨 Testing Invariants (AI 绝对禁令 - 严禁违背)` 子段 — 3 禁令（user 给定全文）：
  1. NO LIFECYCLE MOCKING（Guard/Interceptor/Filter/Pipe/Repository 禁 `new` / `jest.mock`）
  2. MANDATORY INTEGRATION（`Test.createTestingModule` 装 DI 容器）
  3. EXHAUSTIVE BRANCHING（`state_branches` 100% `it()` 覆盖）

**A.3 `tasks-template.md`** 2 处：
- HTML 注释 `kind` 枚举扩 `verification`；`verify_kind` 枚举扩 `smoke`
- `## Server` section 末尾追加 T003 终极任务模板：`[ ] T003 [Verify Backend Physics — Server Runtime Smoke Verification]`（kind=verification + verify_kind=smoke）

### B. spec.zod schema 升级
落点：`.specify/schemas/mono-orchestrator-ready/spec.zod.ts`

- 添加 `state_branches: z.array(z.string()).optional()` —— **P1 stage optional**（per 主 plan Risk 行：撞既有 spec 001/002 drift 风险已知，optional 先过渡）
- schema 文件注释中标 "P3 阶段 sub-plan 内转 required + 同 PR backfill 既有 specs"

### C. `preset.yml` 版本 bump 0.2.1 → 0.2.2
- `version: 0.2.2`
- `description` 段加 0.2.2 增量描述：`state_branches` 字段 + plan-template `Testing Invariants` 段 + tasks-template T003 模板

### D. testcontainers deps 安装
mono root 跑：

```bash
pnpm add -D testcontainers @testcontainers/postgresql @testcontainers/redis
```

预期 lockfile + apps/mobile/package.json 不动；仅 root `package.json` devDeps + `pnpm-lock.yaml` 变化。

### E. `scripts/ci/server-boot-smoke.ts` 标准化（对齐 mono仓实际 bootstrap）

落点：`scripts/ci/server-boot-smoke.ts`

**基于 user 草稿，5 处修正对齐 `apps/server/src/main.ts` 实际形态**：

| # | user 草稿 | 修正后 | 原因 |
|---|---|---|---|
| 1 | `import { AppModule } from '../../apps/server/src/app.module';` | `import { AppModule } from '../../apps/server/src/app/app.module';` | 实际嵌套 `app/` 子目录（per Explore baseline） |
| 2 | `NestFactory.create(AppModule)` 默认 Express adapter / 无 Pipe / 无 prefix | 镜像 `main.ts`: `NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {bufferLogs: true})` + `useGlobalPipes(new ValidationPipe({transform, whitelist, exceptionFactory→FormValidationException}))` + `setGlobalPrefix('api')` | 否则 curl `/api/v1/accounts/me` 走 404 而不是 401，3 个 assertion 全错位（PR-79 修过的链路再次失效） |
| 3 | `process.env.JWT_SECRET = 'smoke-test-secret-2026'` | `process.env.AUTH_JWT_SECRET = 'smoke-test-secret-2026'` + 补 `process.env.SMS_CODE_HMAC_SECRET = 'smoke-test-hmac-2026'` | 实际 SecurityModule `config.getOrThrow('AUTH_JWT_SECRET')`；AuthModule getOrThrow('SMS_CODE_HMAC_SECRET')；PR-79 实证 |
| 4 | `process.env.LOG_LEVEL = 'error'` | 移除 | mono仓用 nestjs-pino，`LOG_LEVEL` env 不被识别；`NestFactory.create` `logger: ['error', 'warn']` 已经降噪足够 |
| 5 | `await app.listen(0)` + `await app.getUrl()` + fetch | `await app.listen(0, '127.0.0.1')` + 显式 `http://127.0.0.1:${address.port}` | NestFastifyApplication `listen(0)` 默认 IPv6 `::1`，部分 Node fetch 在 dual-stack 时走 IPv4 撞错地址；显式绑定 v4 + 拼 URL 规避 |

外加：在 NestFactory.create 之前跑 `execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], { cwd: SERVER_DIR, env, stdio: 'inherit' })` —— 否则 PrismaService boot 时 schema 不存在 → boot 阶段就崩。

**3 个断言 contract 保留 user 原版**：no 500 / RFC 9457 shape (`type+title+status`) / `traceId` 字段非空。

### F. ADR-0040 stub
落点：`docs/adr/0040-multi-layer-test-gate.md`

- frontmatter 4 必填：`adr_id: 0040 / status: Proposed / applies_to: mono-wide / sunset_trigger:` (per 主 plan § ADR 位置)
- 内容范围：**最小提纲**
  - Context 段（PR-5 retro 8 bug + Nx 策略缺失，引用 docs/plans/2026-05/05-22-test-infra-master.md）
  - Decision 段（3 阶段 L1→L2→L3 心法 + 接口契约）
  - 5 钢钉清单（runtime smoke + state_branches + Testing Invariants + nx affected + branch ruleset）
- **不预写**：P2 nx target / namedInputs / ESLint scope 决策；P3 GH Actions / lefthook 正则 / PR template 决策（留 sub-plan 2/3 各自 amend）

### G. master + sub-plan 1 文件 git mv 落定
PR-T1 同 commit 内：

```
docs/plans/pr-5-05-21-review-tech-stack-post-a002-declarative-creek.md
  ↓ 内容拆 2
docs/plans/2026-05/05-22-test-infra-master.md        ← master plan 部分（H1 到 ## On Ship 备注）
docs/plans/2026-05/05-22-test-infra-p1-runtime-smoke.md ← 本 sub-plan 1 全文
```

scratch 文件 git rm。两新文件 git add。

### H. PR 元数据
- commit msg: `chore(test-infra): PR-T1 — runtime smoke script + spec-kit governance fields + ADR-0040 stub`
- PR body: 8 项交付 checkbox + smoke 脚本本地裸跑 exit 0 evidence 截图 + spec.zod 升级 diff 摘要

## Verification（local 裸跑 evidence，PR ready 前全通）

1. ☐ `pnpm install` 后 lockfile 含 `testcontainers` / `@testcontainers/postgresql` / `@testcontainers/redis`
2. ☐ `pnpm tsx scripts/ci/server-boot-smoke.ts` → exit 0 + 3 assertion pass + 终端 echo 出有效 traceId UUID
3. ☐ `pnpm tsx scripts/check-spec-frontmatters.ts` → GREEN（确认 `state_branches` optional 不撞既有 spec 001/002 drift）
4. ☐ `pnpm tsx scripts/check-adr-frontmatters.ts docs/adr/0040-multi-layer-test-gate.md` → GREEN（确认 ADR stub 4 必填字段过校验）
5. ☐ `pnpm nx run-many --target=typecheck,test,lint --all --skip-nx-cache` → all GREEN（确认 testcontainers 装包 + smoke script 不破现有 build）

## STOP criteria（任一红即 STOP，不绕过）

- smoke 脚本 exit 1 — 这是 PR 前置门槛；exit 1 时定位 + 修到 exit 0 为止，不接受 force ship
- spec.zod schema 校验既有 spec 001/002 撞 drift — 说明 `state_branches` 字段定义触发了 zod-preprocess 通病（per memory `feedback_zod_preprocess_breaks_generic_zodtype`），回退到 `z.array(z.string()).optional().default([])`
- testcontainers boot fail — OrbStack/Docker 不可用是 local env 问题，非 PR 范围，但要在 PR body 注明 prereq

## Out of Scope（defer 给 P2 / P3 / follow-up）

- 任何 Nx target 包装（`nx run server:runtime-smoke`）→ sub-plan 2
- `.github/workflows/` CI job、PR template、branch ruleset → sub-plan 3
- mobile playwright `runtime-smoke` target 化（现有 `mobile:e2e` 已 P1 可独立跑通，符合主 plan P1 输出契约）→ sub-plan 2
- lefthook anti-mock 正则拦 `new Guard()` 等 → sub-plan 3
- upstream `michael-speckit-presets` PR 同步 → PR-T1 内开 follow-up GitHub issue 提醒
- `state_branches` 转 required + backfill spec 001/002 → sub-plan 3

## Risk + Rollback

| 风险 | 缓解 |
|---|---|
| smoke 脚本本地 Docker 不可达 | OrbStack/Docker Desktop pre-running 列入 PR body 前置；CI 阶段在 P3 处理 |
| AppModule `NestFactory.create` 默认配置 → 探针 404 而非 401 | E.2 显式 main.ts 镜像（Fastify + Pipe + prefix） |
| `LogLevel` env override 加载顺序错位 | E.4 移除 `LOG_LEVEL` 显式 set，pino 用 default config |
| ADR-0040 stub 含 P2/P3 决策细节锁死下游空间 | F 节「最小提纲」 + 5 钢钉清单严格不涉具体技术 |
| preset 0.2.2 strategy: replace 与 upstream `michael-speckit-presets` drift | follow-up GH issue + 标 memory `feedback_replace_strategy_silent_upstream_drift` |
| 拆 scratch 为 2 个 docs/plans/ 文件时漏内容 | G 节 git rm + git add 显式两步；切分前 chat 展示 boundary（`---` 行为分界） |
| `state_branches` 字段引入触发 zod-preprocess generic 推断 bug | B 节用具体 `z.array(z.string())` 不走 generic helper（per memory `feedback_zod_preprocess_breaks_generic_zodtype`） |

## User 输入未直接覆盖、按主 plan default 处理的项

- `state_branches` schema 强度：optional（主 plan Risk 行默认）
- `🚨 Testing Invariants` 是否还要追加 `NO jest.mock` / `MANDATORY REAL DB` / `NO app.inject` 等：**仅按 user 给的 3 条**，不加
- ADR-0040 stub 范围：**最小提纲**（5 钢钉 + 3 阶段架构图）
- T003 任务 kind/verify_kind 枚举：**`verification` / `smoke`**
- upstream preset PR 时机：**follow-up issue，不阻 PR-T1**

以上 5 项若与 user 后续输入不一致，在 sub-plan 1 执行阶段以 user 修订为准。

## 执行步骤建议顺序（PR-T1 内）

1. 装 testcontainers deps（D 项）
2. 写 + 本地裸跑 server-boot-smoke.ts 到 exit 0（E 项 + Verification 第 2 条）
3. 改 spec-kit preset 3 模板 + spec.zod + preset.yml bump（A/B/C 项）
4. 写 ADR-0040 stub（F 项）
5. git mv scratch → 2 个约定路径文件（G 项）
6. commit + push + `gh pr merge --auto --squash --delete-branch`
