import * as fs from 'node:fs';
import * as path from 'node:path';

export interface GraphifyNode {
  id: string;
  label: string;
  source_file?: string;
  source_location?: string;
  file_type?: string;
  community?: number;
  norm_label?: string;
}

export interface CodeContext {
  scope: string;
  graphPath: string;
  nodes: GraphifyNode[];
  warnings: string[];
  truncated: boolean;
  /**
   * Set by the greenfield fallback (F3): when the target scope is empty, we
   * inject nodes from sibling "golden-sample" modules instead. Holds the
   * sibling scopes (e.g. "apps/server/src/auth, apps/server/src/account") so
   * the prompt can label them and tell the agent to imitate layout, not logic.
   */
  exemplarOf?: string;
}

export interface QueryGraphOptions {
  maxNodes?: number;
}

const DEFAULT_MAX_NODES = 200;

/**
 * Plans express graphify_scope as a glob (e.g. "apps/server/src/auth/**\/*"),
 * but queryGraph matches by directory PREFIX. Strip a trailing glob segment to
 * recover the directory — without this the prefix-match never fires and EVERY
 * orchestrator run is context-blind, not just greenfield ones (p2 §7 F3,
 * caught empirically: `apps/server/src/auth/**\/*` → 0 nodes, bare dir → 200).
 */
export function scopeToDirPrefix(scope: string): string {
  return scope
    .replace(/\/+$/, '')
    .replace(/\/\*\*\/\*$/, '') // strip trailing /**/*
    .replace(/\/\*\*$/, '') // strip trailing /**
    .replace(/\/\*$/, '') // strip trailing /*
    .replace(/\/+$/, '');
}

export function queryGraph(
  graphJsonPath: string,
  scope: string,
  options: QueryGraphOptions = {},
): CodeContext {
  const max = options.maxNodes ?? DEFAULT_MAX_NODES;
  const warnings: string[] = [];

  if (!fs.existsSync(graphJsonPath)) {
    warnings.push(
      `graphify snapshot not found at ${graphJsonPath} — run \`/graphify --update\` to refresh`,
    );
    return {
      scope,
      graphPath: graphJsonPath,
      nodes: [],
      warnings,
      truncated: false,
    };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(graphJsonPath, 'utf-8'));
  } catch (e) {
    warnings.push(`failed to parse ${graphJsonPath}: ${(e as Error).message}`);
    return {
      scope,
      graphPath: graphJsonPath,
      nodes: [],
      warnings,
      truncated: false,
    };
  }

  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { nodes?: unknown }).nodes)) {
    warnings.push(`${graphJsonPath} missing .nodes[] array`);
    return {
      scope,
      graphPath: graphJsonPath,
      nodes: [],
      warnings,
      truncated: false,
    };
  }

  const allNodes = (raw as { nodes: GraphifyNode[] }).nodes;
  const normalizedScope = scopeToDirPrefix(scope);
  const matched = allNodes.filter((n) => {
    const sf = n.source_file ?? '';
    return sf === normalizedScope || sf.startsWith(normalizedScope + '/');
  });

  const truncated = matched.length > max;
  return {
    scope,
    graphPath: graphJsonPath,
    nodes: matched.slice(0, max),
    warnings,
    truncated,
  };
}

export interface ExemplarOptions extends QueryGraphOptions {
  /** How many sibling modules to pull as golden-sample exemplars (default 2). */
  maxSiblings?: number;
}

/**
 * Sibling dirs that are NOT hand-written business modules and make poor
 * exemplars (F3). Ranking siblings by raw node count otherwise picks the
 * Prisma `generated/` client (largest by far) as the #1 "golden sample" and
 * floods the budget with auto-gen noise — the "junk drawer" failure mode.
 * These are infra / generated / framework wiring, not modules to imitate.
 */
const NON_EXEMPLAR_DIRS: ReadonlySet<string> = new Set([
  'generated',
  'app',
  'config',
  'assets',
  '__smoke__',
  'observability',
]);

/**
 * queryGraph + greenfield fallback (p2 §7 F3). When the primary scope matches
 * zero nodes — a brand-new module that doesn't exist in the graph yet — fall
 * back to sibling modules under the same parent dir: the established
 * "golden samples" the new module should imitate. Per the industry verdict
 * ([[reference-greenfield-context-injection-sibling-exemplar]]): explicit
 * sibling/structural retrieval, NOT embeddings — our flat-module convention
 * makes "a sibling module" ≈ "the right exemplar", resolvable by a dir scan.
 *
 * Siblings are ranked by node count (a proxy for "most established"); the top
 * `maxSiblings` are injected, labeled via `exemplarOf` so the prompt tells the
 * agent to imitate layout/naming, not copy business logic. Returns the empty
 * primary result unchanged when there's no parent layer / no siblings / a graph
 * read error (best-effort: context is an aid, never a hard dependency).
 */
