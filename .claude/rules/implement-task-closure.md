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

**历史 `✅` 标记**：meta-repo 时代有 use case tasks.md 使用 `✅` emoji；mono 仓所有新 use case 一律走 `[X]`。lefthook `tasks-md-drift` 识别两种 marker。
