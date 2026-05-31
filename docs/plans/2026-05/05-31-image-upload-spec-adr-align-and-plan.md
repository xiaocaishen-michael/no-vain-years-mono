# ADR-0045 ↔ 008/009 图片上传 spec 对齐审计 + 技术调研 + 修复 plan

## Context

用户要求"对一下" **ADR-0045（对象存储选型 + Profile 图片上传架构）** 与对应的 **图片上传 feature spec**（头像 / 背景图 上传·显示·查看），二者都在 `008-profile-image-upload` 分支上（非 main）。审计中发现 3 处偏差（1 阻塞 + 2 stale）。用户确认：① 编号冲突 → 重编号 **009**；② 交付范围 = **先调研业内技术方案 + 实现细节 → 产出本 plan → 再切分支修复**。

本 plan = 三段：**(A) 对齐审计结论**（ADR vs spec 是否一致）+ **(B) 技术调研收敛**（把 ADR-0045 的 6 个 Open Question 用业界 fact-checked 做法落到具体选型）+ **(C) 执行序**（切分支后的修复 + spec/plan 落地步骤）。

---

## A. 对齐审计结论

**架构对齐度：高。** spec 逐条遵循 ADR-0045 的 5 项 Decision，6 个 Open Question 全部正确标注"留 plan"，无越权、无矛盾。

| ADR Decision | spec 覆盖 | 对齐 |
| --- | --- | --- |
| §1 Aliyun OSS 唯一选型 | Context + banner + Key Entities | ✅ |
| §2 client 直传 / 后端不代理字节 | US1·US3 + FR-S02 + FR-C03 + SC-007 | ✅ |
| §3 public-read + referer 防盗链 | FR-S07 | ✅ |
| §4 OSS 原生 IMG 派生 | FR-C04 + Key Entities | ✅ |
| §5 选图分叉 / 上传统一 | FR-C02·FR-C03 + state_branches | ✅ |

**3 个偏差（与架构对齐无关，是 spec 与当前 main 脱节 —— 分支落后 main 7 commit）：**

1. **🔴 feature_id `008` 撞号（阻塞）**：main 已有 `008-profile-name-gender-edit`（已合并+实装，`feature_id: 008-profile-name-gender-edit`）。分支重用 `008`。→ **重编号 009**（用户已定）。
2. **🟠 字段名漂移**：ADR §OQ5 写 `backgroundUrl`，spec 用 `backgroundImageUrl`。→ 统一为 **`backgroundImageUrl`**（更自描述，与 main UI copy `homeBackground='主页背景图'` 语义一致）。
3. **🟡 spec baseline stale**：① spec 称 `AccountProfileResponse` "仅 accountId/phone/displayName/status/createdAt"，main 现已含 **`bio` + `gender`**（`apps/server/src/account/account-profile.response.ts`）；② spec 称"等 007 合后 rebase"，但 007 的头像/主页背景图 disabled 占位行**已在 main**（`apps/mobile/app/(app)/settings/account-security/index.tsx` L48/L67）；③ 占位行 header 注释当前挂在 main 的 "008 资料编辑"(name-gender) 名下。

**已验真锚点（无偏差）**：`profile.tsx` 的 `Hero`/`AvatarPlaceholder`/`onAvatarPress`·`onBackgroundPress`=`noop`(L298/L314)/`accessibilityHint="点击更换"` 全部存在，spec 引用准确。

---

## B. 技术调研收敛（ADR-0045 6 个 Open Question → 具体选型）

> 调研基于阿里云官方文档 + Expo 官方文档 + npm/GitHub 现状（2024–2026），逐条 fact-check。完整引用见本 plan 末尾「调研出处」。**这些是 HOW，最终落 `specs/009-*/plan.md`（SDD plan 阶段），不写进 spec（WHAT）。**

### B1. 凭证原语（ADR OQ1）—— ⭐ 最关键决策，待用户确认

三方案对约束的覆盖（关键差异）：

| 约束（FR-S02 要求） | STS 临时凭证 | Signed PUT URL | **PostObject policy** |
| --- | --- | --- | --- |
| key 前缀（本账号） | ✅ RAM policy | ✅ 签进 URL | ✅ `starts-with $key` |
| content-type 白名单 | ❌ 不约束 | ✅ 签进 header | ✅ `eq/in $content-type` |
| **size 上限** | ❌ 不约束 | ❌ 不约束 | ✅ `content-length-range` |
| 短时效 TTL | ✅ DurationSeconds | ✅ Expires | ✅ policy expiration |
| client 是否需 OSS SDK / 原生模块 | **需**（web `ali-oss` / RN `aliyun-oss-react-native` 原生模块） | 不需（裸 `fetch` PUT） | **不需**（裸 `FormData` POST） |

**推荐 = PostObject policy（表单直传）**，理由：

