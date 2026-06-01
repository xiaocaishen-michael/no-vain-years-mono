# OSS 自定义域名绑定 Runbook — 头像/背景图浏览器内联预览（009 / ADR-0045 收口）

> **状态（2026-06-01）**：代码侧改动已就位（PR 见 git 史）；`shintongtech.com` **备案审批中**；OSS 绑定 + DNS + env 注入**待备案下号后**执行。本文是下号后的操作参考 + 根因留痕。

## 1. 根因（为什么要做这件事）

009 上传链路全程正确（签名直传 → 落库 → `GET /me` 回填 URL 全绿），但浏览器 `<img>` 加载头像失败。实测复现：

- 通过**默认域名** `https://mbw-profile-images.oss-cn-shanghai.aliyuncs.com/<key>` 匿名 GET（含 `?x-oss-process=image/resize,...` 缩略）→ HTTP 200、`Content-Type: image/webp`、CORS 头齐全，**但带 `Content-Disposition: attachment` + `x-oss-force-download: true`**。
- curl 能拿到字节（无视该头），浏览器 `<img>` 拿到"附件"响应拒绝内联渲染 → Network failed。
- `?response-content-disposition=inline` 覆盖 → 400 `Can not override response header for an anonymous user`（匿名禁改响应头）。

**这是阿里云官方安全策略，非 bug**：通过 OSS **默认域名**访问图片/HTML 等可内联资源时强制下载，防止把 OSS 当免备案图床/网站滥用。**华东2（上海）自 2019-09-29 起新建的 bucket 全部命中**，`mbw-profile-images` 在内。

- 官方出处：
  - <https://help.aliyun.com/zh/oss/user-guide/0048-00000114>（默认域名直接下载而非预览）
  - <https://help.aliyun.com/zh/oss/how-to-ensure-an-object-is-previewed-when-you-access-the-object>（上海 2019-09-29 生效 + 安全原因）

**影响范围**：主要卡**浏览器**（Expo Web / CF Pages）。原生 App（RN Image 走原生网络栈下载字节渲染，不理 `Content-Disposition`）大概率不受影响——待验证。

> ⚠️ 这戳中了 ADR-0045 的一个假设（"public-read + 默认域名 URL 可浏览器内联显示"被证伪）。是设计缺口，只有**真浏览器加载真 OSS 图**才暴露（HEAD 探测 + 单测/IT 都像 curl 一样无视 attachment），被手动 Layer 2 冒烟逮到。建议给 ADR-0045 补一条 known-issue / sunset 注记。

## 1.1 排查链（诊断过程留痕）

1. 现象：web 上传头像"报错"。DevTools Network → `upload-credential` 200 / OSS PUT 200 / `profile-image`(confirm) 200 / `GET /me` 200 **全成功**，**只 `img?x-oss-process=...` 两条 red (failed)** → 锁定「不是上传/落库，是显示」。
2. 取落库 URL（dev DB `account.avatar_url`）+ mobile 处理参数（`oss-image.ts` 的 `x-oss-process=image/resize,m_lfit,w_200,h_200/format,webp/quality,q_80`）。
3. curl 复现：裸图 GET + 带 `x-oss-process` GET **都 200 拿到 webp 字节**（curl 能、浏览器不能）→ 差异在响应头。
4. 响应头发现异常：`Content-Disposition: attachment` + `x-oss-force-download: true`（裸图 + 缩略图都有，CORS 头正常）。
5. 试 `?response-content-disposition=inline` 覆盖 → 400 `Can not override response header for an anonymous user`（匿名禁改响应头）。
6. fact-check 阿里云官方文档 → 确认默认域名强制下载安全策略（上海 2019-09-29 起新建 bucket），唯一彻底解法 = 自定义域名。
7. 查备案：`xiaocaishen.me` 未备案（3 个第三方 MIIT 源一致）→ 改用企业域名 `shintongtech.com`（备案审批中）。
8. 查跨账号绑定（OSS 账号 B、备案/SWAS 账号 A）→ 官方确认 OSS 绑定不要求备案同账号、走 TXT 验证 → 拓扑可行（见 §3）。

