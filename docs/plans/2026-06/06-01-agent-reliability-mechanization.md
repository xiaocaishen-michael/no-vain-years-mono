# Plan：Agent 可靠性的机械化收口（堵 E1-E4 + 洪流）

## Context

来源：[`docs/_review/2026-05-31-token-burn-and-fabrication-postmortem.md`](../_review/2026-05-31-token-burn-and-fabrication-postmortem.md) + 其姊妹篇 [`agent-reliability-industry-remedies.md`](../_review/2026-05-31-agent-reliability-industry-remedies.md)。

核心结论（有实证）：**模型在 clean context 下也不可靠地遵守自己揣着的规则**（IFScale：500 条指令遵守率仅 68%；自我纠错净负）。所以修法不能是"把规则写得更狠"，而是**能机械化的落 hook/CI，不能机械化的才进 memory，CLAUDE.md 最小化**。本 plan 只做最高 ROI 的一小撮，**刻意不做大框架**（解码约束属 vendor 侧、加不了）。

**本 session 现场实证**：Plan 子 agent 自己的并行 Bash 批次里一个 `ls` 不存在路径 → 在 `set -e` 下非零退出 → Claude Code **取消了同批 ~20 个调用**（CC bug #22264）。这正是本 plan 头号要堵的失败类。

## 数据实证（200 session transcript 全量扫描，2026-05-31）

脚本流式扫 207 个 transcript（256MB），只取聚合（见 `/tmp/tx_*.py`）。**这组数据推翻了本 plan 初版的几个核心假设**，据此重排了优先级。

### A. Token 成本结构

- 200 session 合计 **77.3 亿 token**；**~97% 是 `cache_read`**（input/output 各 <1%）。
- 单场最高 4.23 亿（11h session，4.14 亿是 cache_read）。
- **结论**：烧钱大头不是单条洪流命令，是**长 session 把脏 context 每轮重新计费（cache_read）**。→ 最高杠杆是"早 /clear + use-case 粒度切 session + 洪流丢子 agent"，不是 `--quiet` 单条。

### B. 失败分布（推翻"危险命令黑名单"与"path-hook 高 ROI"）

- Bash 总调用 8,004，**失败仅 3.2%（260）**；Edit 6.2% / Write 6.1% / Read 0.9%。
- 失败**不集中在危险命令**，最多的是 `cd/echo/ls/cat/grep` 带 `2>/dev/null` 的**预期内探测**（失败 exit code 是设计行为）。
- **纯 path 脑补全样本仅 ~5/8004**。→ 「危险命令黑名单」无标的；「path-existence hook」要拦的目标极少且会误伤探测命令。

### C. 连坐（sibling cascade）三层拆解 —— 回答"连坐真凶是什么"

82 次连坐victim，72 次匹配到真凶，按真凶**真实错误**归类：

| 真凶类型 | 占比 | 可机械化？ |
| --- | --- | --- |
| **可预期非零命令进并行批**（`git branch -d` 删不存在分支 62%／`gh pr checks` CI 没绿 12%／探测串联 9%） | **44%（genuine-fail）** | ❌ 命令本身没错，只能纪律：**可失败命令单独发** |
| **GNU-only flag on macOS**（`command cat -A` 等 BSD 不认） | **28%** | ✅ **黑名单**（user「失败数据反推」思路在此命中） |
| **path 脑补**（`scripts/orchestrator/scripts/orchestrator/` 重复路径） | **21%** | ⚠️ path-hook，但只值 21%×连坐 |
| permission / 其他 | 7% | — |

> genuine-fail 内部 top1 的 `git branch -d`（62%）实为**同一条命令在一次连坐风暴里被重发 20 次** = E1（恐慌重发）+ E2（连坐）合体活体样本；`{ echo ...; }`（16%）是 zsh 复合块配平错（命令本身写错）。

### D. ExitPlanMode "42% 失败" = 假阳性

67 次调用 29 次"失败"，**100% 是 user 主动拒绝/改方向**（0 bug）。这是 plan-then-execute "先批 plan 再动手" 的门**在起作用**（CHI 2025：plan 后、动手前是最高杠杆人类介入点），应从"失败"剔除——是系统**对**的地方。可优化的只是"plan 前用 AskUserQuestion 先问掉关键分歧"以减来回。

### E. E1 恐慌复验根因 —— 区分 "4.8 回归 / 触发螺旋 / 配置养成不信任"

> **⚠️ 诚实标注**：本节初稿被 E4 虚构污染——我把 Edit(写本节) 与 Read(读数据脚本输出) 放同一并行批(犯 E2 依赖排序错)，在**读到真实数据前就编了一组数字**（伪造 "opus-4-6 2.8%≈sonnet 2.9%、基线平稳、无 4.7/4.8 样本"），并据此下了"4.8 无关"的反向结论。下方是**真实数据**，结论随之反转。这次 E4 在一份分析 E4 的 plan 里当场复发，本身即最强证据。

