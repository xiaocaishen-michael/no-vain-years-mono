# Phase 3 Sub-Plan — PR / CI / lefthook + 部署 workflows meta→mono 迁移

> **Scratch 路径**：`docs/plans/enchanted-skipping-raven.md`；ship 时 `git mv` 到 `docs/plans/2026-05/05-23-claude-config-meta-to-mono-p3-automation.md`（per master plan § 跨阶段决策 表）。
>
> <!-- AMENDS-MASTER --> 本 sub-plan 反推 master plan § Out of Scope「不迁 build-image.yml / deploy.yml / release-please.yml 等 Plan 3 范围（DEFER plan3）」— user 确认技术架构已清楚（A-Tight v2 复用原则）+ 7 决策已锁 → 同 Phase 3 内完成 build-image / deploy migration。release-please.yml mono 已有 → DROP mono-already-superior 不变。

## Context

Phase 1 完成 `CLAUDE.md` 内容层（7 sub-PR）。Phase 2 完成 `.claude/` 加载层（3 sub-PR + orphan）。Phase 3 范围 = 强制层（`lefthook.yml` / `.github/workflows/`）+ 部署 workflows（build-image / deploy）。

User 决策 7 项部署 topology（ADR-0026 7 决策点）已锁定 + **mono = meta-server 的 drop-in replacement**（A-Tight v2 资源复用），本 sub-plan 起手先 Pre-Phase-3 PR 更新 ADR-0026 stub → Accepted 含 A-Tight v2 继承细节，再启 Phase 3 子 PRs。

## ADR-0026 决策锁定（user 2026-05-23 confirmed，含 A-Tight v2 继承）

### 7 决策表（user 锁定）

| # | 决策点 | 锁定值 | 来源 |
|---|---|---|---|
| D1 | Compute 形态 | **SWAS 单实例** | 复用 meta-server 同一台 SWAS |
| D2 | DB 托管 | **SWAS 同机 docker compose `postgres:16-alpine`** | drop + recreate（zero data preservation；走 `prisma migrate deploy` + seed） |
| D3 | Redis 托管 | **SWAS 同机 docker compose `redis:7-alpine`** | drop + flush all keys |
| D4 | Secrets 注入 | **volumes mount**（per ADR-0037 § secrets） | `.env.production` 文件 → docker compose volume，文件权限 + .gitignore 双保险 |
| D5 | 镜像 registry | **阿里云 ACR 个人版 `crpi-uy44w7zpjef3f9w1.cn-shanghai.personal.cr.aliyuncs.com/mbw_xcs/mbw-app`** | namespace + repo 名 全复用 meta image 位置（drop-in image replacement，.env.production 引用不变） |
| D6 | CI/CD pipeline | **GitHub Actions → SSH deploy** | 复用 meta workflow 体例（`APP_SSH_KEY` / `APP_HOST` / `APP_SSH_USER` secrets 复用 + `ACR_USERNAME` / `ACR_PASSWORD` 复用） |
| D7 | 备案 / 域名 | **国内备案 + 大陆 SWAS，复用 `api.xiaocaishen.me`** | meta 时代已备案；mono 接管不需重新备案 |

### A-Tight v2 继承（per [meta ADR-0002 Update 2026-04-30](https://github.com/xiaocaishen-michael/no-vain-years/blob/main/docs/adr/0002-deployment-a-tight.md#update-2026-04-30-a-tight-重新激活附两处偏差) + [meta ADR-0012 Amendment 2026-04-30](https://github.com/xiaocaishen-michael/no-vain-years/blob/main/docs/adr/0012-deployment-a-split.md#amendment-2026-04-30-撤回到-a-tight本-adr-标-superseded)）

| 项 | 继承决策 |
|---|---|
| 数据盘 | **不挂** — PG/Redis 数据落系统盘；保护机制：`pg_dump → OSS mbw-oss` daily 备份（24h loss window 可接受 M1.1 内测前） |
| 对象存储 | **直接接 `mbw-oss` bucket + RAM 子用户 `mbw-server`** — 不启用 MinIO（per ADR-0012 drop-MinIO 决策） |
| Email 通道 | **Resend HTTPS API** — 复用 meta `RESEND_API_KEY` + sender@xiaocaishen.me sender domain（per ADR-0013）；mono M1.1 阶段不主动发 email，但 SDK 配置就位 |
| HTTPS / 反代 | **Nginx 反代 + Let's Encrypt SSL** — 复用 meta nginx 配，反代 path 不变 |
| SWAS bootstrap | **跳 ufw 整段**（per memory `reference_aliyun_swas_ufw_incompat` + meta ADR-0002 § 又一处偏差 2026-05-01 incident） — SWAS 简化网络模型与 ufw default deny 冲突 → 管理面失联 |
| 内存预算 | **Node ~500MB-1GB（vs meta JVM 1.5g）** — 2c4g SWAS 余量更宽松（4368t budget headroom；mono 不需 `-Xmx` 调参） |

