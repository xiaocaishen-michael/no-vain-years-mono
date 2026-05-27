import type { ParsedTask, TaskKind } from './schemas/tasks.js';

/**
 * Kind-aware drift classifier for commitTask's gate (PoC blind spot #22 P1).
 *
 * Given the LLM-declared `task.files` whitelist and the actual file set the
 * LLM touched, decide one of:
 *   - `no-drift`: stage = declared, run the happy path
 *   - `gen-fenced`: bulk-output kind (gen / migration) whose drift is fully
 *     contained in the task's gen_scope → silently expand staging to include
 *     the drift, no LLM round-trip required
 *   - `needs-ralph`: drift falls outside the gen_scope (or kind doesn't allow
 *     auto-expansion) → caller must invoke the orphan self-justify ralph loop
 *
 * Design notes:
 *   - `task.files` is the LLM's *declared intent* — a soft contract. The LLM
 *     is non-deterministic, so we cannot assume declared = actual. Cases like
 *     T027 (openapi-ts regenerates hundreds of files) or T023 (account profile
 *     ripple) routinely produce drift even on a successful task.
 *   - gen / migration kinds are inherently bulk-output. For these, we accept
 *     drift inside a declared "scope fence" silently — but everything outside
 *     the fence (e.g. `package.json` modifications from a gen task) must
 *     still go through ralph self-justify.
 *   - For impl / test / docs / config kinds, ANY drift is suspicious and
 *     must self-justify via ralph.
 */

export type DriftDecision =
  | { kind: 'no-drift' }
  | {
      kind: 'gen-fenced';
      /** Files to add to the stage on top of declared. ⊆ orphans. */
      expandedStage: string[];
      /** Resolved gen_scope (for run-report / archive). */
      genScope: string[];
    }
  | {
      kind: 'needs-ralph';
      /** Files the LLM touched outside `declared`. */
      orphans: string[];
      /**
       * Why ralph (for archive / debugging):
       *   - `kind-not-bulk`: task.kind ∉ {gen, migration}
       *   - `no-gen-scope`: gen/migration kind, but no valid gen_scope could be
       *     derived (gen_dirs absent AND auto-LCD blocked by safety valve)
       *   - `outside-gen-scope`: gen/migration kind has a valid gen_scope, but
       *     some orphans fell outside it
       */
      reason: 'kind-not-bulk' | 'no-gen-scope' | 'outside-gen-scope';
    };

/**
 * Bulk-output kinds whose drift can be silently expanded if contained in
 * `gen_scope`. Anything else routes to ralph regardless of drift size.
 */
const BULK_KINDS: ReadonlySet<TaskKind> = new Set(['gen', 'migration']);

/**
 * Per stop-signal #3: migration drift is only ever silently expanded inside
 * this hardcoded path. Prevents a typo'd `kind: migration` task from getting
 * gen-fenced auto-expansion against `apps/server/src/...`.
 */
const MIGRATION_HARDCODED_PREFIX = 'apps/server/prisma/migrations/';

/**
 * auto-LCD safety valve: directory prefixes that are NEVER allowed as the
 * derived gen_scope. Catches the common failure mode where a small `files`
 * list (e.g. one entry in `apps/server/src/`) produces an LCD that would
 * silently absorb arbitrary modifications across the codebase.
 *
 * Per stop-signal #1 (user-confirmed):
 *   - repo root (".") and absolute root ("/")
 *   - source roots: `apps/server/src`, `apps/mobile/src`, `packages`
 *   - docs/ — gen task should never touch docs; if it must, that's a docs
 *     kind, which already goes through ralph
 *   - prisma/ — schema.prisma is the backend's spine; migration kind uses
 *     the hardcoded prefix above, not auto-LCD
 */
const AUTO_LCD_BLACKLIST: ReadonlySet<string> = new Set([
  '.',
  '/',
  '',
  'apps',
  'apps/server',
  'apps/server/src',
  'apps/mobile',
  'apps/mobile/src',
  'packages',
  'docs',
  'prisma',
]);

/**
 * auto-LCD also requires the derived prefix to be at least this deep (segment
 * count) AND the `files` list to have at least this many entries. Both knobs
 * defend against a single-file declaration auto-deriving an over-broad scope.
 */
