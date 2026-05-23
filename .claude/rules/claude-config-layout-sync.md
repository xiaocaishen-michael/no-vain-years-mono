---
paths:
  - '.claude/**'
---

# Claude 配置布局纪律（path-triggered，触及 `.claude/**` 自动加载）

## 硬性 invariant

### 1. `.claude/` 默认 git 团队共享，唯一例外 `settings.local.json`

新增 / 改 `.claude/` 下任何文件（`settings.json` / `commands/` / `skills/` / `rules/` / 项目级 prompt 资料）**默认进 git 团队共享** —— clone 本仓即完整生效。唯一不进 git 的是个人覆盖 `settings.local.json`（单一真相源在 `.gitignore`）。

→ 个人 / 机密配置放 `settings.local.json`，不要塞进团队共享文件。

### 2. 归属：项目特定落本仓 `.claude/`，跨项目个人偏好落全局 `~/.claude/`

内容只在本仓 working session 用到 → 本仓 `.claude/` + `CLAUDE.md`；跨项目个人偏好（keybindings / 通用 skill / agent）→ 全局 `~/.claude/`。放错层 = 规则要么泄漏到无关项目，要么 clone 本仓时丢失。

## 单源真理

完整配置项分布（路径锚点 Hooks 嵌 `settings.json` / Plans 落 `docs/plans/` / 全局 `~/.claude/` 边界细节）见 [`docs/conventions/claude-config-layout.md`](../../docs/conventions/claude-config-layout.md)。本 rule 仅 surface 路径触发的硬 invariant，不重复 canonical 分布表。
