# Plan: 生产 cutover — mono server drop-in 替换 meta server（Aliyun SWAS）

> ✅ **EXECUTED 2026-05-24** — mono server 已上线 `https://api.xiaocaishen.me`，meta 完全退役。
> 全 5 phase 完成 + 端到端验证通过（4 容器 healthy / migrate 应用 3 migration / public HTTPS smoke / phone-sms-auth mock 一条龙 200）。Hand-on 复跑步骤见 [`ops/runbook/prod-cutover.md`](../../../ops/runbook/prod-cutover.md)。
>
> **执行中实际偏差（plan 外发现，已处理）**：
>
> 1. **dry-run 抓出 2 个 CI 漏网 bug**（PR validation 的 Docker build job 是 skipping，从不真 build 镜像）→ 修复合入 #145：(a) 根 `postinstall` 的 `lefthook install` 在无 git 的 alpine builder 失败 → 加 git guard；(b) healthcheck 用 `localhost` 撞 alpine IPv6 `::1` → app 只绑 IPv4 → 永 unhealthy → 改 `127.0.0.1`。
> 2. **Prisma migrate URL**：Prisma 7 禁 schema 内 `url`（P1012）→ 走既有 `prisma.config.ts`（`datasource.url=process.env.DATABASE_URL`）；`prisma`+`dotenv` 转 prod dep。
> 3. **ACR 用户名格式**：个人版 docker login 用户名是 `mbw-server@<accountID>`（**无** `.onaliyun.com` 后缀），密码是访问凭证「固定密码」非控制台登录密码。
> 4. **镜像传输**：build-image 只产 `linux/amd64`；SWAS clone 撞 GFW（TLS termination）→ 用 `docker save | ssh | docker load` 从已登录的本机推镜像，绕开 box ACR login + GFW。
> 5. **cron 接管**：meta 的 backup-pg / certbot-renew cron 改指 mono（容器名 `nvy-tight-*` + volume `nvy-tight_nvy-letsencrypt`）；backup 实跑验证 OSS 上传通。
>
> 关键安全性质：mono 用独立 volume，cutover 只**停** meta 不改 meta 数据 → 回滚 = 起回 meta（数据卷 `mbw-tight_*` 原封不动）。

## Context

`no-vain-years-mono` 的 NestJS server 要**实际部署到阿里云 SWAS，彻底替换正在跑的 meta server**（`my-beloved-server`，Spring）。这是 4-plan DEFER review 里剩下的「真待办：生产 cutover」，也是 Plan 3 上线的核心一步。决策早已锁定在 [ADR-0026](../adr/0026-backend-deployment-topology.md)（A-Tight v2 复用 + 7 决策 D1-D7），CI 机器（`build-image.yml` / `deploy.yml` / `docker-compose.tight.yml` / `.env.production.example`）也已 ship（#134/#135）。本 plan 把「机器就绪」推进到「真上线」，补齐 3 个 blocker + 跑完 cutover。

**形态**：单 SWAS 实例复用 meta 那台；PG/Redis 同机 docker compose `drop+recreate`（M1.1 内测前**零真实用户数据**，数据全清可接受 per ADR-0026 D2/D3）；ACR 镜像 repo `mbw_xcs/mbw-app` 复用；域名 `api.xiaocaishen.me` 复用（已备案）；meta server **完全退役**。

**已确认决策（2026-05-23）**：
1. Prisma migrate → **entrypoint 自动 migrate**（prisma 转 prod dep + 启动先 migrate deploy 再起 server）
2. 破坏性 SWAS 步骤 → **我用 `!` 命令现场驱动，user 逐条批准**
3. **先本地 dry-run** 再切生产

## 当前状态（实证）

