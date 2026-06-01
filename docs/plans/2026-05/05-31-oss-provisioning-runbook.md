# Aliyun OSS Provisioning Runbook — profile-image upload (009 / ADR-0045)

> 部署侧一次性配置（tasks T017）。**代码侧已就位的契约**：`apps/server/.env.example` 的 `OSS_*` + `oss.config.ts`（impl 落）。本 runbook = 在 Aliyun 侧把 bucket / CORS / referer / RAM uploader 建好，并把 `OSS_*` 注入 SWAS 部署 env。

> ✅ **已 provision + 验证（2026-05-31）**：Step1-4 全做 + 实测绿 —— bucket `mbw-profile-images`(cn-shanghai/public-read) 存在；CORS 对 `app.xiaocaishen.me` 放行 / evil-origin 403；`mbw-server-xt` PutObject 在 `avatar/`+`background/` 成功、越权前缀 `other/` → 403（最小权限生效）；public GET → 200。本机验证 profile = `mbw-xt-oss`（账号 B AK `LTAI…CCV`）。
> ⏳ **仅剩 Step5（.62 注入 `OSS_*` + recreate）推迟到 009 implement/部署时**（现在 .62 跑 main 无 oss.config.ts，注入无意义且徒增 prod recreate）。
> 🧹 遗留：测试对象 `avatar/_smoke/test.txt` + `background/_smoke/test.txt` 待 console 删（mbw-server-xt PutObject-only 删不掉）。
> 🔗 **后续（2026-06-01）**：默认域名对内地 bucket **强制下载**图片（`Content-Disposition: attachment`），浏览器 `<img>` 无法内联——需绑定**自定义域名** `img.shintongtech.com`（备案中）。根因 + 跨账号绑定步骤见 [06-01-oss-custom-domain-binding-runbook](../2026-06/06-01-oss-custom-domain-binding-runbook.md)。

## 前置事实（2026-05-31 实测 + 同步）

**两个独立 Aliyun 主账号**（关键）：

| 账号 | 用途 | RAM 子账号 | 凭证去向 |
|---|---|---|---|
| **A** | .62 SWAS server（部署 + SMS）| `mbw-server` | server `ALIYUN_*`（SMS）|
| **B** = `1585077417676312` | **OSS**（本 feature）| `mbw-server-xt`（原名 mbw-server，2026-05-31 改）| server `OSS_*`（签名）|

- 本机 `~/.aliyun` profile（名 `mbw-server`）→ **账号 B / `mbw-server-xt`**（实测 `GetCallerIdentity`，改名已生效）；当前 `oss:ListBuckets` 403（**待授权**）。
- **OSS bucket 建在账号 B**；server 签 PostObject 的身份**必须是账号 B 的 `mbw-server-xt`**（签名 key 须与 bucket 同账号才有 `oss:PutObject` 效力）→ **server `OSS_ACCESS_KEY_*` = mbw-server-xt 的 AK**（与 SMS 的账号 A key 并存）。**不跨账号授权、不新建 uploader 用户**——复用 mbw-server-xt 加权即可。
- ⚠️ Agent 无法远程验 .62 运行时身份（无 SSH/部署面）；账号 A/B 拆分凭用户同步。
- Agent 已驱动：plan/tasks（含 T003 .env.example OSS_* + T017）+ 本 runbook + 下方配置 JSON。剩 **账号 B 给 mbw-server-xt 授权 + secret 注入 .62 env**（你 + 我协作）。

## 决策

| 项 | 值 | 备注 |
|---|---|---|
| region | `cn-shanghai`（endpoint `oss-cn-shanghai.aliyuncs.com`）| 同区 SWAS 低延迟，per ADR-0045 |
| bucket | `mbw-profile-images`（**待确认全局唯一**）| OSS bucket 名全局唯一；冲突则换 `mbw-profile-images-<suffix>` 并同步改 `.env.example` |
| ACL | **public-read**（公开展示，per ADR-0045 §3）| 写仍仅经签名 PostObject |
| key 布局 | `avatar/<accountId>/<uuid>/img`、`background/<accountId>/<uuid>/img` | 防枚举（ADR-0045 OQ3）|
| 签名身份 | **账号 B 的 `mbw-server-xt`**，加最小权限 `oss:PutObject` on 前缀（ADR-0037）；其 AK 即 server `OSS_ACCESS_KEY_*`。不新建 uploader、不跨账号 | 用户拍板复用 mbw-server-xt（已存在 + AK 在手）|
| public base URL | `https://mbw-profile-images.oss-cn-shanghai.aliyuncs.com` | 落 `avatarUrl`/`backgroundImageUrl` |

> CLI flag 细节随 `aliyun` CLI 版本（本机 3.3.12）/ ossutil 而异 —— 下方命令为**骨架**，执行前用 `aliyun oss --help` / `aliyun ram --help` 核对；**控制台路径同样可靠**，二选一。配置 **JSON 值是权威**。

## Step 1 — 建 bucket（public-read，cn-shanghai）

控制台：OSS → 创建 Bucket → 名 `mbw-profile-images` / 区域 华东2(上海) / 读写权限 **公共读**。
CLI 骨架：