### Drop-in replacement cutover 流程（mono 接管 meta server）

1. mono build-image push `mbw_xcs/mbw-app:server-v0.0.1`（与 meta 不撞 tag — meta 用 `v0.X.Y`，mono 用 `server-vX.Y.Z` per ADR-0042 component-in-tag）
2. SWAS 上停 meta server container（`docker compose -f docker-compose.tight.yml --env-file .env.production stop app`）
3. 改 `.env.production` `MBW_VERSION=server-v0.0.1`
4. Drop + recreate PG / Redis 数据：

   ```bash
   docker exec mbw-tight-postgres-1 dropdb -U mbw mbw
   docker exec mbw-tight-postgres-1 createdb -U mbw mbw
   docker exec mbw-tight-redis-1 redis-cli FLUSHALL
   ```

5. `docker compose pull app + up -d --force-recreate app`
6. mono server 启动后跑 `prisma migrate deploy`（首次启动 hook）+ seed
7. healthcheck 通过 → smoke 通过 → meta-server 退场完成

## Pre-Phase-3 PR — ADR-0026 stub → Accepted + A-Tight v2 继承

> ⚠️ Pre-Phase-3 PR ship 后 Phase 3 sub-PR 3.3/3.4 才能起步（依赖 ADR-0026 锁定决策）

- **改 `docs/adr/0026-backend-deployment-topology.md`**：
  - frontmatter `status: Proposed` → `Accepted (2026-05-23)`
  - sunset_trigger 改写："Plan 3 重新 scope（推 P2P / 仅本地 / SaaS 全外包）让部署形态判废"+"M3 真实用户压力 → 升 RDS+云 Redis（per ADR-0002 升级路径）"
  - `## Decision` 段改写：
    - 7 决策表显式化（chosen 候选 + 决策日期 + 联动 ADR）
    - 加 § A-Tight v2 继承 subsection（数据盘 / 对象存储 / Email / Nginx / SWAS bootstrap / 内存预算 6 项）
    - 加 § Drop-in replacement cutover 流程 subsection（7 步骤）
    - cross-link meta ADR-0002 + ADR-0012 作历史 inheritance
  - `## Consequences` 段从 "依 Decision 而定" 改具体：
    - PG/Redis 数据 drop+recreate → M1.1 内测前 OK，M2+ 100 内测起触发 RDS 切换评估
    - 复用 meta SSH key / ACR creds / OSS bucket / Resend / 域名 — 0 新基础设施 provisioning + 0 备案 lag
    - meta-server image 在 ACR 保留 latest version 作 emergency rollback target
  - `## Open Questions` 关闭 → 全 7 决策 + A-Tight v2 6 继承项已显式
- **branch**: `docs/adr-0026-deployment-topology-accepted`
- **PR title**: `docs(repo): lock ADR-0026 backend deployment topology (A-Tight v2 inherit + 7 decisions)`
- **依赖**: 无（Pre-Phase-3 独立 PR）

## Phase 3 候选 inventory + 决策表（其他层）

### PR template 决策

**Sub-PR 3.0 跳过整个**（mono 41 行 PR template 已 superior，meta 11 段候选全 DROP）。

### Workflows 决策

| 来源 workflow | 决策 |
|---|---|
| meta `spec-integrity.yml` (3 仓) | **DROP: three-repo-only** |
| meta-server `release-please.yml` | **DROP: mono-already-superior** (mono `release-please.yml` 已 ship + ADR-0042 manifest 双线) |
| meta-server `nightly-full-tests.yml` | **DROP: mono-already-superior** (mono `nightly-perf` + `nightly-sweep` strictly superior) |
| meta-server `build-image.yml` | **MIGRATE TRANSLATED**（Sub-PR 3.3）— TS/pnpm/nx 适配 + 复用 `mbw_xcs/mbw-app` repo + `server-vX.Y.Z` tag pattern |
| meta-server `deploy.yml` | **MIGRATE TRANSLATED**（Sub-PR 3.4）— SSH → 同 SWAS + drop-in replace meta container |
| **NEW: migration immutability check** | **MIGRATE 新增**（Sub-PR 3.2）— pr-validation.yml mega-job 内 step |

