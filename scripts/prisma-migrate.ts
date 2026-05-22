#!/usr/bin/env node
/**
 * prisma-migrate.ts — `prisma migrate dev` wrapper with auto-prepended
 * timestamp prefix, per ADR-0035 § 1 timestamp-hybrid naming.
 *
 * Output format: <yyyymmddhhmm>_<verb_obj>
 *   Examples: 20260520_1430_add_phone_to_account
 *             20260521_0900_drop_legacy_session_table
 *
 * Usage:
 *   pnpm db:migrate "add phone to account"
 *   pnpm db:migrate --dry-run "add phone to account"   # print name, don't execute
 *
 * The lefthook `migration-naming-check` hook (lefthook.yml) enforces the
 * format for any newly added prisma/migrations/<NAME>/ directory.
 */

import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

function timestampPrefix(d = new Date()): string {
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}_${pad2(d.getHours())}${pad2(d.getMinutes())}`;
}

function slugify(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function main(): void {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const nameArg = args
    .filter((a) => a !== '--dry-run')
    .join(' ')
    .trim();

  if (!nameArg) {
    console.error('Usage: pnpm db:migrate "<verb obj>"');
    console.error('  e.g. pnpm db:migrate "add phone to account"');
    console.error('  --dry-run prints the final name without invoking prisma');
    process.exit(2);
  }

  const slug = slugify(nameArg);
  if (!slug) {
    console.error(`Invalid name after slugify: ${JSON.stringify(nameArg)}`);
    process.exit(2);
  }

  const fullName = `${timestampPrefix()}_${slug}`;
  console.log(`migration name → ${fullName}`);

  if (dryRun) {
    console.log('(dry-run — skipping prisma migrate dev)');
    return;
  }

  const res = spawnSync(
    'pnpm',
    ['-C', 'apps/server', 'prisma', 'migrate', 'dev', '--name', fullName],
    { stdio: 'inherit', cwd: REPO_ROOT },
  );
  process.exit(res.status ?? 1);
}

main();