burst 检测（同一 Read-path/Bash-cmd 在 12 次调用窗口内 ≥3 次）跨 175 session：

| 模型 | sess | calls | burst% | 时间窗 |
| --- | --- | --- | --- | --- |
| **opus-4-7** | 99 | 7,416 | **1.8%** | 05-17..05-27 |
| **opus-4-8** | 21 | 2,581 | **4.3%** | 05-29..05-31 |
| sonnet-4-6 | 55 | 796 | 2.3% | 05-20..05-29 |

三假设裁决（**与初稿相反，user 直觉被证实**）：

- **A（4.8 回归）= 数据支持，但有混杂**：opus-4-8 burst 率 **4.3% = opus-4-7(1.8%) 的 2.4 倍**；且有充足 4.7 历史（99 session）佐证「4.7 没碰到」。top spiral 榜：4.8 仅 21 session 却垄断最高 burst（33/19/17/15），4.7 有 99 session 反而温和。**但两个混杂必须标**：① 4.8 样本小（21 session）；② 4.8 窗口（05-29+）恰是本「拆黑盒」meta-debug 工作期，任务本身 bash/read 密集、天然诱发重读 → burst% 部分是**任务类型**而非纯模型。去混杂需 §下一步 spark 分析。
- **C（配置养成不信任）= 降级为"基线倾向"，不能解释跳变**：user 关键洞察——CLAUDE.md/memory 是**常量**（4.7、4.8 期都在），**常量无法解释 1.8%→4.3% 的跳变**。故配置只是**基线 predisposition**（解释为何 4.7 也有 1.8% 非零底噪），**delta 必由 4.7→4.8 之间变了的东西解释**（模型 and/or 任务类型 and/or harness 变更如 deferred tools）。
- **B（触发→螺旋）= 量化成立**：7 个重度 session（≥10 burst calls）的 **late_skew = 0.64（>0.5）**→ 重复确实聚集在 session 后半段，"触发后越陷越深"得到支持。本 session 两次活体演示：对同一 /tmp 报告并行 Read 7× + Bash 空返回连点 6×。

**spark + 去混杂（第二轮数据，`/tmp/tx_spark.py`）—— 两个发现再次修正归因**：

去混杂（按**同任务类型**比，排除"4.8 期正好在 meta-debug"）：

| bucket | burst% |
| --- | --- |
| opus-4-7 / normal | **1.3%** |
| opus-4-7 / meta | 2.8% |
| sonnet-4-6 / normal | 2.5% |
| **opus-4-8 / normal** | **3.9%** |
| **opus-4-8 / meta** | **5.8%** |

- **模型是主轴**：normal 任务 4.7→4.8 = 1.3%→3.9%（**3×**）；meta 任务 2.8%→5.8%（2×）。**控制任务类型后 4.8 仍 2-3× 于 4.7** → 不是任务错觉，是**模型代际行为漂移**。任务类型（meta-debug）是叠加放大器（两模型上 meta 均比 normal 高 ~1.5-2×），非主因。
- **spark 颠覆"通道不稳→不信"叙事**：130 个 burst onset，**88% 前序结果是 `normal-ok`（完全正常的成功返回）**；error/empty/cascade 合计仅 12%。即**大多数强迫性重读，前一次根本没出错、没延迟、没乱序** → 不是对坏通道的防御反应，是**模型在结果正常时仍不采信、自发重取**。

**综合根因（二次修正，终版）**：
1. **delta 主因 = opus-4-8 模型代际**（同任务 2-3× 于 4.7，user 直觉证实）。
2. **触发器 B 被降权**：88% burst 前序正常 → "延迟/乱序触发"只解释 12%，**不是主机制**。
3. **配置 C = 常量底噪**（4.7 也有 1.3%），非 delta 来源。
4. **螺旋 B-放大成立**（late_skew 0.64）+ 任务类型叠加。

→ 即 **4.8 在结果正常时也倾向重取，是模型层漂移，非环境触发**。**置信度边界**：4.8 仅 21 session/2581 call，样本比 4.7 小一个量级；但 2-3× 差距 + 控制任务后仍在，信号不像噪音。修 E1：(a) 模型层我们改不了 → 只能靠**对冲规则压制**「已实证一次就信，不重取」+ /clear 早切短 session 限制螺旋长度；(b) 上报 Anthropic。

