# 归档 claude-memory-bridge / memory-cluster-bridge

## Context

用户从老 Java meta-repo（`no-vain-years` + 三仓嵌套）切到 `no-vain-years-mono` 单仓后，跨仓 / 跨 worktree 的 auto-memory 桥接（symlink → canonical pool）失去使用场景：

- mono 仓 cwd 唯一，其 memory dir 已是**实体目录**，独立运行
- bridge 当前只对老 meta-repo 子仓 / 副 worktree 生效（mono 在 `NVY_CWD_EXCLUDES` 内主动排除）
- 老 meta-repo 进入维护态，不再产新 worktree

目标：停用 + 软归档 bridge 相关文件，保留 feat-worktree.sh（用户偶尔回访老 meta-repo 仍需），保留所有物理 symlink 与 canonical memory pool。

## 用户已拍板的决策

| 决策项 | 选择 |
|---|---|
| `feat-worktree.sh` 命运 | **保留**，只删 .sh:279 内引用 bridge 的注释行 |
| `~/.claude/projects/-no-vain-years-*/memory` 4 个 symlink | **不动** |
| 归档方式 | **软归档**：`mv` 到 `_archived/` 子目录 + `.archived-2026-05-21` 后缀 |

## 归档动作清单

### Phase 1 — 停激活（最小 blast）

**`~/.zshrc:151`**：删除整行 `source ~/.zsh/claude-memory-bridge.sh`

```diff
- source ~/.zsh/claude-memory-bridge.sh
```

效果：新启动的 shell 不再注册 `claude()` zsh function；`type claude` 返回原生 binary。

### Phase 2 — 软归档 2 个核心文件

执行前先验证 `~/.claude/skills` 是不是 symlink（用户全局 skills 在 iCloud 上可能是 symlink），决定实际 mv 落点：

```bash
[[ -L "$HOME/.claude/skills" ]] && echo "skills is symlink to: $(readlink "$HOME/.claude/skills")"
```

**A. zsh 实施文件**

```bash
mkdir -p ~/.zsh/_archived
mv ~/.zsh/claude-memory-bridge.sh \
   ~/.zsh/_archived/claude-memory-bridge.sh.archived-2026-05-21
```

**B. SKILL.md（注意 iCloud canonical）**

`~/.claude/skills/memory-cluster-bridge/` 在 iCloud 上有 canonical 副本（路径 `~/Library/Mobile Documents/com~apple~CloudDocs/claude-global/skills/memory-cluster-bridge/`）。mv 用户视角路径即可，iCloud 会同步 rename：

```bash
mkdir -p ~/.claude/skills/_archived
mv ~/.claude/skills/memory-cluster-bridge \
   ~/.claude/skills/_archived/memory-cluster-bridge.archived-2026-05-21
```

如果 `~/.claude/skills` 整体是 symlink → 该 mv 实际会在 iCloud canonical 内执行，跨设备同步生效。

### Phase 3 — 清理活引用

**A. `~/.zsh/feat-worktree.sh:279`** — 单行注释指向已归档文件，删除该行：

```diff
- # 内部 cd 切 server/app 时由 ~/.zsh/claude-memory-bridge.sh 桥接 memory
```

`feat-worktree.sh` 其余函数（`feat-open/feat-close/feat-claude/feat-list`）功能完整保留，可继续用于老 meta-repo。

**B. `no-vain-years-mono/.claude/settings.local.json:83`** — 删 `Bash(zsh -n ~/.zsh/claude-memory-bridge.sh)` 这条权限 entry。该 entry 是给"语法校验 bridge 脚本"用的，脚本归档后无意义。注意保持 JSON 数组前后逗号合法。

### Phase 4 — 验证（端到端）

1. **新 shell 内 `claude()` 不再 wrap**：
   ```bash
   zsh -l -c 'type claude'
   ```
   预期：返回 binary 路径，**不**返回 `claude is a shell function`。

2. **mono 仓 cwd 启动 claude 正常**：在 mono cwd 起新 claude session，确认 memory dir 仍是 `~/.claude/projects/-Users-butterfly-Documents-projects-no-vain-years-mono/memory`（实体目录），70+ 条 mono memory 可见。

