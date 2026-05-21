---
adr_id: ADR-0025
status: Accepted
applies_to: [apps/mobile]
sunset_trigger: |
  - CF Pages 撤免费 tier / 改用付费 plan 不划算
  - Plan 4 引入 mobile binary 分发 (Expo EAS / TestFlight / Play Store)
  - Expo SDK EOL 或 Web export 兼容性大幅退化
---

# ADR-0025: 前端部署 — Expo Web export → Cloudflare Pages (mobile binary 不在 Plan 3 scope)

* Status: Accepted (2026-05-19) — Plan 2 Phase 0 § 2.2.6
* Deciders: project owner
* Tags: frontend / deployment / cross-cutting

## Context

[Plan 2/3](../plans/plan2-plan3-clever-sutherland.md) 把前端部署形态留作 Phase 0 决策项。可选方案 4 选 1:

| 方案 | 心智 |
|---|---|
| A. Expo Web export → static host(CF Pages / Vercel / Netlify / Aliyun OSS+CDN) | 复用 RN 业务代码 0 改动,SDK 54+ 原生支持 |
| B. 独立 Next.js / Vite 项目重写 Web | 双套代码库,Web/RN 分裂 |
| C. Capacitor / Tauri 封 Webview | Web 不实质独立部署 |
| D. 不做 Web,只 mobile binary | 跳过浏览器入口 |

[Plan 3 § 3.3](../plans/plan2-plan3-clever-sutherland.md) 段落已先定基调 A + Cloudflare Pages。本 ADR backfill 显式立。

**Plan 3 部署 scope 边界**:
- ✅ 后端 `apps/server` Docker → Aliyun 生产(部署形态 ADR-0026 决,本 ADR 不涉及)
- ✅ 前端 Web 入口部署(本 ADR 范围)
- ❌ mobile binary(iOS App Store / Android Play Store / Expo EAS Build / 国内应用商店分发)**全部 OOS**,推迟到 Plan 4

## Decision

mono Plan 3 前端部署链:

1. **Build target**:`apps/mobile` Expo SDK 54+ `expo export --platform web` 产出静态 SPA(`apps/mobile/dist/` 单页 + 静态 asset),不引入第二套 Web 项目
2. **Host**:**Cloudflare Pages**(static asset 托管,非 Functions / Workers tier)
3. **Build trigger**:GitHub repo connect → CF Pages 拉取 main 分支自动 build(or 改 GitHub Actions push 触发 `wrangler pages deploy`,具体方式 Plan 3 Phase 2 实施时决)
4. **Build command**:`pnpm nx run mobile:export-web`(or 等价 `pnpm nx run mobile:build --configuration=web`,Plan 3 Phase 2 起手前 mobile project.json target 落地)
5. **API 调用方式**:Web SPA 直接走 CORS 访问 `https://api.<domain>`(后端 Aliyun ECS / SWAS / ACK 任一,per ADR-0026)— **不走 CF Pages Functions 反代**,避开 [CF Workers/Pages Functions → Aliyun ECS 525](../../memory/reference_cf_workers_to_aliyun_ecs_525.md) 已知卡 TLS 握手问题
6. **mobile binary 部署 deferred**:本 ADR 不锁定 EAS Build / 真机分发 / 国内商店上架方案;触发时机 = Plan 3 ship 后 Plan 4 立 ADR

## Consequences

### Positive