1. **唯一同时强约束 key 前缀 + content-type + size + TTL 四项**，且全部由 OSS 服务端校验、后端不碰字节 —— 精确命中 FR-S02 的"size 上限"承重要求（STS/signed-PUT 都无法在 OSS 层卡 size）。
2. **client 零 SDK / 零原生模块**：纯 `FormData` POST，web（`File`/`Blob`）+ RN（`expo-file-system` `uploadAsync` multipart）统一。对 **Expo managed workflow 关键** —— `aliyun-oss-react-native` 是原生模块，需 dev build、破 Expo Go、增原生维护面；PostObject 完全避开。
3. 后端表面最小：用 Node `crypto` 算 base64 policy + HMAC-SHA256 签名（V4），无需 STS Role/RAM 装配。

**取舍/风险**：`ali-oss` Node SDK **未公开** PostObject 的 policy 签名 API → 需手写 V4 PostObject 签名（Node `crypto`，~30–40 行，官方文档有 V4 算法）。runner-up = signed PUT URL（最简，`ali-oss` 有 `signatureUrlV4`），但无法卡 size → 不满足 FR-S02。STS 对 ≤数 MB 单图属过度设计（multipart/续传用不上）且带原生模块税。

### B2. bucket 布局 + key 命名（ADR OQ3）

- **单 bucket 多前缀**：`avatar/` + `background/`（bucket 数不计费、不影响性能；策略未分叉前单 bucket 最简，未来可拆）。
- **key 防枚举命名** = `avatar/<accountId>/<uuid>/<name>.<ext>`（`background/...` 同形）：
  - `<accountId>` 段让签名凭证能 `starts-with $key, avatar/<accountId>/` 锁到本账号（防越权写他人）；
  - `<uuid>`（v4，122 bit 随机）断 public-read bucket 的跨账号 URL 枚举。
- 实装用既有 id 生成（`uuid`/`nanoid`，确认 mono 已有依赖再选）。

### B3. 防滥用（ADR OQ4）

- **size + content-type**：PostObject policy 内 `content-length-range`(0, 5MB) + `eq/in $content-type` 限 `image/jpeg|png|webp`，OSS 服务端拒超限（字节不达后端）。后端签发前再校验请求声明的类型（双兜底；真实类型靠 magic-number 可选）。
- **TTL**：上传凭证 **15 min**（小图单次足够，缩暴露窗口）。
- **限流**：凭证签发 + 确认端点复用既有 `@nestjs/throttler` per-account（FR-S06），限流在加载账号前消费。
- **referer 防盗链**：OSS Referer 白名单（`*.<域>`）+ 允许空 referer（移动端/原生请求无 referer）。**定位 = best-effort 兜底**（referer 可伪造），与 public-read"公开展示"语义一致，非强隔离；私密资产需求按 ADR sunset_trigger 重审。

### B4. OSS 原生 IMG 派生（ADR OQ —— §4 已定，落实现参数）

- URL 参数即时派生：缩略 `?x-oss-process=image/resize,m_lfit,w_200,h_200/format,webp/quality,q_80`；详情用原图或更大尺寸。**单原图、零自存多尺寸**。
- 高频尺寸可选建 **Image Style**（`style/avatar_thumb`）省 URL 长度（免费、按处理量计）。
- **CDN 注意**（若 OQ2 上 CDN）：默认 CDN 忽略 query → 须配"保留参数"否则不同尺寸不命中缓存。

### B5. 自定义域名 + ICP 备案 + CDN（ADR OQ2）

- **v1 = OSS 默认 endpoint**（`<bucket>.oss-cn-*.aliyuncs.com`），`<img>`/`expo-image` 内嵌可用，零备案/零 CDN 装配。
- 自定义域名/CDN 加速需 ICP 备案 → 推迟（与客户端部署进度 [[project_client_deploy_status]] 的备案节奏对齐，非本期阻塞）。

### B6. 旧 object 清理（spec FR-S08）

- **v1 = 不删（leave-and-ignore）**：覆盖语义只更 DB URL 字段；旧 object 量小（数 MB×低频）成本可忽略，不阻塞主流程。
- 后续可上 **OSS Lifecycle 规则**（按 `*/archive/*` 前缀或 tag `Status=Archived` 定期过期）；本期仅在 plan 记选项，不实装。

### B7. bounded context 落点（ADR OQ6）

- 倾向 **`account`**（为自身 profile 资产签发凭证，非通用 platform 凭证）。最终按 [server-bounded-context-catalog](../conventions/server-bounded-context-catalog.md) 7 问决策，plan 阶段加 Operation Catalog 行。

### B8. 客户端实现细节（spec §5 / FR-C02·C03）

| 层 | native（iOS/Android） | web（Expo Web） |
| --- | --- | --- |
| 选图 | `expo-image-picker`（`launchImageLibraryAsync`/`launchCameraAsync`；`allowsEditing`+`aspect` **仅 Android**、iOS 裁剪恒方形） | `<input type=file accept=image/*>`（无相机）+ `react-easy-crop`（web-only，`Platform.OS==='web'` 条件引入） |
| resize/compress | `expo-image-manipulator`（新 `useImageManipulator` context API；`.resize().saveAsync({format:WEBP,compress})`） | canvas `toBlob('image/webp', q)` |
| 直传 | `expo-file-system` `uploadAsync`(multipart, `onProgress`) PostObject FormData | 裸 `fetch` + `FormData` POST |
| 显示 | `expo-image` `<Image>` + OSS IMG 缩略 param + `cacheKey` 分尺寸缓存 | 同 |
| 查看大图 | 先 `expo-image` + Modal +（已在用的）`react-native-reanimated` 手势；不够再引 `@likashefqet/react-native-image-zoom` | 同（galeria 有显式 web 支持，备选） |

