/**
 * 真后端 smoke harness — orchestrator (per docs/plans/2026-05/
 * 05-29-e2e-backend-boundary-hardening.md P2, layer「真后端 smoke」).
 *
 * The bulk FE e2e suite stubs the network boundary (hermetic, fast). This ONE
 * journey deliberately does the opposite: it stands up a REAL, throwaway backend
 * and proves the client's cold-boot session-bootstrap chain works against it —
 * refresh-token rotation + GET /me + AuthGate routing. Catches drift that a
 * stubbed suite can't (e.g. a server DTO / auth change that the mocks don't
 * mirror), complementing the type-level contract guard (src/core/api/
 * backend-contract.spec.ts).
 *
 * Why a standalone tsx orchestrator (Option B) and NOT a Playwright globalSetup
 * booting Nest in-process: Playwright's transpiler does not emit decorator
 * metadata, so NestFactory.create(AppModule) inside Playwright would fail DI.
 * Spawning the server's OWN swc-built artifact (apps/server/dist/main.js) keeps
 * decorator metadata intact, mirrors the prod artifact, and the try/finally here
 * guarantees container teardown even when Playwright fails.
 *
 * Flow: testcontainers PG+Redis → prisma migrate deploy → spawn real server on
 * :3000 → poll /healthz/ready → programmatic API login (black-box: the account
 * auto-registers on first phone-sms-auth, and issueSmsCode() returns the fixed
 * 999999 under NODE_ENV=development) → PATCH /me to set a displayName (so
 * AuthGate routes to the authed tabs, not onboarding) → hand the REAL
 * refreshToken to the Playwright child via env → run the smoke → teardown.
 *
 * Env-gated 独立 job: no-ops unless RUN_REAL_BACKEND_SMOKE=true so an accidental
 * local `nx run mobile:e2e-real-backend` without Docker exits 0 instead of
 * hanging (mirrors the RUN_PERF_IT pattern). CI runs it nightly, soft-signal.
 */
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import { execFileSync, spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createConnection } from 'node:net';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const GATE = 'RUN_REAL_BACKEND_SMOKE';
if (process.env[GATE] !== 'true') {
  console.log(`[real-backend-smoke] ${GATE} !== 'true' — skipping (env-gated 独立 job).`);
  process.exit(0);
}

// nx runs this target with cwd: apps/mobile.
const MOBILE_DIR = process.cwd();
const SERVER_DIR = resolve(MOBILE_DIR, '..', 'server');

const SERVER_PORT = 3000; // app axios baseURL default — do NOT change (web build bakes it).
const API = `http://127.0.0.1:${SERVER_PORT}`;
const PHONE = '+8613800138999';
const DISPLAY_NAME = '真后端冒烟';
const DEV_FIXED_CODE = '999999'; // issueSmsCode() under NODE_ENV=development (sms-code.rules.ts).

let pg: StartedPostgreSqlContainer | undefined;
let redis: StartedRedisContainer | undefined;
let server: ChildProcess | undefined;

// Fail fast (don't auto-kill) if :3000 is taken — the app's web build bakes
// localhost:3000 as the API base, so we cannot relocate, and the squatter might
// be the user's own dev server. A clear message beats a cryptic EADDRINUSE.
async function assertPortFree(port: number): Promise<void> {
  await new Promise<void>((resolveProbe, rejectProbe) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    socket.once('connect', () => {
      socket.destroy();
      rejectProbe(
        new Error(
          `:${port} is already in use. The real-backend smoke needs it free (the web build ` +
            `bakes localhost:${port} as the API base). Stop whatever is listening — e.g. ` +
            `\`lsof -tnP -i:${port} -sTCP:LISTEN | xargs kill\` — and retry.`,
        ),
      );
    });
    socket.once('error', () => {
      socket.destroy();
      resolveProbe(); // connection refused → port is free
    });
  });
}

async function waitForReady(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr = '';
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.status === 200) return;
      lastErr = `status ${res.status}`;
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
    }
    await sleep(500);
  }
  throw new Error(`server not ready at ${url} within ${timeoutMs}ms (last: ${lastErr})`);
}

