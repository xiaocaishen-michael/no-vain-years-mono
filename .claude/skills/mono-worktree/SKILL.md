---
name: mono-worktree
description: no-vain-years-mono 仓 per-feature git worktree 管理 + 资源隔离（server PORT / Expo Metro PORT / Redis db / PG database 4 维）。激活时机：用户提"帮我开 worktree / 创建 feature 工作区 / 并行新分支 / 隔离 server 端口 / 多 feature 同时跑 / feat-open / feat-close / feat-list / feat-claude"，或想从 main 切出独立工作目录避免与主 cwd 抢端口。提供 4 个 zsh 命令（源 ~/.zsh/mono-worktree.sh）+ 资源分配机制 + 关键反模式。
model: inherit
---

# mono-worktree — per-feature 工作区一键开关

## 1. 何时用

solo dev 在 mono 仓需要**并行**多个 feature（如同时跑两个 SDD 分支调试 / 一个分支等 CI 另一分支动手），单 cwd 模式会撞 server PORT (3000) / Metro PORT (8081) / shared PG DB (`mbw_poc`) / shared Redis db 0。

每个 worktree 自动分配独占资源，互不干扰。

**不用的场景**：单 feature 串行开发 — main cwd 直接干就行，多此一举。

## 2. 4 个命令

| 命令 | 作用 |
|---|---|
| `feat-open <branch>` | 开 worktree（自动 branch attach/create）+ 分配 PORT/Metro/Redis db + 建 PG DB + 写 `.envrc` + `pnpm install --frozen-lockfile` |
| `feat-close <branch> [--keep-db]` | 删 worktree + 删本地分支 + drop DB（含 `pg_dump` 自动备份到 `/tmp` 兜底） |
| `feat-claude <branch>` | `cd` 进 worktree + `export CC_NS=<suffix>` + 启 `claude`（独立 memory pool） |
| `feat-list` | 列所有 worktree + 容器目录磁盘占用 + 现存 `mbw_*` feature DB |

## 3. Branch 命名（两套并行，per `docs/conventions/git-workflow.md`）

| 类型 | 格式 | 示例 |
|---|---|---|
| SDD | `NNN-<slug>` | `feat-open 003-pkm-link-graph` |
| 非 SDD | `<type>/<kebab>` | `feat-open chore/docs-cleanup` |

regex 校验：`^[a-z0-9][a-z0-9/-]*[a-z0-9]$`。**首尾必须字母/数字，禁大写**。

## 4. 资源隔离机制

启动时 `feat-open` 写副 worktree 根 `.envrc`，注入 4 个 override 字段，覆盖主仓 `apps/server/.env` 默认值：

```bash
export DATABASE_URL="postgresql://mbw:mbw@localhost:5433/mbw_<suffix>"
export REDIS_URL="redis://localhost:6380/<redis_db>"
export PORT=<server_port>          # 3001 起递增
export EXPO_METRO_PORT=<metro_port> # 8082 起递增
```

**双信号源分配**（每次 `feat-open` 都跑）：
- 端口：`lsof -i :p LISTEN`（实测）+ 扫所有副 worktree `.envrc` 已分配值
- Redis db：Redis `dbsize > 0`（实测）+ `.envrc` 已分配

主仓占 server 3000 / Metro 8081 / Redis db 0 / DB `mbw_poc`。副 worktree 从 3001 / 8082 / db 1 / `mbw_<suffix>` 起。

## 5. 关键工作流

### 开 feature

```bash
# SDD: 先跑 spec-kit specify 自动建 NNN-<slug> 分支
/speckit-specify "pkm link graph"
# → 自动 git checkout -b 003-pkm-link-graph

# 然后开 worktree（attach 已存在分支）
feat-open 003-pkm-link-graph
# → ✅ 输出含 server PORT / Metro PORT / DB 名 / 启动命令提示
```

### 在 worktree 内开发

```bash
cd ~/Documents/projects/no-vain-years-mono-003-pkm-link-graph

# 启 server（PORT 已通过 direnv 注入）
nx serve server

# 启 mobile（Metro PORT 需手带 --port，Expo 不读 env）
nx serve mobile -- --port $EXPO_METRO_PORT

# 启独立 Claude session（独立 memory pool，不污染主仓）
export CC_NS=003-pkm-link-graph
claude
```

### 关 feature

```bash
# 默认 drop DB（含 pg_dump 备份 /tmp/feat-close-backup-*-*.sql 兜底）
feat-close 003-pkm-link-graph

# 保留 DB（数据还要复用）
feat-close 003-pkm-link-graph --keep-db
```

## 6. 关键反模式

- ❌ **绕过 git worktree remove 手工 `rm -rf` 副 wt 目录** → `feat-open` 同名 branch 时会 stale metadata 报错。修：`git -C <mono> worktree prune` 后再开
- ❌ **副 worktree 内改 `.envrc` 手工换端口** → 下次 `feat-open` 端口扫描会把改后值当已分配，可能撞号。改 `.envrc` 后跑 `direnv allow` 让 hook 重读
- ❌ **`feat-close` 跳过 `--keep-db` 但忘了 DB 含重要数据** → 兜底 `pg_dump` 到 `/tmp`，但 macOS 重启会清。重要数据先 `--keep-db` 或手工 dump
- ❌ **同名 branch 已有 worktree 残留 + 同名 DB 残留 同时存在** → `feat-open` 检测到 DB 已存在自动复用，echo `ℹ️ DB 已存在(前次 --keep-db close 残留)`。期望则继续；非期望则先 `feat-close <branch> && docker exec mbw-poc-postgres psql -U mbw -c 'DROP DATABASE IF EXISTS mbw_<suffix>'` 彻底清

## 7. 故障排查

| 症状 | 排查 |
|---|---|
| `❌ PG container mbw-poc-postgres 未在跑` | `cd <mono> && docker compose -f docker-compose.dev.yml up -d` |
| `pnpm install` 失败 lockfile drift | 进 wt 手工 `pnpm install`（不 frozen），feat-open 已 echo 提示但不 rollback |
| worktree 跑 server 启动报 `EADDRINUSE: 3001` | `.envrc` 未被 direnv 加载 → `cd $wt && direnv allow` |
| `feat-close` 卡 `DROP DATABASE` | 有残连 → 脚本已 `pg_terminate_backend`，仍卡说明 server 进程仍在跑，先 `kill` |
| `feat-list` PG 段空白 | 已修：现在显示 `(无 feature DB)` 兜底 |

## 8. 与其他 skill 协同

- `commit-commands:clean_gone` 清理 [gone] 分支时**附带**清 git worktree 元数据，但**不**清 mono-worktree 建的 PG DB / Redis db。建议先 `feat-close` 再 `clean_gone`
- `speckit-implement` 在 worktree 内跑没问题；tasks.md `[X]` flip + commit 走副 worktree git 即可
- `claude-mem` (env-gated `CLAUDE_MEM_ENABLE=1`) 在 worktree 内独立 pool 工作（用户已选独立 pool 方向，不桥接主仓）

## 9. 文件位置

- 脚本：`~/.zsh/mono-worktree.sh`（用户态，约 290 行）
- ~/.zshrc source：`source ~/.zsh/mono-worktree.sh`（行 148）
- 老版本（Java 三仓）：`~/.zsh/_archived/feat-worktree.sh.archived-2026-05-21`
