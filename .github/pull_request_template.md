## 修改内容

<!-- 简述本 PR 的核心改动（≤ 3 bullet） -->

-
-

### 🚨 部署与存活前置确认 (Deployment & Smoke Gates)

<!--
Per ADR-0040 multi-layer test gate. 本段 3 checkbox 由 .github/workflows/
pr-validation.yml 的 actions/github-script step 严格扫描;任一未勾 → CI 红 + 阻 merge。
-->

- [ ] **物理验证通过**：我确认本地已运行 `pnpm exec nx affected -t lint typecheck test build runtime-smoke --base=origin/main` 并拿到 exit code 0。
- [ ] **禁止过度 Mock**：如修改了 Guard / Interceptor / Filter / Pipe / Repository,我确认相关 spec 已使用 `Test.createTestingModule` 装 DI 容器,而非 `new Class()` 隔离实例化。
- [ ] **状态机闭环**：本特性的 `state_branches`(spec.md frontmatter)均已在 integration test 中 100% `it()` 覆盖。

## Test plan

<!-- bullets describing how reviewers can verify this PR locally -->

-

## 关联 Issue / PR

- Fixes #
