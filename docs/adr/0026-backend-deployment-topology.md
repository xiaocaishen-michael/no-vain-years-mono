---
adr_id: ADR-0026
status: Accepted
applies_to: [apps/server, infrastructure]
sunset_trigger: |
  - M3+ 真实用户压力 → 升 RDS PG + 云 Redis（per meta A-Tight 部署 ADR § Migration Path）
  - Plan 3 重新 scope（推 P2P / 仅本地 / SaaS 全外包）让部署形态判废
  - SWAS 单实例资源饱和（GC frequency / P95 拉长 / 内存接顶）→ 升 ECS 4c8g 或 A-Split 拓扑
---

# ADR-0026: Backend Deployment Topology — A-Tight v2 资源复用 (mono server drop-in replacement)

- Status: Accepted (2026-05-23)
- Deciders: project owner
- Tags: backend / deployment / infrastructure / cross-cutting

## Context

[Plan 2/3](../plans/2026-05/05-19-plan2-plan3-migration-deploy.md) Phase 1（后端首次部署）决定 `apps/server`（NestJS + Fastify + Prisma）的物理部署形态。

**前置：mono 接管 meta-server**。Plan 1/2 已确认 mono 是旧 Java meta-repo `my-beloved-server` 的 drop-in replacement（per [ADR-0018](0018-backend-language-pivot.md) backend pivot）。本 ADR 锁定 mono 的部署 = **A-Tight v2 资源复用**（接管 meta 同一台 SWAS + 同 ACR 仓 + 同域名 + 同 OSS bucket + 同 Resend），原则「复用原来的资源」最小化新基础设施 provisioning。

历史 baseline：