### Lefthook 决策

| 来源 hook | 决策 |
|---|---|
| meta-server markdownlint pre-commit | **MIGRATE 新增**（Sub-PR 3.1）per memory `feedback_markdownlint_preflight` |
| meta 其余 10 hooks | **DROP**: 全 mono-already-superior 或 stack-specific 或 three-repo-only |

## Sub-PR 拆分（Phase 3 proper）

| Sub-PR | Scope | Branch | LOC est | 依赖 |
|---|---|---|---|---|
| **3.1** | `lefthook.yml` 加 markdownlint pre-commit hook | `chore/lefthook-markdownlint-preflight` | +12-15 | 无 |
| **3.2** | `.github/workflows/pr-validation.yml` 加 migration immutability check step | `chore/ci-migration-immutability-check` | +15-20 | 无 |
| **3.3** | `.github/workflows/build-image.yml` 新建 | `chore/ci-build-image-acr` | +80-100 | **Pre-Phase-3 PR merged** |
| **3.4** | `.github/workflows/deploy.yml` + `docker-compose.tight.yml` + `.env.production.example` 新建 | `chore/ci-deploy-swas` | +200-300 | **Sub-PR 3.3 merged** |

**3.1 / 3.2 互不依赖 + 与 Pre-Phase-3 + 3.3/3.4 互不依赖可并行起**；3.3 → 3.4 串行。每个 sub-PR 同 commit amend 本 sub-plan 的 Sub-PR 表（per Sub-PR 1.3-1.7 / Sub-PR 2.x 模式）。

## Per-sub-PR 执行细节

### Sub-PR 3.1 — lefthook markdownlint pre-commit hook

- **跨仓 read**：meta-server `lefthook.yml` § markdownlint（已读）
- **MIGRATE TRANSLATED**：插入 `lefthook.yml` pre-commit commands：

  ```yaml
  markdownlint:
    tags: lint
    glob: '*.md'
    # Per memory feedback_markdownlint_preflight — pre-flight catches
    # MD028/MD031/MD040/MD025 etc. before push 省 CI cycle.
    # Config single source: .markdownlint-cli2.jsonc (MD032 disabled).
    # CI mirror: .github/workflows/ci.yml markdownlint job runs same config.
    # Emergency exit: git commit --no-verify.
    run: pnpm exec markdownlint-cli2 {staged_files}
  ```

### Sub-PR 3.2 — CI migration immutability check

- **MIGRATE 新增 step**：插入 `pr-validation.yml` `validate-and-test` job 内 `Run Nx Affected Pipeline` step 之前：

  ```yaml
  - name: Enforce migration immutability (per ADR-0035 + .claude/rules/migration-rules.md)
    run: |
      modified=$(git diff origin/main --diff-filter=MD --name-only \
        | grep -E '^apps/server/prisma/migrations/[^/]+/migration\.sql$' \
        || true)
      if [ -n "$modified" ]; then
        echo "❌ Migration immutability violation"
        echo "$modified" | sed 's/^/  - /'
        exit 1
      fi
  ```

### Sub-PR 3.3 — `build-image.yml`（A-Tight v2 复用 ACR）

- **跨仓 read**：meta-server `build-image.yml`（已读，92 行）
- **MIGRATE TRANSLATED**：
  - 触发：`push: tags: ['server-v*.*.*']`（per ADR-0042 component tag，区分 mobile 不触发 server build）+ `workflow_dispatch`
  - `env`: `ACR_REGISTRY=crpi-uy44w7zpjef3f9w1.cn-shanghai.personal.cr.aliyuncs.com` + `ACR_NAMESPACE=mbw_xcs` + `ACR_REPOSITORY=mbw-app`（**全复用 meta**）
  - Build: 不需 mvn；mono `apps/server/Dockerfile` 是 multi-stage TS/pnpm/nx，buildx 直 build context = repo root
  - Tag resolution: `${GITHUB_REF_NAME}` = `server-vX.Y.Z` → strip `server-` 得 `vX.Y.Z`，image tag = `vX.Y.Z` + `latest`（与 meta image `v0.X.Y` 不撞 because version range 不同 + 同 `latest` 由本 workflow 推后会覆盖 meta `latest`，meta 退役后 deploy 用 mono `latest`）
  - secrets: `ACR_USERNAME` / `ACR_PASSWORD`（**复用 meta**，user 不必重新配）