| 维度 | 状态 |
| --- | --- |
| `/healthz/live` + `/healthz/ready`（Prisma+Redis 检查）| ✅ `apps/server/src/observability/health.controller.ts` |
| Dockerfile（multi-stage / non-root / Trivy-clean / HEALTHCHECK）| ✅ `apps/server/Dockerfile` |
| `docker-compose.tight.yml` + `.env.production.example` | ✅ |
| `build-image.yml`（tag `server-v*` / workflow_dispatch）+ `deploy.yml`（SSH）| ✅ |
| **GitHub secrets** | ❌ 只有 `RELEASE_PLEASE_PAT`；缺 `APP_SSH_KEY`/`APP_HOST`/`APP_SSH_USER`/`ACR_USERNAME`/`ACR_PASSWORD` |
| **ACR 里 mono 镜像** | ❌ 无 `server-v*` tag → build-image 从未跑 |
| **Prisma migrate 接线** | ❌ `onModuleInit` 只 `$connect`；`prisma` CLI 是 devDep；datasource **无 `url`**（obs 4743 实证 migrate deploy 会因缺 URL 失败）|
| **`ops/nginx/conf.d/`** | ❌ mono 不存在；compose 挂载它，nginx 起不来。meta 有 `ops/nginx/conf.d/mbw.conf` 可改 |

## Phase 0 — Repo 改动（我做，PR 合 main；cutover 前必须 merged）

> SWAS clone 靠 `git pull origin main` 拿这些文件 + 镜像靠 build-image 打包 entrypoint/prisma 修复，所以这些必须先进 main。

### 0.1 Prisma migrate 接线（entrypoint 自动 migrate）

**关键**：driver-adapter 模式 datasource 无 `url`，CLI migrate 会失败 → 必须补 `url`。

- `apps/server/prisma/schema.prisma`：datasource 加 `url = env("DATABASE_URL")`（运行时 app 用 `PrismaPg` adapter，此 `url` 仅 CLI migrate/introspect 用，不影响 adapter 运行时）
- `apps/server/package.json`：`prisma` 从 devDependencies → dependencies（prod 镜像才有 CLI；`@prisma/client` + `@prisma/adapter-pg` 已是 prod dep）
- 新建 `apps/server/docker-entrypoint.sh`：
  ```sh
  #!/bin/sh
  set -e
  node_modules/.bin/prisma migrate deploy --schema=./prisma/schema.prisma
  exec node dist/main.js
  ```
- `apps/server/Dockerfile` runner stage：`COPY` entrypoint + 设 `ENTRYPOINT ["sh","/app/docker-entrypoint.sh"]`（替换现 `CMD ["node","dist/main.js"]`）；确认 `/deploy` 带进了 `prisma/`（schema + migrations）—— dry-run 验
- 验证点：`DATABASE_URL` compose 已注入 ✅；migrate deploy idempotent（已应用的 migration 跳过）→ 每次 deploy 安全重跑

### 0.2 nginx 反代配置（adapt meta `mbw.conf`）

- 新建 `ops/nginx/conf.d/mono.conf`，从 meta `my-beloved-server/ops/nginx/conf.d/mbw.conf` 改：
  - `proxy_pass http://app:8080` → **`http://app:3000`**
  - 删 `/actuator/*` 段；按需 block `/metrics`（mono prometheus 端点，仅内网）
  - 保留 default_server（80/443 bare-IP → 444）+ `location = /healthz { return 200 "ok" }`（compose nginx healthcheck 打 `http://localhost/healthz` 靠它转 healthy）
  - 保留 `server_name api.xiaocaishen.me` + Let's Encrypt cert 路径 `/etc/letsencrypt/live/api.xiaocaishen.me/{fullchain,privkey}.pem` + acme-challenge location + 80→443 redirect
- 可选：`ops/runbook/` 落一份 mono cutover runbook（adapt meta `single-node-deploy.md` + `backup-pg.sh`），便于复跑

### 0.3 PR 策略

Phase 0 可合一个 PR（`feat(server): wire prisma migrate-deploy entrypoint + nginx reverse-proxy config for prod cutover`）或拆 2 个（migrate 接线 / nginx conf）。**注意**：改 Dockerfile/entrypoint/prisma 触 `nx affected` server 链，CI 会真跑 build + runtime-smoke；本地先 `pnpm exec nx affected -t lint typecheck test build runtime-smoke --base=origin/main` 拿绿再开 PR（per pr-creation-protocol 部署 gate）。

## Phase 1 — 本地 dry-run（验镜像 / migrate / 启动）

目的：在碰生产前确认镜像能 build、entrypoint migrate deploy 成功、app boot + `/healthz/ready` 绿。**不含 nginx/cert/DNS**（那些只能 SWAS 上验）。

