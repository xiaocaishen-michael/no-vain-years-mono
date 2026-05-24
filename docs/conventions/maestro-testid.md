# Maestro testID 命名 convention

> Per [ADR-0027 § Consequences](../adr/0027-frontend-data-test-layer.md): testID 现起强制 in 占位 UI + final UI。Maestro flow 本身落 Plan 4（binary 分发 prerequisite），但 testID **现在起**所有交互元素必填。

## 格式

```text
testID="<feature>.<element>.<verb>"
```

| 字段      | 取值                                       | 说明                                                               |
| --------- | ------------------------------------------ | ------------------------------------------------------------------ |
| `feature` | spec.md frontmatter `feature_id` slug 部分 | e.g. `phone-sms-auth`（去掉 `NNN-` 前缀）、`account-profile`       |
| `element` | UI 元素类型（kebab-case）                  | `phone-input` / `sms-code-input` / `submit-button` / `tab-profile` |
| `verb`    | 用户动作（kebab-case，单词数 ≤ 2）         | `tap` / `submit` / `clear` / `select` / `dismiss`                  |

## 示例

| 场景                          | testID                                       |
| ----------------------------- | -------------------------------------------- |
| phone-sms-auth 手机号输入框   | `testID="phone-sms-auth.phone-input.type"`   |
| phone-sms-auth 验证码提交按钮 | `testID="phone-sms-auth.submit-button.tap"`  |
| account-profile 修改昵称按钮  | `testID="account-profile.display-name.edit"` |
| account-profile 退出登录      | `testID="account-profile.logout-button.tap"` |

## 强制范围

- **所有交互元素**必填：`<Pressable>` / `<TextInput>` / `<Button>` / `<TouchableOpacity>` / 等带 `onPress` / `onChangeText` 的组件
- **占位 UI（类 1 业务流验证页面）**亦必填：业务流验证阶段视觉占位但已能交互的页面，testID 一次性写好，避免 Mockup 回填阶段漏装
- **Final UI** 直翻 HTML → RN 时，testID 与 RN 组件**一同迁移**（不允许翻译过程丢失）

## 不强制范围

- 纯展示元素：`<Text>` / `<View>` / `<Image>` 等不响应用户输入的组件
- 仅在 dev tooling 中存在的组件（e.g. Expo Dev Tools 浮窗）

## 与 Maestro flow 的关系

- Plan 4 binary 分发开始时（per ADR-0027 sunset），Maestro flow YAML 用 `tapOn: { id: "phone-sms-auth.submit-button.tap" }` 引用
- Plan 4 前 testID **已就位但 flow 暂未写**——验收 testID 完整度的方式是 spec-driven manual review（PR review 时检查交互元素有 testID）

## 检验机制

- **现阶段**: PR review 人工检查（reviewer 必扫新交互元素是否带 testID）
- **将来**: 若 testID 缺失反复发生，加 ESLint rule `react-native/no-untyped-testid-on-pressable`（candidate to track in `docs/conventions/ai-friction-catalog.md` if it surfaces）

## 与 spec.md 的关联

- spec.md `state_branches` 字段穷举状态机分支 → 每分支应有一个 Maestro flow（Plan 4 后）→ 每 flow 引用的 testID 必落到对应交互元素
- Plan 4 触发时按 `state_branches` × testID 1:N 关系写 flow，testID 缺漏直接卡 flow

## 参考

- [ADR-0027 Frontend Data + Test Layer](../adr/0027-frontend-data-test-layer.md) — Maestro 决策 + testID 强制时机
- [`docs/conventions/sdd.md` § 类 1 占位 UI 4 边界](./sdd.md) — testID 属"应包含"清单
- [Maestro 官方文档](https://maestro.mobile.dev/)