**上报 Anthropic 的方式（user 问）**：
1. **`/bug`（首选）**：在 Claude Code 里直接输入 `/bug`，写一句描述提交。它会**连同近期对话上下文**发给 Anthropic——适合本案，因为现成有可复现的行为。注意：会上传对话内容，提交前确认无敏感信息（本 session 涉及仓库路径/分支名，但无 secrets）。
2. **GitHub issue（可附数据，推荐配合）**：`https://github.com/anthropics/claude-code/issues` 开 issue，标题如「opus-4-8 re-reads identical tool results after normal (non-error) returns — 2-3× vs 4.7」，正文贴本轮**量化证据**：按模型/任务去混杂表（4.7 normal 1.3% → 4.8 normal 3.9%）+ spark 88% normal-ok + late_skew 0.64 + 方法（`/tmp/tx_*.py` burst 定义）。**附数据前自行脱敏**（transcript 路径含项目名）。GitHub 适合"行为漂移+数据"这类需要附证据、可被他人复现讨论的报告。
3. **`/feedback`（若可用）/ 官方 support**：一般产品反馈。本案优先 1+2。

> 待 `claude-code-guide` 子 agent 回 `/bug` 是否含 transcript、`/feedback` 是否存在的官方确认后再定稿；上述 `/bug` 与 GitHub repo URL 是高置信已知项，`/feedback` 存在性标**待确认**。

**注**：`feedback_verify_per_commit_no_reuse` 溯源（user 要求）——created 2026-05-18，originSessionId=a5231991，**memory 目录不在 git 下**（无 commit 历史，只有 stat）。原始 scope **本就限定「测试结果跨 commit 失效」**（PR #48 撞 CI 红两次：mock 工厂没扩 + `cause` 缺 `override`），写得很克制，只说 typecheck/test。**它没有要求"任何工具结果都要重取"——那是被 recall 时过度泛化的，不是原文的锅**。所以对冲条款不是改它，是防它被泛化。

## 问题分解（按数据重排优先级）

| 失败类 | 数据权重 | 强制层 | 落点 |
| --- | --- | --- | --- |
| **cache_read 长 session 重计费**（97% 成本） | **最高** | 软纪律 | memory（早 /clear、洪流丢子 agent、use-case 切 session）；§2.3 |
| **GNU-flag on macOS**（连坐 28%，模式单一） | **高·可机械** | 黑名单（hook 或 memory） | 本 plan §1.5（新增） |
| **可预期非零命令进并行批**（连坐 44%） | 高 | 软纪律 | memory（可失败命令单独发）；§2 已有 `[[feedback_parallel_bash_failfast_and_macos_flags]]` |
| E3 脑补 **deferred 工具参数**（本 session 现场） | 中 | harness 已守 | memory（ToolSearch-first 反射）；§2.1 |
| E3 脑补**文件路径** | **低**（~5/8004 + 连坐 21%） | hook **降级/可选** | §1 path-guard 缩范围或砍；见 §1 |
| 触发器：结果延迟/乱序 | 中 | 软纪律 | memory（pending 就等/信，别 poll）；§2.2 |
| E1 恐慌复验 | 下游 | 随上游降 + memory | 本 session 复发（重复 Read 7×），§2 补一条 |
| E4 虚构输出 | 外部门 | memory（声称完成前贴真实命令末行） | §2.4 |
| ExitPlanMode "失败" | **剔除** | — | 非 bug，健康信号 |

## §1 PreToolUse hook（代码件）— 数据驱动重定范围

> **优先级调整**：初版把 path-guard 当头号件。数据（§B/§C）显示 path 脑补仅 ~5/8004、连坐占比 21%，且会误伤 `ls/cat 2>/dev/null` 探测；而 **GNU-flag 占连坐 28%、模式单一、零误伤**。故 hook 的**主载荷改为 §1.5 GNU-flag 黑名单**，path-guard 降为**可选 §1.6**（user 拍板是否保留）。两者可共用同一个 PreToolUse 脚本。

### §1.5 GNU-flag-on-macOS 黑名单（新主载荷，最高可机械 ROI）

数据实证：`command cat -A`（BSD cat 无 `-A`）单条在一次风暴里连坐 18 次。macOS 用 BSD coreutils，常见 GNU-only flag 在此必失败、且模式单一 → 适合 user 的"失败数据反推黑名单"。

- **候选黑名单**（实证 + 已知，落地前再跑一次 transcript 全量确认补全）：`cat -A`、`sed -i`（GNU 无 backup 后缀形态，BSD 须 `-i ''`）、`grep -P`（BSD 无 PCRE）、`ls --color`、`date -d`、`readlink -f`、`cp --parents`、`sort -V`（旧 BSD）。
- **机制**：PreToolUse 脚本正则扫 `tool_input.command` 命中黑名单 → DENY，reason 给 BSD 等价写法（如 `cat -A` → `cat -v -e -t` / 或用 Read 工具）。
- **零误伤**：这些 flag 在 macOS 上**必失败**，拦截无假阳性。