const MIN_DECLARED_FILES_FOR_AUTO_LCD = 2;
const MIN_AUTO_LCD_DEPTH = 3;

/**
 * Cross-cutting governance files (F1, per p2 §7 + [[reference-agent-file-scope-industry-verdict]]).
 *
 * These are shared repo-level registries that ANY task may legitimately need
 * to edit as a ripple of its declared work — e.g. an impl task that introduces
 * a new Prisma model MUST register that model's owner in check-server-moat.ts,
 * and MUST wire its NestJS module into app.module.ts. Those edits fall outside
 * the task's declared `files` whitelist, so the orphan scope-gate used to
 * revert them — which then deadlocked against the very lefthook (check-server-moat)
 * that REQUIRES the edit (999 orch run1: $2.25 / 47 turns of hook-ralph thrash).
 *
 * Per the industry verdict (closed-world per-task file lists + hard-revert is
 * an anti-pattern; the real safety net is downstream guardrails — lefthook moat /
 * eslint boundaries / IT / boot-smoke), edits to these files are treated as
 * implicitly declared: they never count as orphans and are always staged into
 * the task's own commit. The downstream gates still validate correctness.
 *
 * Repo-root-relative, normalized. Extend as new cross-cutting registries appear.
 */
const GOVERNANCE_ALLOWLIST: ReadonlySet<string> = new Set([
  'scripts/checks/check-server-moat.ts', // data-ownership moat registry (MODEL_OWNERSHIP)
  'apps/server/src/app/app.module.ts', // NestJS root module wiring
  'apps/server/prisma/schema.prisma', // backend schema spine
  'eslint.config.mjs', // repo-root eslint (module boundaries)
  'apps/server/eslint.config.mjs', // server eslint boundaries
  'apps/server/openapi.json', // generated OpenAPI contract
]);

/**
 * True if `p` is a cross-cutting governance file any task may legitimately
 * touch (see GOVERNANCE_ALLOWLIST). Input is normalized internally, so callers
 * may pass raw repo-root-relative paths.
 */
export function isGovernanceFile(p: string): boolean {
  return GOVERNANCE_ALLOWLIST.has(normalizePath(p));
}

/**
 * Pure classifier — no I/O. Inputs:
 *   - task: the parsed task (for kind + gen_dirs)
 *   - declared: paths the orchestrator would stage from `task.files`
 *     (already resolved repo-root-relative)
 *   - actual: paths the LLM actually touched since headBefore (from
 *     git.diffNameOnly + untracked, also repo-root-relative)
 *
 * Both `declared` and `actual` MUST be normalized (forward slashes, no
 * leading `./`, no trailing `/`) — call `normalizePath` before passing in.
 *
 * NB: governance-file exemption (F1) is applied UPSTREAM in commitTask by
 * folding touched governance files into `declared` before this runs, so this
 * classifier stays a pure orphan calculator.
 */
export function classifyDrift(
  task: ParsedTask,
  declared: readonly string[],
  actual: readonly string[],
): DriftDecision {
  const declaredSet = new Set(declared.map(normalizePath));
  const orphans = actual
    .map(normalizePath)
    .filter((f) => !declaredSet.has(f))
    .sort();

  if (orphans.length === 0) return { kind: 'no-drift' };

  if (!BULK_KINDS.has(task.kind)) {
    return { kind: 'needs-ralph', orphans, reason: 'kind-not-bulk' };
  }

  const genScope = resolveGenScope(task, declared);
  if (genScope === null) {
    return { kind: 'needs-ralph', orphans, reason: 'no-gen-scope' };
  }

  const outsideScope = orphans.filter((f) => !isUnderAny(f, genScope));
  if (outsideScope.length > 0) {
    return { kind: 'needs-ralph', orphans, reason: 'outside-gen-scope' };
  }

  return { kind: 'gen-fenced', expandedStage: orphans, genScope };
}

