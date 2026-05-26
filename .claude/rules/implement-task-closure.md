---
paths:
  - 'specs/*/tasks.md'
  - 'apps/server/src/**/*.usecase.ts'
  - 'apps/server/src/**/*.controller.ts'
  - 'apps/mobile/src/**/*.tsx'
  - 'apps/mobile/src/**/*.ts'
---

# /implement 每 task 闭环 6 步（path-triggered，改 tasks.md / impl 文件时自动加载）

`/speckit-implement` 执行每个 task 时，**最后一步必须改 tasks.md**，与业务代码 + 测试同 commit：

1. 红：写测试 → typecheck pass + 测试 RED
2. 绿：写实现 → 测试 GREEN
3. typecheck + lint pass
4. **改 tasks.md**：把 task 行的 `- [ ] T<N> ...` 翻成 `- [X] T<N> ...`（spec-kit 原生 checkbox 体例）。**状态语义**：`- [ ]` = pending，`- [X]` = done
5. `git add` impl + 测试 + tasks.md 同 stage
6. 进 commit 流程

**Per-task 节奏**：每 task 走完 6 步**直接 commit**，无需用户审批；phase 之间 `Review gate`（clarify → plan / plan → tasks / analyze → implement）是 phase-level 人工卡点，不在 implement 内 per-task 触发。

## 强制层（双层兜底）

- prompt-time 软提醒：`task-closure` preset 通过 `after_implement` hook 触发 `/speckit-tasks-verify` slash command，扫近 2h commit 报告 `[X]` 状态与 impl 是否 drift（per [michael-speckit-presets](https://github.com/xiaocaishen-michael/michael-speckit-presets)）
- commit-time 硬拦：mono 仓 lefthook `tasks-md-drift` 拒「commit 含 impl 代码但 tasks.md 未 staged」；`--no-verify` 仅限格式化 / typo / 紧急 hotfix 出口

**常见反模式**：写完 impl 喊 /commit、事后再开 PR 改 tasks.md → 应 impl PR 内**同 commit** stage tasks.md `[X]`。

**`✅` 标记兼容**：早期部分 tasks.md 用 `✅` emoji 标完成；新 use case 一律走 `[X]`。lefthook `tasks-md-drift` 两种 marker 都识别。

## Stop signals（impl 期停下问 user，别自作主张往下冲）

per-task 默认直接 commit（上文），但撞到下列任一**停下**、不闷头继续：

1. **spec 歧义**：实现中发现 spec 有多种合理解释 / 关键行为未定 → 停，回 `/speckit-clarify` 或问 user，**不默认挑一个**。
2. **新依赖**：需引入未锁定的 runtime 依赖（npm 包 / 二进制资产）→ 停 + flag（与已锁定项去重，列选型理由）；尤其二进制入仓 / 跨仓改动。
3. **不可逆 / 高风险 op**：DB 不可逆变更 / 删大量代码 / secrets / 生产资源命名 → 停，PR 描述 flag「建议人工合并」，不接 auto-merge。
4. **跨 PR 边界**：发现改动超出本 feature task 范围（牵动他 feature / 平台层大改）→ 停，确认是否拆独立 PR，别把无关改动夹进来。

详版工程机制见 [`docs/conventions/server-impl-playbook.md`](../../docs/conventions/server-impl-playbook.md) / [`mobile-impl-playbook.md`](../../docs/conventions/mobile-impl-playbook.md)。