- **DROP 段**：meta JDK setup comment（mono 无 JVM）；mvn package 步骤

### Sub-PR 3.4 — `deploy.yml` + `docker-compose.tight.yml` + `.env.production.example`

- **跨仓 read**：meta-server `deploy.yml`（已读，158 行）+ meta-server `docker-compose.tight.yml` + `.env.production.example`（待 ship 前 read 一次实证）
- **MIGRATE TRANSLATED + 新建**：
  1. **`.github/workflows/deploy.yml`** — 几乎 1:1 复用 meta：
     - 触发：`workflow_run: workflows: [Build & Push Image]` + `workflow_dispatch`
     - SSH agent + heredoc remote bash pattern 不变
     - SWAS path: `/home/admin/no-vain-years-mono`（mono 仓 clone path，user side 准备）
     - container 名: `nvy-tight-app-1`（mono compose project name 区分 meta `mbw-tight`）
     - healthcheck endpoint: `/healthz/live`（per mono Dockerfile HEALTHCHECK 实证）
     - 公网 smoke: `curl -fsS https://api.xiaocaishen.me/healthz/live`（**复用域名 + 备案**）
     - secrets 全 reused: `APP_SSH_KEY` / `APP_HOST` / `APP_SSH_USER` / `ACR_USERNAME` / `ACR_PASSWORD`
  2. **`docker-compose.tight.yml`**（mono 仓根新建，** mostly copy meta 体例**）:
     - `name: nvy-tight`（区分 meta `mbw-tight`，可并跑同 SWAS）
     - `app`: `image: ${MBW_APP_IMAGE:-crpi-...mbw-app}:${MBW_VERSION:-latest}` + healthcheck + restart policy + `.env.production` volume mount + Nginx upstream 配置
     - `postgres`: `postgres:16-alpine` + named volume `nvy-tight-pg-data` + healthcheck + 端口 5432 only intranet
     - `redis`: `redis:7-alpine` + named volume `nvy-tight-redis-data` + healthcheck + 端口 6379 only intranet
     - `nginx`: 复用 meta 配 `nginx.conf` 体例（反代 + Let's Encrypt） / 或先 stub 后续 follow-up
     - **不挂 MinIO**（per A-Tight v2 继承）
     - **不挂 data 独立 volume**（per A-Tight v2 继承，volumes 落 SWAS 系统盘）
  3. **`.env.production.example`**（mono 仓根新建）:
     - 列必填 keys: `POSTGRES_PASSWORD` / `REDIS_PASSWORD` / `JWT_SECRET` / `MBW_VERSION` / `MBW_APP_IMAGE` (optional override) / `RESEND_API_KEY` (复用 meta) / `ALIYUN_SMS_*` / `ALIYUN_OSS_*` (复用 meta `mbw-oss` bucket creds) / 等
     - 注释 "复制到 .env.production 后填，不进 git"
  4. **mono `.gitignore`** 加 `.env.production`

- **Cutover 流程** 文档化 in PR description（per ADR-0026 § Drop-in replacement cutover 7 步骤）
- **依赖外部 prep**：
  - User side: SWAS 已就绪（meta 那台，复用）；meta-server container 准备退役；ACR/SSH/OSS/Resend creds 全复用 meta secrets

## 4 步流程（per sub-PR）

1. 跨仓 read meta 原文
2. 决策 + 改 mono 正式文件
3. **Post-edit 全文 self-audit**
4. **🛑 人肉 review pause**

## Phase 3 验收

- ☐ Pre-Phase-3 ADR-0026 锁定 + merged
- ☐ Sub-PR 3.1 / 3.2 / 3.3 / 3.4 全 merged
- ☐ markdownlint pre-flight 实证：本地 `pnpm exec markdownlint-cli2 docs/conventions/*.md` 0 false positive
- ☐ migration immutability check dry-run 实证：mock M/D migration → CI exit 1
- ☐ build-image dry-run 实证：手动 push `server-v0.0.1` tag → ACR 出现 `mbw_xcs/mbw-app:v0.0.1`
- ☐ deploy + cutover 实证：手动 workflow_dispatch + tag → SWAS 上 mono container 替换 meta + healthcheck 通过 + `https://api.xiaocaishen.me/healthz/live` smoke 通过

