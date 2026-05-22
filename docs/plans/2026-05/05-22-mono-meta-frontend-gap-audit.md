# Plan: mono frontend (apps/mobile) vs meta no-vain-years-app 能力 Gap Audit (post tech-stack review)

> **Provenance**: 由 plan-mode 自动生成（harness 临时路径 `docs/plans/silly-cuddling-kahn.md`），2026-05-22 按 [`docs/conventions/docs-organization.md`](../../conventions/docs-organization.md) 体例 mv 至本路径。

## Context

[05-21-review-tech-stack-post-a002.md](2026-05/05-21-review-tech-stack-post-a002.md) **自下而上**从 A-002 ship 5 类集成踩坑反推 7 钢钉 + 13 新 ADR + 7 chore PR（PR-1/PR-2/PR-3/PR-4 已 ship → 见 PR #99/#100/#102/#103/#104，PR-5 Orval migration 进行中）。其姊妹 plan [05-22-mono-meta-backend-gap-audit.md](2026-05/05-22-mono-meta-backend-gap-audit.md) **自上而下**盘点了 meta Java/Spring backend → mono NestJS backend 的能力 gap（5 项 A 类 infra 已 ship PR #106/#107，4 项 B/C 待 deferred）。

本 plan 对前端做同一层对照：**meta 仓 `no-vain-years-app` 已具备但 mono `apps/mobile` 仍缺**的能力面。05-21 review 主线聚焦 Orval 切换 / ProblemDetail 客户端契约 / packages 5→2 / `core/api` 治理；**未盘点**：

1. CI/CD workflow 全面对照（Trivy fs scan / 部署 workflow / release-please）
2. 业务能力面 component / hook / validation / format / domain-error mapping 完整性
3. Device tracking 共享 infra（header injection + Zustand store + typed query）
4. 架构 deferred 决策的 ADR 候选 sweep（i18n / dark mode / EAS / Sentry / deep linking）

## 用户决策（2026-05-22）

- **Scope**：infra + 业务能力面全列（component / form hooks / domain error map / device tracking surface 等）；UI 页面真实化（login screen 真实 mockup 实现 / settings 页树等）不进本 plan，归 Plan 2 各 feature 自己的 spec
- **形态**：mirror 05-22-mono-meta-backend-gap-audit.md 体例
  - **A 类**（mono 本期 infra 残留 gap，Plan 2 feature port 不会自然带入）→ 详写 Meta/Mono/Gap 三段对照 + 架构批注，作为后续 chore PR 输入
  - **B 类**（业务能力，Plan 2 第一个 feature port 自然落地）→ 只点名 + 触发条件
  - **C 类**（架构 deferred，触发 trigger 未达）→ 只立 ADR draft 候选

---

## Verification: subagent claims fact-checked

