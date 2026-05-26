# p1 — mono 单源沉淀（conventions + rules + closure 扩）

> 隶属 [master](05-26-feature-impl-guardrails-master.md)。本子 plan = **canonical 详版 + 手动流 path-trigger**，自包含、无外部依赖、单独 ship 即让 command 流受益。遵守 master § 2 全局不变量（去重 / phase-sliced / 单源）。

## 交付物（file-by-file）

| 文件 | 动作 | 内容要点 |
|---|---|---|
| `docs/conventions/server-impl-playbook.md` | 新建 | **后端详版**。① Prisma 并发/事务 8 法：单行 conditional UPDATE affected-count（+READ COMMITTED）/ 禁 FOR UPDATE·Serializable 单行（偏索引 SSI 假冲突）/ 并发 insert P2002+P2034 双形态外层 retry / outbox `publish(tx,…)` 同 tx / scheduler REQUIRES_NEW 每行独立 tx / split-tx 外部 I/O / 悲观锁仅 `$queryRaw FOR UPDATE` 兜底。② 安全：反枚举字节级折叠 + dummy-pad timing / HMAC constant-time 禁 bcrypt / PII AES-GCM + 唯一 hash 防占位 + 终态解密+掩码。每条配「何时用 / 反模式 / mono 实证锚（PR#/feature）」。**顶部链** constitution IV + catalog + ADR-0023/0033（moat/outbox/HMAC **引用不复述**）|
| `docs/conventions/mobile-impl-playbook.md` | 新建 | **前端详版**。RHF 4 铁律（Controller≠register / 表单态≠副作用态 / isSubmitting 单源 / 错误+a11y）+ Strangler-Fig port（`~/theme`+`~/ui` 复用、Orval 函数式 hook 非 class、axios 不删、skin/muscle/nervous/engine 分层）+ **Claude Design mockup 2 段模板**（去 meta 化的 fenced 块：context 表 + prompt block；HTML preview→RN；0 新 token）。链 sdd.md UI 类别 + fe-directory-structure.md + memory `rhf_form_standard_login_golden_sample` |
| `.claude/rules/server-impl-playbook.md` | 新建 | path-triggered 摘要。`paths: apps/server/src/**/*.usecase.ts` / `*.service.ts` / `*.scheduler.ts`。fierce CRITICAL bullet（affected-count 禁 FOR UPDATE / outbox 同 tx / 反枚举折叠 / HMAC 禁 bcrypt / PII AES-GCM）+ 链 server-impl-playbook.md 详版（仿 `server-bounded-context-decision.md`↔catalog 配对）|
| `.claude/rules/mobile-impl-playbook.md` | 新建 | path-triggered 摘要。`paths: apps/mobile/src/**/*.ts(x)` / `apps/mobile/app/**/*.tsx`。RHF 4 铁律 + Strangler + mockup 提示 + 链 mobile-impl-playbook.md |
| `.claude/rules/implement-task-closure.md` | 扩 | 末尾加「## Stop signals（impl 期停下问 user）」：spec 歧义→clarify / 新依赖→停+flag / 不可逆 op→确认 / 跨 PR 边界。复用现有 paths 触发，不增 always-load |
| `docs/plans/2026-05/05-26-feature-impl-guardrails-{master,p1,p2,p3}.md` | 新建 | 本 master + 3 子 plan（随 p1 PR 落）|

> **可选（defense-in-depth，本 PR 默认略）**：`scripts/orchestrator/prompt-assembler.ts` 静态 `guardrailsSection()` —— orchestrator 经 p2 template→architectureNotesSection 已能注入精华，故静态段为冗余兜底，留作后续。

## 守纪律自检（commit 前）

- 新 conventions 无复述 SDD/TDD/moat/nx-gate 正文（只链接已覆盖项）。
- 0 残留旧 Java 仓 / meta / mbw-account / `@nvy/auth` / 批 A-E 编号词。
- 详版「实证锚」引 mono PR/feature（001-005），非旧 Java。

## Verification

- markdownlint（CI mirror `.markdownlint-cli2.jsonc`）扫新 md 绿。
- `pnpm exec nx affected -t lint typecheck test build --base=origin/main` 绿（纯 docs/rules → 空图 exit 0）。
- 路径触发眼检：开 `apps/server/src/**/*.usecase.ts` + `apps/mobile/src/**/*.tsx` → 两 rule `paths:` glob 命中。
- lefthook（spec-frontmatter / markdownlint / docs-organization-drift）绿。

## PR

mono docs PR `docs/feature-impl-guardrails-p1`（含 master + 3 子 plan + 2 conventions + 2 rules + closure 扩）。docs-only → 部署 gate vacuously 满足。
