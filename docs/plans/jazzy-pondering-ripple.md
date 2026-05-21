# Orchestrator observability — NDJSON stream + live phase narration

## Context

### PoC 核心目标：把 16 min 黑盒拆开看

`pnpm orchestrate --live` 跑 T031 实测 945s / 31 turn / $1.81 / 97% cache hit，UI 全程只有 `🧠 Claude (945s)` 计时器；archive 单 JSON 也是末尾才落盘。**没有任何诊断面**回答这三个问题：

| 诊断问题 | 现状（无法答） | NDJSON `--include-partial-messages` 给的独有信号 |
|---|---|---|
| **为什么 16 min？** | 只看到总时长 | `stream_event.thinking_delta` 实时滚 thinking 文本 → 看 LLM 在长想什么 / 卡哪 / 反复纠结 |
| **为什么 31 turn？** | 只看总 turn 数 | `stream_event.message_delta.stop_reason` per-turn 出 `tool_use / end_turn / max_tokens / pause_turn` → 直方图统计"反复 tool 循环 / 反复 max_tokens" |
| **cache 命中怎么样？** | 只有 result event 末尾累积 usage | `stream_event.message_start.usage` per-turn 出 `cache_read_input_tokens / cache_creation_input_tokens / input_tokens` → 算每 turn 命中率，识别"中途 cache 失效"那一 turn |

这 3 个独有信号**只有 `stream-json + --include-partial-messages` 这条路径才有**；不开 partial 时 claude-cli 只吐 11 个粗粒度 event（assistant / user / result），thinking 是 block 结束后才一次性给完整 text，per-turn stop_reason / usage 完全没有。

### 根因 vs 误判

不是 TTY 检测 fallback、不是 PR #59 之后的进度更新 bug、不是 archive 落盘漏洞。是 `claude -p --output-format json` 这条 spec 本身就承诺 "single result at end"。换 `--output-format stream-json` 是**用 claude-cli 显式承诺的稳定 API 切换数据源**，不是黑魔法。

已 spike 验证（`/tmp/orch-spike/out.jsonl` 32 行真实样本）：
- T031 推算约 1500 event / ~300 KB archive，可承担
- 4 个 result event 顶层字段（`is_error / subtype / num_turns / total_cost_usd / permission_denials[]`）和现 `extractClaudeMetrics` 完全对得上，metrics 抽取链路零改动

### Outcome

1. **Live UI**：Listr2 task row 实时滚 phase + 工具名 + thinking heartbeat（"🔧 Bash(ls /private/...) | 💭 The user wants me to..."）
2. **Diagnostic archive**：物理日志 `attempt-N-llm-stream.jsonl` 全量 NDJSON（jq 可查任意 turn 的 thinking / tool args / usage）
3. **`summary.json` per-turn 表**：`attempts[].llm.turns: [{stop_reason, output_tokens, cache_read_input_tokens, cache_creation_input_tokens}]` — 给 run-report + 未来 max_tokens 升级判定留数据底盘
4. **Bonus**：`system.init` event 自动归档本次 subprocess 的 MCP servers / tools / permissionMode（jq 一行验证"orchestrator 子进程到底拿到什么 MCP"）

## Approach

四个 user-locked 决策：
- **干到** — 全面换 stream-json，不保留 `outputFormat: 'json'` 后路
- **重命名** — `attempt-N-llm-stdout.log` → `attempt-N-llm-stream.jsonl`
- **Ralph 只保解析** — orphan-ralph / ralph-loop 不接 UI（这两条路径目前没 listr task surface 可接），但 parser 复用，自动拿到 NDJSON 解析 + 正确 metrics
- **summary.json 加 per-turn** — `attempts[].llm.turns: [{stop_reason, output_tokens, cache_read_input_tokens, cache_creation_input_tokens}]`

### 新文件：`scripts/orchestrator/llm-stream-parser.ts`

Pure-function NDJSON 解析层，零外部依赖、纯单元可测。