> **教训**：HEAD 探测 + 单测 + Testcontainers IT 都像 curl 一样无视 `Content-Disposition`，**唯有真浏览器加载真 OSS 图**能暴露此类「服务端全绿、客户端显示坏」缺口 → 真后端冒烟（Layer 2）不可省。

## 2. 决策

| 项 | 值 | 说明 |
|---|---|---|
| 解法 | **绑定自定义域名 + 改显示基址** | 官方确认：通过自定义域名访问，OSS **不**加强制下载头 |
| 域名 | `img.shintongtech.com`（企业域名 `shintongtech.com` 子域） | 换掉个人域名 `xiaocaishen.me`（未备案）；`shintongtech.com`=新瞳科技，企业主体备案 |
| 备案 | 审批中（2026-06-01） | 内地 bucket 绑定**强制要求**域名已 ICP 备案 |
| 上传 host | **保持默认域名不变** | PostObject 上传 + V4 签名 scope 必须留在 `<bucket>.<region>.aliyuncs.com`；自定义域名**只用于读/显示** |

### 为什么不选其他方案

| 方案 | 弃用原因 |
|---|---|
| 换海外 region bucket | 可行（海外默认域名不强制下载），但改 region + 重新 provision + 国内读图 +延迟；用户选了备案路线 |
| bucket 级开关关强制下载 | 官方确认**不存在** |
| 匿名 `response-content-disposition=inline` | 已实测 400（匿名禁改响应头） |
| 签名 URL 覆盖 | 破坏 public-read 免签名语义；能否盖过安全策略头官方未明说，不确定 |
| server 端代理图片 | 读图全压服务器带宽，废掉直传读侧收益 |

## 3. 跨账号关键结论（最容易踩的坑，已查证）

拓扑：域名 + SWAS 在**账号 A**（`101.133.128.62`，上海），OSS bucket 在**账号 B**（`mbw-profile-images`）。

| 关注点 | 结论 | 出处 |
|---|---|---|
| OSS 绑定自定义域名是否要求备案在 OSS 同账号(B)？ | **不要求**，只要域名在工信部有有效备案（任意账号/接入商）即可 | 官方确认 |
| 跨账号域名怎么绑？ | 走 **TXT 所有权验证**（`_dnsauth.img` 记录），绑定环节只校验所有权、不校验备案账号 | 官方确认 |
| 备案接入用哪台？ | 账号 A 的 SWAS 可作接入；**OSS/CDN 不能作备案接入** | 官方确认 |
| 备案接入与备案是否须同账号？ | **是**（或显式授权）→ 故备案走账号 A | 官方确认 |

**推荐路径**：账号 A 用 SWAS 办备案（已有合规服务器，零新增采购）→ 账号 B 的 OSS 绑定 `img.shintongtech.com` 走 TXT 跨账号验证。**不用迁桶、不用在账号 B 买国内服务器。**

- 出处：<https://help.aliyun.com/zh/icp-filing/basic-icp-service/product-overview/use-oss> / <https://help.aliyun.com/zh/oss/user-guide/access-buckets-via-custom-domain-names>
- ⚠️ **待确认**：子域名免备案豁免的官方语境是"源站在阿里云 + 主域在本账号备案"；"A 账号备案主域 + B 账号 OSS 用子域"这个精确组合官方文档未逐字覆盖。**审批中就确认备案的网站域名形态覆盖 `img.shintongtech.com`**（主域备案覆盖子域是惯例，但跨账号稳妥起见走工单核实）。

## 4. 配置改动清单

### 4a. 代码侧（本 PR 已完成，不依赖备案即可合）