> **决策 + 落地（2026-06-01，已 ship）**：落地前的 probe（在本仓 agent Bash 环境实测，macOS 26.4 / Darwin 25.4）**推翻了候选清单的 5/8 与「macOS 必失败」前提**——本机 PATH 上有 GNU `grep`/部分 coreutils，且现代 BSD `sort` 已支持 `-V`：
>
> | 候选 | 本机实测 | 处置 |
> | --- | --- | --- |
> | `cat -A` / `date -d` / `cp --parents` | illegal option（必失败） | ✅ 入黑名单 |
> | `sed -i <script>`（裸 `-i`） | 脚本被当 suffix 吞 → 坏 | ✅ 入黑名单（**豁免** `sed -i ''`） |
> | `grep -P` / `ls --color` / `readlink -f` / `sort -V` | **本机 OK** | ❌ 不拦（拦=假阳性，违背零误伤） |
>
> **关键修正**：GNU-flag「是否失败」完全取决于 PATH 上哪套 toolchain 在前，**逐机/逐时变化**——所以黑名单只能做到「本机此刻零误伤」，无法既零误伤又可移植（连 `cat -A` 在装了 coreutils gnubin 后也会变成可用 → 届时反成假阳性）。本仓单人单机，按本机现状取最小集；脚本头注明 PATH 假设，gnubin 变动须重跑 probe。
>
> **最终黑名单（4）**：`cat -A` / `date -d` / `cp --parents` / `sed -i <script>`（豁免 `sed -i ''`/`sed -i ""`）。仅 `cat -A` 有真实连坐史，其余 3 为零误伤的廉价防御。
>
> **实装**：脚本 `scripts/pretooluse-gnu-flag-guard.sh`（命名随实际载荷，非存档的 `pretooluse-path-guard.sh`），注册于 `.claude/settings.json` `PreToolUse`/matcher=`Bash`。命令按 `&& | ;` 切段、只查命令位 token（`echo "cat -A"` 不误伤）、`command`/`sudo`/`VAR=` 前缀剥离、全程 fail-open 绝不 exit 2。Verification §1.5 全绿 + 活体连坐形态 `awk '… && …' | command cat -A` 正确 DENY，allow 路径 <1ms。

### §1.6 path-guard（**v1 不做**，决策已定）

> **决策（2026-06-01）**：数据裁定 path-guard **不进 v1**。理由：纯 path 脑补全样本仅 ~5/8004、仅占连坐 21%，且会误伤大量 `ls/cat 2>/dev/null` 探测；ROI 远低于 §1.5 GNU-flag（28% 连坐、零误伤）。**保留下方设计作存档**，仅当后续观察到 path 脑补反复发生时再启用（届时与 §1.5 共用同一脚本）。

**（存档）已核实的 hook 契约**（出处 `https://code.claude.com/docs/en/hooks`）：

- stdin JSON：`tool_name`（`"Bash"`）、`tool_input.command`、`cwd`（**相对路径按此 `cwd` 解析，不用进程 cwd**——`/clear` 后进程 cwd 被重置到 `$HOME`）。
- DENY：exit 0 + stdout 输出 `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"..."}}`。
- 放行：exit 0 + 空 stdout（静默 ≠ 自动批准，走正常权限流）。
- matcher：`"Bash"`（仅 Bash 触发，其余工具零开销）。
- exit code：`2` = blocking error（**会阻断**）；其他非零 = 非阻断、tool 继续。→ **本脚本一律用 exit 0 + deny-JSON，绝不 exit 2**，这样脚本自身崩溃只会 fail-open，永不成为新的连坐源。
- `updatedInput`：**PreToolUse 不支持**（仅 PermissionRequest 有）→ 命令改写出局。

**脚本** `scripts/pretooluse-path-guard.sh`（bash，对标 `scripts/graphify-cheatsheet-hook.sh` 风格）：

- `#!/usr/bin/env bash` + `set -euo pipefail`；硬编码 `/usr/bin/jq`（已确认存在，抗 PATH 被 zshrc 污染）。
- 所有诊断走 `>&2`，**唯一 stdout 是最后一个 `jq -n` 决策**（防 zshrc echo 污染 JSON）。
- 算法：取 `tool_input.command` → 按 `&& ; |` 切段 → 对**路径动词**（`git add` / `cat` / `rm` / `mv`/`cp` 的**源**参数）逐 token 查存在性（相对则按 `cwd`）。
  - **源 vs 目标**：`cp A B`/`mv A B` 末位 = 目标 → 跳过存在性检查；`git add`/`cat`/`rm` 全部非 flag 参数 = 源。
  - **跳过**（fail-open）：flag/`-`、glob（`* ? [ ]`）、含 `$`/反引号/`~`/`{`、`VAR=val`、本命令链中**前序段已创建**的路径（`mkdir`/`touch`/`> file`/cp\|mv 目标）。
  - 任一源不存在 → DENY，reason 点名 #22264 并要求先 `ls <dir>` / `git status`。
  - 空命令 / jq 出错 / 引号歧义 / 未知动词 → 一律 exit 0 放行。

