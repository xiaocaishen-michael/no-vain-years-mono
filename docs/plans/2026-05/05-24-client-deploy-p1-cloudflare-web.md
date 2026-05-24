# 子 plan 1 — Cloudflare Web 部署（Workers Static Assets）

> 隶属 [客户端部署 master plan](05-24-client-deploy-web-android-ios-master.md)（Track A，独立轨）。基准：[ADR-0025](../../adr/0025-frontend-cloudflare-pages-expo-web.md)（Accepted，2026-05-24 amended：host Pages → Workers Static Assets）。
>
> ⚠️ **2026-05-24 host pivot（per ADR-0025 amendment）**：CF 合并 Workers/Pages + 官方推 Workers，本 plan 改用 **Workers Static Assets**。下文凡提 "Pages" / "`_redirects`" / playbook Pages bootstrap，按以下实际方案读：
>
> - repo root `wrangler.jsonc`（`assets.directory: ./apps/mobile/dist` + `not_found_handling: "single-page-application"`）已加；`apps/mobile/public/_redirects` 已移除（Workers 不处理 `_redirects`，SPA 回退改用 `not_found_handling`；`wrangler deploy --dry-run` 已验证读到 dist 42 文件）
> - dashboard 走 **Workers & Pages → Create → Workers**（Git 连接 Workers Builds）：build cmd `corepack enable && pnpm install --frozen-lockfile && pnpm -C apps/mobile build:web`、deploy cmd `npx wrangler deploy`、env `EXPO_PUBLIC_API_BASE_URL=https://api.xiaocaishen.me` + `NODE_VERSION=22` + `PNPM_VERSION=10.33.2`
> - 默认 URL 是 `<name>.<account>.workers.dev`（非 `*.pages.dev`）；用户实际入口仍是自定义域 `app.xiaocaishen.me`（已在 CORS allowlist）。**注意**：`app.xiaocaishen.me` 当前 CNAME 指向旧 meta 项目 `no-vain-years-app.pages.dev`，迁到新 worker 需先从旧项目摘除该自定义域（详见操作交接）

## Context

服务端已上线 `https://api.xiaocaishen.me`（Aliyun SWAS，已备案）。本子 plan 把 `apps/mobile` 的 Expo Web export（已能产出 `dist/`）首次部署到 Cloudflare Pages，让浏览器可访问登录主流程——PoC 阶段最快验证用户路径的形态（无下载 / 无审核）。

## 关键现状核实（2026-05-24 grep 实证）

| 项 | 现状 | 影响 |
|---|---|---|
| server CORS 接线 | **已完整**：`apps/server/src/main.ts:39` `fastifyCors({ origin: parseOrigins(cfg.corsAllowedOrigins) })` + `config/app.config.ts:17` 读 `CORS_ALLOWED_ORIGINS`（默认 `*`） | repo 侧无需改代码 |
| `.env.production.example:24` | **已含** `CORS_ALLOWED_ORIGINS=https://app.xiaocaishen.me,https://no-vain-years-mono.pages.dev` | repo 侧 CORS 配置无需改动 |
| `apps/mobile/public/` | 原**不存在** → 本 PR 新建 `public/_redirects` | 唯一新增 repo 文件 |
| build target | `expo export -p web` → 输出 `dist/`（`project.json:45`） | verify 用现成 target |

⇒ **repo 侧改动极小：1 个 `_redirects` 文件**；其余全是 user 手动 console / SSH 步骤。

## A. Repo 侧（agent，本 PR）

1. ✅ 新建 `apps/mobile/public/_redirects`，单行 `/*    /index.html   200`（SPA fallback）
   → verify：`pnpm -C apps/mobile build:web` 后 `apps/mobile/dist/_redirects` 存在（已验证：expo 把 `public/` 拷入 `dist/`）
2. ✅ 回填 playbook § SPA fallback「现状」→ 标记已创建
3. ✅ master plan + 本子 plan 落 `docs/plans/2026-05/`

## B. Host / Console 侧（user 手动，agent 提供精确命令）

> agent 不能登 CF dashboard / SSH SWAS；以下 user 执行（交互登录用 `! <cmd>`）。**这些步骤在本 PR merge 后做**（CF Pages 从 main 拉取 build）。

1. **SWAS `.env.production` CORS**：确认实际 secret 文件含
   `CORS_ALLOWED_ORIGINS=https://app.xiaocaishen.me,https://no-vain-years-mono.pages.dev`
   （cutover 时若设 `*` 或未设 → web 跨域被拒）→ 在 mono 目录跑 `docker compose -f docker-compose.tight.yml --env-file .env.production up -d` 应用。**必须带 `--env-file .env.production`**（compose 镜像/DB/secret 全是 `${VAR}` 插值，缺省会退化成 `:latest` 触发私有 ACR 拉取 + 空 secret，per [prod-cutover runbook](../../../ops/runbook/prod-cutover.md) §86）。
   注：native Android/iOS 不受影响（不发 Origin、不走 CORS）
2. **CF console bootstrap**（playbook § Bootstrap）：Connect Git `xiaocaishen-michael/no-vain-years-mono` → project `no-vain-years-mono` / branch `main` / framework preset **None** / build cmd `corepack enable && pnpm install --frozen-lockfile && pnpm -C apps/mobile build:web` / output `apps/mobile/dist` / root `/` / env `EXPO_PUBLIC_API_BASE_URL=https://api.xiaocaishen.me` + `NODE_VERSION=22` + `PNPM_VERSION`（对齐 root `package.json` `packageManager`）
3. **自定义域**：CF Pages → Custom domains → `app.xiaocaishen.me`（同账号自动 CNAME + Universal SSL）

## C. Smoke test（playbook § Smoke test，每次 deploy 后）

1. `curl -fsSL -o /dev/null -w '%{http_code}\n' https://app.xiaocaishen.me` → 200
2. `curl … https://app.xiaocaishen.me/login` → 200（SPA fallback，非 404）
3. CORS preflight echo（per playbook 命令）→ `access-control-allow-origin: https://app.xiaocaishen.me`
4. 浏览器开 `https://app.xiaocaishen.me` → phone-sms-auth 登录 → 主流程跑通，打到 prod API

## 已知坑 / defer

- preview 分支 URL `<hash>.no-vain-years-mono.pages.dev` 每次变，`parse-origins.ts` 只认字面值不支持 `*.pages.dev` 通配 → 生产 main 部署到 `no-vain-years-mono.pages.dev`（已在 allowlist）不受影响；preview CORS 按 playbook (a) 临时加 URL / (b) 扩 `parseOrigins` regex（YAGNI defer）
- 国内访问首屏延迟（CF 海外 PoP）→ ADR-0025 已记，多省实测后再评 mirror/Vercel（OOS）