| Subagent 报告（mono 缺 X） | grep / Read 实证 | 修正 |
|---|---|---|
| "mono 缺 expo-device / linking / status-bar / gesture-handler / reanimated / svg / get-random-values" | `apps/mobile/package.json:24-44` 全部已装 | ✅ 已有，**不算 gap** |
| "mono 缺 ErrorBoundary" | `apps/mobile/src/core/error-boundary.tsx` 存在 | ✅ 已有 |
| "mono 缺 QueryClient" | `apps/mobile/src/core/api/query-client.ts` + `app/_layout.tsx` Provider | ✅ 已有 |
| "mono 缺 SecureStore web 回退" | `apps/mobile/src/auth/store.ts:22-44` localStorage fallback | ✅ 已有 |
| "mono 缺 react-native-get-random-values shim" | `apps/mobile/app/_layout.tsx:7` `import 'react-native-get-random-values'` | ✅ 已有 |
| "mono 缺 commitlint CI 网关" | `.github/workflows/ci.yml:` `commitlint` job + `lefthook.yml` `commit-msg` 双层 | ✅ 已有 |
| "mono 缺 axios x-trace-id 注入" | `apps/mobile/src/core/api/setup.ts` interceptor + ADR-0036 已 ship | ✅ 已有 |
| "mono 缺 Playwright E2E 配置" | `apps/mobile/playwright.config.ts` + `playwright.runtime-smoke.config.ts`；meta `no-vain-years-app` 反而**无** Playwright | ✅ mono 领先 meta |
| "mono 缺 testID convention" | `docs/conventions/maestro-testid.md` 已 ship；meta 无对应 doc | ✅ mono 领先 meta |
| "mono 缺 Orval migration" | `packages/api-client/orval.config.ts` + `src/generated/` 已 ship PR-5b；meta 仍是 `@openapitools/openapi-generator-cli` typescript-fetch | ✅ mono 更先进 |
| "mono Trivy 已存在" | `.github/workflows/ci.yml:99-107` 仅 `image-ref: nvy/server:ci`（**image scan**），无 `scan-type: fs` | ❌ 确认 **fs scan gap** (A1) |
| "mono 缺 CF Pages 部署 workflow" | `.github/workflows/` 0 deploy 类文件；`docs/experience/2026-*/` 0 cloudflare 类 playbook；ADR-0025 已拍板 | ❌ 确认 gap (A2) |
| "mono 缺 device tracking" | `apps/mobile/src/auth/` 仅 `store.ts` + `token-refresh.ts`，无 `device-store.ts`；`setup.ts` interceptor 0 `X-Device-*` header；`packages/api-client/src/generated/` 0 `useDevicesQuery` 引用 | ❌ 确认 gap (A3) |
| "mono 缺 lib/{hooks,validation,format,error/login,error/device-errors}" | `apps/mobile/src/` 仅 `auth/core/theme/ui`，无对应业务子目录；meta `apps/native/lib/` 5 子目录共 6 业务文件 | ❌ 确认 gap (B2-B5) |
| "mono ui/ 仅 3 component" | `apps/mobile/src/ui/` = `Button / SafeAreaView / Spinner`；meta `packages/ui/src/` = 11 component（含 PhoneInput / SmsInput / 3 OAuth button / ErrorRow / SuccessCheck / LogoMark / PrimaryButton / Input） | ❌ 确认 gap (B1) |
| "mono settings 页树空" | `apps/mobile/app/(app)/` 仅 `(tabs)/` + `onboarding.tsx`；meta `apps/native/app/(app)/settings/{account-security,legal}/` 8 真实页 | ❌ 确认 gap (B7-B8) |

---

## A 类: Plan 1 残留 infra gap (3 项，本 plan 详写)

### A1 · Trivy **fs scan**（源码 + 依赖树 CVE 扫描）

**Meta 实现** (`no-vain-years/no-vain-years-app/.github/workflows/ci.yml:63-78`)

```yaml
trivy-fs:
  name: Trivy fs scan # ruleset-required
  steps:
    - uses: actions/checkout@v6
    - name: Run Trivy fs scan
      uses: aquasecurity/trivy-action@v0.36.0
      with:
        scan-type: 'fs'
        scan-ref: '.'
        severity: 'CRITICAL,HIGH'
        exit-code: '1'
        ignore-unfixed: true
        skip-dirs: 'docs,.claude,packages/api-client/src/generated'
```

- 扫源码全树 + npm/pnpm transitive deps
- ruleset required_status_check
- skip-dirs 排除 docs / Claude artifacts / 自动生成代码

**Mono 现状** (`apps/mobile/` + `apps/server/`)

- `.github/workflows/ci.yml:99-107` 仅 `Trivy image scan`（`image-ref: nvy/server:ci`）→ 只扫 server 容器镜像
- 0 `scan-type: fs` job → npm transitive CVE 对前端 dep tree 黑盒
- 后果：Expo SDK / RN / nativewind / lucide-react-native / @react-navigation 等 50+ dep 的 CVE 触发不到 CI 拦截；server 源码层（.ts 中硬编码 secret / vulnerable pattern）也不扫

**Gap 实质**：前端 dep 链 + 全仓源码 CVE 黑盒。比 image scan 提前 1 个阶段拦截（image build 前就 fail），且 dep 不打包到 image 也能扫到（如 devDependencies）

**架构批注 (2026-05-22)**