**导出**：
- `parseEventLine(line: string): StreamEvent | null` — 单行 JSON.parse，失败返 null（caller archive 原行 + warn）
- `class StreamAggregator` — 喂 event 流，状态机产出：
  - `mapToPhase(e: StreamEvent): { phrase: string; channel: 'phase' | 'heartbeat' } | null`
    - `system.init` → `🧠 Claude (model=sonnet)`（channel: phase）
    - `assistant.message.content[].type=thinking` → `💭 思考中`（phase）
    - `assistant.message.content[].type=tool_use{name, input}` → `🔧 ${name}(${input.command?.slice(0,40) ?? input.file_path ?? ''})`（phase）
    - `assistant.message.content[].type=text` → `✍️ 回复`（phase）
    - `user.message.content[0]={tool_result, is_error}` → `🔁 ${name} ${is_error?'failed':'ok'}`（phase）
    - `stream_event.event.delta.type=thinking_delta` → 取 `.thinking` 末 60 字符（channel: heartbeat）
    - `stream_event.event.delta.type=text_delta` → 取 `.text` 末 60 字符（heartbeat）
    - `result` → null（终态由 finalize() 处理）
  - `recordTurn(e)` —— 听 `stream_event.message_delta` 累 `turns[]`，每条 `{stop_reason, output_tokens, cache_*_input_tokens}`
  - `finalize(): { result?: ClaudeResultEvent; turns: TurnMetric[] }` —— 最终 result event 替代旧 `parsed`；turns 数组给 archive

### `llm-client.ts` 改动

- `LlmInvokeOptions` 删 `outputFormat`，**强制** stream-json
- `LlmInvokeOptions` 加 `onEvent?: (e: StreamEvent) => void` callback，每行解析后回调
- `buildClaudeArgs`（L149）固定 `--output-format stream-json`；加 `--include-partial-messages` 由 env `ORCHESTRATOR_PARTIAL_MESSAGES !== '0'` 决定（默认 on）
- spawn 块（L300-371）改：用 `readline.createInterface({ input: child.stdout })` 替代 `stdout += b`；每行：
  - 原行写 `opts.streamStdout`（archive 物理落盘不变形态）
  - `parseEventLine(line)` → `null` 跳过；否则 `agg.feed(e)` + `opts.onEvent?.(e)`
- `child.on('close')`：从 `agg.finalize()` 拿 `result` event，**替代** `JSON.parse(stdout)`
  - `isClaudeJsonError(result)` / `describeClaudeError(result)` / `isClaudeMaxTurnsError(result)` 全靠 result event 的现成字段（subtype / is_error / stop_reason），**0 改动**
  - `extractClaudeMetrics(result)`：现在的实现读 `permission_denials` 数组 + `.length` → 已经对得上 stream-json 末尾 result event 的形状（`permission_denials: []` 数组）✅ **无需改 extractClaudeMetrics**
  - `LlmInvokeResult.parsed` 改为 `result` event（同字段集，名字保留 `parsed` 不破坏 archive.ts 引用）
- `LlmInvokeResult` 新增 `turns: TurnMetric[]`

### `archive.ts` 改动

- `pathFor(n, 'llm-stdout.log')` 两处（L234 / L237 / L265 / L269）→ `'llm-stream.jsonl'` / `'llm-stderr.log'` 不变
- `LlmSummary` schema（L22-34）加：
  ```ts
  turns?: Array<{
    stop_reason?: string;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  }>;
  ```
- `copyMetrics()`（L338-345）顺带 copy `m.turns` 到 summary

### `run-feature.ts` 改动

- LLM invoke 调用（L403）加 `onEvent: makePhraseProjector(progress)`
- 新增 `makePhraseProjector(progress: ProgressSink)`：
  - 维护 `lastHeartbeatAt: number`
  - phase 类立即 `progress.update(phrase)`
  - heartbeat 类节流：与上次间隔 ≥ 500ms 才更新，且和当前 phase phrase 拼接成 `${phase} | ${heartbeat}`
  - 复用 progress.ts 现有 `lastPhase` dedup（PR #59 加的，进 stderr 也是去重 line）
- `startElapsedTimer` 保持不动（独立 phase channel，由 phrase 拼合后会被 listr2 显示器自然刷新）

### `run-report.ts` 改动

- `attempt-0-llm-stdout.log` 路径（L167）→ `'attempt-0-llm-stream.jsonl'`
- model 检测 regex（L170-172）改成读最后一行 `result` event 的 `modelUsage` keys（结构化更稳）
- TaskRow 不变；可选第二步加 `max_stop_reasons: string[]` 列显示 per-turn stop_reason 直方图

