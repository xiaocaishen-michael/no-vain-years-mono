# Production Cutover Runbook — mono server drop-in replace meta (Aliyun SWAS)

Hand-on procedure for deploying the mono NestJS server to the shared Aliyun
SWAS, replacing the legacy `my-beloved-server` (Spring) stack. First executed
2026-05-24. Topology / decisions: [ADR-0026](../../docs/adr/0026-backend-deployment-topology.md)
(A-Tight v2 reuse + 7 decisions). Docker discipline: `.claude/rules/docker-rules.md`.

> **Compare-and-stop**: this is a destructive, outward-facing operation. Follow
> step by step; on any deviation, stop and investigate — do not force through.

## Topology recap

- Single SWAS instance (`101.133.128.62`), reused from meta — no new provisioning.
- PG + Redis as co-located docker compose services; **mono uses its own volumes**
  (`nvy-tight_nvy-pgdata` / `nvy-tight_nvy-redisdata`), separate from meta's
  (`mbw-tight_*`). So mono starts with a fresh empty PG and meta data stays
  intact for rollback — cutover only **stops** meta, never mutates it.
- Image registry: Aliyun ACR personal `mbw_xcs/mbw-app`, reused. mono tags
  `vX.Y.Z` (meta used `v0.X.Y`; no collision).
- Domain `api.xiaocaishen.me` + Let's Encrypt cert reused (already ICP-filed).
- `ufw` is **not** used on SWAS (per `reference_aliyun_swas_ufw_incompat`);
  firewall is the SWAS console security group only.

## Prereqs (one-time)

1. **GitHub Actions secrets** (mono repo) — reused from meta:
   `ACR_USERNAME` / `ACR_PASSWORD` / `APP_SSH_KEY` / `APP_HOST` / `APP_SSH_USER`.
   - **ACR username gotcha**: personal-edition docker login username is
     `mbw-server@<accountID>` (e.g. `mbw-server@1226926581945243`), **not** the
     full RAM logon name with the `.onaliyun.com` suffix.
   - **ACR password**: the 访问凭证 _fixed password_, not an AccessKey secret,
     not the console login password.
   - `APP_SSH_KEY` must keep its trailing newline (webfactory/ssh-agent fails
     with `error in libcrypto` otherwise); set via `gh secret set ... < keyfile`.
2. **Image in ACR**: push a `server-vX.Y.Z` tag (release-please) or
   `gh workflow run build-image.yml -f tag=server-vX.Y.Z`. Strips `server-` →
   ACR tag `vX.Y.Z` + `latest`.

## Cutover steps

### 1. Pull / load the image onto SWAS

The box needs the app image locally. Either `docker login` on the box and
`docker compose pull app`, or — if the box ACR login is unavailable — transfer
from an already-authenticated workstation (GFW-resilient, no box login):

```bash
docker pull --platform linux/amd64 <acr>/mbw_xcs/mbw-app:vX.Y.Z
docker save <acr>/mbw_xcs/mbw-app:vX.Y.Z | gzip -1 \
  | ssh -i ~/.ssh/mbw_gha_deploy admin@101.133.128.62 'gunzip | docker load'
```

### 2. SWAS prep (non-destructive — does not touch meta)

```bash
ssh -i ~/.ssh/mbw_gha_deploy admin@101.133.128.62
# clone mono (shallow; GFW may need a retry or two)
git clone --depth 1 https://github.com/xiaocaishen-michael/no-vain-years-mono.git \
  /home/admin/no-vain-years-mono
cd /home/admin/no-vain-years-mono

# .env.production — generate fresh secrets on-box, chmod 600
cp .env.production.example .env.production
# fill DB_PASSWORD / REDIS_PASSWORD / AUTH_JWT_SECRET / SMS_CODE_HMAC_SECRET
#   with `openssl rand -hex 32`; CORS_ALLOWED_ORIGINS per ADR-0025;
#   SMS_GATEWAY=mock; MBW_VERSION=vX.Y.Z
chmod 600 .env.production

# copy the Let's Encrypt cert volume from meta → mono
docker volume create nvy-tight_nvy-letsencrypt
docker run --rm -v mbw-tight_mbw-letsencrypt:/from:ro -v nvy-tight_nvy-letsencrypt:/to \
  alpine sh -c 'cp -a /from/. /to/'

# pre-flight: image present + compose parses
docker compose -f docker-compose.tight.yml --env-file .env.production config --quiet
```

### 3. Cutover (DESTRUCTIVE — downtime window)

```bash
META=/home/admin/my-beloved-server
MONO=/home/admin/no-vain-years-mono
# stop meta (frees 80/443; meta volumes retained)
docker compose -f $META/docker-compose.tight.yml --env-file $META/.env.production down
# start mono full stack; app entrypoint runs `prisma migrate deploy` first
docker compose -f $MONO/docker-compose.tight.yml --env-file $MONO/.env.production up -d
```

### 4. Verify

```bash
docker compose -f $MONO/docker-compose.tight.yml --env-file $MONO/.env.production ps  # 4 healthy
docker logs nvy-tight-app-1 2>&1 | grep -i migration                                  # migrations applied
curl -fsS https://api.xiaocaishen.me/healthz/live
curl -fsS https://api.xiaocaishen.me/healthz/ready                                     # prisma+redis up
# business smoke (mock SMS): request a code, read it from the app log, complete auth
curl -fsS -X POST https://api.xiaocaishen.me/api/v1/accounts/sms-codes \
  -H 'Content-Type: application/json' -d '{"phone":"+8613800138000"}'
docker logs nvy-tight-app-1 2>&1 | grep '\[MOCK SMS\]'   # → code
curl -fsS -X POST https://api.xiaocaishen.me/api/v1/accounts/phone-sms-auth \
  -H 'Content-Type: application/json' -d '{"phone":"+8613800138000","code":"<CODE>"}'
```

### 5. Post-cutover hygiene

- **Backup cron** → mono: `/etc/cron.d/mbw-backup-pg` runs `ops/runbook/backup-pg.sh`
  with `COMPOSE_FILE` / `ENV_FILE` pointed at mono. Validate once manually +
  `aliyun ossutil ls oss://mbw-oss/pg/`.
- **Cert-renew cron** → mono: `/etc/cron.d/mbw-certbot-renew` post-hook copies to
  `nvy-tight_nvy-letsencrypt` volume + `docker exec nvy-tight-nginx-1 nginx -s reload`.
- **Steady-state deploys** are then automatic: a `server-vX.Y.Z` tag →
  `build-image.yml` → `deploy.yml` SSHes in and `up -d --force-recreate app`
  (PG/Redis untouched).
- Meta image `v0.X.Y` tags stay in ACR as rollback targets.

## Rollback

```bash
docker compose -f $MONO/docker-compose.tight.yml --env-file $MONO/.env.production down
docker compose -f $META/docker-compose.tight.yml --env-file $META/.env.production up -d
```

Meta's data volumes are untouched, so meta returns exactly as before. Use meta's
immutable `v0.X.Y` ACR tag — not `latest` (mono overwrites `latest`).