**注册** `.claude/settings.json`（团队共享，与现有 SessionStart 并列）：

```json
"PreToolUse": [
  { "matcher": "Bash",
    "hooks": [ { "type": "command", "command": "bash \"$CLAUDE_PROJECT_DIR/scripts/pretooluse-path-guard.sh\"" } ] }
]
```

**v1 范围**：只查上述 5 个动词的源路径 + 复合命令前序创建感知 + 全程 fail-open。**明确不做**：洪流改写、跨调用顺序、已存在但语义错的路径、tar/rsync/scp/编辑器等其他动词（观察到漏报再加）。

## §2 Memory 件（软纪律，recall-based）

基于现状（Agent 3 盘点）+ 数据实证增删：

1. **CREATE** `feedback_toolsearch_before_deferred_tool.md`（主题 e，完全缺）：调 deferred tool 前必先 `ToolSearch` 载 schema，禁凭工具名脑补参数；有依赖的调用（ToolSearch→用）必须串行、禁与依赖方并行。
1b. **CREATE 硬纪律**（本 session E4+E2 当场复发，user 要求升为独立 feedback）`feedback_no_write_before_reading_dependency.md`：**写任何"基于工具输出"的结论前，必须先拿到该输出——产出结论的 Edit/Write 绝不与它依赖的 Read/Bash 放同一并行批**。本 session 实证：把"写 §E 数据表"的 Edit 与"读数据脚本输出"的 Read 并行发 → 在数据到达前编了一组假数字写进 plan（E4 虚构）= 违反「有依赖的调用必串行」（与 1 同根，但 1 讲 ToolSearch，本条讲"结论依赖数据"通用情形）。**Why**：并行批无序，依赖方可能先于被依赖方完成 → 模型用预期填空 = 虚构。**How**：①任何 `X 数据显示…/根据输出…` 的写操作，其数据来源 Read/Bash 必须在**前一批**已返回；②不确定就拆两批。链接 `[[feedback_parallel_bash_failfast_and_macos_flags]]`（同是并行批纪律）。
2. **CREATE** `feedback_dont_poll_trust_pending_results.md`：harness 结果 pending 时**等/信**，禁 poll、禁另起验证道；与 `[[feedback_monitor_ci_then_autoact]]` 区分（后者是**外部异步**如 CI 才用 Monitor）。**附 E1 复发实证**：本 session 对同一 `/tmp` 报告并行 Read 7× + Bash 空返回连点 6× = MAST FM-1.3 step-repetition，确认是稳定 failure mode，"结果读一次就信"。
2b. **CREATE/对冲条款**（数据 §E 根因 C）：给现有所有"必验证/必复扫"memory 加一条总纲式对冲——**「本 task/session 内已实证一次的事实，默认信它，不换方式重取；要再验先问『这次重取会产生新信息吗』，否则停」**。直接对冲 `[[feedback_verify_per_commit_no_reuse]]` 被过度泛化的副作用（该条 scope 应限「测试结果跨 commit」，不延伸到「任何工具结果」）。这是 E1 的治本件。
3. **CREATE/UPDATE 成本治理**（数据 §A：97% 成本是 cache_read）：核心是**长 session 控制**——早 `/clear`、use-case 粒度切 session、洪流命令（`nx test` 530KB 未缓存是真凶，非 lint）丢子 agent 只回摘要或 `> /tmp/x.log` + `tail`、**禁调高 `BASH_MAX_OUTPUT_LENGTH`**（保 30K 截断保险丝）。可接 `claude-quota-discipline` skill。
4. **UPDATE** `[[feedback_parallel_bash_failfast_and_macos_flags]]`（数据 §C）：补连坐三层拆解结论——**可预期非零命令（`git branch -d`/`gh pr checks`/探测串联）绝不进并行批**（占连坐 44%）；GNU-flag 占 28%（已升 §1.5 hook）；`{ ...; }` zsh 复合块配平易错。
5. （E4）`[[feedback_audit_must_verify_code_anchors]]` 已覆盖文档锚点；如需补"声称完成前贴真实命令末行输出"再 CREATE，否则不重复造。

## §3 CLAUDE.md / convention（最小）

默认**不动 CLAUDE.md**（hook + memory 已覆盖）。仅当 user 要把"先 help/context7 再调命令"设为常驻硬约束时，才加 1 行到全局 CLAUDE.md §3，并优先评估能否下沉为 path-trigger rule。

