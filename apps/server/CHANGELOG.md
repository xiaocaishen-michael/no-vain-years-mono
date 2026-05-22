# Changelog

## [0.1.0](https://github.com/xiaocaishen-michael/no-vain-years-mono/compare/server-v0.0.1...server-v0.1.0) (2026-05-22)


### Features

* **account:** A-002 GetProfile + UpdateDisplayName + mobile bootstrap ([#65](https://github.com/xiaocaishen-michael/no-vain-years-mono/issues/65)) ([2c2d1e6](https://github.com/xiaocaishen-michael/no-vain-years-mono/commit/2c2d1e65d40bcb41485ee9a228af333f1229e4d2))
* **api-client:** W4 V8 OpenAPI 3.1 + @nvy/api-client codegen pipeline ([#16](https://github.com/xiaocaishen-michael/no-vain-years-mono/issues/16)) ([e000541](https://github.com/xiaocaishen-michael/no-vain-years-mono/commit/e000541013cca53832058899b14028997a6d41c2))
* **auth:** /speckit-implement phone-sms-auth (W2.4 in progress) ([#7](https://github.com/xiaocaishen-michael/no-vain-years-mono/issues/7)) ([965bd23](https://github.com/xiaocaishen-michael/no-vain-years-mono/commit/965bd23487648ef46db77554eb05d41c3031e493))
* **auth:** enforce ADR-0033 Outbox envelope with metadata.trace_id ([#90](https://github.com/xiaocaishen-michael/no-vain-years-mono/issues/90)) ([daaf040](https://github.com/xiaocaishen-michael/no-vain-years-mono/commit/daaf0406d1ce9ee7d5045f65830aaffe8f80c886))
* **auth:** T045+T046+T047 FR-S07 剩 3 条规则 + auth-failure lock 30min ([#13](https://github.com/xiaocaishen-michael/no-vain-years-mono/issues/13)) ([d7500e3](https://github.com/xiaocaishen-michael/no-vain-years-mono/commit/d7500e30f56c406fd7966f86d5d03914f00d0dcc))
* **auth:** T048+T049 W3 A3 RetryExecutor port + cockatiel adapter ([#14](https://github.com/xiaocaishen-michael/no-vain-years-mono/issues/14)) ([55223c5](https://github.com/xiaocaishen-michael/no-vain-years-mono/commit/55223c526edf599a5ee8c0a880805428bf91506f))
* **auth:** T050+T051+T052 W3 A4 Aliyun SMS gateway skeleton + ENV-gated ([#15](https://github.com/xiaocaishen-michael/no-vain-years-mono/issues/15)) ([7afca91](https://github.com/xiaocaishen-michael/no-vain-years-mono/commit/7afca91cc24965f3a695927b904bfef5d2ee17a2))
* **auth:** US2 unregistered phone auto-register (T029-T031) ([#8](https://github.com/xiaocaishen-michael/no-vain-years-mono/issues/8)) ([8e3ca10](https://github.com/xiaocaishen-michael/no-vain-years-mono/commit/8e3ca10af22751883a3b38fdb2cbb765a8b0c447))
* **auth:** US3 anti-enumeration + FROZEN disclosure (T032-T038) ([#9](https://github.com/xiaocaishen-michael/no-vain-years-mono/issues/9)) ([1cc292a](https://github.com/xiaocaishen-michael/no-vain-years-mono/commit/1cc292a5016649fed2e74886e8814308e24f400f))
* **auth:** W3 A1 throttler infra + FR-S07 第 1 条 sms:&lt;phone&gt; 60s rate limit ([#12](https://github.com/xiaocaishen-michael/no-vain-years-mono/issues/12)) ([05f6db8](https://github.com/xiaocaishen-michael/no-vain-years-mono/commit/05f6db87a9d254757ca0f1de9244ad1f29daf344))
* **infra:** W4 V7 multi-stage Dockerfile + cold start acceptance ([#17](https://github.com/xiaocaishen-michael/no-vain-years-mono/issues/17)) ([5487cf2](https://github.com/xiaocaishen-michael/no-vain-years-mono/commit/5487cf26b7a4b1922608e02d2f15dc5bb78714af))


### Bug Fixes

* **auth:** FR-S06 timing — SMS code storage bcrypt → HMAC-SHA256 ([#25](https://github.com/xiaocaishen-michael/no-vain-years-mono/issues/25)) ([d4c43e2](https://github.com/xiaocaishen-michael/no-vain-years-mono/commit/d4c43e2bc3a304f5063f1e892085932d1e2b7467))
* **core:** PR-5 tail — CLS/FormValidation/AuthGate cascade + e2e revival ([#79](https://github.com/xiaocaishen-michael/no-vain-years-mono/issues/79)) ([ddee80a](https://github.com/xiaocaishen-michael/no-vain-years-mono/commit/ddee80a9e4a42dfe22fa5780138b0dc7c3275053))
* **infra:** V9 strip node:22-alpine global npm (CVE-2026-33671 HIGH) ([#19](https://github.com/xiaocaishen-michael/no-vain-years-mono/issues/19)) ([d662fac](https://github.com/xiaocaishen-michael/no-vain-years-mono/commit/d662facc5b3554b6599279684b1e0b2d2c4a2f00))
