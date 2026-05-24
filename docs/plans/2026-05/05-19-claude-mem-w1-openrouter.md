# claude-mem W1 启动 plan（OpenRouter 路径）

> **Status**: drafted 2026-05-18，等用户 ExitPlan 审批后启动 W1 实地执行
> **处置（2026-05-24 状态追进）**：deferred — 父 [eval plan](05-19-claude-mem-pilot-eval.md) 未启则不动；同窗口随父 plan 启动。
> **Parent eval plan**: `docs/plans/2026-05/05-19-claude-mem-pilot-eval.md`（170 行 untracked 调研，Status / Killswitch / 4 维验收等仍 authoritative）
> **本文档承载**：re-check delta + OpenRouter 路径补丁 + 与原生 memory 机制对比 + W1 step-by-step 可执行清单 + 2-day A/B 短期验证

---

## 1. Context

- 用户 2026-05-18 session 终决策"延后到 Plan 3"；同日新决策 **override** —— Plan 1 已全 ship（V1-V10 + ADR-0018/0019/0020 + retro），Plan 3 未启，**这个 window 里跑 PoC 比与 Plan 3 业务迁移并行更干净**
- 评估 plan 触发条件（§ 1）已全满足，可直接进 W1
- 用户额外约束：**不烧 Anthropic Console 配额** → claude-mem worker 走 OpenRouter，不用 ANTHROPIC_API_KEY

---

## 2. Re-check 结果（2026-05-18 第二次）

claude-mem 整体仍 stable，**3 项 DELTA / 0 项 BREAKING**：

| 维度 | 状态 | 备注 |
|---|---|---|
| 版本 / license / SQLite default | NO_CHANGE | v13.2.0 / Apache-2.0 / SQLite 仍 default（Server Beta 仍 opt-in） |
| Project-level allowlist | NO_CHANGE | 仍未加 → env-gate 方案继续必需 |
| `npx claude-mem install` 命令 | NO_CHANGE | 仍 primary install path |
| **#2469 token burn** | DELTA | 3 用户在 v13.2.0 实证 token spike，无 mitigation merge → 收紧 budget |
| **#2485 silent observer fail** | DELTA | 1 新用户报 v13.2.0 非 repro → W2 必须加 observer 成功率 baseline 监控 |
| **codex-hooks.json 新增** | DELTA | Codex IDE 用，与 Claude Code hooks.json 分离 → W1 不动它，W2 验证不被 Claude Code 触发 |

---

## 3. OpenRouter 路径（ground-truth 验证）

### 3.1 关键事实

claude-mem 内置 3 个 provider，dispatcher `getActiveAgent()` 在每次 worker 调用时按配置路由：

```typescript
private getActiveAgent(): ClaudeProvider | GeminiProvider | OpenRouterProvider {
  if (isOpenRouterSelected() && isOpenRouterAvailable()) return this.openRouterAgent;
  if (isGeminiSelected() && isGeminiAvailable()) return this.geminiAgent;
  return this.sdkAgent;  // ClaudeProvider 兜底
}
```

设 `provider=openrouter` + `OPENROUTER_API_KEY` → **observations 和 summarize 全部走 OpenRouter，ANTHROPIC_API_KEY 不需要**。

### 3.2 trade-off（必须在 W4 召回质量评估时观察）

| 维度 | ClaudeProvider（SDK） | OpenRouterProvider |
|---|---|---|
| Session memory（summarize 上下文） | ✅ 有原生 session resume | ❌ 每次 stateless 请求 |
| 价格（haiku-4-5） | Anthropic Console 标价 | OpenRouter 标价 ≈ Console + 5-10% |
| Quota 来源 | 用户 Anthropic Console | 用户 OpenRouter 余额 |
| 与 Claude Max 订阅复用 | ❌（worker 仍走 API key） | ❌ |

**stateless summarize 是质量降级风险**，但具体影响只能在 W4 召回评估时实测，无法事先量化。Killswitch（评估 plan § 7）已覆盖召回质量 fail 退出条件。

