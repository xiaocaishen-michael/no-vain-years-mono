# Mobile 实现 Playbook（RHF / Strangler-Fig / Claude Design mockup）

> 新 mobile（Expo / RN）feature **实现期**工程 guardrail 的**单一详版**。沉淀自 login/onboarding/cancel-deletion 实战（已去 Java/meta 化）。
>
> **引用不复述**：目录结构 / 凭据存储 → [fe-directory-structure.md](fe-directory-structure.md)；UI 工作流类别（类 1/2/3 + 占位 UI 4 边界）→ [sdd.md](sdd.md) § 前端 UI 工作流；Metro `.js` extensionless 陷阱 → memory `metro_web_cannot_resolve_js_extension_imports`（ESLint `no-restricted-syntax` 已机械拦）；测试分层 → memory `mono_mobile_test_layering`（vitest=logic-only / Playwright=UI）。
>
> path-triggered 摘要见 [`.claude/rules/mobile-impl-playbook.md`](../../.claude/rules/mobile-impl-playbook.md)。

## 1. RHF 表单 4 铁律（Golden Sample = login）

mono 表单唯一标准 = **React Hook Form + zodResolver**（`@hookform/resolvers`）。login 屏是 Golden Sample。

1. **Controller ≠ register**：RN 无原生 DOM input，**必用 `<Controller>`** 包裹受控组件，禁 web 的 `register()`。
2. **表单态 ≠ 副作用态，分层**：RHF 管表单字段态；网络/提交结果/弹窗等副作用态独立（zustand / useState），不混进 form state。
3. **isSubmitting 单源**：提交中状态以 RHF `formState.isSubmitting` 为唯一来源，不另设 `loading` bool（双源会漂）。
4. **错误 + a11y 一体**：字段错误展示 + `accessibilityLabel` / 错误 announce 同步落地（非事后补）。

- **实证锚**：`apps/mobile/app/(auth)/login.tsx` + `cancel-deletion.tsx`（004 #198）；memory `rhf_form_standard_login_golden_sample`。

## 2. Strangler-Fig port 纪律

迁/port 既有屏时分四层处置 —— **复用皮、重写肉**：

| 层                         | 处置                                                                                                                                                 |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **skin（皮）**             | **复用** `~/theme`（brand token，如 brand-500 `#2456E5`）+ `~/ui` 组件库（design-token 直搬不重设计，per memory `design_tokens_reuse_not_redesign`） |
| **muscle（API 适配）**     | 重写：消费 **Orval 生成的函数式 hook**（**非 class 包装**；axios 实例**不删**）                                                                      |
| **nervous（状态/数据流）** | 重写：RHF + zustand，按本 feature 数据流                                                                                                             |
| **engine（路由）**         | 沿用 Expo Router 结构（`(auth)` / `(app)/(tabs)` / settings），hooks/components 重写                                                                 |

- **反模式**：class 包装 Orval / 删 axios / 用 claude-design 重设计已稳定 token。
- **实证锚**：login / onboarding / cancel-deletion port（003-005）。

## 3. Claude Design mockup 2 段模板（类 1 回填 / 类 2·3 先行）

适用 [sdd.md](sdd.md) § UI 类别（类 1 mockup 回填 / 类 2 自由画布 / 类 3 数据可视化）。产出 = **HTML preview baseline**（非最终 RN），再视觉翻译为 RN（复用 `~/theme` token + `~/ui` + reanimated）。**0 新 token**（视觉资产已稳定）。

mockup-prompt 两段结构（copy 给 Claude Design）：

```text
# 段 1：Design context 表（user-facing，给设计者读）
| 维度 | 值 |
| 屏 / 路由 | <屏名 + Expo route> |
| 用户与场景 | <谁、什么 journey 节点> |
| 关键状态 | <空 / loading / 错误 / 成功 各变体> |
| 数据来源 | <消费哪个 server 端点（已 ship）> |

# 段 2：Prompt block（copy-paste 给 Claude Design）
- 业务 + 状态机：<本屏业务规则 + 状态转换，锚 spec FR/SC>
- POSITIVE 约束：<必须呈现的元素 / 交互 / 状态指示>
- NEGATIVE 约束（DO-NOT）：<不要造的元素，per spec Out-of-Scope>
- 页面结构：<区块布局，非精确像素>
- 状态变体图示：<每个关键状态画一版>
- 视觉语言：复用 ~/theme token（brand-500 等），**0 新增 token / 0 新色**
- DELIVERABLES：HTML preview（mono sdd.md baseline，非 .tsx）
```

- **代码是真相源**：mockup drift 不算 bug（`design/` 是历史决策留痕，不要求与最终 RN 逐 pixel 同步，per sdd.md）。
- **实证锚**：sdd.md § Mockup 留迹路径（`specs/NNN-*/design/`）。

## 4. impl 期 stop-signals

→ [`.claude/rules/implement-task-closure.md`](../../.claude/rules/implement-task-closure.md) § Stop signals。