- mono 与 meta-app 不同：单 Trivy fs job 同时 cover server + mobile dep tree（root + apps + packages 全 workspace），无需双 job
- `skip-dirs` 必须 include `packages/api-client/src/generated`（Orval 输出）+ `apps/mobile/dist`（expo export 临时）+ `apps/server/dist`（nest build 输出）+ `docs` + `.claude`，否则 false positive 爆量
- 与现有 Trivy image scan **互补不替代**：image scan 抓 base image 层（node:alpine 自带 CVE），fs scan 抓 application 层（pnpm-lock.yaml + 源码）。两者都进 ruleset
- `ignore-unfixed: true` 必须保留 — Expo 生态月度 CVE 高峰期，unfixed CRITICAL/HIGH 易让 PR 长期阻塞；fixed-only 才是务实门槛
- Pin `aquasecurity/trivy-action@v0.36.0` 与 image scan 同版本；`@latest` action 漂移过历史教训

---

### A2 · Cloudflare Pages 部署 workflow + experience playbook

**Meta 实现**

- ADR `docs/architecture/tech-stack.md:57`（meta 仓老 path）拍板 CF Pages 作前端 host
- `no-vain-years-app/docs/experience/cloudflare-pages-deploy.md` 完整 playbook（1-on-1 bootstrap / DNS 绑域 / SPA fallback / CORS 跨仓耦合）
- CF Pages console 直连 git repo → push to main 自动 build + deploy（无 workflow 文件，靠 CF git integration）
- 关键约束：build command = `pnpm install --frozen-lockfile && pnpm build:web`；output = `apps/native/dist`；env vars 三项（`EXPO_PUBLIC_API_BASE_URL` / `NODE_VERSION=22` / `PNPM_VERSION=10.33.2`）

**Mono 现状**

- ADR-0025 `frontend-cloudflare-pages-expo-web.md` 已拍板（status: Accepted，applies_to: `[apps/mobile]`）
- `.github/workflows/` 0 deploy 类 workflow（gitleaks / actionlint / pr-title / markdownlint / commitlint / docker-build + image-scan / pr-validation / nightly-perf / nightly-sweep）
- `docs/experience/2026-*/` 0 cloudflare 类 playbook
- `apps/mobile/package.json:13` 有 `build:web: expo export -p web` script + `app.json` web.bundler:metro / web.output:single
- 但 0 落地：CF console 项目未建 / 域未绑 / build env 未配 / SPA fallback 未配 / server 端 CORS allowlist 未含 `*.pages.dev`

**Gap 实质**：Plan 3 部署上线（ADR-0026 backend deployment topology stub 决出后）触发时，前端**完全无落地路径**；server CORS allowlist 与 CF Pages 域名是跨仓耦合（meta playbook 明示），mono 必须显式协调 `apps/server/src/main.ts` 的 `enableCors({ origin: ... })` 与 CF Pages 项目名 / 自定义域

**架构批注 (2026-05-22)**

- **不需要 GitHub Actions workflow** — CF Pages 走 git integration，push 即 deploy；mono 加 deploy.yml 是反模式（CF 自身 build runner 与 GH Actions 双 build 会冲突 cache 哈希）
- 实质交付物 = `docs/experience/2026-05/MM-DD-cloudflare-pages-deploy-mono.md`：bootstrap 步骤 + env vars + CORS 跨仓 checklist + SPA fallback 配置（CF Pages `_redirects` 文件 `/* /index.html 200`）+ Preview deploy 子域命名（`*.no-vain-years-mono.pages.dev`）
- **关键 callout**：mono 单仓部署比 meta 双仓简化 — 不再需要 "先 ship server PR + 部署 ECS → 再 CF 侧改"；但仍需在 `apps/server/.env.example` / `apps/server/src/main.ts` 同 PR 加 CORS origin allowlist（含 `https://app.xiaocaishen.me` + `https://no-vain-years-mono.pages.dev` + `https://*.no-vain-years-mono.pages.dev`）
- ADR-0026 backend deployment topology stub 决出前不动手 — 后端部署形态（容器 vs Worker / 自签 cert vs CF Tunnel / 备案前后差异）会反向影响 CF Pages 的 API origin 配置
- 触发条件：Plan 3 Phase 1 进入 / 第一个真实用户测试需要公网 URL / ADR-0026 ship

---

### A3 · Device tracking 共享 infra（header injection + store）

**Meta 实现** (`no-vain-years-app/packages/auth/src/`)

