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
}

export interface QueryGraphOptions {
  maxNodes?: number;
}

const DEFAULT_MAX_NODES = 200;

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
    warnings.push(
      `failed to parse ${graphJsonPath}: ${(e as Error).message}`,
    );
    return {
      scope,
      graphPath: graphJsonPath,
      nodes: [],
      warnings,
      truncated: false,
    };
  }

  if (
    !raw ||
    typeof raw !== 'object' ||
    !Array.isArray((raw as { nodes?: unknown }).nodes)
  ) {
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
  const normalizedScope = scope.replace(/\/+$/, '');
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

export function formatCodeContext(ctx: CodeContext): string {
  if (ctx.nodes.length === 0) {
    if (ctx.warnings.length > 0) {
      return `(graphify scope=${ctx.scope}: ${ctx.warnings.join('; ')})`;
    }
    return `(graphify scope=${ctx.scope}: no nodes match)`;
  }
  const header = ctx.truncated
    ? `graphify scope=${ctx.scope} — ${ctx.nodes.length} nodes (truncated)`
    : `graphify scope=${ctx.scope} — ${ctx.nodes.length} nodes`;
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
