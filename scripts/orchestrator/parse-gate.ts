#!/usr/bin/env -S node --no-warnings
/**
 * parse-gate.ts — pin command-flow features to the orchestrator consumption
 * contract (orchestrator-command-parity p1 §3). Before this gate the only
 * validator was "run the orchestrator", which nobody did in CI — so any
 * artifact silently drifted off-schema (e.g. the 002 golden reference broke on
 * a stray `_note`). This makes the contract a red/green check.
 *
 * A feature is "orchestrator-shaped" iff its plan.md declares the
 * `orchestrator_config` fenced JSON block. Those MUST load end-to-end (spec +
 * plan + tasks parse, 3-way feature_id equality, trace_fr ∈ spec, DAG acyclic).
 * Manual-SDD features (no orchestrator_config) are skipped — they are not
 * consumed by the orchestrator and are exempt by construction (p1 §4); this is
 * self-maintaining vs. a hand-kept ignore-list.
 *
 * Usage:
 *   pnpm tsx scripts/orchestrator/parse-gate.ts               # scan all specs/*
 *   pnpm tsx scripts/orchestrator/parse-gate.ts <path> [...]  # specific targets
 *       (each target may be a feature dir or any file under one; lefthook passes
 *        staged specs/<f>/*.md, mapped to their feature dir and deduped)
 *
 * Exit codes:
 *   0  all orchestrator-shaped features parsed (others skipped)
 *   1  ≥ 1 orchestrator-shaped feature failed the contract (details on stderr)
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadFeature } from './state.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SPECS_DIR = path.join(REPO_ROOT, 'specs');

/** A feature opts into the orchestrator contract by declaring orchestrator_config. */
export function isOrchestratorShaped(featureDir: string): boolean {
  const planPath = path.join(featureDir, 'plan.md');
  if (!fs.existsSync(planPath)) return false;
  return /```json\s+orchestrator_config\b/.test(fs.readFileSync(planPath, 'utf-8'));
}

/**
 * Map a CLI target (feature dir, or any file/path under specs/<feature>/) to its
 * feature directory. Returns null for paths not under specs/.
 */
export function featureDirOf(target: string, specsDir = SPECS_DIR): string | null {
  const abs = path.resolve(target);
  const rel = path.relative(specsDir, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  const top = rel.split(path.sep)[0];
  if (!top) return null;
  return path.join(specsDir, top);
}

export type GateStatus = 'pass' | 'fail' | 'skip';
export interface GateResult {
  name: string;
  status: GateStatus;
  error?: string;
}

/** Gate a single feature dir: skip if not orchestrator-shaped, else loadFeature. */
export function gateDir(featureDir: string): GateResult {
  const name = path.basename(featureDir);
  if (!isOrchestratorShaped(featureDir)) {
    return { name, status: 'skip' };
  }
  try {
    loadFeature(featureDir);
    return { name, status: 'pass' };
  } catch (e) {
    return { name, status: 'fail', error: e instanceof Error ? e.message : String(e) };
  }
}

function collectFeatureDirs(targets: string[]): string[] {
  if (targets.length === 0) {
    if (!fs.existsSync(SPECS_DIR)) return [];
    return fs
      .readdirSync(SPECS_DIR)
      .filter((d) => !d.startsWith('.'))
      .map((d) => path.join(SPECS_DIR, d))
      .filter((p) => fs.statSync(p).isDirectory());
  }
  const dirs = new Set<string>();
  for (const t of targets) {
    const dir = featureDirOf(t);
    if (dir) dirs.add(dir);
  }
  return [...dirs];
}

function main(): void {
  const targets = process.argv.slice(2);
  const dirs = collectFeatureDirs(targets);

  let failed = 0;
  let checked = 0;
  for (const dir of dirs) {
    const r = gateDir(dir);
    if (r.status === 'skip') {
      console.log(`⏭  ${r.name} — not orchestrator-shaped (manual SDD), skipped`);
      continue;
    }
    checked += 1;
    if (r.status === 'pass') {
      console.log(`✅ ${r.name}`);
    } else {
      failed += 1;
      console.error(`❌ ${r.name}: ${r.error}`);
    }
  }

  if (failed > 0) {
    console.error(`\n[orchestrator-parse-gate] ${failed} feature(s) off-contract`);
    process.exit(1);
  }
  console.log(`\n[orchestrator-parse-gate] ${checked} orchestrator-shaped feature(s) ✓`);
}

// Run only as a CLI entry (not when imported by the spec).
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