- `device-store.ts`：`useDeviceStore` Zustand store（device id / name / type / hydrate from expo-device）
- `storage.ts`：persist 跨 cold start（设备 id 长期稳定）
- `apps/native/lib/api-client/client.ts`：每请求注入 `X-Device-Id` / `X-Device-Name` / `X-Device-Type` 三 header（platform-aware via `expo-device.modelName` + `Platform.OS`）
- `apps/native/lib/hooks/useDevicesQuery.ts`：typed `useQuery('/v1/accounts/me/devices')` hook
- `apps/native/app/(app)/settings/account-security/index.tsx` 消费 useDevicesQuery 渲染设备列表
- 后端 server 侧用 device id 做异常登录策略 / 设备登出 / 设备列表 API

**Mono 现状**

- `apps/mobile/package.json:30` `expo-device ~8.0.10` 已装
- `apps/mobile/src/auth/`：仅 `index.ts` / `store.ts` / `token-refresh.ts`（+ 2 spec.ts）→ **0** `device-store.ts`
- `apps/mobile/src/core/api/setup.ts` axios interceptor：仅注 `x-trace-id` + `Authorization: Bearer` → **0** `X-Device-*` header
- `packages/api-client/src/generated/`：Orval 生成的 service factories 中是否含 `useDevicesQuery` 取决于 `apps/server/openapi.json` 是否暴露 `/me/devices` endpoint → server 侧目前仅 phone-sms-auth + account profile，**0** device endpoint
- 后果：login / 登出 / 异常登录侧 server 无设备维度信号；ADR-0037 "Security and Credentials Governance" 中 refresh rotation + device-bound jti 白名单要求 → device id 是关键

**Gap 实质**：跨多 feature 共享 infra（不属于任何单 feature spec），Plan 2 第一个触及"设备列表 / 异地登录提醒 / 设备登出"的 feature 才会自然需要；但 device-id header 注入是**全局 axios interceptor 副作用**，每请求都要带 → 必须先于业务 feature ship，否则后补需回填所有已 ship endpoint。属典型 Plan 2 启动前 infra 卡点。

**架构批注 (2026-05-22)**

- **三段切分**：
  1. **infra 层（A 类，本 plan）**：`apps/mobile/src/auth/device-store.ts` + `apps/mobile/src/core/api/setup.ts` interceptor 加 `X-Device-*` 注入逻辑 + hydrate from `expo-device.getDeviceTypeAsync()` / `Device.modelName` / `Platform.OS`
  2. **server 契约层**：`apps/server/src/security/` 加 `DeviceIdHeader` Pipe / Guard 读 header 落入 ProblemDetail traceId 旁的 device 上下文（与 ADR-0036 trace 治理同链路），spec 加 `X-Device-*` 必填 header
  3. **业务消费层（B 类，Plan 2 自然带入）**：`useDevicesQuery` / 设置页 / 异常登录 banner / 设备登出 mutation
- **device id 生成策略**：iOS = `Device.modelId`（device-bound 但跨 reinstall 重置）+ 应用层 nanoid backup persist；Android 同。**禁用** `expo-application.getAndroidId`（API 30+ 已不可用）
- web 平台没有 `expo-device` 等价（meta 实测 web fallback = `'Web - <userAgent.split(\' \')[0]>'` 作 device name + 应用层 nanoid 作 id）；mono 必须显式处理 web/native 分支
- Refresh token rotation 与 device id 绑定（ADR-0037 amend）：jti 白名单 key 含 device id → 同 user 多设备并发 refresh 不互相 evict
- **不进 spec frontmatter `modules:` 字段** — 跨所有 feature 共享，不属任何 bounded context；落入 `security` 或 `cross-cutting`

---

## B 类: 业务能力 gap（Plan 2 feature port 自然带入，只点名）

> 触发条件：每条 entry 在 "首次触及该 feature 的 Plan 2 SDD spec" 启动时落地。本 plan 不进 impl scope，但每条记录 **触发 spec** 让 Plan 2 启动时可索引。

