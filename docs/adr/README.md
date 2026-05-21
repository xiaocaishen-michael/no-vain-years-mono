# Architecture Decision Records (ADRs)

记录架构 / 工具 / 流程层的关键决策。每条 ADR 是不可变的（superseded 时立新 ADR 链接覆盖,不删旧）。

## 新立 ADR 模板

走 [`adr-governance` preset](https://github.com/xiaocaishen-michael/michael-speckit-presets) 装的 template:

* 模板路径: `.specify/presets/adr-governance/templates/adr-template.md`
* 校验脚本: `scripts/check-adr-frontmatters.ts` (lefthook pre-commit 自动跑;手动 `pnpm tsx scripts/check-adr-frontmatters.ts`)
* schema: `.specify/schemas/adr-governance/adr.zod.ts`

新 ADR 流程:

1. 决定 NNNN 编号: `ls docs/adr/ | tail -1` 看现有 max 数,+1。
2. 复制 template: `cp .specify/presets/adr-governance/templates/adr-template.md docs/adr/NNNN-<kebab-slug>.md`
3. 填 frontmatter 4 必填字段 (adr_id / status / applies_to / sunset_trigger)
4. 填正文 (Context / Decision / Consequences / Trade-offs / Open Questions / References)
5. `git add docs/adr/NNNN-*.md` → 触发 lefthook adr-frontmatter-check 验证
6. 通过则可 commit;失败按错误信息回填

## Frontmatter 4 必填字段 (per [ADR-0031](0031-adr-governance.md))

| 字段 | 值域 | 用途 |
|---|---|---|
| `adr_id` | `ADR-NNNN` | 与文件名 NNNN 严格一致 (e.g. `0042-foo.md` ↔ `ADR-0042`),lefthook cross-check |
| `status` | `Proposed` / `Accepted` / `Deprecated` / `Superseded` / `Reserved` | 生命周期 |
| `applies_to` | list of `{ apps/<name>, packages/<name>, infrastructure, security, mono-wide }` | LLM agent programmatic filter,按 task scope 决定加载哪些 ADR |
| `sunset_trigger` | 多行字符串 ≥ 10 字符 | 强制显式记录"何时本 ADR 应被重审/退役" |

## ADR 现状索引

| ADR | 主题 | applies_to | status |
|---|---|---|---|
| 0018 | Backend Language Pivot — TypeScript on NestJS+Fastify+Prisma+Nx | apps/server | Accepted |
| 0019 | ORM — Prisma v7+ | apps/server, packages/types | Accepted |
| 0020 | 模块边界 — NestJS Module + ESLint boundaries v6 | apps/server, packages/api-client, packages/types | Accepted |
| 0022 | 限流 — @nestjs/throttler v6 + Redis storage | apps/server | Accepted |
| 0023 | SMS code 存储 — HMAC-SHA256 + constant-time | apps/server | Accepted |
| 0024 | Specs feature-first 布局 + frontmatter modules 反查 | mono-wide | Accepted |
| 0025 | 前端部署 — Expo Web → Cloudflare Pages | apps/mobile | Accepted |
| 0026 | Backend Deployment Topology (stub, Plan 3 Phase 1 决) | apps/server, infrastructure | Proposed |
| 0027 | Frontend Data + Test Layer (Orval + RQ + Maestro) | apps/mobile, packages/api-client | Proposed |
| 0028 | Monorepo pnpm Policy (shamefully-hoist) | mono-wide | Proposed |
| 0029 | TS Module Resolution Policy (bundler base) | mono-wide | Proposed |
| 0030 | Package Decomposition (5→2) | mono-wide | Proposed |
| 0031 | ADR Governance & Programmatic Filtering | mono-wide | Proposed |
| 0032 | Backend Bounded Context Split (security + account + auth) | apps/server | Proposed |
| 0033 | Cross-Context Communication via Outbox | apps/server | Proposed |
| 0034 | Auth/Account Operation Catalog (3 传播规则 + LLM decision tree) | apps/server | Proposed |
| 0035 | Data Layer Governance (migrate + naming + seed + types regen) | apps/server | Proposed |
| 0036 | Observability and Logging Governance | apps/server, apps/mobile | Proposed |
| 0037 | Security and Credentials Governance | apps/server, apps/mobile, security | Proposed |
| 0038 | Full-Stack Error Handling and UX Contract | apps/server, apps/mobile, packages/api-client | Proposed |
| 0039 | Performance and Latency Governance | mono-wide | Proposed |

(0021 历史空缺,跳过编号 — 详 PR #N+1 commit 历史)

## 反查与过滤

按 module 找相关 ADR:

```bash
# 哪些 ADR 影响 apps/mobile?
grep -lE '^\s*-\s+apps/mobile\b' docs/adr/*.md

# 哪些 ADR 是 mono-wide?
grep -lE '^\s*-\s+mono-wide\b' docs/adr/*.md
```

按 status 过滤:

```bash
# 哪些 ADR 仍是 Proposed?
grep -lE '^status:\s+Proposed' docs/adr/*.md
```
