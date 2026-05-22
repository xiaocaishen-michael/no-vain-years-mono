# Meta → Mono：GitHub repo-level 配置 + TS code-quality 工具链迁移

## Context

`no-vain-years` (Java meta) 仓积累了两层与 mono 仓相关但目前未对齐的资产：

1. **GitHub repo-level 配置** — branch protection（ruleset）/ issue templates / labels / 跨仓 doc CI workflow。mono 目前 ruleset 缺 `Markdownlint (docs)` + `Commitlint (conventional commits)` 两个 required check，无 `.github/ISSUE_TEMPLATE/` 目录，labels 缺 `retro`。
2. **代码质量工具链**（Java 侧 Spotless + Palantir Java Format + Checkstyle 三件套）— mono TS 侧**完全空缺**：无 Prettier / Biome / dprint（`eslint-config-prettier@10` 是 orphan dep），无 commitlint，无 `.editorconfig`，ESLint 也未启 `complexity` / `naming-convention` / `max-lines-per-function`。

本 plan 一次性补齐两块。**核心约束**：Java 侧 `checkstyle-rationale.md` 的"格式化与语义 lint 维度互斥"哲学落到 TS 侧 = **Prettier（重写文件）+ ESLint（语义 lint）** 双层栈，commit-msg 层加 commitlint，编辑器底座加 `.editorconfig`。ESLint 新增的复杂度/命名规则**全用 `warn` 不 `error`**，避免 AI 协作场景下 PR 被小驼峰错误硬卡。

非 goal：不引入 Biome（社区生态 Prettier+ESLint 更成熟，2026 仍是 NestJS/Expo 主流；与 user 既有 Java 心智模型 1:1 对齐）。

---

## Part 1 — GitHub repo-level 配置迁移

### 1.1 增 ruleset required status checks

mono 当前 ruleset `main-protection` 已含 `deletion` / `non_fast_forward` / `pull_request` / 4 个 required checks（Gitleaks / Actionlint / PR title / validate-and-test）。**追加** 2 个 check，与 Part 2 的 commitlint + 与本节 1.2 的 markdownlint workflow 配套：

- `Markdownlint (docs)`
- `Commitlint (conventional commits)`

落地：通过 `gh api PUT /repos/.../rulesets/16500378` 提交完整 ruleset JSON（GitHub API 不支持 patch 单项，必须整对象覆盖）。

### 1.2 增两个 CI job（`.github/workflows/ci.yml`）

在 mono `ci.yml` 现有 `gitleaks` / `actionlint` / `pr-title` / `docker-image` 之外追加：

```yaml
  markdownlint:
    name: Markdownlint (docs)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: DavidAnson/markdownlint-cli2-action@v18
        with:
          config: .markdownlint-cli2.jsonc
          globs: "**/*.md"

  commitlint:
    name: Commitlint (conventional commits)
    runs-on: ubuntu-latest
    if: github.event_name == 'pull_request'
    steps:
      - uses: actions/checkout@v6
        with: { fetch-depth: 0 }
      - uses: wagoid/commitlint-github-action@v6
        with: { configFile: commitlint.config.mjs }
```

`.markdownlint-cli2.jsonc` 配置 minimal-adapt 自 meta `/Users/butterfly/Documents/projects/no-vain-years/.markdownlint-cli2.jsonc`：

- **保留 meta 规则部分原样**（MD013/033/041 关；MD024 siblings_only；MD032 关——已沉淀经验，中文 SDD doc 主要磨损源）
- **改 ignore 列表**：
  - 去掉 meta-only：`my-beloved-server/**` / `no-vain-years-app/**` / `build/**` / `docs/issues/**` / `docs/requirement/**` / `docs/session-*.md`
  - 保留：`**/target/**` / `**/node_modules/**` / `**/.git/**` / `**/CHANGELOG.md` / `docs/plans/**`（高频 plan 草稿；与 Prettier 同步豁免）/ `.claude/skills/speckit-*/**` / `.specify/templates/**` / `.specify/extensions/**` / `.specify/scripts/**`
  - 新增 mono-specific：`.specify/memory/**` / `specs/*/tasks.md`（task 行频繁 flip 易引入瞬态 MD 错；commit-msg 节奏快）

### 1.3 增 `.github/ISSUE_TEMPLATE/` 目录

从 meta `/Users/butterfly/Documents/projects/no-vain-years/.github/ISSUE_TEMPLATE/` 拷三模板（bug_report.md / chore.md / feature_request.md）+ config.yml，做单仓化改造：

- 三模板：删 frontmatter / body 内的"触发仓：meta/server/app"字段（mono 单仓不适用）；保留 Chinese 模板骨架与 labels 设置
- `config.yml`：删跨仓 contact_links（指向 my-beloved-server / no-vain-years-app）；保留 Security advisories 链接（指向 mono 仓自身 advisories URL）；保留 `blank_issues_enabled: false`

### 1.4 增 `retro` label

```bash
gh label create retro --color 0E8A16 \
  --description "Weekly retro for optimization work" \
  -R xiaocaishen-michael/no-vain-years-mono
```

---