- 后端 `apps/server` 只在本地 Docker Compose 跑过 W1.4 PoC（per `docker-compose.dev.yml`）
- meta-server 已在 SWAS（cn-shanghai）上以 A-Tight v2 形态运行（per meta [A-Tight 部署 ADR](https://github.com/xiaocaishen-michael/no-vain-years/blob/main/docs/adr/0002-deployment-a-tight.md) + Update 2026-04-30）
- 域名 `api.xiaocaishen.me` 已国内备案，meta-server 在用
- 阿里云 ACR 个人版 `crpi-uy44w7zpjef3f9w1.cn-shanghai.personal.cr.aliyuncs.com/mbw_xcs/mbw-app` 在用

## Decision

### 7 决策点（2026-05-23 锁定）

| #   | 决策点         | 锁定值                                                                      | 联动 ADR / Memory                                                                                                                                                                                                       |
| --- | -------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Compute 形态   | **SWAS 单实例**（复用 meta-server 同一台）                                  | meta [A-Tight 部署 ADR](https://github.com/xiaocaishen-michael/no-vain-years/blob/main/docs/adr/0002-deployment-a-tight.md) + memory [`reference_aliyun_swas_ufw_incompat`](memory)                                     |
| D2  | DB 托管        | **SWAS 同机 docker compose `postgres:16-alpine`**                           | drop + recreate（`prisma migrate deploy` + seed），不保留 meta Java Flyway V1-V14 schema                                                                                                                                |
| D3  | Redis 托管     | **SWAS 同机 docker compose `redis:7-alpine`**                               | drop + `FLUSHALL`，不保留 meta keys                                                                                                                                                                                     |
| D4  | Secrets 注入   | **`--env-file .env.production`（docker compose CLI flag）**                 | deploy.yml 用 `docker compose --env-file .env.production`；文件权限 + .gitignore 双保险；[ADR-0037](0037-security-credentials-governance.md) § secrets 的 `secrets:` 段 + `/run/secrets` 是未来硬化（Proposed，未实装） |
| D5  | 镜像 registry  | **阿里云 ACR 个人版 `mbw_xcs/mbw-app`**（namespace + repo 名 全复用）       | drop-in image replacement；mono push 同 repo，`server-vX.Y.Z` tag（per [ADR-0042](0042-monorepo-release-strategy.md) component-in-tag）+ `latest` 覆盖 meta latest                                                      |
| D6  | CI/CD pipeline | **GitHub Actions → SSH deploy**（复用 meta workflow 体例 + secrets）        | secrets 复用：`APP_SSH_KEY` / `APP_HOST` / `APP_SSH_USER` / `ACR_USERNAME` / `ACR_PASSWORD`                                                                                                                             |
| D7  | 备案 / 域名    | **复用 `api.xiaocaishen.me`**（meta 时代已国内备案，mono 接管不需重新备案） | 解 memory [`reference_cf_workers_to_aliyun_ecs_525`](memory) 跨境问题                                                                                                                                                   |

### A-Tight v2 继承（per meta [A-Tight 部署 ADR Update 2026-04-30](https://github.com/xiaocaishen-michael/no-vain-years/blob/main/docs/adr/0002-deployment-a-tight.md#update-2026-04-30-a-tight-重新激活附两处偏差) + [A-Split 部署 ADR Amendment](https://github.com/xiaocaishen-michael/no-vain-years/blob/main/docs/adr/0012-deployment-a-split.md#amendment-2026-04-30-撤回到-a-tight本-adr-标-superseded)）

| 项             | 继承决策                                                                                                                                                                                                                                           |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 数据盘         | **不挂** — PG/Redis 数据落 SWAS 系统盘；保护机制 = `pg_dump → mbw-oss` daily 备份（24h loss window M1.1 内测前可接受）                                                                                                                             |
| 对象存储       | **直接接 `mbw-oss` bucket + RAM 子用户 `mbw-server`**（复用 meta 已 provisioned）— 不启用 MinIO（per meta [A-Split 部署 ADR](https://github.com/xiaocaishen-michael/no-vain-years/blob/main/docs/adr/0012-deployment-a-split.md) drop-MinIO 决策） |
| Email 通道     | **Resend HTTPS API**（复用 meta `RESEND_API_KEY` + `sender@xiaocaishen.me` DKIM/SPF）；mono M1.1 阶段不主动发 email，但 SDK + secrets 配置就位                                                                                                     |
| HTTPS / 反代   | **Nginx 反代 + Let's Encrypt SSL** — 复用 meta nginx 配 + 证书 + reverse-proxy path                                                                                                                                                                |
| SWAS bootstrap | **跳 ufw 整段**（per memory [`reference_aliyun_swas_ufw_incompat`](memory) + meta A-Tight 部署 ADR § "又一处偏差" 2026-05-01 incident）— SWAS 简化网络模型与 ufw default deny 冲突 → 管理面失联                                                    |
| 内存预算       | **Node ~500MB-1GB（vs meta JVM 1.5g）** — 2c4g SWAS 余量更宽（Node + PG + Redis + Nginx ≈ 1.8GB vs 原 meta 2.86GB），不需调 `-Xmx` 类参数                                                                                                          |

### Drop-in replacement cutover 流程（mono 接管 meta server）

> **权威 compose**：仓根 `docker-compose.tight.yml` 是 prod 唯一权威（deploy.yml 实际 `docker compose -f docker-compose.tight.yml --env-file .env.production` 用它）；`infrastructure/docker-compose.yml` 仅 `secrets:`-段 stub 模板（非部署用）；`docker-compose.dev.yml` 是本地 PoC。

1. mono build-image push `mbw_xcs/mbw-app:server-v0.0.1` 到 ACR（per Sub-PR 3.3）
2. SWAS 上停 meta server container：

   ```bash
   docker compose -f docker-compose.tight.yml --env-file .env.production stop app
   ```

3. 改 SWAS 上 `.env.production`：`MBW_VERSION=server-v0.0.1`
4. Drop + recreate PG / Redis 数据（M1.1 内测前无真用户数据）：

   ```bash
   docker exec mbw-tight-postgres-1 dropdb -U mbw mbw
   docker exec mbw-tight-postgres-1 createdb -U mbw mbw
   docker exec mbw-tight-redis-1 redis-cli FLUSHALL
   ```

5. 切到 mono compose project 并起 app（per Sub-PR 3.4 deploy.yml + docker-compose.tight.yml 新建）：

   ```bash
   docker compose -f docker-compose.tight.yml --env-file .env.production down  # 停 meta compose
   # 切 mono compose 文件 (project name nvy-tight)
   docker compose -f /home/admin/no-vain-years-mono/docker-compose.tight.yml --env-file .env.production pull app
   docker compose -f /home/admin/no-vain-years-mono/docker-compose.tight.yml --env-file .env.production up -d --force-recreate
   ```

6. mono server 启动后跑 `prisma migrate deploy`（首次启动 hook）+ seed 数据
7. healthcheck `nvy-tight-app-1` healthy + smoke `curl https://api.xiaocaishen.me/healthz/live` 200 → meta-server 退场完成

## Consequences

### Positive

- **零新基础设施 provisioning** — SWAS / 备案 / 域名 / ACR / OSS / Resend / SSH key / SSL 证书 全复用 meta 已 provisioned，省 7-14 天备案 lag + 多项 setup 成本
- **零 cross-cutting service migration 风险** — 不动 PG/Redis/MinIO/OSS 体例（drop+recreate 是 mono prisma schema 自管，不靠 schema cross-stack 反推实验）
- **rollback path 明确** — meta-server image 在 ACR 保留历史 tag（`mbw_xcs/mbw-app:v0.X.Y`），如 mono 故障可改 `.env.production MBW_VERSION` 回 meta tag + 起 meta compose
- **Node 内存余量 > JVM 时代** — 2c4g SWAS 不需 `-Xmx` 调参，GC pause / P95 表现预期更稳

### Negative / Trade-offs

- **同一 SWAS 跑双 compose 临时占内存** — cutover 期间需先停 meta compose 才起 mono，无 zero-downtime（M1.1 阶段无 SLO 约束可接受）
- **`mbw_xcs/mbw-app:latest` tag 覆盖 meta 历史 latest** — meta 完全退役后 latest 永远指 mono；如临时回滚需用 immutable version tag (`v0.X.Y`)
- **同 SWAS 单点故障** — ECS 故障即全停服；可容忍 M1 阶段（升级路径见 sunset_trigger）
- **PG/Redis 数据 drop+recreate** — 每次 cutover 都全丢 dev/staging 数据；M2+ 100 内测起触发 RDS PG 评估（per meta A-Tight 部署 ADR § Migration Path）

### 中性

- **mono compose project `nvy-tight` 与 meta `mbw-tight` 命名分离** — 同 SWAS 理论可并跑（不同 compose project + 不同 container 名），但端口（5432/6379/3000）会撞，实操不并跑

## Alternatives Considered

- **新 SWAS 实例 + 新 namespace + 新域名** — 拒绝：备案 7-14 天 lag + 额外月费 + 跨域名 DNS 迁移 + Resend sender domain 重新 DKIM/SPF 验证，user 明示「复用原来的资源」原则
- **ECS + 自管 docker（meta 现 ufw 双层）** — 拒绝：SWAS 月费更低 + 单层云边界防火墙已够 M1 solo dev 阶段
- **RDS PG + 云 Redis 从 M1 起** — 拒绝：成本翻倍且无法本地化开发（per meta A-Tight 部署 ADR 同样拒绝路径）
- **K8s / Serverless** — 拒绝：over-engineered for solo dev M1-M2；NestJS + Prisma + Redis 长连接 vs Serverless cold start 不亲

## Open Questions

无（全 7 决策 + A-Tight v2 6 继承项已显式锁定）。

## References

- [Plan 2/3](../plans/2026-05/05-19-plan2-plan3-migration-deploy.md) Phase 1
- [ADR-0018](0018-backend-language-pivot.md)（backend pivot to TS/NestJS）
- [ADR-0037](0037-security-credentials-governance.md)（secrets 注入路径 D4）
- [ADR-0042](0042-monorepo-release-strategy.md)（component-in-tag `server-vX.Y.Z` D5）
- meta [A-Tight 部署 ADR](https://github.com/xiaocaishen-michael/no-vain-years/blob/main/docs/adr/0002-deployment-a-tight.md)（A-Tight 原始决策 + 2026-04-30 v2 update 含 SWAS+ufw incident）
- meta [A-Split 部署 ADR](https://github.com/xiaocaishen-michael/no-vain-years/blob/main/docs/adr/0012-deployment-a-split.md)（A-Split 撤回 amendment 含 drop-MinIO 决策）
- memory `reference_aliyun_swas_ufw_incompat`（SWAS+ufw 不兼容实证）
- memory `reference_cf_workers_to_aliyun_ecs_525`（备案 D7 驱动）
- [docs/plans/2026-05/05-23-claude-config-meta-to-mono-p3-automation.md](../plans/2026-05/05-23-claude-config-meta-to-mono-p3-automation.md) sub-plan（Phase 3 build-image / deploy 落地）
