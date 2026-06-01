# Changelog

## [0.1.0](https://github.com/xiaocaishen-michael/no-vain-years-mono/compare/mobile-v0.0.1...mobile-v0.1.0) (2026-06-01)


### Features

* **account:** 006-account-settings-shell — 设置/账号与安全 导航壳 (A→B→C 链的 B) ([#221](https://github.com/xiaocaishen-michael/no-vain-years-mono/issues/221)) ([3f342e2](https://github.com/xiaocaishen-michael/no-vain-years-mono/commit/3f342e261ee8b00e562f4d07923c00bec49c8b73))
* **account:** 007 账号与安全三卡片重构 + 个人简介 bio 编辑 ([#247](https://github.com/xiaocaishen-michael/no-vain-years-mono/issues/247)) ([4963133](https://github.com/xiaocaishen-michael/no-vain-years-mono/commit/4963133ae902baa6938ab4fd584bc24aee56f7a1))
* **account:** 009 头像/主页背景图 上传·显示·查看大图（OSS client 直传 PostObject） ([#263](https://github.com/xiaocaishen-michael/no-vain-years-mono/issues/263)) ([afac728](https://github.com/xiaocaishen-michael/no-vain-years-mono/commit/afac7283cea7ae936826c91d9d432da59a6fed5d))
* **account:** 010 微信账号绑定/解绑 Phase 1 — 端口桩接 + 短信验证码解绑 ([#259](https://github.com/xiaocaishen-michael/no-vain-years-mono/issues/259)) ([c361bc1](https://github.com/xiaocaishen-michael/no-vain-years-mono/commit/c361bc1cf75a5e91027906b5a16ee5996b069bfa))
* **account:** A-002 GetProfile + UpdateDisplayName + mobile bootstrap ([#65](https://github.com/xiaocaishen-michael/no-vain-years-mono/issues/65)) ([2c2d1e6](https://github.com/xiaocaishen-michael/no-vain-years-mono/commit/2c2d1e65d40bcb41485ee9a228af333f1229e4d2))
* **account:** onboarding displayName mobile UI slice — RHF + web e2e ([#195](https://github.com/xiaocaishen-michael/no-vain-years-mono/issues/195)) ([b97e6f5](https://github.com/xiaocaishen-michael/no-vain-years-mono/commit/b97e6f5baa9b3177884a19a8a3f2950276b68b03))
* **account:** 注销全生命周期 — 冻结/撤销/匿名化 + 客户端 (004) ([#198](https://github.com/xiaocaishen-michael/no-vain-years-mono/issues/198)) ([4bc3e82](https://github.com/xiaocaishen-michael/no-vain-years-mono/commit/4bc3e82fcb5a60a12e0fc7910d0c922cd92eca5e))
* **auth:** 004-account-deletion client — 注销发起屏 (US10) + A→B3 链闭合 (p4 B3) ([#223](https://github.com/xiaocaishen-michael/no-vain-years-mono/issues/223)) ([5bfef94](https://github.com/xiaocaishen-michael/no-vain-years-mono/commit/5bfef941306217872db1493d12cb5682ab900248))
* **auth:** 005-device-management client — 登录管理屏 (US5) + FR-S15 contract polish (p4 B2) ([#222](https://github.com/xiaocaishen-michael/no-vain-years-mono/issues/222)) ([f64efc3](https://github.com/xiaocaishen-michael/no-vain-years-mono/commit/f64efc31f8ad39f7c270d9b34f4475083963b01b))
* **auth:** login mobile UI slice — RHF golden sample + web e2e ([#193](https://github.com/xiaocaishen-michael/no-vain-years-mono/issues/193)) ([a9b13e1](https://github.com/xiaocaishen-michael/no-vain-years-mono/commit/a9b13e19a189210f058fab8552742569d96e9b8f))
* **mobile:** 底栏 4 tab 图标系统 + 投资(portfolio) tab ([#232](https://github.com/xiaocaishen-michael/no-vain-years-mono/issues/232)) ([5de1664](https://github.com/xiaocaishen-michael/no-vain-years-mono/commit/5de1664231f5e112d2246aa2c88b5efab1c120c9))


### Bug Fixes

* **account:** /me 单一真相源 — 消除 displayName 回跳 + 跨账号资料泄漏 ([#254](https://github.com/xiaocaishen-michael/no-vain-years-mono/issues/254)) ([c13a276](https://github.com/xiaocaishen-michael/no-vain-years-mono/commit/c13a27603172d6ca36e9e33505d4754ce1962dc0))
* **account:** 账号与安全安全区微调 — 去安全小知识 + 注销账号独立居中卡片 ([#249](https://github.com/xiaocaishen-michael/no-vain-years-mono/issues/249)) ([c7b97fd](https://github.com/xiaocaishen-michael/no-vain-years-mono/commit/c7b97fd8dfe1ecd52f28162ab55d9016f17340eb))
* **auth:** login-management 双 header 叠加 + 设备名 transport 编码透传 ([#231](https://github.com/xiaocaishen-michael/no-vain-years-mono/issues/231)) ([66708c1](https://github.com/xiaocaishen-michael/no-vain-years-mono/commit/66708c1e33014256501b4152ac791e319435e400))
* **auth:** 冷启动主动刷新 token 消除首个 /me 401 ([#251](https://github.com/xiaocaishen-michael/no-vain-years-mono/issues/251)) ([901f6d3](https://github.com/xiaocaishen-michael/no-vain-years-mono/commit/901f6d3fe560ad2e6e2aa5594d5bd2d6a7944928))
* **auth:** 老账号登录回填 displayName 防误路由 onboarding ([#216](https://github.com/xiaocaishen-michael/no-vain-years-mono/issues/216)) ([37cd8ad](https://github.com/xiaocaishen-michael/no-vain-years-mono/commit/37cd8adee24c2facd7a6656f16215ad93c2c0371))
* **core:** PR-5 tail — CLS/FormValidation/AuthGate cascade + e2e revival ([#79](https://github.com/xiaocaishen-michael/no-vain-years-mono/issues/79)) ([ddee80a](https://github.com/xiaocaishen-michael/no-vain-years-mono/commit/ddee80a9e4a42dfe22fa5780138b0dc7c3275053))
* **mobile:** align deps to Expo SDK 54 (unblock native Android build) ([#183](https://github.com/xiaocaishen-michael/no-vain-years-mono/issues/183)) ([ab37875](https://github.com/xiaocaishen-michael/no-vain-years-mono/commit/ab37875bf17266a1a6b11e18ed83b6d020b80e72))
* **mobile:** login close×/gating/重登误入 onboarding 修复 + 底栏标签 web 裁切 ([#238](https://github.com/xiaocaishen-michael/no-vain-years-mono/issues/238)) ([f271bab](https://github.com/xiaocaishen-michael/no-vain-years-mono/commit/f271bab035b81a2cff5c3be42b6798efc72687f2))
* **mobile:** tab bar 标签 web 端被裁 — 显式 height + bottom padding ([#233](https://github.com/xiaocaishen-michael/no-vain-years-mono/issues/233)) ([4c34238](https://github.com/xiaocaishen-michael/no-vain-years-mono/commit/4c342381364bda88bc0c6d092014cbe662fead3d))
* **mobile:** use dot access for EXPO_PUBLIC_API_BASE_URL so Expo inlines it ([#175](https://github.com/xiaocaishen-michael/no-vain-years-mono/issues/175)) ([697f188](https://github.com/xiaocaishen-michael/no-vain-years-mono/commit/697f1886c7c6bb783d8cbf8899a3e6da85356122))
* **settings:** anchor (app) stack to (tabs) 修复嵌套路由刷新丢返回按钮 ([#250](https://github.com/xiaocaishen-michael/no-vain-years-mono/issues/250)) ([9df7663](https://github.com/xiaocaishen-michael/no-vain-years-mono/commit/9df7663277007700457c258e7c8fc51e778ec2e8))
* **settings:** headerLeft 兜底 — 嵌套屏 web 刷新返回不死路 ([#253](https://github.com/xiaocaishen-michael/no-vain-years-mono/issues/253)) ([ac600b8](https://github.com/xiaocaishen-michael/no-vain-years-mono/commit/ac600b85319cef9b5bbcf4b3c7712c13f787b302))
