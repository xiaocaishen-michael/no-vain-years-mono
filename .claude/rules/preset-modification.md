---
paths:
  - ".specify/presets/**"
  - ".specify/schemas/**"
  - ".specify/extensions.yml"
---

# Preset 修改纪律（path-triggered，触及 `.specify/presets/` 自动加载）

## 硬性规则

**不准直接修改 `.specify/presets/<id>/` 下任何 vendored 文件**（`preset.yml` / `templates/*` / `schemas/*` / `lefthook.yml.fragment` ...）。这些是 install.sh 从 preset 库 (`~/Documents/projects/michael-speckit-presets`) 复制来的快照。

**必须走的流程**：

1. `cd ~/Documents/projects/michael-speckit-presets`
2. 在 `presets/<id>/` 下改对应文件 + bump version in `preset.yml`
3. 开 PR + auto-merge（参考 [git-workflow](../../docs/conventions/git-workflow.md) AI agent 默认接 auto-merge）
4. 回 mono 跑 `~/Documents/projects/michael-speckit-presets/scripts/install.sh --repo . --preset <id>` re-install
5. mono 这边 commit 是"install `<id>` X.Y.Z"性质的同步 commit，**不**包含 ad-hoc 内容编辑

## 为什么

- vendored 副本是 install 复制来的。在 mono 直接改 → preset 库 git 史不知道
- 下次 install（升级 / 重装 / CI 重建）会按 preset 库 main 内容**静默覆盖**，把直接改的内容擦掉
- mono CI / typecheck / lint 全绿不暴露（mono 自己用的就是 vendored 副本），只在 "去 preset 库找代码" 时才暴露 drift
- 实证：mono PR #80 (PR-T1) / #82 (PR-T3) / #84 (P5) 连撞 3 次此模式，要 PR #14 in `michael-speckit-presets` 把 5 文件 +109/-5 行回流补救

## 例外

- `.specify/presets/.registry` / `.specify/presets/.install.log` / `.specify/presets/.cache/` — install.sh 维护的状态文件，由 install 自己管，**不属于** vendored content。`install.sh` 跑时自动更新
- mono 自己的 `scripts/ci/server-boot-smoke.ts` 等不在 `.specify/presets/<id>/` 下的脚本可以直接改

## 修改前必读

- preset 机制权威说明（spec-kit 4 层 resolver + `strategy: replace` 真正语义）：[`michael-speckit-presets/PRESET-MECHANISM.md`](https://github.com/xiaocaishen-michael/michael-speckit-presets/blob/main/PRESET-MECHANISM.md)
- 不理解 4 层 resolver 之前不要碰 `strategy:` / 不要乱 install