---

## 4. 与原生 new-session bootstrap 全链路机制对比

> 不只比 markdown 文件存储，而是比"上一个 session 结束 → 新 session 起手 → AI 主动接力"这条完整链路。

### 4.1 现有原生 bootstrap 全链路（4 layer）

按"session start → 第一条 prompt 输入前"时间轴排列：

| Layer | 触发时机 | 数据源 | 注入方式 | 主导方 | 典型 token |
|---|---|---|---|---|---|
| **L1 静态 @import** | Claude Code 启动 / `/clear` | `~/.claude/CLAUDE.md` + 仓 `CLAUDE.md`（@import 递归）+ 仓 conventions/*.md | 全文件直灌系统 context | Claude Code 引擎 | 较大（基础规约 + business-naming + git-workflow + SDD 约定）|
| **L2 auto-memory index** | 同上 | `~/.claude/projects/<cwd-slug>/memory/MEMORY.md`（80 条 markdown 索引，截 200 行）| 全文件直灌 | Claude Code auto-memory 子系统 | ~1500-2500 tok（200 行索引）|
| **L3 last-session-notes** | 用户首条 prompt（如 "看下进度" / "继续 X"）触发 | 上次 session 临退前写的 `project_next_session_starter.md`（226 行）或 `last-session-notes-${CC_NS}.md`（per [[feedback-last-session-notes-check-ns-first]]） | Claude 主动 Read 文件 | **Claude（被用户首条 prompt 触发）** | ~3000-5000 tok |
| **L4 state ground-truth 验证（4 步 bootstrap protocol）** | 同 L3，per [[feedback-cross-session-first-message-templates]] + [[reference-state-layer-precedence]] | git log / tasks.md（spec-driven 模块）/ 当前 branch / 双仓 main 同步 | Claude 主动跑 Bash + Read | **Claude** | 命令输出短 |

**4 步 bootstrap protocol** 具体内容（per memory）：

1. 双仓 `git pull --ff-only`（mono + 旧 meta，如果还在跨仓阶段）
2. `cat specs/<feature>/tasks.md | tail -80` 看 phase 状态
3. `git log --oneline -10` 双仓近期 commit
4. drift 报告（tasks.md ✅ vs impl 是否一致）后 → 进入工作

**State layer 优先级**（per [[reference-state-layer-precedence]]）：`git log > tasks.md > daily log > markdown memory`。daily log 不参与 state 判定；冲突立即同步 tasks.md。

**关键性质**：

- L1-L2 是 **knowledge layer**（约定 / 规则 / 历史教训），claude 不验证只吸收
- L3 是 **handoff layer**（上次 session 留的明文交接单），需要上 session 主动写出来才有
- L4 是 **state layer**（运行时 ground-truth），claude 主动跑命令拿，**优先级最高**

### 4.2 claude-mem 的 session 起手机制（对照同 layer 分类）

| Layer | claude-mem 等价物 | 触发 | 数据源 | 注入方式 | 主导方 |
|---|---|---|---|---|---|
| L1 静态规约 | **不覆盖** | 无 | n/a | n/a | n/a |
| L2 memory index | SessionStart hook 注入的 "compact index" | `SessionStart` hook（matcher `startup\|clear\|compact`）| SQLite `observations` 表 + chroma 向量召回 top-k | hook 写一段 system message 到对话头 | claude-mem daemon |
| L3 last-session-notes | observation 流（自动抽，无明确 handoff 单） | Stop hook 每次 session 结束抽 | LLM(haiku-4-5) 看上次 transcript 抽要点 | 写 SQLite，下一 session 起手时 L2 召回 | claude-mem worker |
| L4 state ground-truth | **不覆盖** | 无 | n/a | claude-mem 不跑 git log / tasks.md | n/a |

**关键 mismatch**：claude-mem 只在 L2-L3 之间提供"自动会话日志召回"，**完全不覆盖 L1 规约 / L4 state 验证**。

### 4.3 两套机制叠加后新的 bootstrap 链路（PoC 启用后）

按时间轴：

1. **L1 @import**：原生不变（CLAUDE.md + conventions 全灌）
2. **L2 双注入**：
   - 原生 MEMORY.md 80 条索引继续灌
   - **+ claude-mem SessionStart hook 注入 compact index**（top-k 相关 observation 摘要）
   - 两者**不互读、无 dedup**
3. **L3 handoff**：Claude 仍按用户首条 prompt 触发 Read `project_next_session_starter.md`（不会被 claude-mem 替代）
4. **L4 4 步 protocol**：Claude 仍主动跑 `git log` / `tasks.md`（**claude-mem 没接管这个**，也不该接管 — state layer 必须是 ground-truth）

**净增量**：L2 多了一块 "compact index"，主要价值场景是**召回上次 transcript 的过程性细节**（如：尝试过的 fix 路径、踩过的坑、当时讨论的设计选项），这是 markdown memory 和 4 步 protocol 都拿不到的"对话过程信息"。

**净成本**：

- ctx%：估增 1-3 pp（L2 双注入）
- 起手延迟：SessionStart hook 同步执行，担心阻塞 → W1 step 6 验证 #1 时测
- token：worker 每次 Stop 抽取烧 OpenRouter haiku-4-5（§ 6 2-day A/B 评估）

### 4.4 PoC 期间是否要改 4 步 protocol？

**默认不改**。理由：

- 4 步 protocol 拿的是 **state layer**（git log / tasks.md），是 ground truth；claude-mem 注入的是 **transcript 衍生**，不能替代 state
- 用户已有 [[feedback-cross-session-first-message-templates]] 三模板（A/B/C）成熟，PoC 期间不动 muscle memory
- W4 评估时再回头看：claude-mem 是否提供了 4 步 protocol 看不到的细节增量

**唯一例外**：若 W4 末 claude-mem 全 pass 推广，且观察到 compact index 已稳定召回 last-session 上下文 → 可考虑把 L3（手工 last-session-notes）退役，但 L4 永不退役。

### 4.5 两套机制的存储 / 索引 / 加载逻辑（细节层）

| 维度 | 原生 Claude Code auto-memory（含 `project_next_session_starter`） | claude-mem |
|---|---|---|
| 物理存储 | `~/.claude/projects/<cwd-slug>/memory/*.md`（80 文件，本仓） | `~/.claude-mem/claude-mem.db`（单 SQLite + chroma embeddings） |
| 索引文件 | `MEMORY.md`（@import 自动加载，截 200 行）| DB 内 `observations` 表 + chroma vector index |
| 加载触发 | session 起手 @import `MEMORY.md` → 一次性灌 ctx | SessionStart hook 注入 compact index → 按需 MCP `search` 取详情（progressive disclosure） |
| 数据更新 | 用户手工 Write 文件 / Claude 写 memory 命令 | Stop hook 自动 LLM 抽取（worker daemon haiku-4-5）|
| Git tracked | ❌（在 `~/.claude/`，不在仓内）| ❌（在 `~/.claude-mem/`，不在仓内）|
| 跨设备 sync | iCloud symlink（meta-repo 时代）/ 本仓 2026-05-18 已物理分离 | 不支持（SQLite binary） |
| Human review | ✅ markdown 可读 | ❌ binary DB，需 sqlite3 CLI 查 |

**核心定位差异**：

- 原生：**手工沉淀的精品经验库**（80 条 feedback/reference/project，反复合并 + `[[wikilink]]` 互链）
- claude-mem：**自动会话日志数据库**（LLM 抽 transcript → 海量 observation，progressive 召回）

**两者不互读不互写**：claude-mem worker 不会读 80 条 markdown；原生 @import 也不会读 SQLite。同时启用 = session 起手双注入 ctx%，两套数据无交集。

### 4.6 `project_next_session_starter` 在新机制下的命运

- `project_next_session_starter.md`（226 行，2026-05-18 写）仍走原生 @import 链路加载
- claude-mem 不替代它（不会反向写入 markdown）
- PoC 启动后两者并跑，主观体感哪个对当前任务更命中靠 W4 召回质量评估
- 若 PoC 通过，可考虑把它写成"Claude 写完 session 自动追加新 starter notes"的自动化（claude-mem 写 SQLite + 同步抽精华到 markdown 一份），但这是 W5 推广后的话题，**W1-W4 不动 markdown 流程**

### 4.7 Worktree + CC_NS 行为对比

`CC_NS` 是用户自建的 wrapper-script 环境变量，用于强制 Claude Code 原生 memory dir 命名空间（[[feedback-last-session-notes-check-ns-first]]）。仅对原生 memory 系统生效，claude-mem 完全不读 `CC_NS`。

| 场景 | 原生 memory | claude-mem |
|---|---|---|
| 单仓非 worktree session | cwd-slug = `-Users-butterfly-Documents-projects-no-vain-years-mono` → 单一 memory dir | project_id = basename `no-vain-years-mono` → 单一 project 分区 |
| 同仓两个 worktree 并行 session（如 main + feature-x）| 默认 cwd-slug 不同 → 两个 memory dir 分裂（用户用 `feedback-memory-cluster-bridge` symlink 或 `CC_NS` 强制收敛到主 cwd 的 dir）| **project_id = `no-vain-years-mono/<worktree-basename>` 不同** → 两个 project 分区分裂；**不自动共享 observation** |
| 数据库 / 文件并发写 | 文件 IO，markdown 单文件并发安全（极少同时写同一文件） | 单一 `~/.claude-mem/claude-mem.db` + WAL mode + 单 daemon（worker.pid 单例）→ 并发写安全 |
| Branch merge 后跨 worktree 数据归并 | 不适用（markdown 手工管理） | `WorktreeAdoption` 后处理把 worktree project 的 observation 标 `merged_into_project` 合到 parent project |
| 跨 worktree 召回 | 看 symlink/CC_NS 配置：用户的 bridge skill 让所有 worktree 看同一 memory dir | **NO**：每个 worktree 只召自己的 observation，与 parent main 互不可见（直到 WorktreeAdoption 后处理）|

**对用户影响**：用户已习惯 `feedback-memory-cluster-bridge` 让 worktree 共享原生 memory，但 **claude-mem 默认相反方向**（worktree 强隔离）。**这是机制冲突，需要 W4 评估时单列一项**：

- 选项 A：接受 claude-mem worktree 隔离，把它当"per-worktree 会话日志"用（原生 memory 仍是共享精品库）
- 选项 B：W2 baseline 时人为把同仓 worktree session 的 observation 用 `project_id` 重写聚合（需破坏 claude-mem 设计，不推荐）
- 选项 C：PoC 期间限制 W1-W4 只在 mono-repo 主 cwd 起 session，**不在 worktree 起 claude-mem 启用的 session**（最简单，但限缩验证面）

**W1 默认选项 C**（在 worktree 起 session 时 `direnv` 不应自动 export `CLAUDE_MEM_ENABLE=1`，因为 `.envrc` 在 main cwd），W4 末若 PoC 通过再决策 A/B/C 长期方向。

### 4.8 与 `feedback-memory-cluster-bridge` skill 的关系

- skill 解决**原生 memory** 的多 cwd 共享，claude-mem 不进入 skill 的设计 scope
- 若 claude-mem W4 全 pass 推广，skill 仍保留（两套系统服务不同目的）
- 若 claude-mem 失败回退，skill 是默认 fallback 路线（评估 plan § 8 已记）

---

## 5. W1 执行清单（replaces eval plan § 5 W1 行）

### Step 1 — install（不烧 token）

```bash
npx claude-mem install
```

**预期产物**：hooks 写入 `~/.claude/settings.json` 或 `~/.claude/plugins/marketplaces/thedotmack/claude-mem/`；`~/.claude-mem/` 数据目录创建（SQLite + chroma + logs）

**verify**：
- `ls -la ~/.claude-mem/`（应有 `claude-mem.db` / `chroma/` / `logs/`）
- `jq '.hooks // {} | keys' ~/.claude/settings.json` 或 `find ~/.claude/plugins -name hooks.json`，定位实际 hook 配置路径
- 不应在 install 阶段触发 worker；如 install 报 missing `ANTHROPIC_API_KEY` → 停 + 问 user

### Step 2 — provider 切到 OpenRouter

W1 实地确认 `isOpenRouterSelected()` 实现读哪个 env / 配置文件（源码搜：`gh search code --repo=thedotmack/claude-mem 'isOpenRouterSelected'`）。预估写入 `~/.claude-mem/.env`：

```
CLAUDE_MEM_PROVIDER=openrouter
OPENROUTER_API_KEY=<user 准备>
# 可选：摘要 tier 模型显式 pin
CLAUDE_MEM_TIER_SUMMARY_MODEL=anthropic/claude-haiku-4-5
```

**verify**：起一次 session（CLAUDE_MEM_ENABLE 仍未设，应 noop），grep `~/.claude-mem/logs/` 不应看到 ClaudeProvider/Anthropic SDK 字样

### Step 3 — env-gate 6 个 Claude Code hooks

定位 `hooks.json`（W1 step 1 实地），每个 hook command 首行注入：

```bash
[ -z "$CLAUDE_MEM_ENABLE" ] && exit 0
```

**hooks.json 备份**：patch 前 `cp hooks.json hooks.json.preEnvGate.bak`，便于 upgrade 后 diff 验证

**不 patch codex-hooks.json**：Codex IDE 专用，Claude Code 不读；W2 baseline 时 grep ~/.claude-mem/logs/ 确认无 codex hook 触发记录

### Step 4 — mono-repo `.envrc`

```bash
echo 'export CLAUDE_MEM_ENABLE=1' > /Users/butterfly/Documents/projects/no-vain-years-mono/.envrc
grep -q '^\.envrc$' /Users/butterfly/Documents/projects/no-vain-years-mono/.gitignore \
  || echo '.envrc' >> /Users/butterfly/Documents/projects/no-vain-years-mono/.gitignore
direnv allow /Users/butterfly/Documents/projects/no-vain-years-mono
```

**verify**：
- `cd /Users/butterfly/Documents/projects/no-vain-years-mono && echo "$CLAUDE_MEM_ENABLE"` → `1`
- `cd ~ && echo "$CLAUDE_MEM_ENABLE"` → 空
- mono-repo 内任何 worktree（`/Users/butterfly/Documents/projects/no-vain-years-mono-wt-*`）`echo "$CLAUDE_MEM_ENABLE"` → 空（确认 worktree 默认不开启，per § 4.7 选项 C）

### Step 5 — guard-check script

新建 `scripts/claude-mem-guard-check.sh`（mono-repo 内，可入 git）：

```bash
#!/usr/bin/env bash
# 检查 claude-mem hooks 是否仍带 env-gate（升级会覆盖 hooks.json）
set -euo pipefail
HOOKS_JSON="$1"  # 实际路径 W1 step 1 后填
EXPECTED='[ -z "$CLAUDE_MEM_ENABLE" ] && exit 0'
MISSING=$(jq -r '.hooks | to_entries[] | .value[]? | .hooks[]? | .command' "$HOOKS_JSON" \
  | grep -cv "CLAUDE_MEM_ENABLE" || true)
if [ "$MISSING" -gt 0 ]; then
  echo "ERROR: $MISSING hook(s) lost env-gate, re-patch needed"
  exit 1
fi
echo "OK: all hooks env-gated"
```

**use**：每次 `npx claude-mem upgrade` 后跑一次

### Step 6 — 端到端验证（评估 plan § 10 + OpenRouter + worktree 附加）

| # | 步骤 | 预期 |
|---|---|---|
| 1 | mono-repo 主 cwd 起 Claude Code session | `~/.claude-mem/logs/worker-*.log` 有 "session started" + provider=openrouter 痕迹 |
| 2 | `~/` cwd 起 session（CLAUDE_MEM_ENABLE unset） | claude-mem 日志**无新行** |
| 3 | mono session 跑 5 个 tool call（Read/Bash/Edit） | `sqlite3 ~/.claude-mem/claude-mem.db 'SELECT COUNT(*) FROM observations'` > 0 |
| 4 | `/clear` 重起 session | 起手 system 注入 compact index 块 |
| 5 | mono `.envrc` 删后起 session | 起手无 claude-mem 痕迹 |
| 6 | **新增**：worker log grep `OpenRouter` / `ClaudeProvider` | 只见前者，不见后者 |
| 7 | **新增**：OpenRouter dashboard 用量计数 | step 1-4 跑完后 dashboard 显示有 claude-haiku-4-5 调用 |
| 8 | **新增**：mono worktree cwd 起 session（不开 CLAUDE_MEM_ENABLE） | claude-mem 日志无新 worktree project_id 行（验证 § 4.3 选项 C） |

---

## 6. 2-day 短期 A/B 验证（W1 完成后 → W2 baseline 前插）

**目的**：W2 4 维 baseline 需要 5 次同类 session 跑 1 周才有量级，太长；先 2 天搞个粗粒度信号，决定要不要走完 W2-W4。

**前置**：W1 已全 step PASS + OPENROUTER_API_KEY 真实在用

**Day 1-2 设置**（在 mono-repo 主 cwd 起 4 次代表性 session，每次 30-60 min）：

| Session | 任务类型 | CLAUDE_MEM_ENABLE | 备注 |
|---|---|---|---|
| A1 | 中等复杂代码任务（如 Plan 3 use case 调研）| **1**（启用） | 记起手 ctx% / 任务首轮命中率（主观 1-5） / 是否依赖原生 memory 还是 claude-mem 召回 |
| A2 | 跨 session 续作（A1 后第二天接着干） | **1**（启用） | 重点观察跨 session 接力命中率（claude-mem 强项）|
| B1 | 中等复杂任务（不同 use case） | **0**（关闭，临时 `unset CLAUDE_MEM_ENABLE` 再起） | 对照组：仅原生 memory |
| B2 | 跨 session 续作（B1 后第二天） | **0**（关闭） | 对照组跨 session 接力 |

**评估表**（2 天后填）：

| 维度 | A 组（开启）| B 组（关闭）| 差异信号 |
|---|---|---|---|
| 起手 ctx% | ___% | ___% | A-B 差 > 3pp = 双注入显著 |
| 首轮任务命中率（主观 1-5） | ___ | ___ | A > B = claude-mem 有增量价值 |
| 跨 session 接力命中率（A2 vs B2） | ___ | ___ | A >> B = progressive disclosure 有效 |
| OpenRouter 累计花费 | $___ | $0 | 2 天 < $1 = 阈值健康 |
| ~/.claude-mem/logs/ error 行数 | ___ | n/a | > 0 = 触发 #2485 类 issue，停 |
| observations 表 count | ___ | n/a | < 10 / session = 抽取异常 |
| 起手延迟（session ready 到第一条 prompt 可输入） | ___s | ___s | A-B 延迟 > 3s = 用户体验降级 |

**决策门**（2 天验证后）：

- A 组在 ≥ 2 个维度明显优于 B 且无 error 行 → **继续走 W2-W4 完整 4 周 PoC**
- A 组无明显优势但 token 健康 → **退到 evaluation plan § 8 半 pass 路径**（关 SessionStart 自动 inject，只用 `mcp__claude-mem__search` 按需查）
- A 组有 error 行 / 召回质量差 / token > $1 / 起手延迟 > 5s → **立即 `unset CLAUDE_MEM_ENABLE` + 写 ADR 沉淀 + 终止 PoC**

**注**：2 天评估只看强信号 / 红线，不替代 W4 的 5 次抽样 + 4 维详细评估。

---

## 7. 评估 plan 待 patch 段落（W4 验收前补，不阻塞 W1 启动）

| 段落 | 当前内容 | 补丁方向 |
|---|---|---|
| § 1 决策时间线 | "2026-05-18 不安装 + 触发信号 + W4 推广" | 加一行：2026-05-18 第二次 override；触发信号全满足；走 OpenRouter |
| § 2 真相核对表 | Token 模型行 | 加 provider 行：3 provider + OpenRouterProvider 无 session memory |
| § 3 mismatch 表 | "跨 worktree per-project 强隔离 ❌" | 实证补充：`parent/worktree` composite project_id；WorktreeAdoption 后处理路径 |
| § 4 隔离方案 | 5 hook + 1 setup hook | 改为 6 lifecycle hooks（patch）+ 1 codex-hooks.json（不 patch） |
| § 5 W2 baseline | "5 次 session" | 加前置 § 6 的 2-day 短期 A/B 决策门 |
| § 5 W3 token monitor | "Anthropic Console 拉用量 / $0.5/day budget" | 改 OpenRouter dashboard；阈值收紧到 $0.25/day（因 #2469 v13.2.0 未修） |
| § 6 4 维验收 | Token 维度按 Console budget | 改 OpenRouter 用量；召回质量维度加注 "stateless summarize 影响实测" |
| § 7 Killswitch | "单日 token 增量 > $2 连续 2 天" | 同步收紧到 > $1 连续 2 天 |

---

## 8. 关键文件 / 路径

- 评估 plan：`docs/plans/2026-05/05-19-claude-mem-pilot-eval.md`
- 本 W1 plan：`docs/plans/2026-05/05-19-claude-mem-w1-openrouter.md`
- claude-mem 数据：`~/.claude-mem/`（不在仓内，自动 gitignore-外）
- claude-mem 配置 env：`~/.claude-mem/.env`（W1 step 2 创建）
- mono-repo env-gate：`/Users/butterfly/Documents/projects/no-vain-years-mono/.envrc`（gitignored）
- Guard script：`/Users/butterfly/Documents/projects/no-vain-years-mono/scripts/claude-mem-guard-check.sh`
- hooks.json 实际路径：W1 step 1 实地后填回
- 原生 memory 80 条 markdown 库：`~/.claude/projects/-Users-butterfly-Documents-projects-no-vain-years-mono/memory/`（PoC 期间**完全不动**）

---

## 9. Stop signals（W1 + 2-day A/B 内任一触发 → 停 + 问 user）

1. `npx claude-mem install` 报必须设 `ANTHROPIC_API_KEY` 才能继续（OpenRouter 路径理论不该，但官方未承诺）
2. `isOpenRouterSelected()` 读不到任何 env 或 config 文件（源码与文档不一致）
3. hooks.json 实际路径找不到（marketplace 路径或 settings.json 内嵌都无）
4. step 6 验证 #6 显示仍走 ClaudeProvider（provider 配置未生效）
5. W1 任何步骤产生 git tracked 改动**外**意外文件变更（如 ~/.claude/settings.json 大量改动）
6. install 期间触发任何不可逆操作（drop / migrate / 写 mono-repo 主代码区）
7. 2-day A/B 评估期间出现 § 6 "立即 unset" 红线（error 行 / token > $1 / 起手延迟 > 5s 等）

---

## 10. 启动前提（all green = 可立即跑）

- [x] Plan 1 全 ship（V1-V10 + 3 ADRs + retro 沉淀）
- [x] 评估 plan re-check 已完成（§ 2）
- [x] 用户决策 override "延后到 Plan 3"
- [x] 本地状态 clean（无 prior install / direnv 装好 / hook 不冲突）
- [x] 与原生 memory 机制对比 + worktree 行为澄清（§ 4 已记）
- [ ] **用户确认走 OpenRouter 路径并准备 OPENROUTER_API_KEY**（执行 step 2 前提供，可 W1 中途交付）
- [ ] **本 plan 通过 ExitPlanMode 审批**