```bash
aliyun oss mb oss://mbw-profile-images --region cn-shanghai --acl public-read
```

## Step 2 — CORS（允许 web 直传 PostObject）

控制台：bucket → 权限管理 → 跨域设置 → 创建规则，用下值；或 CLI `PutBucketCors`。**规则值（权威）**：

```json
{
  "CORSRule": [
    {
      "AllowedOrigin": [
        "https://app.xiaocaishen.me",
        "https://no-vain-years-mono.pages.dev",
        "http://localhost:8081"
      ],
      "AllowedMethod": ["POST", "PUT", "GET", "HEAD"],
      "AllowedHeader": ["*"],
      "ExposeHeader": ["ETag", "x-oss-request-id"],
      "MaxAgeSeconds": 3600
    }
  ]
}
```

> `AllowedOrigin` 对齐 CORS_ALLOWED_ORIGINS（`.env.example` 注释里的 CF Pages host）；preview 分支域按需追加。native（Expo app）直传**不经浏览器 CORS**，无需为其加 origin。

## Step 3 — Referer 防盗链（best-effort 兜底，ADR-0045 §3）

控制台：bucket → 权限管理 → 防盗链。**值**：

- Referer 白名单：`https://app.xiaocaishen.me`、`https://*.no-vain-years-mono.pages.dev`
- **允许空 Referer：是**（native app / 直接 `<img>` 加载常无 referer，关掉会误伤）
- 定位 = 防外站嵌图的弱兜底，可伪造，非强隔离（私密资产需求按 ADR-0045 sunset_trigger 重审）。

## Step 4 — 给 `mbw-server-xt`（账号 B）加 OSS 权限（你在账号 B RAM 控制台）

**永久最小权限 policy**（runtime 签名只需这个，**权威 JSON**，account B id 已填）：

```json
{
  "Version": "1",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["oss:PutObject"],
      "Resource": [
        "acs:oss:*:1585077417676312:mbw-profile-images/avatar/*",
        "acs:oss:*:1585077417676312:mbw-profile-images/background/*"
      ]
    }
  ]
}
```

> 仅 `oss:PutObject`。confirm 的 HEAD 校验（D3）走 **public-read 匿名 HEAD**（bucket 公共读），**不**需 GetObject。`mbw-server-xt` 的 AK（已存在，在你手上 / 本机 CLI 那把）= server `OSS_ACCESS_KEY_*`，**无需新建 AccessKey**。

**若让 agent 用本机 CLI（= mbw-server-xt）跑 Step1-3 provisioning**，需**临时**额外加 bucket-admin（建完后撤回，留上面的 PutObject-only）：

```json
{
  "Version": "1",
  "Statement": [
    { "Effect": "Allow",
      "Action": ["oss:PutBucket","oss:PutBucketCors","oss:PutBucketReferer","oss:GetBucketInfo","oss:ListBuckets","oss:PutObject"],
      "Resource": ["acs:oss:*:1585077417676312:mbw-profile-images","acs:oss:*:1585077417676312:mbw-profile-images/*","acs:oss:*:1585077417676312:*"] }
  ]
}
```

> 控制台：账号 B → RAM → 用户 `mbw-server-xt` → 添加权限 → 自定义 policy（粘上方 JSON）。建完 bucket 后把临时 policy 解绑，仅留 PutObject-only。

## Step 5 — 注入 SWAS 部署 env（**人工 / 你来**，agent 不可达生产）

把以下写入 server 部署 env（SWAS，secret 走 secrets manager / 部署面，**不入 git**）：

```bash
OSS_REGION=oss-cn-shanghai
OSS_BUCKET=mbw-profile-images
OSS_ACCESS_KEY_ID=<账号 B mbw-server-xt 的 AccessKeyId>      # 与 SMS 的 ALIYUN_*(账号A) 不同账号，并存
OSS_ACCESS_KEY_SECRET=<账号 B mbw-server-xt 的 AccessKeySecret>
```

## 验证

1. 控制台确认 bucket public-read + CORS 规则 + referer 白名单（含允许空 referer）。
2. 用 uploader key 本地试签一个 PostObject policy + `curl -F` 直传一张测试图到 `avatar/<accountId>/<uuid>/img` → 200；越权前缀（如 `avatar/other/...`）→ 403（policy 限制生效）。
3. 浏览器从 `https://app.xiaocaishen.me` fetch PostObject POST → 无 CORS 报错。
4. `https://mbw-profile-images.oss-cn-shanghai.aliyuncs.com/<key>` 直接 `<img>` 可加载（public-read）；`?x-oss-process=image/resize,w_200` 派生缩略生效。

## 与代码的接缝

- `oss.config.ts`（impl T003）Zod 校验 `OSS_REGION/OSS_BUCKET/OSS_ACCESS_KEY_ID/OSS_ACCESS_KEY_SECRET`（feature 启用时必填）。
- `oss-policy.ts`（T004）用上述 region/bucket/key 签 PostObject；`buildPostObjectCredential` 的 `IMAGE_WHITELIST` + `content-length-range` 与本 bucket 无关（policy 内联），但 CORS 的 `AllowedMethod` 必含 `POST`。
- confirm 的 HEAD（T006，D3 必做）打 public base URL，无需 OSS 凭证。