3. **老 meta-repo cwd 仍能命中 canonical pool**（symlink 路径未动）：
   ```bash
   ls -la ~/.claude/projects/-Users-butterfly-Documents-projects-no-vain-years/memory
   ```
   预期：仍是 symlink → iCloud canonical。其他 3 个子仓 / feat-514 symlink 同样不动。

4. **回滚演练（dry）**：归档目录可见，文件名带日期：
   ```bash
   ls -la ~/.zsh/_archived/ ~/.claude/skills/_archived/
   ```

### Phase 5 — 不做的事（显式列出，避免越界）

- ❌ **不动** `~/.claude/projects/-no-vain-years-*/memory` 4 条 symlink + canonical 实体（用户决策）
- ❌ **不动** `feat-worktree.sh` 其余 326 行（只删 1 行注释）
- ❌ **不改** `docs/plans/` 内 3 个历史 plan doc（Plan 1 / claude-mem PoC 评估）——它们是历史快照，git 已记录"当时决策"
- ❌ **不改** 老 meta-repo canonical memory pool 内 2 条间接相关 memory（`feedback_zshrc_extract_to_dedicated_sh.md` / `project_claude_mem_deferred_poc.md`）——通用 pattern / claude-mem 评估记录，独立价值

## 归档影响面（影响 / 不影响 矩阵）

| 受影响 | 不受影响 |
|---|---|
| 新 shell 起 `claude` 不再走 wrapper（mono 场景本来就 EXCLUDES，零行为差异） | mono 仓所有日常工作流 |
| 老 meta-repo 副 worktree 起 claude 不再自动建 symlink | 已建好的 4 条 symlink（已建即生效） |
| `claude-memory-bridge` 这个 zsh function 名字消失 | `claude` 原生 binary 调用 |
| `memory-cluster-bridge` skill 不再可被 Skill tool 调用 | iCloud canonical 上的 SKILL.md 内容（mv 不删，仅 rename） |

## 关键风险点

| # | 风险 | 兜底 |
|---|---|---|
| 1 | mv SKILL.md 时如果 `~/.claude/skills` 是 symlink，需确认 iCloud 同步状态健康 | Phase 2 先跑 `readlink`；如发现 iCloud 离线先等同步 |
| 2 | `~/.zshrc` 删行后忘了 `exec zsh` 或起新 shell 验证 | Phase 4 #1 强制起 `zsh -l -c` 验证 |
| 3 | `settings.local.json` JSON 改后语法挂 | 用 Edit 单行替换不动 JSON 结构；改完 `jq . settings.local.json` 校验 |

## 回滚方案

任一步骤失败 / 后续发现需要恢复：

```bash
# 逆 Phase 2
mv ~/.zsh/_archived/claude-memory-bridge.sh.archived-2026-05-21 ~/.zsh/claude-memory-bridge.sh
mv ~/.claude/skills/_archived/memory-cluster-bridge.archived-2026-05-21 ~/.claude/skills/memory-cluster-bridge

# 逆 Phase 1（在 ~/.zshrc 第 151 行附近重加）
echo 'source ~/.zsh/claude-memory-bridge.sh' >> ~/.zshrc  # 位置可调

# Phase 3 的 1 行注释 + 1 行 JSON entry 走 git checkout / 手补即可（注释从 plan 文件复制；JSON entry 从本 plan 抄回）
```

## 后续 memory 沉淀（实施后可考虑）

实施完成后，可以加一条 memory 记录归档事实，避免未来误以为 bridge 仍激活：

```yaml
---
name: reference-claude-memory-bridge-archived
description: claude-memory-bridge / memory-cluster-bridge 已于 2026-05-21 软归档；mono 单仓不再需要跨 cwd memory 桥接
metadata:
  type: reference
---
```

这条 memory 写到 mono 仓 memory pool（`~/.claude/projects/-Users-butterfly-Documents-projects-no-vain-years-mono/memory/`）即可。
