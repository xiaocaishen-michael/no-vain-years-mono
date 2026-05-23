# Claude Code 配置布局

仓库**独立**维护 `.claude/` 目录。clone 本仓时配置完整生效。

## 配置项分布

- `.claude/` 下**所有内容默认进 git 团队共享**（`settings.json` / `commands/` / `skills/` / `rules/` / 项目级 prompt 资料等）
- **唯一例外**：`settings.local.json`（个人覆盖）→ `.gitignore`（单一真相源在 `.gitignore`）
- **路径锚点**：Hooks 嵌在 `settings.json` 内；Plans 落本仓 `docs/plans/`（由 `plansDirectory` 配置项指向）
- **归属判断**：内容只在本仓 working session 用到 → 放本仓 `.claude/`

## 全局 `~/.claude/` 的边界

全局 `~/.claude/` 只放跨项目个人偏好（keybindings / 通用 skill / agent）；项目特定规则一律落项目 `.claude/` + `CLAUDE.md`。
