# p2 — impl 双流质量对比实验（manual command vs orchestrator，both Sonnet）

> 隶属 [双流对齐 master](05-26-orchestrator-command-parity-master.md)。**依赖 p1**（orchestrator 能 parse 命令流 feature 才能跑）。impl 阶段才是真正的「双流」—— 同一份 `tasks.md`，两条 impl 流并行，找质量差异根因 + 把 orchestrator 优化到向 manual gold-standard 靠拢。

## 1. 目标（Why）

- impl 阶段是唯一真有两条执行流的地方：**manual `/speckit-implement`**（连续会话、全工具、closure 6 步 TDD）vs **orchestrator `--live`**（per-task 全新 `claude -p` 子进程、受限工具、verify+ralph 机械重试、独占 commit）。
- 用户预设过「auto-memory / convention 差异」，但实证已排除：`--bare` 已 drop（`llm-client.ts:213`），子进程**也加载 CLAUDE.md + auto-memory + path-rules**。真正差异在**结构**（见 §3）。
- 必须先控住 model 这个混淆变量，否则质量差分不清是「流结构」还是「Sonnet vs Opus」。

## 2. 实验控制（方法论：ablation —— 先齐后变）

差异分「可控变量（pin 成相同）」与「不可约结构变量（要研究的）」。**先把所有可控变量 pin 成相同 → 测残差（归于不可约结构）→ 再逐个放回可控变量测增量归因**。（用户 2026-05-26：MCP + allowedTools 也尽量 pin 相同减混淆；但工具差异**本身可能是质量差的一个因**——manual 有 graphify-MCP/全 bash、orchestrator 白名单内无——所以不是「永远 pin 掉」，而是 baseline pin、ablation 时放回测其贡献。）

**A. 可控变量（baseline pin 成相同）**

| 变量 | pin 法 |
|---|---|
| model | 两臂 Sonnet |
| **allowedTools** | 两臂同一白名单（默认取 orchestrator 现集 `Read,Edit,Write,Bash(pnpm *),Bash(git *),Glob,Grep`） |
| **MCP** | 两臂同款 —— baseline 都不挂 graphify-MCP；code 上下文都走 orchestrator 预注入块，保证输入一致 |
| 输入 | 同一 `spec/plan/tasks`、同一 starting commit |
| turn/timeout | 尽量对齐（或都放宽到不触顶） |

**B. 不可约结构变量（baseline 残差归因于此）**

| 变量 | orchestrator | manual |
|---|---|---|
| 执行单元 | per-task 全新 `claude -p` 子进程（无跨 task 记忆） | 单次跑全 feature（连续上下文） |
| prompt 交付 | buildPrompt 预切片（traced US/FR/SC + 架构 notes + graphify 子图） | 自读全 spec/plan/tasks 自决相关性 |
| TDD 机制 | verify + ralph 机械重试 | closure 6 步语义 TDD |
| commit 归属 | orchestrator 独占 | agent 自提 |

**C. ablation 臂（baseline 后逐个放回可控变量测增量）**：如两臂都加 graphify-MCP + 全 bash（测工具贡献）、manual 也改 per-task 子进程（测会话连续性贡献）等。

> manual 流是 **gold-standard 参照**；目标不是分胜负，是找 orchestrator 相对 manual 的缺口根因 → 优化 orchestrator（修法可能恰是 ablation 验出的「放回某可控变量」，如补工具）。

## 2.1 两实验臂定义（both `claude -p` 同 flags + 都自治，2026-05-26 定）

为消 model + 工具 + human-in-loop 多混淆，**两臂都走 headless `claude -p` 同 flags**（model/allowedTools/MCP 天然一致），都自治零人工干预，只剩 §2-B 结构差异：