1. 本地 build：`docker build -f apps/server/Dockerfile -t mbw-app:dryrun .`（repo root context）→ verify：build 成功 + Trivy 本地可选扫
2. 临时 `.env.dryrun`（本地随机 DB/Redis 密码 + `AUTH_JWT_SECRET`/`SMS_CODE_HMAC_SECRET` = `openssl rand -hex 32` + `SMS_GATEWAY=mock` + `CORS_ALLOWED_ORIGINS=http://localhost`）
3. `MBW_APP_IMAGE=mbw-app:dryrun docker compose -f docker-compose.tight.yml --env-file .env.dryrun up -d postgres redis app`（**不起 nginx**）
   → verify：`docker compose ps` app `healthy`；`docker compose logs app` 见 migrate deploy 应用 3 个 migration（`0_init`/`1_add_outbox_event`/`2_drop_legacy_modulith_flyway_tables`）+ Nest boot；`curl localhost:3000/healthz/ready` → 200（Prisma+Redis 通）
4. 排错重点：datasource url 缺失 / prisma CLI 不在镜像 / `/deploy` 没带 prisma migrations（若缺 → Dockerfile 显式 `COPY apps/server/prisma`）
5. teardown：`docker compose -f docker-compose.tight.yml --env-file .env.dryrun down -v`

**dry-run 全绿 = 镜像放行进 Phase 2。**

## Phase 2 — 凭证 + SWAS 预备（user 持有凭证，我引导）

### 2.1 GitHub secrets（user 加，值复用 meta）
`gh secret set <NAME> --repo xiaocaishen-michael/no-vain-years-mono`，5 个：
- `ACR_USERNAME` = RAM 子用户 `mbw-server@<accountid>.onaliyun.com`
- `ACR_PASSWORD` = ACR 个人版固定密码
- `APP_HOST` = SWAS 公网 IP（meta 那台，如 `101.133.128.62`）
- `APP_SSH_USER` = `admin`
- `APP_SSH_KEY` = SWAS SSH 私钥（PEM）

### 2.2 SWAS 预备（我用 `!`/SSH 驱动，user 批准）
- clone mono 到 `/home/admin/no-vain-years-mono`（deploy.yml 硬编码路径）
- `cp .env.production.example .env.production` → 填：`DB_PASSWORD`/`REDIS_PASSWORD`/`AUTH_JWT_SECRET`/`SMS_CODE_HMAC_SECRET`（`openssl rand -hex 32`，AUTH_JWT_SECRET 纸质备份）+ `CORS_ALLOWED_ORIGINS`（per ADR-0025 Cloudflare Pages host）+ `SMS_GATEWAY=mock`；`chmod 600`
- 证书：复用 meta 已有 `/etc/letsencrypt/live/api.xiaocaishen.me/`（meta 退役不删证书）→ 拷进 mono 的 `nvy-tight_nvy-letsencrypt` volume

## Phase 3 — 打第一个 mono 镜像 → ACR（我触发）

- 触发 `build-image.yml`：`gh workflow run build-image.yml -f tag=server-v0.0.1 --repo ...`（workflow_dispatch 手动 tag 路径，免依赖 release-please）→ ACR 出 `mbw_xcs/mbw-app:v0.0.1` + `latest`
- verify：ACR 控制台 / `docker pull` 确认镜像在；tag = `v0.0.1`（`server-` 前缀已 strip）

## Phase 4 — Cutover（破坏性，我用 `!` 现场驱动，user 逐条批准）

> ⚠️ 不可逆段：停 meta + drop PG/Redis。M1.1 零真实用户，数据全清已 per ADR-0026 接受。**端口冲突**：meta `mbw-tight` 与 mono `nvy-tight` 抢 80/443/5432/6379/3000 → 同时只能一个跑，先彻底停 meta。

