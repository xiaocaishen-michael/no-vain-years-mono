#!/usr/bin/env node
/**
 * check-env-sync.ts — validate .env ↔ .env.example key alignment + process.env refs.
 *
 * Algorithm (per ADR-0037 § 2):
 *   1. K_example = keys in .env.example
 *   2. K_env = keys in .env (skip if absent — .env is gitignored)
 *   3. K_example != K_env → fail (values not checked)
 *   4. K_referenced = grep process.env.X across apps/**\/*.ts(x)
 *   5. K_referenced ⊄ K_example ∪ ALLOWLIST → fail
 *
 * Usage:
 *   pnpm tsx scripts/checks/check-env-sync.ts       # scan all configured pairs
 *   lefthook pre-commit hook triggers on staged .env* changes
 */

import { readFileSync, existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Script lives at scripts/checks/ → repo root is two levels up.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const ENV_PAIRS: Array<{ example: string; env: string }> = [
  { example: 'apps/server/.env.example', env: 'apps/server/.env' },
];

// Standard runtime / framework / CI env vars not required in .env.example.
// Test-only opt-in flags (RUN_PERF_IT / PERF_IT_REPS) belong here — they
// are vitest gate flags, not application config.
const ALLOWLIST = new Set([
  'PORT',
  'NODE_ENV',
  'CI',
  'GITHUB_ACTIONS',
  'RUN_PERF_IT',
  'PERF_IT_REPS',
  // vitest 运行时自动注入 (sms-code.rules.ts 用 !process.env.VITEST 区分测试 vs dev)。
  'VITEST',
  // 真发 SMS env-gated IT (apps/server/test/integration/aliyun-sms.real-send.it.spec.ts)
  // opt-in flag + 测试手机号 — vitest gate / 测试输入,非 application config。
  // (ALIYUN_ACCESS_KEY_ID/SECRET/SIGN_NAME/TEMPLATE_CODE 已在 .env.example。)
  'RUN_SMS_IT',
  'SMS_IT_PHONE',
  // Expo build-time public var (apps/mobile/src/core/api/setup.ts). EXPO_PUBLIC_*
  // is an Expo framework prefix baked into the web bundle at export; mobile has
  // no server-style .env/.env.example pair, so it is declared here.
  'EXPO_PUBLIC_API_BASE_URL',
]);

const SRC_DIRS = ['apps/server/src', 'apps/server/test', 'apps/mobile/src'];

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.next', '.expo', 'generated']);

function parseEnvKeys(content: string): Set<string> {
  const keys = new Set<string>();
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^([A-Z_][A-Z0-9_]*)=/.exec(line);
    if (m) keys.add(m[1]);
  }
  return keys;
}

async function walkTs(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      out.push(...(await walkTs(join(dir, e.name))));
    } else if (e.name.endsWith('.ts') || e.name.endsWith('.tsx')) {
      out.push(join(dir, e.name));
    }
  }
  return out;
}

async function findEnvRefs(): Promise<Set<string>> {
  const refs = new Set<string>();
  const re = /process\.env\.([A-Z_][A-Z0-9_]*)/g;
  for (const dir of SRC_DIRS) {
    const files = await walkTs(join(REPO_ROOT, dir));
    for (const f of files) {
      // Drop whole-line comments so doc mentions of `process.env.X` in comments
      // aren't mistaken for real refs (e.g. mobile setup.ts `EXPO_PUBLIC_*` note).
      const content = readFileSync(f, 'utf8')
        .split('\n')
        .filter((line) => {
          const t = line.trim();
          return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
        })
        .join('\n');
      let m: RegExpExecArray | null;
      while ((m = re.exec(content)) !== null) {
        refs.add(m[1]);
      }
    }
  }
  return refs;
}

function setDiff<T>(a: Set<T>, b: Set<T>): T[] {
  return [...a].filter((x) => !b.has(x));
}

async function main(): Promise<void> {
  const errors: string[] = [];
  const allExampleKeys = new Set<string>();

  for (const { example, env } of ENV_PAIRS) {
    const examplePath = join(REPO_ROOT, example);
    const envPath = join(REPO_ROOT, env);

    if (!existsSync(examplePath)) {
      errors.push(`Missing ${example}`);
      continue;
    }
    const K_example = parseEnvKeys(readFileSync(examplePath, 'utf8'));
    K_example.forEach((k) => allExampleKeys.add(k));

    if (!existsSync(envPath)) {
      console.log(
        `ℹ️  ${env} absent (gitignored / not yet provisioned) — skipping pair-diff check`,
      );
      continue;
    }
    const K_env = parseEnvKeys(readFileSync(envPath, 'utf8'));
    const onlyExample = setDiff(K_example, K_env);
    const onlyEnv = setDiff(K_env, K_example);
    if (onlyExample.length) {
      errors.push(`${example} has keys NOT in ${env}: ${onlyExample.join(', ')}`);
    }
    if (onlyEnv.length) {
      errors.push(`${env} has keys NOT in ${example}: ${onlyEnv.join(', ')}`);
    }
  }

  const refs = await findEnvRefs();
  const undeclared = [...refs].filter((k) => !allExampleKeys.has(k) && !ALLOWLIST.has(k));
  if (undeclared.length) {
    errors.push(
      `process.env.<KEY> refs not declared in any .env.example or ALLOWLIST: ${undeclared.join(', ')}`,
    );
  }

  if (errors.length) {
    console.error('❌ check-env-sync failed:\n');
    for (const e of errors) console.error(`  - ${e}`);
    console.error('\nFix:');
    console.error(
      '  - Keep .env and .env.example keys aligned (values may differ; .env is gitignored).',
    );
    console.error(
      '  - For new process.env.<KEY>: add a placeholder to apps/<app>/.env.example, OR add to ALLOWLIST in scripts/checks/check-env-sync.ts (only for runtime/framework vars, not app config).',
    );
    process.exit(1);
  }

  console.log('✅ check-env-sync: K_example == K_env; process.env refs all declared.');
}

main().catch((err) => {
  console.error('check-env-sync internal error:', err);
  process.exit(2);
});