| 臂 | 怎么跑 |
|---|---|
| **orchestrator 臂** | `ORCHESTRATOR_MODEL=sonnet pnpm orchestrate <feature> --live`（内部以 §2-A 的 flags 起 per-task `claude -p`） |
| **manual 臂** | headless `claude -p --model sonnet --allowedTools <同 orchestrator> [--mcp-config <同>]`，给整个 feature + 指令走 `/speckit-implement`（自读、closure 6 步 TDD），**零人工干预**。`claude -p`（非 `--bare`）仍载 CLAUDE.md/memory/path-rules |
| （可选第三臂） | 交互式 human-in-loop Sonnet `/speckit-implement`，单独量化「人在环」增益 |

> 两臂去人在环 + 同 flags 是**故意的**：orchestrator 无人在环、tools 受限，留着差异会变成额外混淆变量。人/工具的增益用 §2-C ablation 臂单独测。

## 3. 对比维度（8 维，机械/半机械打分）

| 维度 | 测法 |
|---|---|
| 1 功能正确性 | IT/单测真绿 + 真满足 spec FR/SC（非「编译过」） |
| 2 规范符合度 | lint/typecheck/`check-server-moat`/affected-count/扁平贫血范式/api-contract/RHF 铁律 |
| 3 代码质量 | 过度设计(senior-eng test)/diff 最小性/命名风格一致/null·error 处理/复杂度注释 |
| 4 安全护栏遵守 | 反枚举折叠 / HMAC / AES-GCM / outbox 同 tx（p1/p2 烘焙精华是否真落地） |
| 5 过程成本 | token/cost、API turn 数、wall-clock、ralph 重试次数、人工干预次数 |
| 6 可靠性/可重复 | 同 task 重跑产出稳定吗、失败模式分布（max_turns/orphan/no-op/verify-red） |
| 7 commit 卫生 | 粒度、message 规范、`tasks.md [X]` 同步、是否误碰 whitelist 外文件（orphan） |
| 8 TDD 真实性 | 真红→绿（非写完直接绿）、测试本身质量 |

## 4. 实验设计（待细化）

1. **N 组模拟真实业务的 feature**（varied 复杂度）—— 单文件 use case / 多文件 + 并发护栏 / 含前端 RHF slice / 含 migration 等，覆盖不同 task kind。沿用 999 式 sacrificial 或挂真实待办 feature。
2. 每组：固定 starting commit → 两流各在独立 worktree 跑同一 `tasks.md` → 全程留痕。
3. **留痕**：orchestrator 走 `.spec-kit/runs/<feature>/`（已有 archive + NDJSON + run-report）；manual 流需等量记录（每 task prompt/diff/turn/cost/verify 结果）—— 设计一个 manual-flow 记录模板/脚本，保证两侧可比。
4. 逐 task + 整 feature 按 §3 八维打分（能机械的脚本化：lint/typecheck/moat/diff 行数/cost/turn 自动；质量/TDD 真实性人工 + rubric）。

## 5. 产出

- **根因**：哪些 §2 结构变量驱动了质量缺口（如「prompt 预切片丢了 manual 自读全 spec 的上下文」「per-task 无记忆导致跨 task 不一致」「ralph 机械重试不如 closure 语义 TDD」）。
- **orchestrator 优化项**（向 manual 靠拢）：可能含 prompt 注入更多 spec 上下文 / 跨 task 状态传递 / 放开关键工具 / TDD 机制改进 等，逐项可验证。
- 量化对比表 + 优化前后回归。

## 6. 开放问题（细化时定）

1. **manual 臂的留痕粒度**（关键工程点）：manual 臂走 `claude -p --output-format stream-json` → 与 orchestrator 同款 NDJSON，留痕天然可比；但它**一次跑全 feature**（单条流，无 per-task 边界），而 orchestrator 是 per-task 流 —— 怎么把 manual 单流按 task 切分对齐（按 commit / 文件 / 时间戳？），还是 manual 只做 feature 级、orchestrator 做 per-task + feature 级双对比？
2. N 取多少、选哪些 feature 类型才覆盖代表性 task kind（impl/gen/migration/test/前端）？
3. orchestrator 优化项落地后回灌 **guardrails p1/p2** 的 template/rule（双流共享底座闭环）的具体形态。