| # | 业务能力 | meta 锚点 | 触发 Plan 2 spec |
|---|---|---|---|
| B1 | UI 业务 component 10 个 | `packages/ui/src/{PhoneInput,SmsInput,GoogleButton,AppleButton,WechatButton,PrimaryButton,ErrorRow,SuccessCheck,LogoMark,Input}.tsx` | 首个含 phone-sms login UI 的 feature spec（预计 003/004 系列） |
| B2 | Form hooks | `apps/native/lib/hooks/use-login-form.ts` / `use-onboarding-form.ts` | 同 B1 + onboarding spec |
| B3 | Validation schemas (Zod) | `apps/native/lib/validation/{login,onboarding}.ts` + 单元测试 4 文件 共 ~476 行 | 同 B1 / B2 |
| B4 | Format utilities | `apps/native/lib/format/{phone,datetime}.ts` | 任何展示用户输入电话或日期的 feature |
| B5 | Domain error mapping 完整版 | `apps/native/lib/error/{login,device-errors}.ts` 共 50+ row code→中文 map | mono 已有 `ERROR_DISPLAY_MAP` skeleton；新 endpoint ship 时按 code 补 |
| B6 | Auth usecases.ts | `packages/auth/src/usecases.ts` 业务编排（login / logout / refresh / cancel-deletion） | login + 注销取消 spec |
| B7 | Settings 页树 | `apps/native/app/(app)/settings/{index,account-security/{index,phone,delete-account},legal/{personal-info,third-party}}.tsx` 8 真实页 | 设置入口 spec / 法律页 spec |
| B8 | Freeze-period modal flow + cancel-deletion 页 | `apps/native/app/(auth)/cancel-deletion.tsx` + `apps/native/app/__tests__/integration/freeze-flow.test.tsx` | 冻结流程 spec（与 ADR-0016 deletion 配套） |
| B9 | Profile 页真实 UI（US5 in spec 002） | `apps/native/app/(app)/(tabs)/profile.tsx` | spec 002 已 ship 占位，真实 mockup pending |
| B10 | Tab 页真实 UI | `apps/native/app/(app)/(tabs)/{index,search,pkm,profile}.tsx` 占位 → 真实 | 各 tab 对应 feature spec（home / search / PKM 主体） |

> mono `apps/mobile/src/auth/index.ts` 当前仅 export `useAuthStore`；Plan 2 启动后预计扩为 `useAuthStore + useDeviceStore + login()/logout()/refresh()/cancelDeletion()` 全 surface

---

## C 类: 架构 deferred（ADR draft 候选，只点名）

| # | 主题 | 触发 trigger | 候选 ADR ID |
|---|---|---|---|
| C1 | i18n 引入（i18next vs lingui vs FormatJS） | 第二语种支持需求（英文 / 繁中）；当前 ADR-0038 已注 "Plan 4 引入" | ADR-0043 (proposed) |
| C2 | Dark mode 完整链（theme provider + 用户偏好 persist + UI toggle） | M3 用户测试反馈 / 系统 Appearance 接入 | ADR-0044 (proposed) |
| C3 | EAS native binary build profile | Plan 4 mobile binary 分发（App Store / TestFlight / Play Console） | ADR-0045 (proposed)；amend ADR-0025 |
| C4 | Sentry / 崩溃上报集成 | 用户量 > 50 / ErrorBoundary placeholder 链路打通 | ADR-0046 (proposed) |
| C5 | Deep linking 完整契约（URL scheme nvy:// + OAuth callback handler + universal links） | OAuth provider（Google / WeChat / Apple）ship | ADR-0047 (proposed) |
| C6 | Multi-platform suffix convention（`.web.tsx` / `.native.tsx` / `.ios.tsx` / `.android.tsx`）强制 | PKM 大屏 Web 分形（Plan 4）/ Web-only 路由分化 | amend ADR-0030 |
| C7 | spec.md frontmatter Zod 校验 + lefthook hard gate | 已被 ADR-0031 (Proposed) cover；schema 文件待 ship | 进 PR-1 of 05-21 plan |
| C8 | Maestro flow YAML 落地（testID convention 配套） | Plan 4 mobile binary E2E 验收 | amend ADR-0027 |

---

## Deferred / Not gap（subagent 误报或已 ship）

