# 阿里云短信激活 runbook（mock → aliyun）

> 2026-05-31。SMS 签名 + 模板审批通过后激活真·阿里云 DySMS。
> **网关代码早已实现并接好线**（`aliyun-sms.gateway.ts` + `auth.module.ts` provider 工厂 + `sms.config.ts`，W3 "Skeleton-only 没 cred" 时 ship）；本次只补当初延期的**真发 env-gated IT** + 激活。

## 前置（已具备）

- SDK `@alicloud/dysmsapi20170525` 已装；`SMS_GATEWAY=aliyun` 时 `auth.module.ts` 自动选 `AliyunSmsGateway`，否则 `MockSmsGateway`。
- **单通用模板**：登录/注册 + 注销（DELETE_ACCOUNT）+ 撤销注销（CANCEL_DELETION）共用同一 `ALIYUN_SMS_TEMPLATE_CODE`；网关 per-purpose 覆盖留空即回退默认（无需配 `_DELETE_ACCOUNT` / `_CANCEL_DELETION`）。
- **模板变量名 = `code`**：网关发 `templateParam={"code": <验证码>}`，模板文案须用 `${code}`。
- 国内号：网关自动去 `+86` 前缀。

## Step 1 — 本地真发验证（env-gated IT，禁把 cred 入仓）

```bash
RUN_SMS_IT=true \
ALIYUN_ACCESS_KEY_ID=<id> ALIYUN_ACCESS_KEY_SECRET=<secret> \
ALIYUN_SMS_SIGN_NAME=<已审批签名> ALIYUN_SMS_TEMPLATE_CODE=<已审批模板CODE> \
SMS_IT_PHONE=+8613800138000 \
pnpm exec nx test server -- aliyun-sms.real-send.it
```

→ verify：测试手机收到验证码，IT 绿（`aliyun-sms.real-send.it.spec.ts`）。失败时网关会把 Aliyun 业务错误码原样抛出（如 `isv.BUSINESS_LIMIT_CONTROL` 限流 / `isv.SMS_SIGNATURE_ILLEGAL` 签名不符）。

> 默认不跑（`describe.skipIf(!RUN_SMS_IT)`）—— CI / 常规 `nx affected` 不会真发短信。`RUN_SMS_IT` / `SMS_IT_PHONE` 已加 `check-env-sync.ts` ALLOWLIST（test-only flag，不进 `.env.example`）。

## Step 2 — 生产激活（Aliyun SWAS，per [05-23-prod-cutover](../../plans/2026-05/05-23-prod-cutover-meta-to-mono-swas.md)）

prod 走 `docker compose -f docker-compose.tight.yml --env-file .env.production`。在服务器上改 `.env.production`（`chmod 600`，**不在仓库**）：

```bash
SMS_GATEWAY=aliyun
ALIYUN_ACCESS_KEY_ID=<id>
ALIYUN_ACCESS_KEY_SECRET=<secret>
ALIYUN_SMS_SIGN_NAME=<已审批签名>
ALIYUN_SMS_TEMPLATE_CODE=<已审批模板CODE>
```

→ 重建 app 容器：`docker compose -f docker-compose.tight.yml --env-file .env.production up -d app`
→ verify：真机走 phone-sms-auth 收到真实验证码（boot 时 `sms.config.ts` 校验缺 cred 即启动失败，是预期护栏）。

## Rollback

`.env.production` 改回 `SMS_GATEWAY=mock` → `up -d app`。立即回退到 mock（log 打码，不真发）。

## 注意

- **密钥永不入仓**：只在本地 shell env / 服务器 `.env.production`（gitignored / 600）。
- 阿里云国内短信按条计费 + 有日/分钟限流；真发 IT 与 prod 冒烟都会消耗额度。
