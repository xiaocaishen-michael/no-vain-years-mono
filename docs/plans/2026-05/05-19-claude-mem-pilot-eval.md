# claude-mem 试点评估 + 引入 plan（**延后执行**）

> 评估对象：[thedotmack/claude-mem](https://github.com/thedotmack/claude-mem) v13.2.0（2026-05-12 release，main HEAD `37d2494` 2026-05-13，pushed_at 2026-05-17）
> **Status**：已完成调研 + plan 编写；**实际启动延后到 Plan 1 PoC 完全收尾后**（具体触发条件见 § 1）
> **处置（2026-05-24 状态追进）**：deferred — Plan 1 已收尾，但被 Plan 2 业务优先级挤后；重启窗口 = Plan 2 业务迁移告一段落。与 [W1 子 plan](05-19-claude-mem-w1-openrouter.md) 捆绑启动。
> 决策范围：是否在 Plan 1 PoC 之后引入，作为后续所有项目 memory 管理候选

---

## 1. Context

用户痛点：Claude Code `/clear` 或退出 session 后跨会话上下文丢失。

现有方案：Claude Code 原生 auto-memory（`~/.claude/projects/<cwd-slug>/memory/MEMORY.md` 索引 + 65 条 feedback/reference/project 单文件 markdown），起手通过 `@import` 自动灌入 context，配合 `feedback_memory_cluster_bridge` skill 解决 meta-repo / 多 worktree 跨 cwd 共享。

候选方案：claude-mem——6 hook + 常驻 worker daemon + SQLite + Chroma embedding + MCP `search` tool 的"自动会话日志"系统，progressive disclosure 召回。

**用户决策时间线**（2026-05-18 plan session）：

1. **现在不安装**——本仓正处于 Plan 1（Java meta-repo → NestJS mono-repo pivot）4-5 周 PoC 中，进度敏感；不能让外部插件 churn / token burst / hook 阻塞干扰主线
2. **触发启动信号**（任一未完成则继续等）：
   - phone-sms-auth PoC 全部 use case 验收通过（W3 已 ship，待 W4-W5 收尾）
   - ADR-0018（backend-language-pivot）/ ADR-0019（ORM-prisma）/ ADR-0020（module-boundary-nestjs）三 ADR ship
   - Plan 1 retrospective 文档落地
3. **启动后策略**：全局装 + env-gate 隔离 + 仅本仓激活，4 周 PoC 观察
4. **PoC 验收**：token 成本 / 召回质量 / 稳定性 / 与原生不冲突，4 项全部通过才推广到其他项目

**为什么现在写 plan 而不直接执行**：W1 触发时 claude-mem 大概率已 v14/v15（按当前 4 天 3 release 节奏），但调研的关键事实（架构定位、与原生 memory 的 4 mismatch、env-gate 隔离方案选型、4 维验收口径、killswitch 阈值）是 stable 的。届时只需做 1 次 **轻量 re-check**（30 min 内）：
- `gh api repos/thedotmack/claude-mem/releases` 看是否仍 Apache-2.0、是否仍 binary SQLite 存储、是否新增 project-level allowlist 配置
- `gh api repos/thedotmack/claude-mem/issues` 看 #2469 / #2485 / #2468 是否仍 open
- 若无 breaking change，直接按本 plan 走 W1 setup
- 若有（如：claude-mem 转闭源 / 加入了 project allowlist 让 env-gate 不再必要 / 数据格式改 PostgreSQL），按差异回补本文档相应段落再启动

---

## 2. claude-mem 真相核对（已交叉验证）

| 维度 | 事实 | 来源 |
|---|---|---|
| Star / 活跃度 | 76,380 ★ / 6,551 fork / Trendshift 上榜 / 116 open issues | `gh api repos/thedotmack/claude-mem` |
| License | Apache-2.0 | 同上 |
| 当前版本 | v13.2.0（2026-05-12），4 天 3 release（v13.0.0/v13.0.1/v13.1.0/v13.2.0） | GitHub releases API |
| README badge 状态 | 写 v6.5.0，与实际 v13.2.0 严重 drift（卖点判断要绕开 README badge） | README L78 |
| 阶段定位 | v13.0.0 标题 "Server Beta + Apache 2.0"，Server / Postgres / BullMQ 大改阶段 | release notes |
| Hook 注入面 | 5 个 lifecycle hook（SessionStart `startup\|clear\|compact` / UserPromptSubmit / PreToolUse:`Read` / PostToolUse:`*` / Stop）+ 1 setup hook | `plugin/hooks/hooks.json` |
| 存储 | `~/.claude-mem/`：SQLite `claude-mem.db`（34 migration）+ Chroma embedding + `worker.pid` + logs；可通过 `CLAUDE_MEM_DATA_DIR` 改路径 | docs/configuration |
| Token 模型 | `Stop` hook 调 `@anthropic-ai/claude-agent-sdk` haiku-4-5 压缩 transcript 成 `<observation>` XML | hooks.json + worker source |
| 召回策略 | SessionStart 注入 compact index（~50-100 tokens/result），按需走 MCP `search` 取详情 | docs/progressive-disclosure |
| **project-level 启停** | **不支持**——无 allowlist / blocklist / `CLAUDE_MEM_DISABLED` env | docs/configuration WebFetch 确认 |

---

## 3. 与现有 memory 系统的 4 个 mismatch

claude-mem 是"自动会话日志数据库"，原生 memory 是"手工沉淀经验库"——**目的不同，不是直接替换关系**。

| 维度 | 原生 memory | claude-mem |
|---|---|---|
| 跨子仓 / 多 worktree 共享（`memory-cluster-bridge` 场景） | symlink 桥接 ✅ | per-`project` 强隔离 ❌ |
| iCloud 跨设备 sync | markdown 文件并发安全 ✅ | binary SQLite 并发写不安全 ❌ |
| Git-trackable / human review | ✅ | ❌（binary DB） |
| Token 成本 | 0 | 持续烧 haiku-4-5（issue #2469：Max5 用户 5 min 烧完月 quota） |
| 检索能力 | cat 全量灌 | Chroma + FTS5 + MCP progressive disclosure ✅ |
| 自动判别"该记什么" | ❌（用户自写） | LLM 自动 ✅ |
| 数据可移植 | markdown 可手工迁移 | 需 export / 工具支持 |

**核心矛盾**：用户现有 65 条 memory 是反复校对、合并、`[[wikilink]]` 互链的精品库。claude-mem 不会读这些 markdown（无 import 通道），也不会写入这些 markdown（写 SQLite）。同时跑 = 双注入起手 ctx%，且两套数据无交集。

---

## 4. 关键技术约束 + 隔离方案选定

**约束**：claude-mem 当前不支持 "全局装 + 仅本仓启用"。文档和 hooks.json 双确认，5 个 session 周期 hook 一旦注册到 `~/.claude/settings.json`（或 plugin marketplace），所有 cwd 都触发。

**选定方案：A. env-gate**

理由：env var 比 cwd path 守卫更优雅（子目录 / worktree / rename 都不破），且关闭只需 `unset CLAUDE_MEM_ENABLE`。

实施：
1. 全局装：`npx claude-mem install`
2. 找 hook 安装路径（按文档应在 `~/.claude/plugins/marketplaces/thedotmack/claude-mem/` 或 user settings 内嵌）
3. 在每个 hook command 首行注入 `[ -z "$CLAUDE_MEM_ENABLE" ] && exit 0`——**先在沙箱目录里手工 patch，不入 git**
4. mono-repo 根目录 `.envrc`（gitignored）加 `export CLAUDE_MEM_ENABLE=1`，配合 direnv
5. 写一行守卫 script `scripts/claude-mem-guard-check.sh`，每次 `npx claude-mem repair` / upgrade 后跑一次，校验 patch 是否仍在；不在则重打

**已知风险**：claude-mem upgrade 会覆盖 hooks.json。Mitigation = post-upgrade re-patch script + W4 验收前不主动升级。

---

## 5. PoC 实施计划（4 周）

> **前置条件**：§ 1 列出的 3 个 Plan 1 收尾信号全部满足 + § 1 末尾的轻量 re-check 30 min 内完成。

| 周次 | 任务 | 验证标志 |
|---|---|---|
| **W1 setup** | (1) 全局装 `npx claude-mem install`；(2) 手工 patch 5 个 hook 加 env-gate；(3) mono-repo `.envrc` 加 `CLAUDE_MEM_ENABLE=1`；(4) 写 `scripts/claude-mem-guard-check.sh` post-upgrade 校验；(5) 离开 mono-repo cwd 起 session 验证 hook 全 noop（看 `~/.claude-mem/logs/`） | 其他仓 cwd session 起手无 claude-mem hook 触发；mono-repo cwd 起手 worker log 有写入 |
| **W2 baseline** | (1) 启用前 baseline：本仓 5 次 typical session 起手记 ctx% / 任务完成质量主观打分；(2) 启用后跑 5 次同类 session 记同 metrics；(3) 每日 `~/.claude-mem/logs/worker-*.log` grep error / silent-fail | ctx% 增量 < 3pp；observations 表写入 > 0；无 #2485 静默失败 |
| **W3 token 监控** | (1) Anthropic console 拉每日 API 用量（claude-mem worker 走 user 自己的 ANTHROPIC_API_KEY）；(2) 对比启用前同期；(3) 设 budget alert $5/day | 单日 haiku-4-5 调用增量 < $0.5；无 burst |
| **W4 召回评估** | (1) 抓 5 次新 session 起手 claude-mem 自动注入的内容；(2) 人工评估：是否命中当前任务（≥4/5 命中算 pass）；(3) 是否比 cat-style 原生 MEMORY.md 直灌更精准；(4) 是否产生重复信息双注入 | 命中率 ≥ 80%；无与原生 MEMORY.md 重复信息双注入 |

---

## 6. 4 维验收口径（用户已选"全部验证"）

| 维度 | Pass 阈值 | Fail 信号 |
|---|---|---|
| **Token 成本可控** | 单日 haiku-4-5 调用增量 < $0.5；4 周累计 < $15；无 quota burst | issue #2469 复现；Anthropic console budget alert 触发 |
| **召回质量 > 原生** | 5 次抽样命中率 ≥ 80%；progressive disclosure 比 cat-style 更精准 | 命中率 < 60%；信息 stale / 与当前任务无关 |
| **稳定性可信** | 无 worker daemon 崩溃；无 observation 静默失败（#2485）；无 hook 阻塞 Claude Code（> 5s 卡顿） | observations 表写入 0 但日志显示 hook 触发；session 起手 > 10s 延迟 |
| **与原生不冲突** | 新 session 起手 ctx% < 8%（单原生 ~5%）；无重复信息双注入；关键 feedback 不漏召回 | 双注入起手 ctx% > 12%；user 发现 feedback 被 claude-mem 覆盖 |

---

## 7. Killswitch / 退出条件

任一条触发 = 立即 `unset CLAUDE_MEM_ENABLE`，停 PoC：
- 单日 token 增量 > $2（连续 2 天）
- worker daemon 崩溃 / DB lock 导致 Claude Code 卡顿 > 30s
- 数据丢失 / observations 表 corruption
- v13.x 出 breaking change 影响数据格式（每周看 release notes）
- mono-repo 主线进度被 PoC 干扰超过 0.5 day

**完全卸载步骤**（PoC 失败时执行）：
1. `unset CLAUDE_MEM_ENABLE`（环境立即生效）
2. `npx claude-mem uninstall`（如有该 command，否则手工删 hook + plugin）
3. 删 `~/.claude-mem/` 整目录（PoC 数据不保留）
4. 删 mono-repo `.envrc` 中的 `CLAUDE_MEM_ENABLE` line
5. 反向校验：其他仓 + mono-repo session 起手无 claude-mem 痕迹

---

## 8. 推广决策（W4 末）

| 情况 | 行动 |
|---|---|
| 4 维全 pass | 推广策略二选：(a) 扩到下一个新项目（用 `CLAUDE_MEM_ENABLE` env-gate per-project 控制）；(b) 替换原生 memory 之前还要做 65 条 markdown → claude-mem seed import 调研 |
| 任 1 维 fail | 停 PoC；写一份 ADR 沉淀经验；继续 memory-cluster-bridge 路线 |
| 半 pass（token & 稳定 pass，召回质量 borderline） | 退到 "retrieval-only" 模式（关 SessionStart 自动 inject，只用 mem-search skill 按需查），再 2 周观察 |

---

## 9. 关键文件 / 路径 / 命令

- 安装/卸载：`npx claude-mem install` / `npx claude-mem uninstall`
- Hook 配置（待 W1 setup 时定位）：`~/.claude/plugins/marketplaces/thedotmack/claude-mem/hooks/hooks.json` 或 `~/.claude/settings.json` hooks 段
- 数据目录：`~/.claude-mem/`（`claude-mem.db` / `chroma/` / `logs/` / `worker.pid`）
- Env-gate 守卫：mono-repo 根 `.envrc`（gitignored）
- post-upgrade 校验：`scripts/claude-mem-guard-check.sh`（新建，本仓内）
- MCP search tool（PoC W4 评估召回时用）：`mcp__claude-mem__search`
- Web viewer（real-time observation 流）：`http://localhost:37777`

## 10. 验证 plan（端到端）

W1 setup 完成后跑：
1. 在 mono-repo cwd 起 Claude Code session → 看 `~/.claude-mem/logs/worker-YYYY-MM-DD.log` 是否有 "session started" 行
2. 在另一个仓（如 `~/Documents/projects/my-claude-x`）起 session → 同日志应**无新行**写入
3. mono-repo session 中跑 5 个 tool call（Read / Bash / Edit）→ `~/.claude-mem/claude-mem.db` `observations` 表 count 应 > 0（`sqlite3 ~/.claude-mem/claude-mem.db 'SELECT COUNT(*) FROM observations'`）
4. `/clear` 后重起 session → 起手 system message 应能看到 claude-mem 注入的 compact index 块
5. 退出 mono-repo cwd 删 `.envrc`，再起 session → 起手应无 claude-mem 注入痕迹

---

## 关键参考

- 主仓 README：<https://github.com/thedotmack/claude-mem>
- 配置文档：<https://docs.claude-mem.ai/configuration>
- Progressive disclosure 哲学：<https://docs.claude-mem.ai/progressive-disclosure>
- 关键风险 issue：[#2469 token burn](https://github.com/thedotmack/claude-mem/issues/2469) / [#2485 silent observation fail](https://github.com/thedotmack/claude-mem/issues/2485) / [#2468 observer context unbounded](https://github.com/thedotmack/claude-mem/issues/2468)
- 用户现有 memory 现状：65 条 markdown @ `~/.claude/projects/-Users-butterfly-Documents-projects-no-vain-years-mono/memory/`
- 相关 user memory：[[feedback-memory-cluster-bridge]]（meta-repo 跨子仓共享方案，与 claude-mem per-project 隔离冲突）
