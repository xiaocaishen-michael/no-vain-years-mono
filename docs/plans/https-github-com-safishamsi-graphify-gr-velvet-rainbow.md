# 接入 graphify 作为 mono-repo 代码知识图谱

## Context

`no-vain-years-mono` 当前正在 Plan 1 PoC 收尾阶段（NestJS + Fastify + Prisma + Nx），跨 apps/server / packages / docs / specs（SDD artifacts）/ .specify/templates 的认知地图正在变厚。希望引入 [`safishamsi/graphify`](https://github.com/safishamsi/graphify)（PyPI `graphifyy`，MIT，tree-sitter 31+ 语言 AST + 可选 LLM semantic edge + 内建 MCP stdio server）产出一份本仓的知识图谱，让后续 Claude Code session 可以通过 MCP 工具直接 `query_graph` / `shortest_path` / `god_nodes`，减少"先 grep 再 read"的重复成本。

**决策锁定**（chat 里 2 轮 confirm 后）：

| 维度 | 选择 | Tradeoff |
|---|---|---|
| 索引 scope | 全 mono-repo（apps + packages + docs + specs + .specify） | 跨域 edge 最丰富；首次成本最高 |
| 语义抽取 | **Phase 1 = AST-only baseline；Phase 1 验证通过后 Phase 2 = Claude Code subagents (Anthropic Max 配额) 跑 semantic** | Phase 1 秒级出图、0 token；Phase 2 一次性消耗 Max 配额（mono 全量预估 50k-100k token，单次承受）；不走 Gemini API |
| 刷新策略 | **Phase 1 = 一次性 + MCP server**；**Phase 2 = 加装 post-commit hook 保 AST 增量永远同步** | hook 仅做 code 改动的 AST 增量（0 token），docs / spec 改动仍需手动 `/graphify --update` 触发 semantic |

**已知风险**：本机 Python 3.14（最新版本），graphifyy 可能要求 ≤3.13。Phase 1 Step 1 验证；若不兼容用 uv 的 managed Python 退到 3.12 隔离 install。

## 选型说明（NestJS / Prisma 语义层局限性）

调研结论（已 fact-check，npm + GitHub 实证）：

| 工具 | 作者 | NestJS DI graph? | Prisma 关系? | 本 plan 取舍 |
|---|---|---|---|---|
| **`safishamsi/graphify`**（即 `graphifyy`） | safishamsi | ❌ 仅 tree-sitter 通用 AST，decorator 当 class 修饰符识别，不解析 `@Module imports` / `@Injectable` 注入 / `@Controller` 路由 | ❌ `.prisma` 走 tree-sitter prisma grammar，能见 model / 字段名，**不**建模关系字段语义 | ✅ **本 plan 主选**（mono 全栈跨包 import / docs↔code 跨域 / MCP / 31 语言广覆盖） |
| `Howell5/graphify-ts` | Howell5（**与 safishamsi 无关**） | ❌ 同上，12 语言通用 tree-sitter，README 零提 NestJS / decorator / Prisma | ❌ 同上 | ❌ 不用（无独立优势，且非 safishamsi 生态） |
| `nestjs-spelunker` | nestjs 生态 | ✅ 专门抽 DI graph（modules / providers / controllers） | — | 🔮 后续可选叠加 |
| `prisma-erd-generator` | Prisma 生态 | — | ✅ 从 `schema.prisma` 出 ER 图 | 🔮 后续可选叠加 |

**graphify 在本仓真实能给到的 NestJS 视角**：

- ✅ TS 跨文件 import / call / class 继承（tree-sitter AST）
- ✅ Mono 跨包 (`apps/server` ↔ `packages/*`) 依赖
- ✅ Phase 2 LLM 接入后：docs / spec / ADR ↔ code 的跨域 INFERRED edge（其他工具给不了）
- ✅ MCP server 供 Claude Code 查询（关键收益）
- ❌ **不**给 NestJS DI graph（`@Module` imports / `providers` / `exports` 之间的依赖注入边）
- ❌ **不**给 Prisma 关系语义（外键 / `@relation` / cascade 行为）

**结论**：graphify 与 nestjs-spelunker / prisma-erd 是**互补**，不是替代。本 plan 先把 graphify 跑通拿到 80% 的通用图谱价值；若 Phase 1/2 跑完发现 NestJS DI / Prisma ERD 视角缺失刚需，再单开一个 plan 叠加专用工具，不在本次扩 scope。

## 总览：两阶段递进

```
Phase 1 (今天, ~5 min, 0 token) ──verify gate──> Phase 2 (LLM + hook, ~一次 50-100k Anthropic token)
```

Phase 1 跑完做 7 项 verify（见 Step 8）；全过才进 Phase 2。任一失败 → 停在 Phase 1 复盘。

## Phase 1: AST baseline + MCP (今天)

### Step 1. Install graphifyy + Python 兼容性验证

```bash
uv tool install graphifyy
graphify --version   # verify: 输出版本号（期望 0.8.x）
```

- 失败回退：`uv tool install --python 3.12 graphifyy`（uv managed 3.12，不污染 brew Python 3.14）
- 不要 `pip install` 到 brew Python（PEP 668 + 全局污染）

**verify**：`graphify --help` 返回；`uv tool list | grep graphifyy` 列出。

### Step 2. `.gitignore` 排除 graphify 产物

`graphify-out/` 目录会塞 graph.html (MB 级)、graph.json、私有的 `.graphify_python` / `.graphify_chunk_*.json` / `cost.json` / cache。整目录 ignore。

修改 `/Users/butterfly/Documents/projects/no-vain-years-mono/.gitignore`，追加：

```gitignore
# graphify code knowledge graph
graphify-out/
```

**verify**：`git status` 不出现 graphify-out/。

### Step 3. 走 SKILL.md Step 1-2（install guard + detect）

按 `~/.claude/skills/graphify/SKILL.md` Step 1（interpreter resolution，写 `.graphify_python`）+ Step 2（`graphify.detect.detect()` 扫文件）。

**关键**：检查 detect 输出的 `total_files` / `total_words` 与按类目分布。预期 mono-repo 触发"> 200 files 或 > 2M words"警告 → 走 skill 的"top 5 subdirectories"分支问用户先跑哪个子目录。届时统一选 `.`（仓根，全跑）但**显式确认** detect 已经把 `node_modules` / `.nx` / `dist` / `apps/server/prisma/generated` / `pnpm-lock.yaml` 等噪声排掉了——若没排，先扩 graphify 的内建 skip 或拆 scope。

graphify 内建的 sensitive / skip 清单未在 SKILL.md 列全，**先 dry-run 一次 detect**，观察实际 corpus 体积再决定是否需要手动 scope。

**verify**：detect 输出按 code / docs 分类合理；total_files 数量级匹配 `find apps packages docs specs -type f \( -name '*.ts' -o -name '*.md' -o -name '*.prisma' \) | wc -l`（粗对账）。

### Step 4. **AST-only 抽取**（跳过 SKILL.md Step 3B）

按用户选择 AST-only first pass：

- **运行 SKILL.md Step 3 Part A**（`graphify.extract.extract()`，AST，tree-sitter，0 LLM）写 `graphify-out/.graphify_ast.json`
- **跳过 Part B**（不 dispatch semantic subagents，不读 GEMINI_API_KEY）
- **合并**：直接把 Part A 结果当 extraction 输出写到 `.graphify_extract.json`（mock 一个空 semantic 部分：`{"nodes":[],"edges":[],"hyperedges":[],"input_tokens":0,"output_tokens":0}` 合进去）

实现层面：调用 skill 走到 Step 3 Part A 完成后，**手动**构造 `.graphify_semantic.json = {nodes:[],edges:[],hyperedges:[],input_tokens:0,output_tokens:0}`，再走 Part C 合并。Part C 已经是 `ast.edges + sem.edges`，sem 为空时即等价于 AST-only。

**verify**：`.graphify_extract.json` nodes 数 == AST nodes 数（无 semantic 增量）；input_tokens=0 / output_tokens=0。

### Step 5. 走 SKILL.md Step 4-6（build/cluster/label/HTML）

- Step 4：`build_from_json` → `cluster()` → `god_nodes` → `surprising_connections`
- Step 5：人工 / 模型给 community 起 2-5 词 label
- Step 6：默认产 `graph.html`（不带 `--obsidian`，跳过 vault 生成，避免一文件一节点的 200+ md 污染 mono root）

**verify**：
- `graphify-out/GRAPH_REPORT.md` 含 God Nodes / Communities 段
- `graphify-out/graph.html` 可在 browser 打开（macOS `open` 命令）
- nodes 数 > 0 且非 explosion（粗略阈值：< 5000，超阈则 SKILL.md 自动 aggregate）

### Step 6. 注册 MCP server 到 Claude Code

Claude Code（CLI 版）的 MCP server 配置通过 `claude mcp add` 写入用户级 `~/.claude.json` 或项目级 `.mcp.json`。**项目级**优先（不污染其他仓）。

```bash
# 从仓根执行
claude mcp add graphify -s project \
  -- "$(cat graphify-out/.graphify_python)" -m graphify.serve \
  "$(pwd)/graphify-out/graph.json"
```

- `-s project` → 写 `/Users/butterfly/Documents/projects/no-vain-years-mono/.mcp.json`
- Python 解释器路径用 SKILL.md 已落盘的 `.graphify_python`（避开 3.14 / 3.12 选错）
- `graph.json` 用绝对路径（MCP 进程 cwd 不可靠）

**verify**：
- `.mcp.json` 文件存在且包含 `graphify` server entry
- 下次开 Claude Code session 后 `/mcp` 命令显示 graphify 已连接
- 调用 `query_graph` 工具返回 graph 数据（不是 connection error）

### Step 7. 文档化（最小集）

**不**改 CLAUDE.md（per memory `feedback_no_pointer_when_ondemand_covers`：用户全局 CLAUDE.md 已有 graphify 触发说明，仓内重复 = 冗余 pointer）。

**写一份**：`docs/experience/2026-05-18-graphify-bootstrap.md`（bootstrap 类一次性操作归 experience 而非 conventions，per memory `feedback_conventions_evergreen_only.md`）。内容：

- 本次 install + 一次性出图 + MCP 接入命令清单
- 增量刷新 cheatsheet：`/graphify --update` 后 MCP 自动接最新 graph.json
- 已知坑：Python 3.14 兼容性结论 / detect 排除清单实测

**不**装 git post-commit hook（用户选择 refresh 策略 = 一次性 + MCP，非 hook 模式）。

### Step 8. Phase 1 端到端验证（gate to Phase 2）

| 检查项 | 命令 | 期望 |
|---|---|---|
| graphify 装好 | `graphify --version` | 输出版本 |
| graph 产出齐 | `ls graphify-out/{graph.html,graph.json,GRAPH_REPORT.md}` | 3 文件均在 |
| HTML 可视化 | `open graphify-out/graph.html` | browser 打开图 |
| Report 有内容 | `head -50 graphify-out/GRAPH_REPORT.md` | 含 god nodes 段 |
| `.gitignore` 生效 | `git status` | 不出现 graphify-out/ |
| MCP entry 写入 | `cat .mcp.json` | 含 graphify server |
| MCP 在新 session 可用 | 新开 Claude Code → 任意 prompt 触发 `query_graph` | 返回非空 graph 数据 |

**7 项全过** → 进 Phase 2。任一不过 → 停 + 报告 + 等用户决策。

## Phase 2: LLM semantic + post-commit hook（Phase 1 全绿后接手）

### Step 9. LLM semantic 抽取（Claude Code subagents, Anthropic Max 配额）

按 SKILL.md Step 3B 流程，**显式不读** `GEMINI_API_KEY`（即使存在），强制走 general-purpose subagent dispatch 路径：

- 读 `graphify-out/.graphify_uncached.txt`（Phase 1 没跑 semantic，全部 uncached）
- 按 20-25 文件 / chunk 切分，每 chunk 一个 general-purpose subagent
- **同一条 message 内 dispatch 所有 subagent**（per SKILL.md "Step B2 - Dispatch ALL subagents in a single message"），并行执行
- 每个 subagent 写自己的 `.graphify_chunk_NN.json` 到 `graphify-out/`
- 合并 → 写 `.graphify_semantic.json` → save_semantic_cache → Part C 合并 AST + semantic → 重跑 SKILL.md Step 4-5 重建 graph + report

**Anthropic 配额预算**：粗估 mono-repo 非代码文件 ~80-150 个（docs + specs + adr + plan），每 subagent ~3-5k token，并行后总耗 50-100k token。Max plan 单次承受范围。**不重试失败 chunk 超过 1 次**（SKILL.md 半数 chunk 失败即停的规则照搬）。

**verify**：
- `graphify-out/graph.json` nodes / edges 数明显增长（typically AST → AST + semantic 增加 30%-100%）
- `GRAPH_REPORT.md` 出现 INFERRED edges / `semantically_similar_to` 关系（grep 验证）
- MCP server 自动接最新 graph.json（stdio 进程下次启动即用新文件，无需 restart 配置）

### Step 10. 安装 post-commit hook 保 AST 增量同步

```bash
graphify hook install
```

效果（per SKILL.md）：
- 每次 `git commit` 后，post-commit hook 检测 `git diff HEAD~1` 中变更的 code 文件
- 跑 `graphify.extract.extract()` AST 增量（仅变更文件）
- 重建 `graphify-out/graph.json` + `GRAPH_REPORT.md`
- **不**触发 LLM subagent（hook 不烧 token）
- docs / specs / md 改动 hook 会**跳过** → 需手动 `/graphify --update`（届时再走 LLM semantic 一次）

**已有 hook 情况**：SKILL.md 文档说 "appends to it rather than replacing"，安全。若 lefthook 也接管 post-commit，需要确认两者不冲突（mono-repo 当前用 lefthook，但据 git-workflow.md 没有 post-commit 配置，只 pre-commit）。

**verify**：
- `cat .git/hooks/post-commit` 含 graphify 段
- 做一次 dummy code edit + `git commit` → hook 触发并刷新 `graphify-out/graph.json` mtime
- `gh pr ...` / PR 流不受影响（hook 仅本地）

### Step 11. 更新 experience 笔记

把 Phase 2 实测数据回填 `docs/experience/2026-05-18-graphify-bootstrap.md`：

- 实际 LLM token 消耗（从 `graphify-out/cost.json`）
- semantic 增加的 nodes / edges 数（diff Phase 1 baseline vs Phase 2 final）
- hook 一次 commit 的 wall-clock 耗时（per memory `feedback_avoid_slow_pre_commit_or_pre_push`：> 30s 要警惕）
- 任一非预期行为

## 关键文件清单

| 文件 | 用途 |
|---|---|
| `~/.claude/skills/graphify/SKILL.md` | pipeline 1067 行 SOP（read-only 参照） |
| `/Users/butterfly/Documents/projects/no-vain-years-mono/.gitignore` | 追加 `graphify-out/` 一行 |
| `/Users/butterfly/Documents/projects/no-vain-years-mono/.mcp.json` | `claude mcp add` 命令写入，含 graphify stdio server |
| `/Users/butterfly/Documents/projects/no-vain-years-mono/graphify-out/` | 产物目录（gitignored）：graph.html / graph.json / GRAPH_REPORT.md / .graphify_python / cost.json |
| `/Users/butterfly/Documents/projects/no-vain-years-mono/docs/experience/2026-05-18-graphify-bootstrap.md` | bootstrap 笔记（含命令 + 实测排除清单 + Python 兼容结论） |

## 实施 log（2026-05-18，Phase 1）

> 原计划写到 `docs/experience/2026-05-18-graphify-bootstrap.md`，但该目录是 Plan 3 才迁入的 iCloud symlink 占位，**未创建**。bootstrap log 临时落本 plan 文件；Plan 3 设好 symlink 后可迁出。

### 命令清单（已执行）

```bash
# 1. install
uv tool install graphifyy
graphify --version   # → graphify 0.8.3 on Python 3.14.4

# 2. gitignore
# .gitignore 末尾追加 'graphify-out/'

# 3. detect (Python API)
"$(cat graphify-out/.graphify_python)" -c "from graphify.detect import detect; ..."
# → 181 files / 237,701 words / 7 sensitive skipped / 134 code + 47 docs

# 4. AST extract (excluding .nx/)，Phase 1 不跑 LLM semantic
"$(cat graphify-out/.graphify_python)" -c "from graphify.extract import extract; ..."
# 注意：手动 exclude .nx/* 之后 128 code files 进 AST

# 5. build/cluster/auto-label/HTML
# (在 Python 内一并跑完，to_json 加 force=True 覆盖)

# 6. MCP register
claude mcp add graphify -s project \
  -- "$(cat graphify-out/.graphify_python)" -m graphify.serve \
  "$(pwd)/graphify-out/graph.json"
```

### 实测排除清单 + 已知遗漏

| 类别 | 状态 | 备注 |
|---|---|---|
| `node_modules/` | ✅ graphify 内建 exclude | |
| `dist/` / `.git/` | ✅ graphify 内建 exclude | |
| `pnpm-lock.yaml` | ✅ graphify 内建 exclude | |
| `apps/server/src/generated/prisma/` | ✅ 走 sensitive skip（含 schema-like patterns） | |
| **`.nx/cache/run.json`** | ⚠️ **graphify 未排除**，需手动 exclude `/.nx/` | 不大但无用 |
| **`.nx/workspace-data/*.json`** | ⚠️ **graphify 未排除**，6 个文件共 ~2MB，**严重污染** | 含 project-graph.json 983KB / parsed-lock-file 629KB；手动 exclude 后图量 2358 → 1559 nodes (-34%) |
| **`apps/server/prisma/schema.prisma`** | ❌ graphifyy 0.8.3 无 `.prisma` tree-sitter grammar | 计划在 Phase 2/未来版本观察是否补 |
| **`auth/infrastructure/jwt-token.service.ts` + `.spec.ts` + `redis.token.ts`** | ❌ sensitive false-positive（`token` / `secret: 'test-secret-for-unit'` 字面量匹配） | 核对**无真实 secret**；Phase 1 接受损失（4 文件 = 2.2% corpus），不手动 unskip |

### Phase 1 baseline 数据

| 指标 | 值 |
|---|---|
| Corpus | 181 files / 237,701 words |
| AST input | 128 code files (134 - 6 个 .nx 污染) |
| Graph | 1,559 nodes / 1,972 edges / 83 communities |
| Token cost | 0 in / 0 out（AST-only） |
| Wall clock | ~12s（install 后到 HTML 产出） |
| graph.html | 1.2 MB |
| graph.json | 1.2 MB |
| GRAPH_REPORT.md | 20 KB |
| Edge confidence breakdown | 100% EXTRACTED / 0% INFERRED / 0% AMBIGUOUS |

### 待 Phase 2/未来优化（Phase 2 已 ship 部分标 ✅）

1. ~~**community label 过粗**~~ ⏸ Phase 2 走 LLM 后从 83 → 149 communities，label 仍 coarse 但因 community 数翻倍每个 community 内更聚焦；进一步细化需要专门的 community-label LLM step。
2. ✅ **`.nx/` exclusion 已常驻**：Phase 2.2 创建 `.graphifyignore` 写入 `.nx/` + `graphify-out/`，hook + manual update 路径都生效。
3. **prisma schema 缺失**：仍待上游补 `.prisma` tree-sitter grammar 或自写 extractor。
4. **3 auth files sensitive false-positive**：仍可上报 graphifyy issue（`secret\s*[:=]\s*['"]\S+['"]` 应支持 test fixture white-list）。

## 实施 log（2026-05-18，Phase 2）

### Phase 2.1 LLM semantic 抽取 — 实测数据

| 指标 | 值 |
|---|---|
| 切分策略 | 175 uncached files / 8 chunks / 同 message 并行 dispatch |
| Subagent 类型 | `general-purpose`（必须，Explore 写不了 chunk JSON） |
| 单 chunk token 范围 | 59,144 - 128,222（mean 88,476） |
| **总 token 实测** | **707,805 input**（plan 估 50-100k，**7-14x over**；plan 当时只算 docs 没算 code semantic） |
| Wall-clock | 91s - 224s 单 chunk，**max 224s** ≈ 3.7 min（并行）— 比顺序 ~21 min 快 5.6x |
| chunk 平均产物 | 41 nodes / 54 edges / 3 hyperedges |
| Semantic 合并产物 | 340 nodes（dedup 后） / 426 edges / 24 hyperedges |

### Phase 2 最终图谱（经 `graphify update` 再补 AST 后）

| 指标 | Phase 1 baseline | Phase 2 final | Δ |
|---|---|---|---|
| Nodes | 1,559 | **2,435** | +56% |
| Edges | 1,972 | **2,900** | +47% |
| Communities | 83 | **149** | +80% |
| Hyperedges | 0 | **24** | new |
| INFERRED edges | 0 | **64**（avg confidence 0.86） | new |
| Token cost | 0 | 707,805 input | |

**Semantic edge 类型分布**（Phase 2 final 2900 edges 中）：

| Relation | Count | 备注 |
|---|---|---|
| `contains` | 1,886 | AST 容器关系（class/method/file 包含）|
| `references` | 233 | semantic |
| `imports` | 233 | AST |
| `imports_from` | 215 | AST |
| `calls` | 102 | mostly semantic（AST 也产 calls，但 LLM 补了 cross-file 的）|
| `method` | 71 | AST |
| `implements` | 55 | semantic（port/concept 实现）|
| `shares_data_with` | 28 | semantic |
| `defines` | 23 | AST |
| `rationale_for` | 18 | semantic（**关键价值**：ADR 决策 ↔ code）|
| `conceptually_related_to` | 16 | semantic |
| `semantically_similar_to` | 12 | semantic（如 outbox_event ↔ event_publication）|
| `cites` | 8 | semantic（spec ↔ FR 编号）|

### Phase 2.2 hook 实测

| 指标 | 值 | 评估 |
|---|---|---|
| 装的 hook | `post-commit` + `post-checkout` | 完整 |
| `graphify update .` wall-clock | **< 1s**（168 code files AST-only） | 远低于 [[feedback_avoid_slow_pre_commit_or_pre_push]] 30s 红线 |
| 异步设计 | `nohup ... &` + `disown` | commit 0s blocking |
| Resource limit | `GRAPHIFY_REBUILD_TIMEOUT=600s`（10 min cap） | 合理 |
| Skip 场景 | rebase / merge / cherry-pick / `.git/MERGE_HEAD` | 周全 |
| Log 路径 | `~/.cache/graphify-rebuild.log` | OK |
| Semantic 保留 | `_rebuild_code` 用 `build_merge` 读 graph.json 不 round-trip | ✅ 验证全部 24 hyperedges + 64 INFERRED edges 保留 |
| Lefthook 冲突 | 0（mono 仓 lefthook 仅 pre-commit，graphify 接 post-commit / post-checkout） | 无冲突 |
| **意外发现** | `graphify update` 的 AST extractor 比 `graphify.extract.extract()` 直调更全（多 `contains` 1886 / `imports_from` 215 / `method` 71 / `defines` 23 边类型） | 手动 Python 走 Phase 1.4 不够全，**update 路径才是 canonical**；下次 Phase 1 baseline 应直接用 `graphify update .` 替代手动 extract |

### Retrospective（per [[feedback_retro_long_running_tasks]]，task > 3 min 触发）

**总耗时**：~10 min 端到端（Phase 1 ~5min + Phase 2 ~5min wall-clock）。

**时间分布**：

| 阶段 | wall-clock | token | 瓶颈 |
|---|---|---|---|
| Phase 1.1 install | ~3s | 0 | uv tool resolve 32 packages |
| Phase 1.3 detect | ~2s | 0 | 文件 walk + sensitive 扫描 |
| Phase 1.4 AST + build/cluster + HTML | ~12s | 0 | tree-sitter 10 worker pool |
| Phase 1.5 MCP register | ~1s | 0 | `.mcp.json` 写盘 |
| Phase 2.1 semantic（8 chunk 并行） | **224s（最长 chunk）** | **707,805** | **subagent 内的 file Read + reasoning** — 单 chunk 平均 23s file read overhead，主导耗时 |
| Phase 2.2 hook install + update test | <1s + <1s | 0 | 无 |

**优化建议**（如未来要再跑全量 semantic）：

1. **跳过 generated/ 代码**：`apps/server/src/generated/prisma/*` 14 个 + `packages/api-client/src/generated/*` 14 个 = 28 文件全是 codegen boilerplate，semantic 价值低，应进 `.graphifyignore`。预计省 ~25% chunk overhead。
2. **缩 chunk size 到 15 files**：单 chunk 224s 反映 22 文件 Read 太重；15 files + 10 chunks 并行 wall-clock 可能降到 ~150s，token 总量同。
3. **改用 Gemini API**：graphifyy `extract --backend gemini` 批量 endpoint 跑 ~30s 全量 + cost ~$0.05；但牺牲 Anthropic 配额自包含性。**不**推荐切——本 plan 决策仍优于切外部依赖。
4. **细化 community label**：用一个额外 LLM step 给 149 communities 起名（输入 community 内 top 5 node label + neighborhood），消耗 ~10k token，但 HTML 可读性大幅提升。

**首次 vs 稳态成本对比**：

| 模式 | Token | Wall-clock |
|---|---|---|
| 首次 Phase 1 + Phase 2 | 707,805 input | ~10 min |
| 稳态 commit-time hook | **0** | **< 1s** |
| 偶尔 docs 改动后 `/graphify --update` | ~few k - few 10k（仅改动 doc 重抓） | ~10s |

稳态非常便宜，首次成本一次性。Token ROI 在第 ~3 次跨 community query 即回本（每次 Claude 查 graph 替代 grep + 多文件 read，省 ~10k token / 次）。

- **叠加 `nestjs-spelunker`** → 补 graphify 缺的 NestJS DI graph（`@Module imports` / providers / controllers 依赖注入边）。npm 包，与 graphify 输出可共存。触发条件：Phase 1/2 跑完后觉得 DI 关系问题靠 grep 仍频繁。
- **叠加 `prisma-erd-generator`** → 补 graphify 缺的 Prisma 关系语义（`@relation` / 外键 / cascade）。从 `schema.prisma` 出 ER 图 SVG。触发条件：schema 字段开始多到 grep 不动。
- **接 Neo4j**（`graphify export neo4j`） → 仅当需要复杂 Cypher 查询，不在 PoC 阶段考虑。
- **`--wiki` 产 agent-crawlable wiki** → 让 Claude Code 在没 MCP 的 session 也能 fallback。
- **`graphify claude install` 写 CLAUDE.md 段** → graphify 官方"always-on"集成。当前 plan **不走**，因为会冲撞 mono CLAUDE.md "极简骨架" 纪律（per memory `feedback_new_repo_claude_md_strict_skeleton`）。