## Part 2 — TS code-quality 工具链（Spotless + Checkstyle 等价）

### 2.1 Prettier（格式化基座，Spotless + Palantir 类比）

**Root devDeps**（`package.json`）：

```bash
pnpm add -D -w prettier
```

**`.prettierrc.json`**（根目录）：

```json
{
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2,
  "semi": true
}
```

**`.prettierignore`**（根目录，与 markdownlint ignore 同步思路）：

```text
**/dist/
**/build/
**/node_modules/
**/.next/
**/.expo/
**/coverage/
**/target/

# Generated
apps/server/openapi.json
packages/api-client/src/generated/

# AI 草稿 / 高频改写区（per user gate）
.specify/memory/
specs/*/plan.md
specs/*/tasks.md
specs/*/analysis.md
docs/plans/
docs/daily/
docs/experience/

# Upstream vendored
.claude/skills/speckit-*/
.specify/templates/
.specify/extensions/
.specify/scripts/
```

**Lefthook 集成**（`lefthook.yml`，`pre-commit:commands:` 下新增 `format` block）：

```yaml
    format:
      tags: format
      glob: "*.{ts,tsx,js,jsx,json,md}"
      run: pnpm exec prettier --write {staged_files}
      stage_fixed: true
```

`{staged_files}` 已有引号吞失问题（per `reference_lefthook_staged_files_template_strips_quotes`）→ 若实测含路径空格触发错误，回退为 `run:` 内 `git diff --cached --name-only --diff-filter=ACMR | grep -E '\.(ts|tsx|js|jsx|json|md)$' | xargs -r pnpm exec prettier --write`。

### 2.2 ESLint 加严（Checkstyle 语义 lint 类比）

修改 `/Users/butterfly/Documents/projects/no-vain-years-mono/eslint.config.mjs`，在现有 nx flat config 块内追加：

```js
{
  files: ["**/*.ts", "**/*.tsx"],
  rules: {
    // 复杂度（Checkstyle CyclomaticComplexity=12 → TS 略宽 15，React 声明式代码多）
    "complexity": ["warn", 15],
    // Method length（Checkstyle MethodLength=80 → TS 150，React component 整页常态）
    "max-lines-per-function": ["warn", {
      "max": 150,
      "skipBlankLines": true,
      "skipComments": true,
    }],
    // 命名（Checkstyle Naming 类比；全 warn 不 error 避免 AI 协作硬卡）
    "@typescript-eslint/naming-convention": ["warn",
      { "selector": "default", "format": ["camelCase"] },
      { "selector": "variable", "format": ["camelCase", "UPPER_CASE", "PascalCase"] },
      { "selector": "typeLike", "format": ["PascalCase"] },
      { "selector": "parameter", "format": ["camelCase"], "leadingUnderscore": "allow" },
      { "selector": "property", "format": null }, // 放过 API snake_case
    ],
  },
},
```

**关键设计**（per Java `checkstyle-rationale.md` 哲学复用）：

- 格式化维度（缩进 / 行宽 / import 排序）**让出给 Prettier**，ESLint 不重叠管
- 风险评估：先**全 warn**；M3 部署前真实数据看 warning 数量决定是否拔到 error（与 Java 侧 Naming/Coding 卡 build 时机一致——但晚一步）

`eslint-config-prettier@10` 已在 devDeps（orphan）→ 此次落地后变 useful（关掉与 Prettier 冲突的 ESLint stylistic 规则）。需在 `eslint.config.mjs` 末尾 append `eslintConfigPrettier`。

### 2.3 Commitlint（Conventional Commits 规范）

**Root devDeps**：

```bash
pnpm add -D -w @commitlint/cli @commitlint/config-conventional
```

**`commitlint.config.mjs`**（根目录，从 meta `/Users/butterfly/Documents/projects/no-vain-years/commitlint.config.mjs` 镜像）：

```js
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'scope-enum': [0],
    'header-max-length': [2, 'always', 100],
    'body-max-line-length': [2, 'always', 150],
    'footer-max-line-length': [2, 'always', 150],
    'subject-case': [0],
  },
};
```

> 保留 meta footer-max-line-length=150（per meta 注释：`Co-Authored-By:` trailer 触发 footer 算法把 body 拉过来；server PR #191 实证 2026-05-15）—— 已实证经验值得继承。

**Lefthook 集成**（`lefthook.yml`，新增 top-level `commit-msg:` block）：

```yaml
commit-msg:
  commands:
    conventional-format:
      run: pnpm exec commitlint --edit {1}
```

> 与 Java 侧 regex-only fast-path 不同：mono Node 依赖即装，直接跑 `commitlint --edit` ~1s，足够快且与 CI 完全一致（无 local/CI 分裂风险）。

### 2.4 `.editorconfig`（编辑器底座）

根目录新建：

```ini
root = true

[*]
charset = utf-8
indent_style = space
indent_size = 2
end_of_line = lf
insert_final_newline = true
trim_trailing_whitespace = true

[*.md]
trim_trailing_whitespace = false
```

---

## 落地顺序（每步独立 commit + 可单测）

