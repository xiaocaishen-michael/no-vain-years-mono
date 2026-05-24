---
adr_id: ADR-0037
status: Proposed
applies_to: [apps/server, apps/mobile, security]
sunset_trigger: |
  - 切 OAuth2 / OIDC IdP (Keycloak / Auth0) — 全套 JWT 自管换托管
  - 切 RS256 + JWKS (per memory: HS256 适合 solo dev / RS256 适合多 svc)
  - 切 Vault / Secrets Manager (per ADR-0026 Phase 1 决) — secrets 注入路径改
  - 切 WebAuthn / passkey 取代 SMS code (per [ADR-0023](0023-sms-code-storage-hmac.md) sunset)
---

# ADR-0037: Security and Credentials Governance — gitleaks + env-sync + JWT HS256 双 token + secrets volumes

- Status: Proposed
- Deciders: project owner
- Tags: backend / mobile / security / cross-cutting

## Context

Plan 1-2 实际安全状态:

1. **secrets 容易泄露** — `.env` 改但 `.env.example` 漏更新,新 dev clone 仓不知道要哪些 key;`.env.production` 实际 secret 误 commit 风险
2. **JWT 单 access token 无 rotation** — Plan 1 W3 实装单 access token,无 refresh / 无撤销机制,token 泄露后无法 force logout
3. **secrets 注入路径未定** — 现 `.env` 文件 mount 起步,但生产 image 是否 bake env / volumes mount / 云密钥 — 未定 (Phase 1 决)

## Decision

### 1. gitleaks pre-commit + CI

`.gitleaks.toml` 用 `useDefault = true`(继承 gitleaks 内置规则集 — 含 AWS / GCP / generic secret 等 pattern)+ `[allowlist]`(仓内已知非密文豁免),未自写 per-厂商 `[[rules]]`; `lefthook.yml` pre-commit hook 跑 `gitleaks protect --staged --no-banner`,CI workflow 跑 `gitleaks detect`.

### 2. `.env` / `.env.example` 同步校验

`scripts/check-env-sync.ts`(PR-6 ship):

```ts
// 对每个 .env.example: 提取 key 集合 K_example
// 对应 .env 必须有相同 key 集合 K_env (值不校验)
// K_example !== K_env → fail
// 同时 grep apps/**/*.ts 引用的 process.env.KEY,union 进 K_required
// K_required ⊄ K_example → fail
```

lefthook hook `check-env-sync`:staged `.env*` 任一改动触发。

### 3. JWT HS256 双 token + Redis jti 白名单 + rotation + 5s grace

| Token       | Lifetime | 用途                                              |
| ----------- | -------- | ------------------------------------------------- |
| **access**  | 15 min   | 业务 API 鉴权,带 `jti` (uuid)                     |
| **refresh** | 30 day   | 换新 access + 自身 rotate;带 `jti` + `parent_jti` |

- HS256 (HMAC,solo dev 简单;多 svc 时切 RS256)
- Redis `jti:whitelist` SET 存所有 active jti — verify 必查 SET,未命中即拒
- refresh 时 issue 新 access + 新 refresh,**旧 refresh jti 立即从 SET 删**(rotation)
- 5s grace:旧 refresh 删除后 5s 内仍接受(并行请求 race window)— 用 `jti:revoked-with-grace` 5s TTL SET 兜底
- logout:`jti:whitelist` SET 删该 user 所有 jti → 立即失效

### 4. secrets 注入 — 当前 `--env-file`，目标 volumes mount

> **当前实装**(per [ADR-0026](0026-backend-deployment-topology.md) D4):M1.1 部署用 `docker compose --env-file .env.production`(文件权限 + .gitignore 双保险)。下列 `secrets:` 段 + `/run/secrets` 文件挂载是**未实装的硬化目标**(本 ADR `Proposed`)。

- 禁 image ENV baking — 任何 secret 不写 Dockerfile `ENV`
- docker-compose 模板 `infrastructure/docker-compose.yml` 用 `secrets:` 段
- 生产部署:secrets 文件 mount 到容器 `/run/secrets/<name>`,应用启动读文件

当前 config 基建 = `apps/server/src/config/*.config.ts`(`registerAs` + Zod,启动 fail-fast 读 `process.env`);`/run/secrets/<name>` 文件 loader 属**未实装**的 secrets 设计(本 ADR `Proposed`),落地时在该 config 层加 file-first / env-fallback reader。

### 5. Refresh rotation 5s race grace 算法

```ts
async function refresh(oldRefreshJwt: string): Promise<TokenPair> {
  const payload = verify(oldRefreshJwt);
  const isActive = await redis.sismember(`jti:whitelist`, payload.jti);
  const isInGrace = await redis.sismember(`jti:revoked-with-grace`, payload.jti);
  if (!isActive && !isInGrace) throw new UnauthorizedException('REFRESH_INVALID');

  if (isActive) {
    // First refresh in family — rotate
    await redis.srem(`jti:whitelist`, payload.jti);
    await redis.sadd(`jti:revoked-with-grace`, payload.jti);
    await redis.expire(`jti:revoked-with-grace`, 5); // 5s grace
  }
  // else: in grace — re-issue without re-rotating (race window 兼容)

  const newPair = issuePair(payload.sub, payload.jti);
  await redis.sadd(`jti:whitelist`, newPair.access.jti, newPair.refresh.jti);
  return newPair;
}
```

### 6. Secrets incident response (per memory obs 3957)

短 procedure 文档落 `docs/security/incident-response.md` (PR-7):

- 发现 secret 泄露 → 立即 `redis flushdb jti:whitelist` (强制全员重登) → 改 JWT_SECRET → rotate `.env` → push 新 image → 通知 audit log
- git secret commit → `gitleaks` + BFG repo-cleaner + force push (慎用,solo dev 可)

## Consequences

- PR-6 ship 全套:gitleaks / check-env-sync / SecurityModule 全套 (双 token + Redis whitelist + rotation + grace) / volumes mount 模板 / refresh-token usecase
- Plan 3 Phase 1 决 secrets 注入具体路径后,本 ADR amend 加 "云密钥服务接入" 段

## Trade-offs

- HS256 单 secret(JWT_SECRET 全 svc 共享)— solo dev OK,scale 后切 RS256 (sunset trigger 2)
- 5s grace 设计兜并行 refresh race,但有 5s 内多次 refresh 成功的 misuse 风险 — 接受 (race 罕见 + 5s 短)

## References

- memory obs (3953-3957 E3 Security Governance decisions)
- [ADR-0023](0023-sms-code-storage-hmac.md)
- [ADR-0026](0026-backend-deployment-topology.md)