1. （可选保险）`pg_dump` meta 库 → `mbw-oss` 留一份（即便要丢，先证明备份链通）
2. **停 + 移除 meta 全栈**：`docker compose -f <meta>/docker-compose.tight.yml --env-file <meta>/.env.production down`（含 nginx，释放 80/443）→ 确认 `docker ps` 无 `mbw-tight-*`（释放内存，per risk 表）
3. mono SWAS：`docker login` ACR → `docker compose -f docker-compose.tight.yml --env-file .env.production pull`
4. **起 mono 全栈**：`docker compose -f docker-compose.tight.yml --env-file .env.production up -d`（postgres+redis+app+nginx；app entrypoint 自动 migrate deploy 建 schema）
5. verify：`docker compose ps` 四服务 healthy；`docker compose logs app` 见 migrate + boot；本机 `curl localhost:3000/healthz/ready` 200

## Phase 5 — 验收 + meta 退役 + 收尾

- 公网 smoke：`curl -fsS https://api.xiaocaishen.me/healthz/live` → 200（验 nginx + 反代 + 证书 + DNS）；`/healthz/ready` 200
- 业务 smoke：phone-sms-auth 一条龙（`SMS_GATEWAY=mock` 看 log 拿 code → 换 token）；mobile api-client 指向新域名实测
- 续签 cron（adapt meta）：certbot renew → 拷 mono volume + `docker exec nvy-tight-nginx-1 nginx -s reload`
- 备份 cron：`backup-pg.sh`（adapt meta，容器名 `nvy-tight-postgres-1`）→ `mbw-oss/pg/`
- meta 彻底退役：确认 mono 稳定后，meta container 已 down + `docker rm`；meta image `v0.X.Y` tag 在 ACR 保留作 emergency rollback
- 后续 deploy 自动化：之后 `server-v*` tag（release-please）→ build-image → deploy.yml 自动 SSH recreate `app`（PG/Redis 不动），稳态无需手动

## Rollback

| 触发 | 动作 |
| --- | --- |
| mono 启动失败 / smoke 红 | `.env.production` `MBW_VERSION=<meta v0.X.Y>` → `docker compose down` mono → 起 meta compose（meta image 仍在 ACR）；PG/Redis 从 Phase4.1 备份恢复（24h 窗口）|
| 仅 app 异常（PG/Redis OK）| `docker compose up -d --force-recreate app` 回退到上一个可用 image tag |

> `latest` tag 会被 mono 覆盖（meta 完全退役场景可接受）；rollback 用 meta 的 immutable `v0.X.Y` tag，不靠 `latest`。

## 关键文件

- 改：`apps/server/prisma/schema.prisma`（datasource url）/ `apps/server/package.json`（prisma→dep）/ `apps/server/Dockerfile`（entrypoint）/ 新建 `apps/server/docker-entrypoint.sh` + `ops/nginx/conf.d/mono.conf`
- 既有（不改，执行依据）：`docker-compose.tight.yml` / `.env.production.example` / `.github/workflows/{build-image,deploy}.yml` / `apps/server/src/observability/health.controller.ts`
- adapt 源（meta，read-only）：`my-beloved-server/ops/nginx/conf.d/mbw.conf` / `ops/runbook/{single-node-deploy.md,backup-pg.sh,ecs-bootstrap.sh}`

## Verification（端到端）

1. 本地 dry-run：镜像 build + migrate deploy 应用 3 migration + `/healthz/ready` 200（Phase 1）
2. ACR：`mbw_xcs/mbw-app:v0.0.1` 存在（Phase 3）
3. SWAS：四服务 healthy + `docker logs app` 见 migrate（Phase 4.5）
4. 公网：`curl https://api.xiaocaishen.me/healthz/live` 200 + phone-sms-auth 一条龙过（Phase 5）
5. meta：无 `mbw-tight-*` 容器残留（退役确认）

## On Ship

- 本 plan scratch 路径 `docs/plans/generic-pondering-umbrella.md`；落地时 `git mv` 到 `docs/plans/2026-05/05-23-prod-cutover-meta-to-mono-swas.md`（per docs-organization）
- cutover 完成后回写：4-plan DEFER 账「生产 cutover」→ ✅ done；ADR-0026 Phase 3 验收 deploy+cutover 实证项打勾
- 注：iCloud/ufw 红线 —— SWAS **不启 ufw**（per `reference_aliyun_swas_ufw_incompat`），防火墙走 SWAS 控制台单层