1. **Part 1.4 retro label** → 验证 `gh label list` 含 retro
2. **Part 2.4 `.editorconfig`** → 文件提交即生效（无 hook 改动）
3. **Part 2.1 Prettier + lefthook format hook + `.prettierignore`** → 跑一次 `pnpm exec prettier --write .` 看 diff 量 → 单独 commit `chore(repo): add Prettier baseline` （此 commit 改动量预计极大，需独立提交避免污染后续 diff）
4. **Part 2.2 ESLint 加严** → `pnpm exec nx run-many -t lint` 看 warning 数量基线 → commit
5. **Part 2.3 Commitlint + commit-msg hook** → 自己手工 commit `feat: test commitlint` 验红，再 `feat(repo): test commitlint` 验绿 → commit
6. **Part 1.2 + 1.3 + 1.1**（GitHub 仓配置 + ISSUE_TEMPLATE + ruleset required checks）→ 一并 PR（CI 内 `markdownlint` / `commitlint` job 首次跑要全绿才能加入 required checks）

落地节奏估算：步骤 3 Prettier 首次重写最大不确定性（warning 量可能千级），单步可能耗 1-2h；其余步骤每个 30-60min。

---

## 验证

| 维度 | 验证方式 | 期望 |
|---|---|---|
| Prettier 工作 | `pnpm exec prettier --check .`（首次跑前应 exit 1，第 3 步 commit 后 exit 0） | exit 0 |
| ESLint 加严生效 | `pnpm exec nx run-many -t lint` | 出现 `complexity` / `naming-convention` / `max-lines-per-function` warning（具体数量为基线） |
| Commitlint local 拦截 | 手工 `git commit -m "bad message"` | lefthook commit-msg 拒提交 |
| Commitlint CI 拦截 | 起测试 PR 含 bad-message commit | `Commitlint (conventional commits)` CI job 红 |
| Markdownlint CI 拦截 | 起测试 PR 含未通过 md | `Markdownlint (docs)` CI job 红 |
| Ruleset required checks 生效 | 测试 PR 不 merge until 两 check 绿 | merge 按钮 blocked |
| Issue template 出现 | GitHub Web `Issues → New issue` | 含 3 模板选项 + Security advisories link |
| retro label 存在 | `gh label list` | 含 retro |

---

## 关键文件

**新建**：

- `/Users/butterfly/Documents/projects/no-vain-years-mono/.markdownlint-cli2.jsonc`
- `/Users/butterfly/Documents/projects/no-vain-years-mono/.prettierrc.json`
- `/Users/butterfly/Documents/projects/no-vain-years-mono/.prettierignore`
- `/Users/butterfly/Documents/projects/no-vain-years-mono/.editorconfig`
- `/Users/butterfly/Documents/projects/no-vain-years-mono/commitlint.config.mjs`
- `/Users/butterfly/Documents/projects/no-vain-years-mono/.github/ISSUE_TEMPLATE/bug_report.md`
- `/Users/butterfly/Documents/projects/no-vain-years-mono/.github/ISSUE_TEMPLATE/chore.md`
- `/Users/butterfly/Documents/projects/no-vain-years-mono/.github/ISSUE_TEMPLATE/feature_request.md`
- `/Users/butterfly/Documents/projects/no-vain-years-mono/.github/ISSUE_TEMPLATE/config.yml`

**修改**：

- `/Users/butterfly/Documents/projects/no-vain-years-mono/.github/workflows/ci.yml`（追加 `markdownlint` + `commitlint` job）
- `/Users/butterfly/Documents/projects/no-vain-years-mono/eslint.config.mjs`（追加 complexity / naming / max-lines-per-function + `eslintConfigPrettier`）
- `/Users/butterfly/Documents/projects/no-vain-years-mono/lefthook.yml`（追加 `pre-commit.format` + `commit-msg.conventional-format`）
- `/Users/butterfly/Documents/projects/no-vain-years-mono/package.json`（追加 `prettier` / `@commitlint/cli` / `@commitlint/config-conventional` 到 devDependencies）

**GitHub API 改动**：

- ruleset 16500378 追加 `Markdownlint (docs)` + `Commitlint (conventional commits)` 到 `required_status_checks`
- repo labels：加 `retro` (#0E8A16)

---

## 风险与回退

| 风险 | 缓解 |
|---|---|
| Prettier 首次跑改动量过大污染 git history | 第 3 步独立 commit + commit message `chore(repo): apply Prettier baseline` + PR 描述强调"格式化基线，无业务改动" |
| ESLint `naming-convention` 大量 warning 噪音 | 全 warn 不 error，先看基线再决定收紧时机 |
| `{staged_files}` 路径含空格触发 lefthook 引号问题 | 步骤 3 实测如挂，回退方案已写在 § 2.1 |
| commitlint local hook 慢（>3s 节奏被破坏） | 已实测 commitlint --edit ~1s；若超 3s 回退为 Java 侧 regex-only 方案 |
| ruleset 加 required check 后未先验绿就锁，导致 PR 全卡 | 落地顺序步骤 6 严格遵守：先确认两 job 在 PR 上首次跑全绿，才更新 ruleset |
