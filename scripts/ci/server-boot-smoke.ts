/**
 * Server runtime boot smoke (PR-T1 / 测试基建机制层).
 *
 * Standalone Node.js 脚本（用 tsx 跑）— 不依赖 vitest / nx target / CI.
 * 物理验证 contract:
 *   1. nx build server (ensure fresh dist; bakes SWC + decorator metadata)
 *   2. Testcontainers (Postgres + Redis) 真起
 *   3. 镜像 apps/server/src/main.ts bootstrap (Fastify + ValidationPipe
 *      with FormValidationException exceptionFactory + setGlobalPrefix('api'))
 *   4. 真 HTTP fetch (NOT app.inject) — 跨 process boundary 串联 trace_id
 *   5. 断言：(a) no 500 crash  (b) RFC 9457 ProblemDetail shape
 *      (c) traceId 字段非空 (CLS middleware → ProblemDetailFilter 链路活)
 *      (c+) x-trace-id response header ≡ body.traceId (双链路同步)
 *
 * Why dist import (not src): NestJS DI 依赖 `emitDecoratorMetadata` 输出的
 * `design:paramtypes` 反射元数据. tsx 默认 esbuild transform 不 emit metadata,
 * swc-node 在 monorepo `.js` 后缀 import 解析上有 gap. dist 是 nx build
 * (SWC) 编译产物, metadata 已烧入 — 最稳健.
 *
 * Why "no app.inject": app.inject 走 Fastify in-process injector, 绕过
 * 真实 socket 监听 + CLS request hook lifecycle, 拦不住 PR-79 类
 * "interceptor mode 漏 Guards/Filters" 的 cascade bug. 唯一可靠探针
 * 是真发 HTTP 请求 + 检查 response header + body 双链同步.
 *
 * Usage:
 *   pnpm tsx scripts/ci/server-boot-smoke.ts
 *
 * Prerequisites:
 *   - Docker / OrbStack 运行中 (Testcontainers 拉镜像 + 启容器)
 *   - apps/server/.swcrc + tsconfig.app.json 含 decoratorMetadata=true
 *
 * Expected exit codes:
 *   0 — 全 assertion pass, 终端 echo 真 traceId UUID
 *   1 — 任一 assertion fail, 含原因 + 完整 RFC 9457 body 调试用
 *
 * Maintained as part of multi-layer test gate strategy
 * (ADR-0040 / docs/plans/2026-05/05-22-test-infra-master.md).
 */

