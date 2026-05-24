# no-vain-years-mono Constitution

> 「不虚此生」mono-repo PoC 项目级原则。每个业务模块、每个 use case、每个 PR review 必参考。基于 [Plan 1](https://github.com/xiaocaishen-michael/no-vain-years/blob/main/docs/plans/2026-05/05-18-plan1-backend-stack-poc.md) PoC 范围（W1-W5）锁定，Plan 2 / Plan 3 阶段视需要 amend。

## Core Principles

### I. Spec-Driven Development（NON-NEGOTIABLE）

每个业务 use case 严格走 6 步 SDD：`/speckit-constitution`（项目级一次性）→ `/speckit-specify` → `/speckit-clarify` → `/speckit-plan` → `/speckit-tasks` → `/speckit-analyze` → `/speckit-implement`。详见 [`docs/conventions/sdd.md`](../../docs/conventions/sdd.md)。

**禁跳步**：clarify → plan / plan → tasks / analyze → implement 之间是人工审批卡点，不可绕。直接跳到 implement 等于绕过 spec 一致性保障。

### II. Test-First TDD（NON-NEGOTIABLE）

`/speckit-implement` 每 task 走红→绿→typecheck/lint→tasks.md `[X]`→stage→commit 6 步闭环。**测试必须先写**，看到 RED 才写实现；GREEN 后才 commit。

**禁反模式**：写完 impl 再补测试 / 测试通过但未真正断言关键路径 / mock 过深以致 spec drift。

### III. Atomic Task = 30min-2h + 独立 Commit

`/speckit-tasks` 拆 task 时每条应是 **30min-2h 可独立 commit 的工作单元**。每个 task 完成同 commit stage 业务代码 + 测试 + tasks.md `[X]` 翻转。

**禁反模式**：tasks 拆得过细（每个 method 一个 task） / 多 task 合一 commit / 写完 impl 喊 /commit 事后再开 PR 改 tasks.md。

### IV. Module Boundary 显式 + ESLint 强制（扁平 + 贫血 + 护城河）

跨 bounded context（`auth` / `account` / `security`）通信走 Module 显式 `exports` + DI，**单向** `auth → account → security`（反向禁），由 `eslint-plugin-boundaries` 在 **module 级**拦截（hexagonal 层强制已退役，per ADR-0032）。模块**内部扁平**：文件平铺于 module 根，无 `domain` / `application` / `infrastructure` / `web` 层子目录（per ADR-0043 § 1）。

**现行边界规则**（ESLint boundaries + Nx depConstraints 在 CI 拦截）：

1. 跨 module 单向 `auth → account → security`；`security`（平台基座）不依赖任何业务 ctx
2. **数据护城河**：某 ctx 不碰他 ctx 的 Prisma 表（禁 `tx.<otherTable>.*` / `prisma.<otherTable>.*` 出现在非 owner ctx）；跨 ctx 读/写经对方的 use case（R2，必要时拆**两段式委托** `Inspect*UseCase` 只读 + `Commit*UseCase` 写，per ADR-0043 § 3a / § 5）
3. **无 repository port**：use case 直注 `PrismaService` 读写自己 ctx 的表；数据 = 贫血 Prisma row（`@map` camelCase）+ `*.rules.ts` 纯函数不变量；禁充血 Domain Class / Entity Mapper / 输入校验 VO class（零-class，per ADR-0043 § 2 / § 4）
4. shared 层（`packages/`）不依赖 business module（`apps/`）

详见 ADR-0032（bounded context 拆分 + hexagonal 退役）+ ADR-0043（扁平 / 贫血 / 护城河 / 零-class 正向范式）。**ADR-0020（原 hexagonal 四层 + repository 边界）已 Superseded by 0032 + 0043。**

### V. 类型同步链 Nx-driven（不引入跨仓 hook）

`apps/server` `@nestjs/swagger` 装饰器 → `nx run server:export-openapi` 产 `apps/server/openapi.json` → `packages/api-client` 跑 `openapi-typescript` 生成 TS client → `apps/mobile` 消费。`nx affected` 自动传导，**不引入 cross-cwd hook**（meta 时代 `/sync-api-types` / `api-types-sync` preset 失效，mono 内 Nx target dependency chain 覆盖）。

PR 边界：server impl + api-client regen + mobile 消费 **同 PR**。

## Tech Stack Constraints

PoC 阶段（W1-W5）锁定栈：

| 层 | 选型 | Plan 1 § |
|---|---|---|
| Runtime | Node 22 LTS | § F |
| Package manager | pnpm 10.33.2 | § F |
| Monorepo | Nx 21+ | § F |
| 后端框架 | NestJS 11 + Fastify adapter | § F |
| 后端 ORM | Prisma 6+ | § F + ADR-0019 |
| 后端 build | `@nx/js:swc` 转译（不 bundle） | § F + W2.0 amend |
| 前端框架 | Expo（Plan 2 物理迁入） | § F |
| Test runner | Vitest 2（前后端一致） | § F |
| Lint / Format | ESLint 9 flat config + Prettier 3 | § F |
| Pre-commit | lefthook（W3+ 装） | § F |
| CI | GitHub Actions + Nx affected | § F |
| 容器 base | `node:22-alpine`（production） | § F |
| OpenAPI | code-first `@nestjs/swagger` | § F |
| 跨语言 contract | OpenAPI（Protobuf 未来评估） | § F |

**禁锚定旧 ADR**（per [Plan 1](https://github.com/xiaocaishen-michael/no-vain-years/blob/main/docs/plans/2026-05/05-18-plan1-backend-stack-poc.md) E.4 / user 决策 2026-05-17）：mono 是从 Java meta-repo 推倒重来，旧 ADR-0001~ADR-0017（业务无关部分如 Lint / Format / 部署）不自动继承；ADR-0018（语言）/ ADR-0019（ORM）/ ADR-0020（module 边界）由 PoC 验证产出后落 W4-W5。

## Quality Gates

每个 PR 必须满足：

1. **Required status checks**（mono main-protection ruleset）：
   - Gitleaks（密钥扫描）
   - Actionlint（workflow YAML）
   - PR title（conventional commits）
   - Build (nx build server)（SWC 转译产 dist/main.js）
2. **Conventional Commits**：PR title + body + 每个 commit message 符合 `<type>(<scope>): <subject>` 格式（type ∈ `feat / fix / docs / chore / refactor / style / test / perf / build / ci`）；body 每行 ≤ 150 字符
3. **Squash merge only**：保持 main 线性历史；feature 分支 merge 后自动删除
4. **AI agent default auto-merge**：除明示例外（user 要 review / draft / 不可逆操作 / release-please），AI 创建 PR 后接 `gh pr merge --auto --squash --delete-branch`

详见 [`docs/conventions/git-workflow.md`](../../docs/conventions/git-workflow.md)。

## Governance

本 Constitution **supersede** `CLAUDE.md` / `docs/conventions/*` 中冲突部分。

**Amendments**：

- 任何 amend 走独立 PR（`docs/constitution-amend-<topic>`）
- PR 描述必须 cite：当时背景 / 为何需 amend / 影响哪些已有约定
- 每 amend bump version（SemVer：原则增减→MAJOR，section 重写→MINOR，文字调整→PATCH）
- Last Amended date 同步更新

**AI agent compliance**：

- 每 PR review 必引用本 Constitution 检查 5 原则 + Tech Stack 锁定 + Quality Gates
- `/speckit-analyze` 把 spec / plan / tasks 对照 Constitution 扫一致性
- Constitution 与 `docs/conventions/sdd.md` 冲突时以 Constitution 为准（sdd.md 是 SDD 流程细节，Constitution 是 PoC 项目级原则）

**Version**: 1.1.0 | **Ratified**: 2026-05-17 | **Last Amended**: 2026-05-24

> v1.1.0（2026-05-24）：§ IV Module Boundary 重写对齐 ADR-0043 扁平+贫血+护城河+零-class 范式（R-1~R-VO 实装后）—— 删退役的 hexagonal 四层 ArchUnit 规则，改单向 module 边界 + 数据护城河 + 无 repository；ADR-0020 标 Superseded。
