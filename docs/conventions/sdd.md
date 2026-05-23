# Spec-Driven Development（SDD）工作流

mono-repo 单仓共享。M1.1 起业务模块按此流程开发。基于 [GitHub Spec-Kit](https://github.com/github/spec-kit)（2025-2026 事实标准）；选型决策见 `docs/adr/0010-sdd-with-spec-kit.md`（Plan 3 阶段迁入）。

## 标准流程（每个 feature 走一遍）

6 步必跑 + `constitution` 项目级一次性。**spec.md 单一来源** 在 `specs/NNN-<feature-slug>/spec.md`（mono root 相对，扁平 feature-first 布局，per [ADR-0024](../adr/0024-spec-feature-first-layout.md)）；plan / tasks / analysis 与 spec 同目录。

| #   | 命令                    | cwd       | 产出位置                                                                                                           |
| --- | ----------------------- | --------- | ------------------------------------------------------------------------------------------------------------------ |
| 0   | `/speckit-constitution` | mono root | `.specify/memory/constitution.md`                                                                                  |
| 1   | `/speckit-specify`      | mono root | `specs/NNN-<feature-slug>/spec.md`（NNN 由 spec-kit 自动 sequential 编号；同时创 git branch `NNN-<feature-slug>`） |
| 2   | `/speckit-clarify`      | mono root | spec.md 内 `## Clarifications` 段（inline）                                                                        |
| 3   | `/speckit-plan`         | mono root | `specs/NNN-<feature-slug>/plan.md`                                                                                 |
| 4   | `/speckit-tasks`        | mono root | `tasks.md`；每条标层级 `[Server]` / `[Mobile]` / `[Contract]`；测试任务不独立，绑定到每个实现 task                 |
| 5   | `/speckit-analyze`      | mono root | `analysis.md`（跨 spec / plan / tasks / constitution 一致性扫描）                                                  |
| 6   | `/speckit-implement`    | mono root | 代码 + 测试 + tasks.md `[X]` flip；TDD 红绿循环                                                                    |

**Review gate**：clarify → plan、plan → tasks、analyze → implement 之间均为人工审批卡点，不是装饰。

### spec.md frontmatter（强制，per [ADR-0024](../adr/0024-spec-feature-first-layout.md)）

每个 `spec.md` 顶部 YAML frontmatter 必填三字段，作为**模块倒查 / ownership / lifecycle** 单一来源：

```yaml
---
modules:
  [auth] # 影响的代码模块,值域 = business-naming.md 列出的业务模块名
  # 单模块: [auth]   多模块: [pkm, account, notification]
  # 完全跨模块平台改造: [cross-cutting]
owners: ['@xiaocaishen-michael'] # GitHub handle,与 CODEOWNERS 兼容
status: implemented # draft | planned | implementing | implemented | superseded | archived
---
```

**模块倒查**：`rg -l '^modules:.*\bauth\b' specs/`（不依赖目录结构，靠 frontmatter）。

## 前端 UI 工作流变体（per ADR-0017）

前端 UI 业务模块的 SDD 流程**按 UI 类别分支**（per `docs/adr/0017-sdd-business-flow-first-then-mockup.md`，amends `docs/adr/0015-claude-design-from-m1-2.md`；两 ADR 均 Plan 3 阶段从 meta 迁入）：

| UI 类别              | 例子                                                             | 流程                                                                                                                                                                                                                                     |
| -------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **类 1 标准 UI**     | login / onboarding / 设置 / 表单 / 列表 / 信息卡片               | spec → plan（业务段 + UI 段标占位）→ tasks → impl 业务+占位 UI → 真后端冒烟 → **Mockup（用户跑 Claude Design → HTML preview baseline，over-deliver .tsx 不依赖）** → plan UI 段回填 + UI 完成 impl（HTML 直翻为 RN，不消费 source .tsx） |
| **类 2 自由画布**    | PKM 知识图谱 / 自由画布                                          | spec → **Mockup**（design/，库选型 + paradigm 决策必先做）→ plan（含完整 UI 段）→ tasks → impl 业务+UI                                                                                                                                   |
| **类 3 数据可视化**  | 财富板块图表 / dashboard                                         | 同类 2（图表库 + 数据建模与 mockup 互锁）                                                                                                                                                                                                |
| **设计哲学重设页面** | spec User Scenarios 主路径变化（如 ADR-0016 单 form 取代双 tab） | 同类 2（让 mockup 帮决定新方向）                                                                                                                                                                                                         |
| **后端业务模块**     | account / pkm / 其他 server use case                             | 不涉及 UI 流程；走完整 SDD 标准流程（无 mockup 步骤）                                                                                                                                                                                    |

### 类 1 占位 UI 4 边界（强制纪律，per ADR-0017）

**应包含**：路由 / Form 输入 / 提交事件 / 状态机视觉指示（裸 `<Text>` 即可）/ 错误展示位置

**不应包含**：精确间距 / 颜色 / 字号 / 阴影 / 自定义动画 / 视觉装饰 / packages/ui 抽组件 — **占位用原生 RN component**

**代码标记**：占位 page 头部加 `// PHASE 1 PLACEHOLDER — business flow validated; visuals pending mockup.` banner

**plan.md UI 段**：phase 1 写 `## UI 结构（占位版，pending mockup）`；phase 2 mockup 落地后回填完整版

### Mockup 留迹路径（per [ADR-0024](../adr/0024-spec-feature-first-layout.md)）

Mockup 与 spec / plan / tasks 同位于 feature 目录 `design/` 子目录：

```text
specs/NNN-<feature-slug>/
├── spec.md
├── plan.md
├── tasks.md
└── design/          # PNG / handoff bundle / 设计 notes
```

适用 § 类 1（mockup 阶段回填）/ § 类 2（设计先行）/ § 类 3（图表 mockup）。

**代码是真相源**：mockup drift 不算 bug — `design/` 是历史决策留痕，不要求与最终 RN 代码逐 pixel 同步。

## `spec.md` 内部结构

走 spec-kit 官方 3 段模板（`.specify/templates/spec-template.md`）：User Scenarios & Testing / Functional Requirements / Success Criteria。**不自创子层**（如"业务规则 / API / 测试"等）—— [Martin Fowler 2024 三工具对比](https://martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html) 明确："there is not a general definition of what constitutes a specification"。

## 与已有约定的协同

| 约定                  | 协同点                                                                                                    |
| --------------------- | --------------------------------------------------------------------------------------------------------- |
| OpenAPI（code-first） | server 注解派生 `/v3/api-docs`（@nestjs/swagger 替代旧 Springdoc），mobile 通过 `pnpm api:gen` 同步 typed |
| ADR                   | use case 内部决策留 `plan.md`；跨模块 / 不可逆决策才抽出独立 ADR                                          |

## /implement 每 task 闭环 6 步（强制）

→ `.claude/rules/implement-task-closure.md`（path-trigger 自动加载：改 `specs/*/tasks.md` 或 impl 文件 ts/tsx 时触发，含 TDD 6 步 + `[X]` flip 状态语义 + lefthook `tasks-md-drift` 强制层 + 历史 `✅` 标记兼容 + 常见反模式）。

## server impl 后的 mobile types 同步

→ `.claude/rules/api-contract-trigger.md` § Nx target 依赖链（path-trigger 自动加载：改 server controller / DTO / openapi.json / packages/api-client/src/ 时触发，含 server → api-client → mobile 同步链 + `pnpm nx affected --target=generate` 命令）。

## 反模式

- ❌ implement 阶段跳过 TDD — SDD 不替代 TDD
- ❌ tasks 拆得过细（每个 method 一个 task）— 一个 task 应是 30min-2h 的可单独 commit 工作单元
- ❌ spec drift（代码改了 spec 没改）— PR review 时 spec / code 必须一起 review；超过 1 周脱节就删 spec 转向代码注释