/**
 * Derive the gen_scope used to fence orphans for bulk-output kinds. Returns
 * null when no usable scope exists (caller should route to ralph with
 * reason='no-gen-scope').
 *
 * Resolution order:
 *   1. migration kind → always the hardcoded Prisma migration prefix
 *      (ignores task.gen_dirs to keep stop-signal #3 tight).
 *   2. Explicit `task.gen_dirs` → use as-is after normalization
 *      (no safety valve; the human author opted in).
 *   3. auto-LCD fallback → longest common directory of declared files,
 *      subject to safety valves (depth, file count, blacklist).
 */
export function resolveGenScope(task: ParsedTask, declared: readonly string[]): string[] | null {
  if (task.kind === 'migration') {
    return [normalizeDirPrefix(MIGRATION_HARDCODED_PREFIX)];
  }
  if (task.gen_dirs && task.gen_dirs.length > 0) {
    const normalized = task.gen_dirs.map((d) => normalizeDirPrefix(d)).filter((d) => d.length > 0);
    return normalized.length > 0 ? normalized : null;
  }
  // auto-LCD fallback
  if (declared.length < MIN_DECLARED_FILES_FOR_AUTO_LCD) return null;
  const lcd = longestCommonDir(declared.map(normalizePath));
  if (lcd === null) return null;
  if (AUTO_LCD_BLACKLIST.has(lcd)) return null;
  const depth = segmentDepth(lcd);
  if (depth < MIN_AUTO_LCD_DEPTH) return null;
  return [normalizeDirPrefix(lcd)];
}

/**
 * Normalize a repo-root-relative file path: forward slashes, no leading
 * `./`, no trailing `/`. Paths starting with `/` get the leading slash
 * stripped (treated as repo-root-relative).
 */
export function normalizePath(p: string): string {
  let s = p.replace(/\\/g, '/');
  if (s.startsWith('./')) s = s.slice(2);
  if (s.startsWith('/')) s = s.slice(1);
  while (s.endsWith('/')) s = s.slice(0, -1);
  return s;
}

/** Normalize a directory prefix to ALWAYS end in `/` (so containment is
 *  unambiguous: `f.startsWith(dir + '/')`). Empty input → empty string. */
function normalizeDirPrefix(d: string): string {
  const cleaned = normalizePath(d);
  return cleaned.length === 0 ? '' : cleaned + '/';
}

/**
 * Longest common directory prefix of the given paths (repo-root-relative,
 * already normalized). Returns the directory WITHOUT trailing slash, or null
 * if the inputs share no common directory (e.g. one is at the repo root).
 *
 * Example: ['packages/api-client/src/gen/a.ts',
 *           'packages/api-client/src/gen/b.ts'] → 'packages/api-client/src/gen'
 */
function longestCommonDir(paths: readonly string[]): string | null {
  if (paths.length === 0) return null;
  const splits = paths.map((p) => p.split('/'));
  // Drop the filename component; we care about the directory only.
  const dirs = splits.map((s) => s.slice(0, -1));
  if (dirs.some((d) => d.length === 0)) return null;
  const minLen = Math.min(...dirs.map((d) => d.length));
  const common: string[] = [];
  for (let i = 0; i < minLen; i++) {
    const seg = dirs[0][i];
    if (dirs.every((d) => d[i] === seg)) {
      common.push(seg);
    } else {
      break;
    }
  }
  return common.length === 0 ? null : common.join('/');
}

function segmentDepth(dir: string): number {
  if (dir.length === 0 || dir === '.') return 0;
  return dir.split('/').filter((s) => s.length > 0).length;
}

function isUnderAny(file: string, dirs: readonly string[]): boolean {
  for (const d of dirs) {
    if (d.length === 0) continue;
    if (file.startsWith(d) || file === d.replace(/\/$/, '')) return true;
  }
  return false;
}

// Exported for testing only — surface so spec can assert constants stay
// aligned with the design doc.
export const __testing = {
  AUTO_LCD_BLACKLIST: AUTO_LCD_BLACKLIST as ReadonlySet<string>,
  GOVERNANCE_ALLOWLIST,
  MIGRATION_HARDCODED_PREFIX,
  MIN_DECLARED_FILES_FOR_AUTO_LCD,
  MIN_AUTO_LCD_DEPTH,
  longestCommonDir,
  segmentDepth,
  normalizeDirPrefix,
};