* **业务代码 0 fork** — Expo Web 与 iOS / Android 共享 RN component / hook / store / api-client;`packages/*` 共享包不分裂;新增 feature 仅在 Web 不可用时(camera / 推送 / 设备权限等)写条件分支
* **零 build infra** — CF Pages 内置 build environment 直跑 pnpm(`PNPM_VERSION` env 即可),无需自建 CI build pod;build 失败有 dashboard log + commit status
* **全球 CDN 默认** — CF Pages 内置全球 CDN(覆盖 300+ POP),海外用户首屏可达性优于 Aliyun OSS+CDN(国内优势但海外 PoP 稀疏);备案前 stage / 海外用户访问无 friction
* **HTTPS + SSL 默认** — CF 自动签 SSL,无需手动管证书 / 续期;`*.pages.dev` 默认域 + custom domain 接 CF 后 SSL 自动覆盖
* **成本可控** — CF Pages free tier(500 build/月 + 无限 request)对 PoC / 早期用户期实质免费;商用化升级 Pro $20/月仍低成本
* **scope 切干净** — mobile binary 部署 OOS,Plan 3 1 周可收 Phase 2,不被 EAS Build / 国内商店审核流程拖延
* **Avoid CF→Aliyun 525** — Web SPA → API 走 CORS 而非 CF Pages Functions 反代,绕开 [`reference_cf_workers_to_aliyun_ecs_525`](../../memory/reference_cf_workers_to_aliyun_ecs_525.md) memory 记录的 TLS 握手 525 阻断

### Negative / Trade-offs

* **Expo Web 已知坑点** — NativeWind v4 web build / native-only API(camera / haptics / 推送)在 Web 需 Platform.OS 条件分支或 stub;Plan 2 期间每个 feature 起步必须 phase-by-phase 验 web 兼容性(per Plan 3 § 3.3.1),不能 ship 完才发现 Web build 红。**缓解**:Plan 2 spec.md frontmatter 加 `web_compat: tested|stub|n/a` 字段(M3+ 评估),或每 feature PR description 显式标注 Web 验证状态
* **国内用户首屏可达性** — CF 在国内未备案,部分用户 / 网络节点可能走 CF 海外 PoP 较慢(P95 1-3s 首屏)。**缓解**:Plan 3 Phase 2 起手前用国内多省网测试;严重时考虑(a)同源 Aliyun OSS+CDN 镜像 / (b)切 Vercel(国内访问体验类似 CF)/ (c)等备案后切 Aliyun 国内节点。本 ADR 不锁,留 Plan 3 Phase 2 实测决
* **CORS 配置层暴露** — Web → Aliyun API 走跨域,server 必须显式配 CORS allow-origin = CF Pages 域(预 prod 域 + `*.pages.dev` preview 域)。**缓解**:NestJS `app.enableCors({ origin: [process.env.CORS_ALLOW_ORIGIN] })` config 化,W2 后端 mobile-only 时 disable CORS / W4+ Web 上线时 enable
* **Cookie domain 难** — JWT auth 走 Authorization header 不依赖 cookie(spec FR-S09 已确认),无 cookie scope 问题;若后续引入 cookie-based session(如 CSRF / fingerprint)需重评估
* **mobile binary 部署黑盒延后** — iOS / Android / 国内商店 / EAS Build 整套未触碰;**缓解**:Expo 框架本身保证 binary build 可行性(SDK 54+ EAS Build 成熟),Plan 4 立 ADR 时再具体选;Plan 3 内只验"Web 主入口可达"足以闭环登录主流程
* **build target 重复** — `apps/mobile` 同时 build native + web,build 时长翻倍;**缓解**:CF Pages 仅触发 Web build,native build 仅本地 dev / 后续 EAS;互不阻塞
* **CF 锁定** — wrangler / CF Pages 配置一旦写入 `wrangler.toml`,迁出非零成本(domain DNS / SSL 重签 / build env vars 迁移)。**缓解**:迁移成本约 1-2 天,与 PoC 阶段试错预算匹配;Plan 5+ 重评估时若需迁 Vercel / Aliyun 静态托管成本可接受
* **跨境网络架构未决** — CF Pages(海外 PoP) ↔ Aliyun ECS / SWAS(国内为主) ↔ 客户端(国内 + 海外混合)三方拓扑需 ADR-0028 专门设计;本 ADR 仅锁 Web host = CF Pages,不锁国内/海外用户分流路径

