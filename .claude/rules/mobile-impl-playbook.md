---
paths:
  - 'apps/mobile/src/**/*.ts'
  - 'apps/mobile/src/**/*.tsx'
  - 'apps/mobile/app/**/*.tsx'
---

# Mobile 实现 guardrails（path-triggered，改 mobile feature 文件自动加载）

> 🚨 **CRITICAL — 写 Expo/RN feature 时严守。** 详版 + mockup 模板 + 实证锚见 [`docs/conventions/mobile-impl-playbook.md`](../../docs/conventions/mobile-impl-playbook.md)（单源，本 rule 不复述）。

## RHF 表单 4 铁律（Golden Sample = login）

唯一标准 = RHF + zodResolver。① **Controller ≠ register**（RN 必用 `<Controller>`）；② **表单态 ≠ 副作用态**分层；③ **isSubmitting 单源**（用 `formState.isSubmitting`，不另设 loading bool）；④ **错误 + a11y 一体**。

## Strangler-Fig port

复用皮、重写肉：skin = **复用** `~/theme` + `~/ui`（design-token 直搬**不重设计**）；muscle = **Orval 函数式 hook**（**非 class** 包装、axios **不删**）；nervous/engine = 重写但沿用 Expo Router 结构。

## Mockup（类 1 回填 / 类 2·3 先行）

走 Claude Design **2 段模板**（context 表 + prompt block）→ 产出 **HTML preview baseline**（非 .tsx）→ 翻 RN，**0 新 token**。模板见详版 § 3 + [sdd.md](../../docs/conventions/sdd.md) § UI 类别。

## 已有单一家（引用不复述）

Metro `.js` extensionless（memory + ESLint 已拦）/ 测试分层 vitest=logic·Playwright=UI（memory）/ 目录·凭据（[fe-directory-structure.md](../../docs/conventions/fe-directory-structure.md)）。