### `progress.ts` —— **不动**

PR #59 加的 `lastPhase` dedup + non-TTY stderr fallback 已经天然吸收高频 update。新 phrase 的拼接由 `run-feature.ts` 的 projector 决定。

### orphan-ralph.ts / ralph-loop.ts —— **不动**

它们 `llm.invoke` 时不传 `streamStdout` / `onEvent`，新 parser 在 llm-client 内部跑、结果照常返回 `LlmInvokeResult.parsed`。零 surface 改动。

### env override

| env | 默认 | 行为 |
|---|---|---|
| `ORCHESTRATOR_PARTIAL_MESSAGES` | `1` | `0` → 不加 `--include-partial-messages`；只拿 assistant/user/result 粗粒度 event，文件小 10×；UI 失去 thinking heartbeat |

## 关键文件 + 行号 cheat-sheet（执行时直接定位）

| 文件 | 改动点 | 行号 |
|---|---|---|
| `scripts/orchestrator/llm-client.ts` | LlmInvokeOptions 删 outputFormat 加 onEvent | L15-43 |
| | LlmInvokeResult 加 turns | L45-60 |
| | buildClaudeArgs 固定 stream-json + 条件 --include-partial-messages | L149-178 |
| | spawn 块改 readline | L300-371 |
| | child.close 改 agg.finalize() | L332-369 |
| `scripts/orchestrator/llm-stream-parser.ts` | **新文件** | — |
| `scripts/orchestrator/archive.ts` | pathFor 'llm-stdout.log' → 'llm-stream.jsonl' | L234 / L237 / L265 / L269 |
| | LlmSummary 加 turns 字段 | L22-34 |
| | copyMetrics copy turns | L338-345 |
| `scripts/orchestrator/run-feature.ts` | llm.invoke 加 onEvent + makePhraseProjector | L403-408 |
| | 新增 makePhraseProjector 函数 | new |
| `scripts/orchestrator/run-report.ts` | attempt-0-llm-stdout.log → llm-stream.jsonl | L167 |
| | model 检测改读末行 result event | L170-172 |
| `scripts/orchestrator/progress.ts` | **不动** | — |
| `scripts/orchestrator/orphan-ralph.ts` | **不动** | — |
| `scripts/orchestrator/ralph-loop.ts` | **不动** | — |

## 4 个关键发现的落点（之前提的，最终结论）

| 发现 | 落点 |
|---|---|
| **A. `permission_denials` 形状变了？** | 没变。claude-cli 两种 mode 都数组；llm-client.ts:234 已 `.length`。**0 改动**，spec fixture 保留数组形状即可 |
| **B. `--include-partial-messages` 默认开** | env-toggled 默认 on（核心 PoC 目标依赖此 flag 拿 thinking_delta / per-turn stop_reason / per-turn cache token 这 3 个独有信号）；`ORCHESTRATOR_PARTIAL_MESSAGES=0` 仅为兜底磁盘场景，关后 3 个诊断信号都丢 |
| **C. per-turn `stop_reason` 留底盘** | summary.json 新增 `attempts[].llm.turns[]`；run-report 可选加直方图列。源 = `stream_event.message_delta` |
| **D. MCP servers 从 `system.init` 顺手归档** | 此 PR 不强行加 `attempts[].llm.mcp_servers`（避免 schema 膨胀），留 jsonl 物理日志里 jq 可查 |

## 复用现有

- `progress.ts` 的 `lastPhase` dedup + non-TTY stderr fallback（PR #59）— phrase 拼合后**天然**被去重
- `llm-client.ts` 的 `extractClaudeMetrics / isClaudeJsonError / describeClaudeError / isClaudeMaxTurnsError`（L202-283）— 全部读 result event 现成字段，**0 改动**
- `archive.ts` 的 stream writer + finish() overwrite 双写（L226-272）— 对任何字节流通用
- `readline` Node 原生模块 — pure stdlib，splitter 不引第三方依赖

## 测试

### 新增