| 文件 | 改动 |
|---|---|
| `apps/server/src/config/oss.config.ts` | `OssAliyunSchema` 加可选 `publicBaseUrl`（`z.string().url().optional()`）；`ossConfig()` 读 `OSS_PUBLIC_BASE_URL`（空 → undefined，不触发 url() 失败）；`ossPublicBaseUrl(region, bucket, publicBaseUrl?)` — 设了用它（剥尾斜杠），否则回退 `https://<bucket>.<region>.aliyuncs.com` |
| `apps/server/src/account/confirm-profile-image.usecase.ts` | 落库的 `publicUrl` 传 `this.ossCfg.publicBaseUrl` |
| `apps/server/src/account/oss-policy.ts` | **不动** — 上传 host + 签名 scope 留默认域名 |
| `apps/server/.env.example` + 本地 `.env` | 加 `OSS_PUBLIC_BASE_URL`（空，回退；check-env-sync key 对齐） |
| `.env.production.example` | 加注释 `# OSS_PUBLIC_BASE_URL=https://img.shintongtech.com`（备案后启用） |
| 测试 | `oss.config.spec`（custom domain 解析 + 空值容错 + 剥斜杠）/ `confirm-profile-image.usecase.spec`（publicBaseUrl 设了落自定义域名 URL） |

> **设计 smell（未做，flag）**：DB 存的是**完整绝对 URL**，域名一换存量 URL 全 stale。更稳是**只存 objectKey、读时拼基址**，以后换域名/CDN 零迁移。009 刚上线几乎无存量数据，本次先一次性切；重构待定。

### 4b. 备案下号后的手动步骤

**前置 verify**：工信部 <https://beian.miit.gov.cn/> 能查到 `shintongtech.com` 备案号。

1. **DNS（阿里云云解析，`shintongtech.com` NS = dns25/26.hichina.com）**：
   - `CNAME`：主机 `img` → `mbw-profile-images.oss-cn-shanghai.aliyuncs.com`
   - `TXT`：主机 `_dnsauth.img` → OSS 控制台给出的验证串
   - verify：`dig +short img.shintongtech.com` 解析到 OSS endpoint
2. **OSS 控制台（账号 B）**：Bucket → Bucket 配置 > 域名管理 > 绑定域名 `img.shintongtech.com` → 因 DNS 不在本账号选"验证域名所有权"（上面 TXT）→ 验证并绑定
3. **HTTPS 证书**：域名管理配 SSL（阿里云数字证书服务申请免费 DV 证书）+ 强制 HTTPS
4. **注入 env**：`.62` 的 `.env.production` 加 `OSS_PUBLIC_BASE_URL=https://img.shintongtech.com` → recreate app 容器
5. verify：
   - `curl -I https://img.shintongtech.com/<key>` **不再带** `Content-Disposition: attachment`
   - 浏览器（:8081 或线上）头像/背景图内联显示成功；`?x-oss-process=...resize` 缩略也内联

### 4c. 不用动

- **CORS `AllowedOrigin`** / **Referer 防盗链白名单**：管的是请求/引用页 origin，不是图片域名 → 不变
- **mobile**：`apps/mobile/src/profile-image/oss-image.ts` 的 `ossThumbUrl` 直接拿 server 返回 URL 追加 `?x-oss-process` → server 改自定义域名后自动跟着走，**前端零改动**

## 5. 执行顺序（step → verify）

1. 合代码 PR（4a）→ verify：server test 全绿、boot 仍 green（`OSS_PUBLIC_BASE_URL` 未设走回退）
2. 备案下号 → verify：工信部可查
3. DNS CNAME + TXT（4b.1）→ verify：dig 解析正确
4. OSS 绑定 + TXT 验证 + 证书（4b.2-3）→ verify：`curl -I` 无 attachment 头
5. 注入 env + recreate（4b.4）→ verify：浏览器内联显示成功

> 第 3-5 步**卡在备案下号**；第 1 步现在即可做（代码 optional 回退，不依赖备案）。

## 6. 相关

- OSS 开通 runbook（bucket/CORS/referer/RAM 授权）：`docs/plans/2026-05/05-31-oss-provisioning-runbook.md`
- ADR-0045（profile image PostObject 直传）— 建议补 known-issue 注记
- 备案接入：账号 A SWAS（企业材料：营业执照 ≥3 个月有效期 / 法人 + 网站负责人证件 / 人脸核验 / 真实性核验单 / 授权书）；阿里云初审 1-2 工作日 + 管局审核，总约 1-22 工作日