| 项 | 状态 |
|---|---|
| `expo-device` / `expo-linking` / `expo-status-bar` / gesture-handler / reanimated / svg / get-random-values 等 native deps | ✅ 已装（package.json:24-44） |
| ErrorBoundary | ✅ 已 ship (`apps/mobile/src/core/error-boundary.tsx`) |
| QueryClient singleton + Provider | ✅ 已 ship |
| SecureStore web fallback (localStorage) | ✅ 已 ship (`store.ts:22-44`) |
| `react-native-get-random-values` shim 注册 | ✅ 已 import (`app/_layout.tsx:7`) |
| Commitlint CI 网关 | ✅ 已有（ci.yml `commitlint` job + lefthook commit-msg 双层） |
| axios x-trace-id 注入 | ✅ 已 ship (`core/api/setup.ts` + ADR-0036) |
| ProblemDetail RFC 9457 客户端契约 + type guards + ERROR_DISPLAY_MAP skeleton | ✅ 已 ship（PR-5 范围） |
| Orval API codegen（react-query + axios） | ✅ 已 ship（PR-5b 替换 @hey-api）→ **mono 更先进于 meta**（meta 仍是 `@openapitools/openapi-generator-cli` typescript-fetch） |
| Playwright E2E 配置 + runtime-smoke target | ✅ 已 ship；**mono 领先 meta**（meta 0 Playwright，e2e 全 deferred） |
| Maestro testID convention doc | ✅ 已 ship (`docs/conventions/maestro-testid.md`)；**mono 领先 meta**（meta 无对应 doc） |
| tsconfig bundler resolution | ✅ 已 ship（PR-2 of 05-21 plan） |
| packages 5→2 collapse (`packages/{auth,ui,design-tokens}` 删除 → `apps/mobile/src/{auth,ui,theme}` inline) | ✅ 已 ship（PR-3 of 05-21 plan） |
| `shamefully-hoist=true` .npmrc | ✅ 已 ship（PR #67） |
| nightly-perf / nightly-sweep / pr-validation workflow | ✅ mono 独有（meta 无） |
| spec-integrity workflow | ❌ 不直接对应 — meta 用法是 cross-repo symlink 校验（mono 单仓 colocated 模型，spec/plan/tasks 同目录，靠 lefthook `tasks-md-drift` + ADR-0031 spec.zod 校验 cover） |
| release-please workflow | 🟡 **in-flight** — 本分支 `docs/release-please-plan` 已开 plan（[05-22-release-please-mono-bootstrap.md](2026-05/05-22-release-please-mono-bootstrap.md)），3 个 PR 序列规划完毕；不进本 gap audit |

---

## A 类执行序列（用户决策 2026-05-22：bundle 单 chore PR）

**Decision**：A1 + A2 + A3 三项触及不同 subsystem（CI workflow / server CORS+文档 / mobile interceptor），但每项独立小颗粒（合计 5-7h）且互无 merge 冲突 → **bundle 进同一 chore PR** 而非拆 3 PR。

**Why bundle**：solo dev 工作流下 3 个独立 PR = 3 次 CI 周期 + 3 次自己 review 自己 + 3 次 squash merge，开销 > 颗粒度收益；A1/A2/A3 全 infra plumbing，scope 高度一致，单 PR 描述里分 3 段即清晰。

**Single PR scope（合计 5-7h）**

| 子项 | 改动 | 工时 |
|---|---|---|
| **A1 · Trivy fs scan** | `.github/workflows/ci.yml` 新增 `trivy-fs` job（`scan-type: fs` / `severity: CRITICAL,HIGH` / `ignore-unfixed: true` / skip-dirs 含 `docs,.claude,packages/api-client/src/generated,apps/mobile/dist,apps/server/dist`）；pin `aquasecurity/trivy-action@v0.36.0` 与现有 image scan 同版本；首跑可能命中 1-2 个真实 CVE 需 `pnpm up` | 1-2h |
| **A2 · CF Pages 预留 + Playbook** | (a) `apps/server/src/main.ts` `enableCors` allowlist 加 `https://app.xiaocaishen.me` + `https://no-vain-years-mono.pages.dev` + `https://*.no-vain-years-mono.pages.dev`；(b) `apps/server/.env.example` 加 `CORS_ORIGINS` key + ConfigService 读取；(c) `docs/experience/2026-05/05-22-cloudflare-pages-deploy-mono.md` 新建（参考 meta playbook 改写：bootstrap / env vars / SPA `_redirects` / 跨仓 CORS checklist 在 mono 单仓简化版） | 2h |
| **A3 · Device tracking infra** | (a) `apps/mobile/src/auth/device-store.ts` 新建（Zustand + persist + `expo-device.modelName` / `getDeviceTypeAsync` + web fallback：userAgent 抽取 + `nanoid` 作设备 ID backup）；(b) `apps/mobile/src/core/api/setup.ts` 拦截器追加 `X-Device-Id` / `X-Device-Name` / `X-Device-Type` 注入；(c) `apps/mobile/src/auth/device-store.spec.ts` 覆盖 native hydrate / web fallback / persist 三 case；`nanoid ^5.1.11` 已装（package.json:36），免新增 dep | 2-3h |