async function postJson(path: string, body: unknown, bearer?: string) {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`POST ${path} → ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

async function patchJson(path: string, body: unknown, bearer: string) {
  const res = await fetch(`${API}${path}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`PATCH ${path} → ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

async function teardown(): Promise<void> {
  if (server && !server.killed) {
    server.kill('SIGTERM');
  }
  await Promise.allSettled([pg?.stop(), redis?.stop()]);
}

async function main(): Promise<number> {
  await assertPortFree(SERVER_PORT);

  console.log('[real-backend-smoke] starting PostgreSQL + Redis testcontainers…');
  pg = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('smoke')
    .withUsername('smoke')
    .withPassword('smoke')
    .start();
  redis = await new RedisContainer('redis:7-alpine').start();

  // Env for BOTH migrate deploy and the spawned server. NODE_ENV=development +
  // no VITEST → issueSmsCode() returns the fixed 999999 (black-box login). Strip
  // any inherited VITEST so the fixed-code branch is reachable.
  const serverEnv = {
    ...process.env,
    NODE_ENV: 'development',
    PORT: String(SERVER_PORT),
    DATABASE_URL: pg.getConnectionUri(),
    REDIS_URL: redis.getConnectionUrl(),
    AUTH_JWT_SECRET: 'real-backend-smoke-jwt-secret-min-32-bytes-pad-abcdef',
    SMS_CODE_HMAC_SECRET: 'real-backend-smoke-hmac-secret-min-32-bytes-pad-zzz',
    // CORS_ALLOWED_ORIGINS unset → '*' (permissive) so the :4173 web origin is allowed.
  };
  delete serverEnv.VITEST;

  console.log('[real-backend-smoke] prisma migrate deploy…');
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    cwd: SERVER_DIR,
    env: serverEnv,
    stdio: 'inherit',
  });

  console.log('[real-backend-smoke] spawning server (node dist/main.js) on :3000…');
  server = spawn('node', ['dist/main.js'], { cwd: SERVER_DIR, env: serverEnv, stdio: 'inherit' });
  server.on('exit', (code) => {
    if (code && code !== 0) console.error(`[real-backend-smoke] server exited early (${code})`);
  });

  // /healthz/ready exercises Prisma + Redis → proves the backend is fully wired,
  // not just that the Node process is up.
  await waitForReady(`${API}/healthz/ready`, 60_000);

  console.log('[real-backend-smoke] programmatic API login…');
  await postJson('/api/v1/accounts/sms-codes', { phone: PHONE });
  const auth = (await postJson('/api/v1/accounts/phone-sms-auth', {
    phone: PHONE,
    code: DEV_FIXED_CODE,
  })) as { accountId: string; accessToken: string; refreshToken: string };

  // Set a displayName via the REAL PATCH /me so GET /me returns a name and
  // AuthGate lands on the authed tabs (a null name would route to onboarding).
  await patchJson('/api/v1/accounts/me', { displayName: DISPLAY_NAME }, auth.accessToken);

  console.log(`[real-backend-smoke] login OK (accountId=${auth.accountId}); running Playwright…`);
  const pw = spawnSync(
    'pnpm',
    ['exec', 'playwright', 'test', '-c', 'playwright.real-backend.config.ts'],
    {
      cwd: MOBILE_DIR,
      stdio: 'inherit',
      env: {
        ...process.env,
        SMOKE_ACCOUNT_ID: auth.accountId,
        SMOKE_REFRESH_TOKEN: auth.refreshToken,
        SMOKE_DISPLAY_NAME: DISPLAY_NAME,
      },
    },
  );
  return pw.status ?? 1;
}

// If the runner is killed abruptly (e.g. nx/CI signals the tsx child, or Ctrl-C),
// the normal then/catch teardown never runs and the spawned server orphans on
// :3000 — poisoning the next run. Kill the child synchronously on signal so the
// OS reclaims :3000 immediately, then exit.
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    if (server && !server.killed) server.kill('SIGKILL');
    process.exit(1);
  });
}

main()
  .then(async (code) => {
    await teardown();
    process.exit(code);
  })
  .catch(async (err) => {
    console.error('[real-backend-smoke] FAILED:', err);
    await teardown();
    process.exit(1);
  });