> ⚠️ 上表所有"新依赖"在切分支后 **进 plan 前须 `Explore` 二次确认 mono 当前 Expo SDK 版本下的 API 形态 + 是否已在 deps**（per [[feedback_verify_subagent_claimed_packages]]）—— 尤其 `expo-image-manipulator` 新旧 API、`react-easy-crop` web-only 边界、查看大图库是否值得引（能 0 新依赖优先）。iOS 裁剪恒方形：背景图宽幅在 iOS 由显示端 framing 或独立裁剪兜（plan 定）。

---

## C. 执行序（切分支后，按 step → verify）

> 全部需在 `008-profile-image-upload` 分支执行（plan mode + 跨分支，当前 main 无法落笔）。先 rebase 到 main（分支落后 7 commit）。

1. **rebase 分支到 main** → verify：`git rebase main` 干净；确认 007 占位行 + `AccountProfileResponse.bio/gender` 已在树内（解 stale baseline 前提）。
2. **重编号 008→009**：`git mv specs/008-profile-image-upload specs/009-profile-image-upload`；改 spec frontmatter `feature_id: 009-profile-image-upload`；改 banner `Feature Branch`/`Created` 行；改 `checklists/requirements.md` 相对引用；branch 改名 `009-profile-image-upload`（4 处一致 per [[reference_mono_sdd_artifacts_diverge_from_speckit_skill]]）。→ verify：`ls specs/ | grep 009` 且不再与 `008-profile-name-gender-edit` 撞号。
3. **统一字段名**：spec 全文维持 `backgroundImageUrl`；ADR §OQ5 加一句"字段名由 009 spec 定为 `backgroundImageUrl`"回链（可选）。→ verify：`rg 'backgroundUrl\b' docs specs` 仅剩 ADR 历史候选或清零。
4. **刷新 spec stale baseline**（3 处）：`AccountProfileResponse` 现含 bio/gender（新增是叠加非从最小集扩）；007 占位行已在 main（叙事改"翻 main 既有占位为 active"）；占位行归属注释更新到 009。→ verify：spec 描述与 `account-profile.response.ts` + `account-security/index.tsx` 现状逐字对得上；跑 `/speckit-baseline-audit 009-profile-image-upload` 二次自检。
5. **（可选，用户定）跑 `/speckit-plan`**：把 B 段收敛的决策（PostObject 凭证 / key 命名 / 防滥用 / OSS IMG / v1 默认 endpoint / 不删旧 object / account context / 客户端选型）写进 `specs/009-*/plan.md`，含 server-bounded-context Operation Catalog 行 + api-contract regen 计划。→ verify：plan 通过 `/speckit-analyze` 跨制品一致性。

> 注：spec 是 full-stack feature（实装排在 007 之后、已在 main），本 plan 不含实装；实装走标准 SDD `/speckit-tasks` → `/speckit-implement`，单独 session（per [[feedback_cross_session_first_message_templates]] / SDD session 边界纪律）。

---

## 验证方式

- **对齐**：`git show <branch>:docs/adr/0045-*.md` vs `:specs/008-profile-image-upload/spec.md` 并排核 §1–§5 / OQ1–6（A 段表已做）。
- **编号冲突**：`ls specs/ | grep -E '00[89]'`（main 现 `008-profile-name-gender-edit`；分支引入 `008-profile-image-upload` 即冲突）。
- **锚点**：`rg -n 'onAvatarPress|noop|accessibilityHint' apps/mobile/app/\(app\)/\(tabs\)/profile.tsx`、`rg -n 'avatarUrl|backgroundImageUrl|bio|gender' apps/server/src/account/account-profile.response.ts`、`rg -n 'COPY.avatar|homeBackground' apps/mobile/app/\(app\)/settings/account-security/index.tsx`。
- **技术选型 fact-check**：切分支进 plan 前用 `Explore` 复核 Expo 包 API 形态 + ali-oss PostObject 签名是否需手写（per [[feedback_verify_subagent_claimed_packages]]）。

## 调研出处（关键）

- 凭证原语：阿里云 OSS「客户端直传」「PostObject」「STS 临时凭证」「signatureUrlV4」+ CORS 配置 docs（help.aliyun.com / alibabacloud.com）。
- 防滥用/IMG/Lifecycle：OSS「防盗链(hotlink-protection)」「图片处理 resize/format」「Image Styles」「Lifecycle 规则」docs。
- 客户端：Expo `imagepicker`/`imagemanipulator`/`filesystem`/`image` 官方 docs；`react-easy-crop` npm（web-only 已确认）。
