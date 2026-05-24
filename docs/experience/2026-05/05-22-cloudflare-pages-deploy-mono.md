# Cloudflare Pages 部署 playbook — apps/mobile (Expo Web)

> ⚠️ **HOST SUPERSEDED (2026-05-24)**：host 已从 CF Pages pivot 到 **Cloudflare Workers Static Assets**（per [ADR-0025](../../adr/0025-frontend-cloudflare-pages-expo-web.md) 2026-05-24 amendment；CF 合并 Workers/Pages + 官方推 Workers）。**新部署看 [子 plan 1](../../plans/2026-05/05-24-client-deploy-p1-cloudflare-web.md) 顶部 pivot banner**（root `wrangler.jsonc` + `not_found_handling: single-page-application` + Workers Builds `npx wrangler deploy`）。本 Pages playbook 保留作 build cmd / CORS / 自定义域 / 排错 cheat-sheet 的历史参考——其中 build command、env vars、CORS allowlist、自定义域绑定逻辑在 Workers 下**仍适用**；仅「Framework preset / output directory / `_redirects` SPA fallback / Pages console 路径」是 Pages 专属、已被 Workers 方案取代。
>
> Provenance: 由 [`docs/plans/2026-05/05-22-mono-meta-frontend-gap-audit.md`](../../plans/2026-05/05-22-mono-meta-frontend-gap-audit.md) A2 衍生。ADR-0025 原拍板 Cloudflare Pages 作 `apps/mobile` web 形态 host；本文档是 0-to-ship 操作手册。
>
> **当前状态**：CORS 预留 + `.env.example` hint + 本 playbook 在 `chore/fe-trivy-fs-cors-device-tracking` PR ship；CF console 项目创建延后到 ADR-0026 backend deployment topology 决出 + Plan 3 Phase 1 入场。playbook 先就位，bootstrap 按需触发。

## 适用场景

- mono 仓 `apps/mobile`（Expo SDK 54 / metro web bundler）web 形态首次上线
- 已有 CF Pages 项目改部署 config（迁分支 / 改 build command / 加自定义域）
- 新人 onboarding：自验"30 min 内 0 to preview URL"

## 前置

- GitHub repo `xiaocaishen-michael/no-vain-years-mono` push 权限
- Cloudflare 账号（与现有 `app.xiaocaishen.me` DNS 同账号；CF Pages 项目自动继承 DNS zone）
- mono 仓 `apps/mobile/package.json:12` `build:web` script 已 ship（`expo export -p web`）
- mono 仓 `apps/server` 已 deploy 到生产 origin 并 CORS allowlist 含 CF Pages 域（见下方 § Cross-origin CORS checklist）

## Bootstrap（CF console 一次性配置）

1. CF dashboard → Workers & Pages → Create application → Pages → Connect to Git
2. Select repo `xiaocaishen-michael/no-vain-years-mono` → Begin setup
3. Project name：`no-vain-years-mono`（这决定生产 URL `no-vain-years-mono.pages.dev` + preview URL pattern `<branch>.no-vain-years-mono.pages.dev`）
4. Production branch：`main`
5. Build configuration（mono workspace 特化）：

   | 字段 | 值 | 注 |
   |---|---|---|
   | Framework preset | None | 选 None 而非 "Expo" preset — preset 会硬编码 `npm install` 与 lockfile/pnpm 不兼容 |
   | Build command | `corepack enable && pnpm install --frozen-lockfile && pnpm -C apps/mobile build:web` | mono workspace 必须 `-C apps/mobile` 限定 cwd；corepack 让 CF runner 用 `packageManager` 字段的 pnpm 版本 |
   | Build output directory | `apps/mobile/dist` | `expo export -p web` 默认输出位置 |
   | Root directory | `/` | mono 根；不能填 `apps/mobile`（会让 pnpm install 找不到 root lockfile） |

6. Environment variables（Production + Preview 同套）：

   | 变量 | 示例值 | 用途 |
   |---|---|---|
   | `EXPO_PUBLIC_API_BASE_URL` | `https://api.xiaocaishen.me`（占位，按 ADR-0026 决议落实） | mobile axios baseURL；不带末尾 `/` |
   | `NODE_VERSION` | `22` | CF Pages 默认 Node 版本可能滞后；显式 pin 避免漂移 |
   | `PNPM_VERSION` | 与 `mono/package.json` `packageManager` 一致（当前 `10.x`） | corepack 用此版本 |

7. Save → 首次 deploy 自动触发；查 build log 确认 `expo export` 输出含 `dist/index.html`

## SPA fallback（`_redirects`）

Expo Router web 输出是 SPA，需 CF Pages 把所有未匹配路由回退到 `index.html`，否则刷新 `/login` 等深层路径返回 404。

**实现**：`apps/mobile/public/_redirects` 文件（`expo export -p web` 把 `public/` 全部拷贝到 dist/）：

```text
/*    /index.html   200
```

**验证**：bootstrap 后浏览器访问 `https://<branch>.no-vain-years-mono.pages.dev/login` 直接刷新，应返回 200 + login UI（而非 CF Pages 默认 404 页）。

