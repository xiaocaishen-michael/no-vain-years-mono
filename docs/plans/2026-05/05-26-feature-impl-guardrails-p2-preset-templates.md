# p2 — preset 仓 3 template 烘焙 + 同步回 mono

> **状态：✅ ship（mono install 同步 #205 / `ab3e175`，preset 0.5.0）** — spec/plan/tasks 三 template 烘焙 + preset.yml 0.5.0 changelog 落地。
>
> 隶属 [master](05-26-feature-impl-guardrails-master.md)。本子 plan = **template 烘焙层**（每个新 spec/plan/tasks 自带精华提示）。**依赖 p1**（template 内 link 指向 p1 的 conventions，link 目标须先存在）。跨仓 roundtrip，per [`preset-modification.md`](../../../.claude/rules/preset-modification.md) 5 步流程。

## 交付物

### A. preset 仓改动（`~/Documents/projects/michael-speckit-presets/presets/mono-orchestrator-ready/`）

phase-sliced，per master § 3 映射（spec=WHAT / plan=HOW / tasks=结构）：

| template | 改动 |
|---|---|
| `templates/spec-template.md` | `state_branches` 段加引导：提示枚举**并发/竞态分支**（"N 并发→恰一"）、**反枚举字节级等价分支**、**安全/PII 要求**入 state_branches/FR/SC。**只 WHAT，零 HOW 机制词** |
| `templates/plan-template.md` | § Architecture Notes 加 `### 🚨 Impl Guardrails`（与 Testing Invariants / ADR-0043 banner 平级，L218-251 区）：后端并发/安全 + 前端 RHF/Strangler 各 3-4 fierce bullet（HOW），每条链 mono `docs/conventions/{server,mobile}-impl-playbook.md` |
| `templates/tasks-template.md` | Server 段加「每条 race/反枚举 state_branch 配独立 `[Server-IT]` task」提示；Mobile 段加「RHF 逻辑测 task 绑定」提示 |
| `preset.yml` | bump `0.4.0`→`0.5.0` + changelog（0.5.0 增量：3 template 注入 impl guardrails，链 mono playbook）|

→ preset 仓开 PR + auto-merge（per git-workflow）。

### B. 同步回 mono

- `~/Documents/projects/michael-speckit-presets/scripts/install.sh --repo . --preset mono-orchestrator-ready`
- mono commit = "install mono-orchestrator-ready 0.5.0" 同步性质（**不夹 ad-hoc 编辑**，per preset-modification.md §5）。
- **清 re-install cosmetic drift**（per memory `preset_reinstall_prettier_quote_drift`）：install 会顺带改 `check-spec-frontmatters.ts` + lefthook fragment 的 prettier 引号 → `git checkout` 掉这 2 个，只 stage 真变的 3 template + `.registry`/`.install.log`。

## Verification

- preset 仓 PR CI 绿 + 0.5.0 merge。
- mono `git diff` 仅 3 template + install 状态文件（引号 drift 已 checkout）。
- `pnpm exec nx affected -t lint typecheck test build --base=origin/main` 绿 + markdownlint 绿。
- 烘焙生效（留 p3 dogfood 实证）：新 feature 跑 `/speckit-specify·plan·tasks` 产出自带提示/callout。

## PR

preset 仓 PR（0.5.0）+ mono install 同步 PR `chore/install-preset-0.5.0`。
