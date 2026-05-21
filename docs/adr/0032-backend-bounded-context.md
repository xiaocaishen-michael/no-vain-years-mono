---
adr_id: ADR-0032
status: Proposed
applies_to: [apps/server]
sunset_trigger: |
  - 业务模块 > 30 引入更细 DDD 分层 (sub-bounded context / aggregate root 显式化)
  - 切 vertical slice 架构 (feature-folder per use case, 无 bounded context 层)
  - 单 context 内代码 > 50K LOC 自然拆分新 context (per "Bounded Context 大小拇指规则")
---

# ADR-0032: Backend Bounded Context Split — security + account + auth

* Status: Proposed
* Deciders: project owner
* Tags: backend / architecture / ddd / cross-cutting

## Context

A-002 (account profile) ship 后,`apps/server/src/auth/` module 同时承载:

* JWT issuance / verification / refresh (security 关注点)
* phone-sms-auth use case (auth 关注点)
* GetProfile / UpdateDisplayName (account 关注点)

LLM agent 加新 use case (e.g. "加 changePhone")时错向放在 `auth/`,因为现有 module 长这样。但 changePhone 本质是 **account** 操作 (改 account 实体的 phone),应该独立物理位置。

模型边界混乱症状:

1. `src/auth/domain/Account.ts` (account 实体) — name 与 module 不符
2. `src/auth/web/jwt-auth.guard.ts` (security 关注点) — 应跨 module 复用,但物理在 auth/ 里
3. 单 module 测试覆盖广,fail 时定位慢

## Decision

拆 3 bounded context (top-level under `apps/server/src/`):

### 1. `src/security/`

* JWT 签发 / 验证 / refresh rotation (per [ADR-0037](0037-security-credentials-governance.md))
* Guard / Strategy (Passport-jwt wrap)
* token revocation (Redis jti whitelist)
* **不依赖** account / auth

```
src/security/
  security.module.ts
  jwt.strategy.ts
  jwt-auth.guard.ts
  token-issuer.service.ts
  token-revocation.service.ts
```

### 2. `src/account/`

* Account 实体 + Repository
* GetProfile / UpdateDisplayName / auto-create use cases
* **依赖** security (验 JWT) — 但通过 SecurityModule 公开 guard,不直接 import 内部

```
src/account/
  account.module.ts
  domain/Account.ts (从 src/auth/domain/ 移)
  domain/AccountRepository.port.ts
  application/get-profile.usecase.ts
  application/update-display-name.usecase.ts
  application/auto-create.service.ts
  infrastructure/account.repository.prisma.ts
  web/account.controller.ts
```

### 3. `src/auth/`

* phone-sms-auth use case (编排 security + account)
* SMS code domain (SmsCodeRepository / verify)
* refresh-token use case (per ADR-0037)
* **依赖** security + account (编排,组合两者)

```
src/auth/
  auth.module.ts
  domain/SmsCode.ts
  application/phone-sms-auth.usecase.ts  ← 编排:验码 → account.autoCreate / get → security.issueTokens
  application/refresh-token.usecase.ts   ← 编排:security.verify → security.rotate
  ...
```

### 依赖方向(强制 ESLint boundaries)

```
auth → account → security
auth → security
```

禁:

* `account → auth`(反向依赖)
* `security → account / auth`(security 不知业务)

### eslint.config.mjs amend

```js
{
  elements: [
    { type: "security",  pattern: "apps/server/src/security/*" },
    { type: "account",   pattern: "apps/server/src/account/*" },
    { type: "auth",      pattern: "apps/server/src/auth/*" },
  ],
  rules: [
    { from: "security", allow: [] },                     // security 不依赖业务
    { from: "account",  allow: ["security"] },
    { from: "auth",     allow: ["security", "account"] },
  ],
}
```

## Consequences

* PR-4 (Server bounded context split) 物理 mv ~13 文件 src/auth → src/account
* 001 + 002 spec.md modules 字段调整:`modules: [auth]` → 按主导方;account-profile spec → `modules: [account]`;phone-sms-auth spec → `modules: [auth, security, account]`(编排型 use case)
* test/integration/* import 改

## Trade-offs

* 3 context 物理拆分 = 早期 over-engineering 风险 — 但 LLM agent 命中率收益 > 该成本(已实证 A-002 错向)
* 编排型 use case (auth) 引入跨 context import — 由 ESLint boundaries 单向白名单 contained

## References

* memory `project_plan_pivot_nestjs_mono` (Plan 1 NestJS module 边界设计起源)
* [ADR-0020](0020-module-boundary-nestjs.md) (现有 ESLint boundaries 机制)
* [ADR-0033](0033-outbox-cross-context-comm.md) (cross-context async 路径)
* [ADR-0034](0034-auth-account-operation-catalog.md) (LLM decision tree 写在哪)
