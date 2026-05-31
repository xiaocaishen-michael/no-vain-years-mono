# Aliyun OSS Provisioning Runbook — profile-image upload (009 / ADR-0045)

> 部署侧一次性配置（tasks T017）。**代码侧已就位的契约**：`apps/server/.env.example` 的 `OSS_*` + `oss.config.ts`（impl 落）。本 runbook = 在 Aliyun 侧把 bucket / CORS / referer / RAM uploader 建好，并把 `OSS_*` 注入 SWAS 部署 env。

## 前置事实（2026-05-31 实测）

- Aliyun account：`1585077417676312`；server region = **cn-shanghai**（SWAS）。
- 本机 `~/.aliyun` 配置的 profile = RAM user **`mbw-server`**，**无 OSS 权限**（`oss:ListBuckets` → 403 AccessDenied，SMS-scoped）。
- ⇒ **本 runbook 的所有 Aliyun 写操作必须用具 OSS + RAM 管理权的身份执行**（主账号 / 管理员 RAM / Aliyun 控制台），`mbw-server` profile 跑不动。
- Agent 侧已驱动完成：`.env.example` 的 `OSS_*` 契约 + plan/tasks T017 + 本 runbook + 下方所有配置 JSON。剩下的是 **持权身份执行 + secret 注入**（人工 / 你协助）。

## 决策

| 项 | 值 | 备注 |
|---|---|---|
| region | `cn-shanghai`（endpoint `oss-cn-shanghai.aliyuncs.com`）| 同区 SWAS 低延迟，per ADR-0045 |
| bucket | `mbw-profile-images`（**待确认全局唯一**）| OSS bucket 名全局唯一；冲突则换 `mbw-profile-images-<suffix>` 并同步改 `.env.example` |
| ACL | **public-read**（公开展示，per ADR-0045 §3）| 写仍仅经签名 PostObject |
| key 布局 | `avatar/<accountId>/<uuid>/img`、`background/<accountId>/<uuid>/img` | 防枚举（ADR-0045 OQ3）|
| 签名身份 | **方案 B 推荐**：专用 RAM uploader 仅 `oss:PutObject` on 前缀（ADR-0037 最小权限）| 方案 A：给 `mbw-server` 加 `oss:PutObject` 复用现有 key（省一把 key，但耦合 SMS 身份）|
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

## Step 4 — 签名身份（方案 B：专用 RAM uploader，推荐）

最小权限 policy（**权威 JSON**，account id 已填）：

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

> 仅 `oss:PutObject`。confirm 端点的 HEAD 校验（D3）走 **public-read 匿名 HEAD**（bucket 公共读），**不**需要本 key 的 GetObject —— 故 uploader 权限只给 PutObject。

CLI 骨架（持权身份执行）：

```bash
aliyun ram CreateUser --UserName mbw-oss-uploader
aliyun ram CreatePolicy --PolicyName mbw-oss-uploader-putobject --PolicyDocument "$(cat policy.json)"
aliyun ram AttachPolicyToUser --PolicyType Custom --PolicyName mbw-oss-uploader-putobject --UserName mbw-oss-uploader
aliyun ram CreateAccessKey --UserName mbw-oss-uploader   # 输出 AccessKeyId + AccessKeySecret —— secret 仅此一次可见
```

> **方案 A（省一把 key）**：跳过新建 user，给 `mbw-server` attach 上面同样的 policy，server 复用既有 `ALIYUN_ACCESS_KEY_*` 签名 → 此时 `OSS_ACCESS_KEY_*` 可指向同一对 key。代价 = SMS 与 OSS 写共享一个身份（key 泄露 blast radius 更大）。**默认走 B**。

## Step 5 — 注入 SWAS 部署 env（**人工 / 你来**，agent 不可达生产）

把以下写入 server 部署 env（SWAS，secret 走 secrets manager / 部署面，**不入 git**）：

```bash
OSS_REGION=oss-cn-shanghai
OSS_BUCKET=mbw-profile-images
OSS_ACCESS_KEY_ID=<Step4 输出>
OSS_ACCESS_KEY_SECRET=<Step4 输出>
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
