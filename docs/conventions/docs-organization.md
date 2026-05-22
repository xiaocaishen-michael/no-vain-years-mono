# Docs 文件组织约定

**约束范围**：`docs/plans/` 与 `docs/experience/`。

**不受此约束**：`docs/daily/`（已有 `YYYY-MM-DD.md` 一日一文体例）/ `docs/conventions/` / `docs/adr/`（ADR 走 `NNNN-<slug>.md` 编号体例）/ `docs/spec/`。

## 命名

新建文件按 `MM-DD-<kebab-slug>.md`：

- `MM-DD`：创建当日（本地时区，零填充），如 `05-21`
- `<kebab-slug>`：从主题提取 kebab-case 3-5 词；含关键名词 + 动作/状态。**避免泛词**（`notes` / `misc` / `tmp` / `update`）
- 文件名总长 ≤ 60 字符
- 同日同 slug 撞名 → 末尾加 `-2` / `-3` 递增

示例：

- `05-21-archive-memory-bridge.md`
- `05-21-orval-migration-postmortem.md`
- `04-28-server-auth-pivot-decision.md`

## 目录结构

按 `YYYY-MM/` 月度子目录归档：

```text
docs/plans/
  2026-04/
    04-28-server-auth-pivot-decision.md
  2026-05/
    05-21-archive-memory-bridge.md
docs/experience/
  2026-05/
    05-13-dependabot-react-pair.md
```

新建文件时，若当月目录不存在则创建。

## 设计取舍

| 维度                | 选择                            | 原因                                                     |
| ------------------- | ------------------------------- | -------------------------------------------------------- |
| MM-DD 数字前缀      | 而非纯语义命名                  | `ls` 自然按时间排，无需 `--sort=time`                    |
| YYYY-MM/ 月度子目录 | 而非季度 / 年度                 | 月堆积 ≥ 20 时单目录浏览受阻；季度过粗失分辨率           |
| MM-DD 不含年份      | 年份在父目录                    | 文件名不冗余；避免与 daily 体例 `YYYY-MM-DD.md` 视觉混淆 |
| kebab-case slug     | 与 git-workflow.md 分支命名一致 | 项目内体例一致                                           |