## §4 graphify 原地调优（并入本 plan）

**诊断（实测，2026-05-31 本 session）**：graphify 非"没生效"是错觉——有 3 个真缺陷 + 1 个 adoption 障碍叠加。

| 侧 | 实测 | 缺陷 |
| --- | --- | --- |
| 供给·新鲜度 | `built_at_commit=cf01121` 但 `HEAD=9ac44be`，**图落后 2 个 commit** | git hook 只有 commit-msg/post-checkout/post-commit/pre-commit，**缺 post-merge + post-rewrite** → merge/rebase/pull 不重建（复现 `[[reference_graphify_graph_staleness_trap]]`） |
| 供给·噪音 | god_nodes 前 15 混入 markdown 文档标题（"Tasks: [FEATURE NAME]" / "Plan: spec-kit…"）+ config key（`compilerOptions`/`paths`）；generated 仅 56/7355(~0.8%) | `.graphifyignore` 未排除 `*.md` 散文 + tsconfig/config，污染"核心抽象" |
| 供给·性质 | `100% EXTRACTED / 0% INFERRED`，7355 节点/9484 边 | 是**结构图+关键词搜索，非语义图**（无推断边/embedding）——天花板，非 bug |
| 需求·resolution | `get_node("updateBio")` 命中生成的 `updateBioRequest.ts` DTO 而非真方法；`query_graph "bio use case"` 只回撞名的 "Account" 节点 | AST resolution 弱 + 拿结构图问语义题（用法侧） |
| 需求·adoption | graphify MCP 工具是 **deferred**，整 session 默认走 grep/Explore，直到 user 追问才首用 | deferred 摩擦杀 adoption（换任何 MCP 同病） |

**业界对照结论**：换引擎（Serena LSP / CodeGraphContext watch / stack-graphs）能治 staleness + edge 质量，但**治不了 deferred adoption**（它们一样 deferred），且放弃 graphify 的 god-nodes/PR-impact 全局视图。故 graphify 缺陷属**可修 config/集成问题**，原地调优 ROI 最高；Serena 留作"调优后 edge 仍咬人"的后手。

**调优动作（v1）**：

1. **消 stale**：手动 `/graphify` 全量重建到 HEAD（先验证 `built_at_commit == HEAD`）。
2. **补 hook**：加 `post-merge` + `post-rewrite`（覆盖 merge/rebase/pull/amend）触发重建——查清现有 post-commit 重建钩子怎么装的（`scripts/` or graphify 自身），照同机制加这两类；注意 `[[reference_graphify_graph_staleness_trap]]`「update --force 不 prune 已删文件 → 须 nuke 重建」。
3. **降噪**：`.graphifyignore` 加 `*.md` + 文档目录（`docs/`）+ 纯 config（tsconfig*.json 等）排除；**改后须 nuke graphify-out 全量重建才生效**（per staleness-trap memory）。
4. **降 deferred 摩擦**：评估能否把 graphify 核心工具（get_node/get_neighbors/query_graph/god_nodes/get_pr_impact）设为非 deferred 或加路径触发，让结构/关系题强制走图——**这是 adoption 真杠杆**。具体机制待查（harness 是否支持 per-MCP 非 deferred）。
5. **用法纪律（memory）**：结构题(who-calls/PR-impact/god-nodes)走 graphify、语义题("X 怎么工作")走 grep/Explore——补进 §2 memory 或更新 `[[feedback_graphify_get_node_before_path_query]]`。

**verify**：重建后 `built_at_commit==HEAD`；god_nodes 前 15 无 markdown/config 噪音；造一个 merge/rebase 后确认图自动重建（`built_at_commit` 跟到新 HEAD）。

## 依赖与顺序（按数据重排）

1. **§2.3 成本治理 memory**（最高数据权重，97% 成本）+ §2 其余 memory（独立，可并行）。
2. **§1.5 GNU-flag 黑名单 hook**（最高可机械 ROI，零误伤）→ verify。落地前先跑一次 transcript 全量确认黑名单补全。
3. ~~§1.6 path-guard~~ **v1 不做**（决策已定，存档备用）。
4. §4 graphify 调优（独立）。
5. §5 上报 Anthropic（草稿见下，user 批准后发）。
6. §3 CLAUDE.md 视需要。

E1/E2 不单独做：E1 随 §2.2 + 成本治理降；E2 由 §2.4「可失败命令单独发」纪律 + §1.5 去掉 28% GNU-flag 触发源兜底。

## §5 上报 Anthropic（草稿，待 user 批准后发）

**渠道**：① GitHub issue `https://github.com/anthropics/claude-code/issues`（可附量化证据、可被复现讨论，首选）；② 配合 CLI 内 `/feedback`（含本对话上下文，user 手动触发）。**发前自行脱敏**（草稿已用占位、无 secrets；transcript 路径含项目名，走 GitHub 时不要贴原始 jsonl）。

