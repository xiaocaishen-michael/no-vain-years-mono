# Local Dev / Manual-Test Runbook — server + mobile web

Hands-on procedure to bring the full stack up on a dev machine for **manual
testing**: Postgres + Redis (docker) → NestJS server (`localhost:3000`) → Expo
Web (`localhost:8081`). Dev deps topology: [`docker-compose.dev.yml`](../../docker-compose.dev.yml)
(ports 5433/6380, project `mbw-poc`, deliberately offset from prod/meta to avoid
collision). For production deploy see [`prod-cutover.md`](./prod-cutover.md).

> All commands run from the **mono root**
> (`no-vain-years-mono/`) unless noted. Ports used: 5433 (PG), 6380 (Redis),
> 3000 (server), 8081 (Expo web).

## Prereqs (one-time)

1. **Docker** running (OrbStack / Docker Desktop) — provides PG + Redis.
2. **Deps installed**: `pnpm install` (Node `^22`, pnpm `>=10 <11`).
3. **Server env**: `apps/server/.env` exists. If missing, copy from
   `apps/server/.env.example` and keep the dev defaults:
   - `DATABASE_URL="postgresql://mbw:mbw@localhost:5433/mbw_poc"`
   - `REDIS_URL="redis://localhost:6380"`
   - `SMS_GATEWAY="mock"` — **no real SMS sent**; the login code is written to
     the server log (see § Manual test).
4. **Mobile** needs no env for web: it defaults `baseURL` to `http://localhost:3000`
   when `EXPO_PUBLIC_API_BASE_URL` is unset (`apps/mobile/src/core/api/setup.ts`).

## Bring-up steps

### 1. Start deps (Postgres + Redis)

```bash
docker compose -f docker-compose.dev.yml up -d
docker compose -f docker-compose.dev.yml ps   # both should be (healthy)
```

### 2. Apply DB schema

```bash
pnpm -C apps/server exec prisma migrate status   # expect "Database schema is up to date!"
# if migrations are pending on a fresh volume:
pnpm -C apps/server exec prisma migrate deploy
```

### 3. Start the server (build + watch)

```bash
npx nx serve server      # runs build, then `node --watch dist/main.js`
```

Ready when the log prints `🚀 Application is running on: http://localhost:3000/api`.
Verify:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/healthz/live   # 200
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/docs           # 200 (OpenAPI UI)
```

> Routes carry global prefix `/api` (e.g. `/api/v1/...`), **except** health
> (`/healthz/live`, `/healthz/ready`) which is excluded from the prefix.

### 4. Start mobile (Expo Web)

```bash
npx nx run mobile:serve --args="--web"   # or: cd apps/mobile && npx expo start --web
```

First bundle is slow (Metro compiles the dep graph). Ready when it logs
`Waiting on http://localhost:8081`. Open <http://localhost:8081> in a browser.

| Target                    | API connectivity        | Notes                                                                                                          |
| ------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------- |
| Expo Web                  | `localhost:3000` direct | zero extra config                                                                                              |
| iOS simulator             | `localhost:3000` direct | shares the Mac network                                                                                         |
| physical device (Expo Go) | **needs LAN IP**        | `localhost` resolves to the phone; set `EXPO_PUBLIC_API_BASE_URL=http://<mac-lan-ip>:3000` before `expo start` |

## Manual test — getting the login SMS code

`SMS_GATEWAY=mock` means `MockSmsGateway` (`apps/server/src/auth/mock-sms.gateway.ts`)
does not send a real SMS — it logs the code instead. After requesting a code in
the app, grab it from the server log:

```text
[MOCK SMS] sent <code> to <phone> (purpose=login)
```

If the server runs in a terminal, the line is on stdout. If backgrounded to a
file, `grep "MOCK SMS" <logfile> | tail -1`.

## Teardown

```bash
# stop server + expo: Ctrl-C their terminals, or kill by port:
lsof -tnP -iTCP:3000 -sTCP:LISTEN | xargs -r kill -9
lsof -tnP -iTCP:8081 -sTCP:LISTEN | xargs -r kill -9

docker compose -f docker-compose.dev.yml down      # stop deps, KEEP data (volumes)
docker compose -f docker-compose.dev.yml down -v    # ...or drop the PG volume too
```

`down` (no `-v`) preserves the `mbw-poc-pgdata` volume, so schema + seeded data
survive across restarts.

## Troubleshooting

| Symptom                                   | Cause / fix                                                                      |
| ----------------------------------------- | -------------------------------------------------------------------------------- |
| server 404 on `/api/healthz/...`          | health is **not** under `/api`; use `/healthz/live`.                             |
| port 3000/8081/5433/6380 already in use   | a prior run is still up; kill by port (see Teardown) or `docker compose ... ps`. |
| mobile can't reach API on a real device   | `localhost` ≠ the Mac; set `EXPO_PUBLIC_API_BASE_URL` to the Mac LAN IP.         |
| `prisma migrate status` can't find schema | run via `pnpm -C apps/server` (cwd must be `apps/server`).                       |
| login never receives a code               | confirm `SMS_GATEWAY="mock"`; read the code from the server log, not a phone.    |