> **现状（2026-05-24 更新）**：host 已 pivot 到 Workers Static Assets（见顶部 banner），`apps/mobile/public/_redirects` **已移除** —— Workers 不处理 `_redirects`，SPA 回退改由 root `wrangler.jsonc` 的 `not_found_handling: "single-page-application"` 承担。本节 `_redirects` 方案仅作 Pages 历史参考。

## Cross-origin CORS checklist（跨 origin 必查）

CF Pages 域 → `apps/server` API origin 走标准 CORS preflight。server 端 `apps/server/src/main.ts` `enableCors({ origin: parseOrigins(cfg.corsAllowedOrigins), credentials: true })` 已就位；生产 env 必须 set：

```text
CORS_ALLOWED_ORIGINS="https://app.xiaocaishen.me,https://no-vain-years-mono.pages.dev"
```

- `https://app.xiaocaishen.me`：CNAME 到 `no-vain-years-mono.pages.dev`，真实用户访问域
- `https://no-vain-years-mono.pages.dev`：CF 默认域，开发/debug 直连

**Preview 分支 wildcard 限制**：preview deploy URL 形如 `<commit-hash>.no-vain-years-mono.pages.dev`，每次提交变 hash。当前 `apps/server/src/config/parse-origins.ts` 只识别字面字符串，不支持 `*.no-vain-years-mono.pages.dev` 通配。

**目前的两条务实路径**：

- (a) preview 调试时临时把具体 preview URL 加入 `CORS_ALLOWED_ORIGINS`，调完删
- (b) 真撞到频繁 preview 测试需求时，扩 `parseOrigins`：识别值形如 `/^https:\/\/.*\.pages\.dev$/` 的 regex 字符串、解析成 RegExp 传给 `@fastify/cors`，单测 `parse-origins.spec.ts` 加 case 覆盖

defer 到首次真需要 preview CORS 时再做（YAGNI）。

## 自定义域绑定（`app.xiaocaishen.me`）

1. CF Pages 项目 → Custom domains → Set up a custom domain
2. 输入 `app.xiaocaishen.me`
3. DNS zone 同账号 → CF 自动添加 CNAME；非同账号 → 手动加 `CNAME app no-vain-years-mono.pages.dev`
4. SSL 证书自动签发（CF Universal SSL，~5 min）
5. 验证：`curl -I https://app.xiaocaishen.me` 返回 200 + `server: cloudflare`

## Build 排错 cheat-sheet

| 现象 | 根因 | 修法 |
|---|---|---|
| `pnpm install` 报 `ERR_PNPM_LOCKFILE_OUT_OF_SYNC` | local 改 package.json 未 regen lockfile | `pnpm install` 本地 + commit 新 lockfile |
| `expo export` 报 `Cannot find module 'react-native-web'` | mono workspace hoist 未把 web peer dep 提到 root | 检 `.npmrc` `shamefully-hoist=true`（PR #67 已 ship） |
| Build log 卡在 `Detected non-JavaScript project` | CF preset 选了 "Expo" 而非 None | 切回 None preset + 显式 build command |
| Preview URL 访问 404 | `_redirects` 缺失 / 拼写错（必须 `/*    /index.html   200`） | 见上方 § SPA fallback |
| 浏览器 console `CORS error` | server `CORS_ALLOWED_ORIGINS` 未含 CF Pages 域 | 见上方 § Cross-origin CORS checklist |

## Smoke test（每次 deploy 后跑）

```bash
# 1. Production URL 可达 + SSL 绿
curl -fsSL -o /dev/null -w '%{http_code}\n' https://app.xiaocaishen.me
# 期望 200

# 2. SPA fallback 工作（深链刷新不 404）
curl -fsSL -o /dev/null -w '%{http_code}\n' https://app.xiaocaishen.me/login
# 期望 200（不是 404）

# 3. CORS preflight 通
curl -fsS -X OPTIONS https://api.xiaocaishen.me/api/auth/login \
  -H 'Origin: https://app.xiaocaishen.me' \
  -H 'Access-Control-Request-Method: POST' -I | grep -i access-control-allow-origin
# 期望 echo 'access-control-allow-origin: https://app.xiaocaishen.me'
```

## 不在本 playbook 范围

- `.github/workflows/deploy.yml` 等 GitHub Actions 部署 workflow（CF Pages 走 git integration 即可，加 GH Actions 会双 build 冲突 cache）
- EAS native binary build（iOS / Android binary 走另一通道，ADR-0045 候选）
- 备案前后差异（M3 ICP 备案完成前 `xiaocaishen.me` 国内访问可能被运营商屏蔽，与本 playbook 无关）

## 触发条件

- ADR-0026 backend deployment topology decision ship → 知道生产 `EXPO_PUBLIC_API_BASE_URL` 真实值
- Plan 3 Phase 1 入场 → 第一次需要真实公网 URL 给用户测试
- 上述任一发生时按本 playbook 走一遍 bootstrap；遇坑回填 § Build 排错 cheat-sheet