**PR title**：`chore(repo): A1 Trivy fs scan + A2 CF Pages CORS+playbook + A3 device tracking infra`

**PR body 大纲**

```markdown
## 修改内容
post-A002 tech-stack review 衍生 frontend gap audit 的 A 类 infra 残留（详见 docs/plans/2026-05/05-22-mono-meta-frontend-gap-audit.md）。三子项 bundle：

### A1 · Trivy fs scan
- ci.yml 新增 trivy-fs job（CRITICAL/HIGH + ignore-unfixed + skip-dirs 配套）

### A2 · CF Pages CORS 预留 + 部署 playbook
- apps/server CORS allowlist 加 pages.dev / 自定义域三 origin
- docs/experience/2026-05/05-22-cloudflare-pages-deploy-mono.md 新建

### A3 · Device tracking 共享 infra
- apps/mobile/src/auth/device-store.ts 新建 + axios interceptor X-Device-* 注入
- 单测覆盖 native / web fallback / persist

### 🚨 部署与存活前置确认
（按 docs/conventions/pr-creation-protocol.md 模板填三 checkbox）

## Test plan
- [ ] ci.yml trivy-fs job GREEN on PR；故意 add CVE 包后红、删后绿
- [ ] apps/mobile/src/auth/device-store.spec.ts GREEN（native + web fallback + persist）
- [ ] runtime-smoke：浏览器 console 请求 header 含 X-Device-Id / X-Device-Name / X-Device-Type
- [ ] server stdout log grep 单次命中 X-Device-Id
- [ ] CORS allowlist：本地 curl preflight from pages.dev origin → 200 + Access-Control-Allow-Origin echo
```

**触发时序**

- A1 + A3：任何时机 ship（与 ADR-0026 解耦）
- A2 CORS allowlist：与 A1/A3 同 PR ship；CF Pages console 项目实际创建延后到 ADR-0026 决出 + Plan 3 Phase 1 入场。playbook 文档先 ship，bootstrap 操作按需触发

---

## Verification

### A 类 success criteria

| PR | verify |
|---|---|
| chore-fe-A1 | `gh workflow run ci.yml`（PR 触发）`Trivy fs scan` job GREEN；故意 `pnpm add <known-CVE-package>` → CI 红；删后绿 |
| chore-fe-A2 | CF Pages console 新建项目 → push 触发 build → preview URL 可访问；server `enableCors` 含 pages.dev origin → 浏览器 console 无 CORS 拦截；experience doc 新人按 playbook 0 to ship < 30 min |
| chore-fe-A3 | `apps/mobile/src/auth/device-store.spec.ts` 新建覆盖 hydrate / persist / web fallback 三 case；任意 server endpoint 请求 → 后端 stdout log grep 单次命中 `X-Device-Id`；spec 002 / 003 frontmatter `modules:` 含 `security` |

### B / C 类

仅 sanity check："B/C 类条目均无 impl 改动"；ADR draft 候选 ID（C 类 8 项）在 `docs/adr/README.md` index 中标 `Proposed` 状态。

### End-to-end

合并 A1 + A3 后：

- `pnpm nx affected -t lint typecheck test build runtime-smoke --base=origin/main` GREEN
- `pnpm nx run-many --target=test --all` GREEN
- `apps/mobile/playwright.runtime-smoke.config.ts` runtime smoke GREEN（web export → playwright → trace_id 灰字 + 设备 header 落地）

### Critical assertions

1. **不引入新 dep**：A1 / A2 / A3 全部用现有 dep（trivy-action / expo-device / axios 已装）
2. **不动 ADR-0027 / 0030 / 0036 / 0037 / 0038 contract**：本 plan A 类是 infra 填充，不改架构 verdict
3. **B 类无回填动作**：Plan 2 第一个 feature spec 启动时按 B1-B10 表索引 → 在该 feature plan.md 内带入；本 plan 不开 chore PR
4. **C 类立 ADR ≠ ship 实现**：ADR-0043 ~ 0047 draft status 即可，触发 trigger 未达不立 Accepted