## Sub-PR ship 顺序

```text
Pre-Phase-3 PR (ADR-0026 lock) ────┐
                                   ├──→ Sub-PR 3.3 (build-image)
Sub-PR 3.1 (lefthook markdownlint) │       │
Sub-PR 3.2 (CI immutability)       │       ↓
(任意并行 / 不依赖 ADR)            │   Sub-PR 3.4 (deploy + compose + env + cutover)
                                   │
                                   └──→ 全 ship → Phase 3 全 done → 3-phase claude-config migration 完成 → 整体终局验收
```

## Out of Scope（Phase 3 不做）

- ❌ `.github/pull_request_template.md` 改动（mono superior）
- ❌ `.github/workflows/spec-integrity.yml`（three-repo-only）
- ❌ `.github/workflows/nightly-full-tests.yml`（mono nightly-perf + nightly-sweep superior）
- ❌ `.github/workflows/release-please.yml` 改动（mono superior + ADR-0042）
- ❌ `lefthook.yml` 其他 hooks（全 mono-already-superior 或 stack-specific）
- ❌ `.claude/settings.json` allow 清单 enrich（per master plan，走 `/fewer-prompts` skill 独立路径）
- ❌ RDS / 云 Redis 切换 评估（per ADR-0026 升级路径，M3+ 真用户压力触发）
- ❌ K8s / Serverless / 备案 后续运维（per ADR-0026 D1/D7 决策已锁定 SWAS + 国内备案）

## Risk + Rollback

| 风险 | 缓解 |
|---|---|
| Sub-PR 3.1 markdownlint pre-commit 撞既存 violation 阻 commit | 首次 ship 前本地 dry-run 实证不撞 |
| Sub-PR 3.4 cutover 时 mono server 启动失败 | meta-server image 在 ACR 保留（drop-in 同 repo `latest` tag 会被 mono 覆盖，但 `v0.X.Y` tag 仍可 rollback）；SWAS 上 backup 一份 `.env.production` 旧版本 |
| Drop database 误操作 / 数据备份缺失 | cutover 前手动 `pg_dump → mbw-oss` 一次实证可用；M1.1 内测前无真用户数据，loss window OK |
| `mbw_xcs/mbw-app:latest` tag 覆盖 meta-server 历史 latest → meta-server 紧急回滚错乱 | meta-server 完全退役场景；如需保留 meta-server 并跑，改 mono repo 为 `mono-server`（user 已选 `保留 mbw-app` 表示 meta 完全退役）|
| SWAS 内存不够（PG + Redis + Node + Nginx + 旧 meta-server 残留）| 退役 meta-server container 必须 confirm 已 `docker rm`（占内存）；mono Node ~500MB-1GB << meta JVM 1.5g，余量更宽 |
| meta-server `mbw-tight` compose project 在 SWAS 仍跑 → 端口冲突 mono `nvy-tight` 5432/6379/3000 | cutover 前 `docker compose -f docker-compose.tight.yml down`（meta compose），再起 mono compose；同时间只能一个跑 |

## On Ship 备注

- **Pre-Phase-3 PR ship 时**：含本 sub-plan `git mv` 到 canonical 路径
- **Sub-PR 3.4 ship 后**：Phase 3 全 done；3-phase claude-config-meta-to-mono 整体 ship → user 跑 cutover 7 步骤 → meta-server 完全退役 → prompt user 跑终局验收 4 项（claude-md-audit 整仓扫 + 起新 Claude session 5 典型问题 sanity check）

## Verification（本 sub-plan 自身）

- ☐ User 在 ExitPlanMode 批准
- ☐ Pre-Phase-3 PR ship + ADR-0026 Accepted + A-Tight v2 继承显式
- ☐ Sub-PR 3.1 / 3.2 / 3.3 / 3.4 全 merge
- ☐ Phase 3 验收 6 项全过
- ☐ 本 sub-plan `git mv` 到 `docs/plans/2026-05/` 约定路径（随 Pre-Phase-3 PR ship）
- ☐ Cutover 7 步骤实操（user 主导）
- ☐ 整体 3-phase 终局验收（per master plan § 终局验收）