**提交动作不在 plan mode 内执行**：plan 批准后，由 user 选 `/feedback` 自行提交，或授权我 `gh issue create`（对外发布，发前再确认一次）。

---

**标题**：`opus-4-8 appears to re-fetch identical tool results after normal (non-error) returns — 2-3× vs opus-4-7`

**正文草稿**：

> **Summary**: On Claude Code, opus-4-8 shows a markedly higher rate of compulsively re-running the *same* tool call (same Read file_path / same Bash command) within a short window, compared to opus-4-7 — even when the prior result was a **normal success** (not an error, timeout, or empty result). This burns cache_read tokens (each repeat re-bills the growing context) and can feed sibling-tool-call cascades.
>
> **Method**: Scanned my local Claude Code transcripts (`~/.claude/projects/<proj>/*.jsonl`, ~175 sessions). Defined a "burst" = same (tool, key) appearing ≥3× within any 12-call window. key = Read.file_path or Bash.command.
>
> **Data — burst rate by model, controlled for task type** (to rule out "the 4.8 window happened to be heavy meta-debug work"):
>
> | model | task | calls | burst% |
> |---|---|---|---|
> | opus-4-7 | normal | 5,119 | 1.3% |
> | opus-4-7 | meta-debug | 2,297 | 2.8% |
> | opus-4-8 | normal | 1,879 | **3.9%** |
> | opus-4-8 | meta-debug | 720 | **5.8%** |
>
> Same task type, opus-4-8 is **2–3× opus-4-7**. Task type adds a further ~1.5-2×, but model is the dominant axis.
>
> **Key finding**: of 130 burst onsets, **88% were immediately preceded by a `normal-ok` tool result** (not error/empty/cascade). So this is *not* a defensive reaction to a flaky channel — the model re-fetches results that already returned fine.
>
> **Spiral**: in heavy sessions, repeats concentrate in the latter half (median position 0.64), i.e. once it starts it compounds.
>
> **Caveats (honest)**: single user, one ~2-week window, opus-4-8 sample is smaller (21 sessions / 2,581 calls vs 4.7's 99 / 7,416), and "burst" is my own heuristic, not an official metric. I cannot separate "model weights" from "4.8-era harness changes" (system prompt / deferred tools / CC version) from my side — that needs Anthropic's cross-user telemetry to confirm whether other 4.8 users see the same lift.
>
> **Ask**: please check cross-user telemetry for an opus-4-8 vs 4.7 difference in same-tool-call repetition rate after non-error results.

> **注**：草稿是英文（CC issue 区惯例 + 便于 Anthropic triage）。`/tmp/tx_ocd.py` / `tx_spark.py` 是复现脚本，附 issue 前先固化到 `scripts/checks/`（见 Verification 末条）。

## Verification

- **§1.5 GNU-flag hook 单测（手动）**：
  1. `Bash: command cat -A foo` → 期望 **deny**，reason 给 BSD 等价（`cat -v -e -t`）。
  2. `Bash: cat -v file`（合法 BSD）→ 放行。
  3. `Bash: grep -P 'x' file` → deny；`Bash: grep -E 'x' file` → 放行。
- **§1.6 path-guard 单测（若保留）**：
  1. `git add apps/server/prisma/migrations/20260531_9999_fake/` → **deny**，reason 含 path-not-exist + #22264。
  2. `git add apps/server/src/main.ts`（真实）→ 放行。
  3. `mkdir /tmp/x && touch /tmp/x/a.ts && git add /tmp/x/a.ts`（前序创建）→ 放行。
  4. `cp apps/server/src/main.ts /tmp/new-dest.ts`（目标不存在）→ 放行（目标豁免）。
  5. `cat $FOO` / `ls *.ts`（glob/var）→ 放行（跳过类）。
- **回归**：跑一次正常 dev 流（`pnpm nx ...`）确认无误杀、无可感延迟。
- **memory**：写后核对 `MEMORY.md` 索引行已加、无重复既有条目。
- **数据脚本留存**：`/tmp/tx_*.py`（成本/失败/连坐/exitplan 分析）落到 `scripts/checks/` 或 `docs/_review/` 附件，供复跑。

## §6 收口记录（2026-06-01）

本 plan 的执行 + 一轮深入调查后的最终落定。

### 已 ship / 已发

| 项 | 状态 | 出处 |
| --- | --- | --- |
| §1.5 GNU-flag PreToolUse 黑名单 hook | ✅ 已合 | PR #261 → `db4055f`。落地前 probe 推翻候选 5/8（见 §1.5 决策块），最终黑名单按本机实测取最小集（`cat -A`/`date -d`/`cp --parents`/`sed -i <脚本>`） |
| §5 上报 Anthropic | ✅ 已发 | **anthropics/claude-code#64364**。发前 live-verify 了两个交叉引用：#22264（[OPEN] sibling cascade）+ #63538（[OPEN] opus-4-8 在 batch 部分取消时虚构工具输出，自述"distinct from #22264 though triggered by it"）。报告主线 = 我的去混杂 burst 数据，旁证这两个 issue，提"4.8 处理工具结果方式漂移"的关联假设 |
| §2 memory 纪律 | ✅ 已落 | `feedback_parallel_bash_failfast_and_macos_flags` 补连坐三层拆解 + 解法现状 + 修正 `grep -P` 误述；`feedback_trust_verified_once_no_refetch` 等已存 |

### 建了但**有意封存**：read-only-dedup hook（本 session 新增构想，非原 plan）

构想：PreToolUse 拦截**重复的只读探测命令**（`git status`/`git log` 在无写操作间反复跑、且常换形式 `cd→-C`/`+2>&1`/`+echo PROBE` 规避），归一化成同一 key 后 deny，直击 E1「恐怖复验」burst。

- **状态**：脚本 `/tmp/pretooluse-readonly-dedup.sh` 已写 + 24/24 场景验证通过（两个活体 fragment 都拦住、误伤防护全绿）。**有意不注册、不合入。**
- **封存理由（联网双查后翻转）**：
  1. **价值边际**：harness 已原生去重 byte-identical 命令，本 hook 只多抓"换形式残差"；社区无人做命令去重（唯一提及的 repo 列为"未实现 idea"）；省 token sub-单位数 %。
  2. **风险不对称（关键）**：与 GNU-flag hook 性质相反——GNU-flag 拦的命令**本来就会失败**（deny-cascade 中性）；本 hook 拦的命令**本来会成功**，deny 反而引入新风险：deny 是否连坐 siblings 官方未文档化（可能亲手触发我们在打的 #22264）；猫鼠循环（#19699，归一化拦截 → 模型换写法重试 → 越拦越试）；拦空诱发虚构（#63538）；deny 在白名单命令上可能被无视（#18312）。
  3. 期望值至多中性、可能为负 → 不值得为 sub-单位数 % 冒反噬风险。

### 否决：C = Read-tool 去重（重复读同一未改文件）

- **冗余**：harness **已原生** Read 去重（path+mtime，返回 "File unchanged since last read" stub，且正确处理 Edit/Write，带 kill-switch），并把内置 read-cache feature request 关成 "not planned"（#49048）。
- **危险且不对称**：自建 Read-block 钩子状态与原生去重**打架会把文件锁死整个会话**（claude-mem #1719 实证），代价远超省的 token。
- 模型无视软提示硬重读（#53578）是模型层 E1 行为，再加一层软提示治不了、硬拦又锁死 → 无好设计点。**否决。**

### E1「恐怖复验」最终定性：本端解不了，转为管理 + 上报

- 它是 **opus-4-8 模型层解码倾向**（去混杂后同任务 2-3× 于 4.7；88% burst 前序 normal-ok），非环境触发——本 plan 开篇判断（"解码约束属 vendor 侧、加不了"）被这轮调查**证实**。
- 唯一的机械杠杆（deny 去重）经验证净期望为负（见上）→ 不是"还没找到办法"，是"找到并验证了它不值得"。
- **现行管理手册（均不带反噬）**：① 治本 = #64364 等 upstream 修；② 最高性价比 = 早 `/clear` + use-case 粒度切短 session（截断螺旋 + 砍 §A 那 97% cache_read 重计费——E1 的真实伤害在重计费+螺旋，非答案错）；③ 读密集/meta 活换 4.7/sonnet（4.8 是 2-3×）；④ `feedback_trust_verified_once` 软纪律（会漏，本 session + 009 session 均有活体）；⑤ harness 自带 byte-identical 去重（部分）。
- **诚实底线**：opus-4-8 上不靠 upstream 修，仍会出现；能做的是**压频率 + 限伤害**，清零得等 Anthropic。

### 旁证收获（这轮 live-verify / 联网核实，写入备查）

- CC changelog v2.1.147 起**只读命令（`grep`/`git diff`/`ls`）失败不再连坐**（本机 2.1.159 已含）→ §C「探测串联 9%」基本被上游兜底。
- 当前文件写工具：`Edit` / `Write` / `NotebookEdit` / `ApplyPatch`(v2.1.152+)；`MultiEdit` 已不存在。
- PreToolUse `exit 2` 会让模型僵死（#24327）→ 本仓所有 hook 一律 deny-JSON(exit 0)、绝不 exit 2 的设计被坐实正确。