import 'reflect-metadata';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import {
  RedisContainer,
  type StartedRedisContainer,
} from '@testcontainers/redis';
import { ValidationError, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';

interface ProblemDetail {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
  instance?: string;
  traceId?: string;
  code?: string;
}

interface InvalidAttribute {
  field: string;
  messages: string[];
}

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const MONO_ROOT = path.resolve(SCRIPT_DIR, '../..');
const SERVER_DIR = path.resolve(MONO_ROOT, 'apps/server');
const SERVER_DIST = path.resolve(SERVER_DIR, 'dist');

function log(msg: string): void {
  console.log(`[smoke] ${msg}`);
}

// Mirrors apps/server/src/main.ts flattenValidationErrors — keep in sync.
function flattenValidationErrors(
  errors: ValidationError[],
  parentPath = '',
): InvalidAttribute[] {
  return errors.flatMap((err) => {
    const field = parentPath ? `${parentPath}.${err.property}` : err.property;
    const own: InvalidAttribute[] = err.constraints
      ? [{ field, messages: Object.values(err.constraints) }]
      : [];
    const nested = err.children?.length
      ? flattenValidationErrors(err.children, field)
      : [];
    return [...own, ...nested];
  });
}

async function runSmokeTest(): Promise<void> {
  log('[1/6] building server (nx build server) to ensure fresh dist…');
  execFileSync('pnpm', ['exec', 'nx', 'build', 'server'], {
    cwd: MONO_ROOT,
    env: process.env,
    stdio: 'inherit',
  });

  log('[2/6] booting Testcontainers (Postgres + Redis)…');
  const pgContainer: StartedPostgreSqlContainer =
    await new PostgreSqlContainer('postgres:16-alpine')
      .withDatabase('smoke')
      .withUsername('smoke')
      .withPassword('smoke')
      .start();
  const redisContainer: StartedRedisContainer = await new RedisContainer(
    'redis:7-alpine',
  ).start();

  let app: NestFastifyApplication | undefined;

  try {
    // Inject env BEFORE NestFactory.create — SecurityModule / AuthModule
    // ConfigService.getOrThrow checks run at module-init time.
    process.env['DATABASE_URL'] = pgContainer.getConnectionUri();
    process.env['REDIS_URL'] = redisContainer.getConnectionUrl();
    process.env['AUTH_JWT_SECRET'] =
      'smoke-test-jwt-secret-min-32-bytes-pad-abcdef';
    process.env['SMS_CODE_HMAC_SECRET'] =
      'smoke-test-hmac-secret-min-32-bytes-pad-zzzzzz';
    process.env['SMS_GATEWAY'] = 'mock';

    log('[3/6] applying Prisma migrations against smoke Postgres…');
    execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
      cwd: SERVER_DIR,
      env: process.env,
      stdio: 'inherit',
    });

    log('[4/6] dynamic-importing compiled AppModule + FormValidationException…');
    const appModuleUrl = pathToFileURL(
      path.resolve(SERVER_DIST, 'app/app.module.js'),
    ).href;
    const fveUrl = pathToFileURL(
      path.resolve(SERVER_DIST, 'security/form-validation.exception.js'),
    ).href;
    const { AppModule } = (await import(appModuleUrl)) as {
      AppModule: unknown;
    };
    const { FormValidationException } = (await import(fveUrl)) as {
      FormValidationException: new (errors: InvalidAttribute[]) => Error;
    };

    log('[5/6] booting NestFastifyApplication (mirrors main.ts)…');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    app = await NestFactory.create<NestFastifyApplication>(
      AppModule as any,
      new FastifyAdapter(),
      { logger: ['error', 'warn'], bufferLogs: true },
    );
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        exceptionFactory: (errors: ValidationError[]) =>
          new FormValidationException(flattenValidationErrors(errors)),
      }),
    );
    app.setGlobalPrefix('api');
    // Explicit IPv4 — NestFastifyApplication on dual-stack hosts may default
    // to '::' and surprise fetch with mixed v4/v6 resolution races.
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address();
    if (!address || typeof address === 'string') {
      throw new Error('smoke: failed to read bound port from Fastify');
    }
    const url = `http://127.0.0.1:${address.port}/api/v1/accounts/me`;
    log(`         listening on http://127.0.0.1:${address.port}`);

    log(
      `[6/6] probing ${url} with invalid bearer (expect 401 ProblemDetail)…`,
    );
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/problem+json',
        Authorization: 'Bearer smoke.invalid.token',
      },
    });
    const body = (await res.json()) as ProblemDetail;

    log(`       received status=${res.status}, asserting contract…`);

    // (a) Must not be 500 — Guard/Filter must catch invalid bearer cleanly.
    if (res.status === 500) {
      throw new Error(
        `[ASSERT-A] server crashed with 500; body=${JSON.stringify(body)}`,
      );
    }

    // (b) RFC 9457 ProblemDetail shape: type+title+status all present.
    if (!body.type || !body.title || typeof body.status !== 'number') {
      throw new Error(
        `[ASSERT-B] response missing RFC 9457 shape (type/title/status); body=${JSON.stringify(body)}`,
      );
    }

    // (c) traceId must be present + non-empty (CLS middleware + filter live).
    if (typeof body.traceId !== 'string' || body.traceId.length === 0) {
      throw new Error(
        `[ASSERT-C] response missing traceId — check CLS middleware + ProblemDetailFilter; body=${JSON.stringify(body)}`,
      );
    }

    // (c+) Cross-check: x-trace-id response header should mirror body.traceId.
    const headerTraceId = res.headers.get('x-trace-id');
    if (headerTraceId !== body.traceId) {
      throw new Error(
        `[ASSERT-C+] x-trace-id header (${headerTraceId}) ≠ body.traceId (${body.traceId}); cross-link broken`,
      );
    }

    log(
      `✅ ALL ASSERTIONS PASSED — status=${res.status} traceId=${body.traceId}`,
    );
  } catch (err) {
    console.error('[smoke] ❌ FAILED:', err);
    throw err;
  } finally {
    log('cleanup: closing Nest app + stopping containers…');
    if (app) await app.close();
    await redisContainer.stop();
    await pgContainer.stop();
  }
}

runSmokeTest().then(
  () => process.exit(0),
  () => process.exit(1),
);