- `scripts/orchestrator/llm-stream-parser.spec.ts`
  - `parseEventLine`：合法 NDJSON 行解析 / 非法行返 null 不抛
  - `StreamAggregator.mapToPhase`：每种 event type 输出预期 phrase + channel
  - `StreamAggregator.recordTurn`：feed `message_delta` 序列后 `finalize().turns` 长度 + 字段
  - `StreamAggregator.finalize`：含 `result` event 时返回；未含时 result=undefined
  - 用 `/tmp/orch-spike/out.jsonl` 真实样本切几条做 fixture（不查 LLM 网络）

### 改

- `llm-client.spec.ts`
  - L270-283 `FULL_PAYLOAD` 替换为 NDJSON 字符串（一个 init / 一个 assistant tool_use / 一个 user tool_result / 一个 result）
  - L383-408 `FakeLlmClient` 返回 shape：`{ stdout: <ndjson string>, parsed: <last result event>, turns: [...] }`
  - 测 onEvent callback 被调用、被传 parsed event
- `archive.spec.ts` L53 / L112-119 / L220-297 — 字段名 `llm-stdout.log` → `llm-stream.jsonl`，fixture 字符串改 NDJSON
- `run-report.spec.ts` L39 / L87 / L123 — 写 attempt-0 fixture 改 .jsonl + model 检测断言走结构化

### 全栈 typecheck + test

```bash
pnpm -C scripts/orchestrator typecheck
pnpm -C scripts/orchestrator test --skip-nx-cache
```

## 验证 (end-to-end)

### 1. Spike fixture 验证（无 LLM）

```bash
# 已经存在 /tmp/orch-spike/out.jsonl (32 行真实 NDJSON)
# 写一个手动 driver 喂给 StreamAggregator，打印 phrases
node -e "import('./scripts/orchestrator/llm-stream-parser.ts').then(...)"
```

期待输出 phase 序列含 `🧠 Claude (model=...)` / `💭 思考中` / `🔧 Bash(ls /private...)` / `🔁 Bash ok` / `✍️ 回复`。

### 2. 真 live run — 跑 T032

```bash
pnpm orchestrate specs/002-account-profile --live --only T032 2>&1 | tee .spec-kit/runs/_console.live.log
```

观察（验收 PoC 核心目标 3 个独有信号都能产）：
- **UI**：`🧠 Claude` 不再呆 945s 静默；listr task line 持续滚 phase + thinking heartbeat
- **archive 在场**：`.spec-kit/runs/002-account-profile/T032/attempt-0-llm-stream.jsonl` 非 0 字节，行数 > 100
- **per-turn stop_reason 可查**（诊断"为什么 31 turn"）：
  ```bash
  jq -r 'select(.type=="stream_event" and .event.type=="message_delta") | .event.delta.stop_reason' \
    .spec-kit/runs/002-account-profile/T032/attempt-0-llm-stream.jsonl | sort | uniq -c
  ```
- **per-turn cache 命中可查**（诊断"cache 命中怎么样"）：
  ```bash
  jq -c 'select(.type=="stream_event" and .event.type=="message_start") | .event.message.usage' \
    .spec-kit/runs/002-account-profile/T032/attempt-0-llm-stream.jsonl
  ```
- **thinking 滚动可查**（诊断"为什么 16 min"）：
  ```bash
  jq -r 'select(.type=="stream_event" and .event.delta.type=="thinking_delta") | .event.delta.thinking' \
    .spec-kit/runs/002-account-profile/T032/attempt-0-llm-stream.jsonl
  ```
- **summary.json**：`attempts[0].llm.turns: [...]` 长度 ≥ num_turns - 1
- **回归**：run-report 总表照常出，cost / num_turns / permission_denials 数字与现状对齐

### 3. env off 路径验证

```bash
ORCHESTRATOR_PARTIAL_MESSAGES=0 pnpm orchestrate specs/002-account-profile --live --only T033
```

观察：jsonl 文件小 ~10×，UI 只剩 phase（无 thinking heartbeat），summary.json turns 数组依然在（基于 `assistant` event 也能间接获得，但 stop_reason 可能不完整 — 接受）。

## Out of scope

- ralph-loop / orphan-ralph 的 listr UI 接入 — 留独立 PR（需先设计两条路径在哪个 listr task surface 显示）
- run-report 直方图列（per-turn stop_reason 计数） — 留独立 PR
- 把 `attempts[].llm.mcp_servers` 写进 summary.json — 留独立 PR
- 把 onEvent / phrase mapping 抽给前端做 — 不在 PoC 范围
