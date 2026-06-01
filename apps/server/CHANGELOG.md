# Changelog

## [0.2.0](https://github.com/xiaocaishen-michael/no-vain-years-mono/compare/server-v0.1.0...server-v0.2.0) (2026-06-01)


### Features

* **account:** 007 账号与安全三卡片重构 + 个人简介 bio 编辑 ([#247](https://github.com/xiaocaishen-michael/no-vain-years-mono/issues/247)) ([4963133](https://github.com/xiaocaishen-michael/no-vain-years-mono/commit/4963133ae902baa6938ab4fd584bc24aee56f7a1))
* **account:** 009 头像/主页背景图 上传·显示·查看大图（OSS client 直传 PostObject） ([#263](https://github.com/xiaocaishen-michael/no-vain-years-mono/issues/263)) ([afac728](https://github.com/xiaocaishen-michael/no-vain-years-mono/commit/afac7283cea7ae936826c91d9d432da59a6fed5d))
* **account:** 010 微信账号绑定/解绑 Phase 1 — 端口桩接 + 短信验证码解绑 ([#259](https://github.com/xiaocaishen-michael/no-vain-years-mono/issues/259)) ([c361bc1](https://github.com/xiaocaishen-michael/no-vain-years-mono/commit/c361bc1cf75a5e91027906b5a16ee5996b069bfa))


### Bug Fixes

* **repo:** outbox_event.id 删冗余 DB 默认值 — 收敛 schema↔migration drift ([#260](https://github.com/xiaocaishen-michael/no-vain-years-mono/issues/260)) ([7c4b56d](https://github.com/xiaocaishen-michael/no-vain-years-mono/commit/7c4b56d4cb934a58c2b6e5c80a3ac9ebac83b08c))

## [0.1.0](https://github.com/xiaocaishen-michael/no-vain-years-mono/compare/server-v0.0.1...server-v0.1.0) (2026-05-29)


### Features

* **account:** A-002 GetProfile + UpdateDisplayName + mobile bootstrap ([#65](https://github.com/xiaocaishen-michael/no-vain-years-mono/issues/65)) ([2c2d1e6](https://github.com/xiaocaishen-michael/no-vain-years-mono/commit/2c2d1e65d40bcb41485ee9a228af333f1229e4d2))
* **account:** 注销全生命周期 — 冻结/撤销/匿名化 + 客户端 (004) ([#198](https://github.com/xiaocaishen-michael/no-vain-years-mono/issues/198)) ([4bc3e82](https://github.com/xiaocaishen-michael/no-vain-years-mono/commit/4bc3e82fcb5a60a12e0fc7910d0c922cd92eca5e))
* **api-client:** W4 V8 OpenAPI 3.1 + @nvy/api-client codegen pipeline ([#16](https://github.com/xiaocaishen-michael/no-vain-years-mono/issues/16)) ([e000541](https://github.com/xiaocaishen-michael/no-vain-years-mono/commit/e000541013cca53832058899b14028997a6d41c2))
* **auth:** /speckit-implement phone-sms-auth (W2.4 in progress) ([#7](https://github.com/xiaocaishen-michael/no-vain-years-mono/issues/7)) ([965bd23](https://github.com/xiaocaishen-michael/no-vain-years-mono/commit/965bd23487648ef46db77554eb05d41c3031e493))
* **auth:** 005-device-management client — 登录管理屏 (US5) + FR-S15 contract polish (p4 B2) ([#222](https://github.com/xiaocaishen-michael/no-vain-years-mono/issues/222)) ([f64efc3](https://github.com/xiaocaishen-michael/no-vain-years-mono/commit/f64efc31f8ad39f7c270d9b34f4475083963b01b))
* **auth:** device-management — 登录设备列表 + 单设备远程撤销 (005) ([#201](https://github.com/xiaocaishen-michael/no-vain-years-mono/issues/201)) ([a08fb5d](https://github.com/xiaocaishen-michael/no-vain-years-mono/commit/a08fb5d5be9121eecf6b00fb28572ef052f6c907))
* **auth:** enforce ADR-0033 Outbox envelope with metadata.trace_id ([#90](https://github.com/xiaocaishen-michael/no-vain-years-mono/issues/90)) ([daaf040](https://github.com/xiaocaishen-michael/no-vain-years-mono/commit/daaf0406d1ce9ee7d5045f65830aaffe8f80c886))
* **auth:** T045+T046+T047 FR-S07 剩 3 条规则 + auth-failure lock 30min ([#13](https://github.com/xiaocaishen-michael/no-vain-years-mono/issues/13)) ([d7500e3](https://github.com/xiaocaishen-michael/no-vain-years-mono/commit/d7500e30f56c406fd7966f86d5d03914f00d0dcc))
* **auth:** T048+T049 W3 A3 RetryExecutor port + cockatiel adapter ([#14](https://github.com/xiaocaishen-michael/no-vain-years-mono/issues/14)) ([55223c5](https://github.com/xiaocaishen-michael/no-vain-years-mono/commit/55223c526edf599a5ee8c0a880805428bf91506f))
* **auth:** T050+T051+T052 W3 A4 Aliyun SMS gateway skeleton + ENV-gated ([#15](https://github.com/xiaocaishen-michael/no-vain-years-mono/issues/15)) ([7afca91](https://github.com/xiaocaishen-michael/no-vain-years-mono/commit/7afca91cc24965f3a695927b904bfef5d2ee17a2))
* **auth:** US2 unregistered phone auto-register (T029-T031) ([#8](https://github.com/xiaocaishen-michael/no-vain-years-mono/issues/8)) ([8e3ca10](https://github.com/xiaocaishen-michael/no-vain-years-mono/commit/8e3ca10af22751883a3b38fdb2cbb765a8b0c447))
* **auth:** US3 anti-enumeration + FROZEN disclosure (T032-T038) ([#9](https://github.com/xiaocaishen-michael/no-vain-years-mono/issues/9)) ([1cc292a](https://github.com/xiaocaishen-michael/no-vain-years-mono/commit/1cc292a5016649fed2e74886e8814308e24f400f))
* **auth:** W3 A1 throttler infra + FR-S07 第 1 条 sms:&lt;phone&gt; 60s rate limit ([#12](https://github.com/xiaocaishen-michael/no-vain-years-mono/issues/12)) ([05f6db8](https://github.com/xiaocaishen-michael/no-vain-years-mono/commit/05f6db87a9d254757ca0f1de9244ad1f29daf344))
* **infra:** W4 V7 multi-stage Dockerfile + cold start acceptance ([#17](https://github.com/xiaocaishen-michael/no-vain-years-mono/issues/17)) ([5487cf2](https://github.com/xiaocaishen-michael/no-vain-years-mono/commit/5487cf26b7a4b1922608e02d2f15dc5bb78714af))
* **server:** wire prisma migrate-deploy entrypoint + nginx reverse-proxy for prod cutover ([#144](https://github.com/xiaocaishen-michael/no-vain-years-mono/issues/144)) ([add662b](https://github.com/xiaocaishen-michael/no-vain-years-mono/commit/add662bdd0710615169f9a1df3fc2868712ad836))


### Bug Fixes

* **auth:** FR-S06 timing — SMS code storage bcrypt → HMAC-SHA256 ([#25](https://github.com/xiaocaishen-michael/no-vain-years-mono/issues/25)) ([d4c43e2](https://github.com/xiaocaishen-michael/no-vain-years-mono/commit/d4c43e2bc3a304f5063f1e892085932d1e2b7467))
* **auth:** login-management 双 header 叠加 + 设备名 transport 编码透传 ([#231](https://github.com/xiaocaishen-michael/no-vain-years-mono/issues/231)) ([66708c1](https://github.com/xiaocaishen-michael/no-vain-years-mono/commit/66708c1e33014256501b4152ac791e319435e400))
* **core:** PR-5 tail — CLS/FormValidation/AuthGate cascade + e2e revival ([#79](https://github.com/xiaocaishen-michael/no-vain-years-mono/issues/79)) ([ddee80a](https://github.com/xiaocaishen-michael/no-vain-years-mono/commit/ddee80a9e4a42dfe22fa5780138b0dc7c3275053))
* **infra:** V9 strip node:22-alpine global npm (CVE-2026-33671 HIGH) ([#19](https://github.com/xiaocaishen-michael/no-vain-years-mono/issues/19)) ([d662fac](https://github.com/xiaocaishen-michael/no-vain-years-mono/commit/d662facc5b3554b6599279684b1e0b2d2c4a2f00))
* **repo:** server tsconfig app/spec 拆分 — 根治 nx 缓存陈旧 .tsbuildinfo 的 spurious TS6059 flake ([#215](https://github.com/xiaocaishen-michael/no-vain-years-mono/issues/215)) ([385759d](https://github.com/xiaocaishen-michael/no-vain-years-mono/commit/385759decabced462f9e0f7f337c57cb50297690))
* **security:** throttler 429 透出 canonical Retry-After (跨 001/003/004/005) ([#202](https://github.com/xiaocaishen-michael/no-vain-years-mono/issues/202)) ([07d8d22](https://github.com/xiaocaishen-michael/no-vain-years-mono/commit/07d8d22b9a04e0c0e4c4ebc7462039933fa501d0))
* **server:** allow PATCH/DELETE in CORS preflight methods ([#227](https://github.com/xiaocaishen-michael/no-vain-years-mono/issues/227)) ([696b2e5](https://github.com/xiaocaishen-michael/no-vain-years-mono/commit/696b2e57e2f8a28144e430e0b6f37ff3c2f42c93))
* **server:** make prod Docker image build + report healthy (dry-run findings) ([#145](https://github.com/xiaocaishen-michael/no-vain-years-mono/issues/145)) ([bec0a52](https://github.com/xiaocaishen-michael/no-vain-years-mono/commit/bec0a528397a4d05a0ed1a9630f19fa3c18ef0f4))