export function queryGraphWithExemplars(
  graphJsonPath: string,
  scope: string,
  options: ExemplarOptions = {},
): CodeContext {
  const primary = queryGraph(graphJsonPath, scope, options);
  // Real matches OR a load/parse warning → nothing to fall back to.
  if (primary.nodes.length > 0 || primary.warnings.length > 0) return primary;

  const dirPrefix = scopeToDirPrefix(scope);
  const lastSlash = dirPrefix.lastIndexOf('/');
  if (lastSlash <= 0) return primary; // no parent layer
  const parent = dirPrefix.slice(0, lastSlash);
  const targetModule = dirPrefix.slice(lastSlash + 1);

  let allNodes: GraphifyNode[];
  try {
    const raw = JSON.parse(fs.readFileSync(graphJsonPath, 'utf-8')) as { nodes?: GraphifyNode[] };
    allNodes = Array.isArray(raw.nodes) ? raw.nodes : [];
  } catch {
    return primary;
  }

  // Tally node counts per sibling module dir directly under `parent`.
  const counts = new Map<string, number>();
  for (const n of allNodes) {
    const sf = n.source_file ?? '';
    if (!sf.startsWith(parent + '/')) continue;
    const rest = sf.slice(parent.length + 1);
    const slash = rest.indexOf('/');
    if (slash < 0) continue; // a file directly under parent, not a module dir
    const mod = rest.slice(0, slash);
    if (mod === targetModule || NON_EXEMPLAR_DIRS.has(mod)) continue;
    counts.set(mod, (counts.get(mod) ?? 0) + 1);
  }
  if (counts.size === 0) return primary;

  const maxSiblings = options.maxSiblings ?? 2;
  const siblings = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, maxSiblings)
    .map(([mod]) => `${parent}/${mod}`);

  // Cap nodes PER sibling so the budget is shared fairly — otherwise the first
  // (largest) sibling fills `maxNodes` and later siblings contribute nothing.
  const max = options.maxNodes ?? DEFAULT_MAX_NODES;
  const perSibling = Math.max(1, Math.floor(max / siblings.length));
  const nodes: GraphifyNode[] = [];
  let truncated = false;
  for (const sib of siblings) {
    let taken = 0;
    for (const n of allNodes) {
      const sf = n.source_file ?? '';
      if (sf !== sib && !sf.startsWith(sib + '/')) continue;
      if (taken >= perSibling) {
        truncated = true;
        break;
      }
      nodes.push(n);
      taken += 1;
    }
  }
  return {
    scope,
    graphPath: graphJsonPath,
    nodes,
    warnings: [],
    truncated,
    exemplarOf: siblings.join(', '),
  };
}

export function formatCodeContext(ctx: CodeContext): string {
  if (ctx.nodes.length === 0) {
    if (ctx.warnings.length > 0) {
      return `(graphify scope=${ctx.scope}: ${ctx.warnings.join('; ')})`;
    }
    return `(graphify scope=${ctx.scope}: no nodes match)`;
  }
  let header: string;
  if (ctx.exemplarOf) {
    // Greenfield fallback (F3): target module is empty; we injected sibling
    // golden samples. Steer the agent hard — imitate shape, not logic.
    header =
      `graphify scope=${ctx.scope} is greenfield (no nodes yet) — showing ` +
      `${ctx.nodes.length} node(s) from sibling golden-sample module(s): ${ctx.exemplarOf}.\n` +
      `IMITATE their file layout, naming, and structural conventions ` +
      `(flat module / anemic usecase / moat). Do NOT copy their business logic.`;
  } else {
    header = ctx.truncated
      ? `graphify scope=${ctx.scope} — ${ctx.nodes.length} nodes (truncated)`
      : `graphify scope=${ctx.scope} — ${ctx.nodes.length} nodes`;
  }
  const lines = ctx.nodes.map((n) => {
    const loc = n.source_location ? `:${n.source_location}` : '';
    const src = n.source_file ?? '?';
    return `  - ${n.label} @ ${src}${loc}`;
  });
  return [header, ...lines].join('\n');
}

export function resolveDefaultGraphPath(repoRoot: string): string {
  return path.resolve(repoRoot, 'graphify-out', 'graph.json');
}