## Alternatives Considered

* **Vercel** — 拒绝:与 CF Pages 等同 static host 能力,但价格更高(Pro $20/user/月)+ 国内访问体验相似(无国内节点)+ 用户已熟悉 CF 生态,decision overhead 0
* **Netlify** — 拒绝:同 Vercel,无对 mono 的优势;CF Pages 全球 CDN 节点更多
* **Aliyun OSS + CDN** — 拒绝:虽国内访问最优,但**需备案才能用 CDN**(2026-05-19 备案进度未完),Plan 3 staging 起步无路;后续若备案完 + CF 国内访问差,可作 mirror / migration 候选
* **GitHub Pages** — 拒绝:无 build environment(只 static commit),需外部 CI build 后 push artifact 仓库,流程复杂 + 无 preview 域
* **Independent Next.js / Vite Web 项目** — 拒绝:Web 与 RN 业务代码分裂 = 双套维护 / 类型 / 测试,与 Plan 1 mono "前后端共享 packages" 心智冲突;Expo Web 是"Expo 框架对 RN-for-Web 的官方包装",原生方案
* **Capacitor / Tauri WebView** — 拒绝:本质是用 native 壳跑 Web,Plan 3 Web 入口需求是"浏览器直访问"非"打包 mobile",方案错位
* **不做 Web,只 mobile binary** — 拒绝:Plan 3 done condition L171 "Cloudflare Pages 通过 HTTPS 访问 Expo Web export 主入口" 是显式验收标准;Web 入口是 PoC 阶段最快验证用户路径的形态(无下载 / 无审核)
* **CF Pages Functions 反代后端 API** — 拒绝:CF Pages Functions / Workers fetch Aliyun ECS 在 TLS 握手阶段被卡 525 ([`reference_cf_workers_to_aliyun_ecs_525`](../../memory/reference_cf_workers_to_aliyun_ecs_525.md) 实证);Web 直走 CORS 调 Aliyun API 是直接路径,功能等价 + 避坑

## Validation

* **实装锚点 deferred to Plan 3 Phase 2**:
  * `apps/mobile/project.json`:`export-web` target(`nx run mobile:export-web` 跑通本地产出 `apps/mobile/dist/`)
  * `wrangler.toml` or CF Pages dashboard config:build command + output dir + env vars
  * `apps/server` `enableCors` config:allow-origin = CF Pages prod 域 + preview 通配
  * `.github/workflows/deploy-web.yml`:main push 触发 deploy or CF Pages 自管
* **Plan 3 done condition**(per [Plan 2/3 § 3.1](../plans/plan2-plan3-clever-sutherland.md)):"Cloudflare Pages 通过 HTTPS 访问 Expo Web export 主入口,登录 → 主流程跑通"
* **本 ADR 仅锁定 host + build target;Phase 2 实施细节 / CORS config 具体值 / preview 域命名规则等留在 Plan 3 Phase 2 task 落地时决**

## References

* [Plan 2/3 § 3.3 Phase 2](../plans/plan2-plan3-clever-sutherland.md)
* [Plan 2/3 § 2.2.6 task](../plans/plan2-plan3-clever-sutherland.md)
* [Expo Web docs](https://docs.expo.dev/workflow/web/) — Expo SDK 54+ Web export
* [Cloudflare Pages docs](https://developers.cloudflare.com/pages/) — static host + build config
* memory `reference_cf_workers_to_aliyun_ecs_525` — CF Workers/Pages Functions → 阿里云 ECS 525 实证
* **deferred / 未决**:
  * ADR-0026(后端部署形态,Plan 3 Phase 1)
  * ADR-0027(CI/CD deploy 流,Plan 3 Phase 1)
  * ADR-0028(跨境网络架构,Plan 3 Phase 2)
  * Plan 4(mobile binary 部署 — EAS Build / 商店上架 / 国内分发)
