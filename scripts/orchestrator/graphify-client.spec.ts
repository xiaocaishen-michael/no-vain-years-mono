import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  formatCodeContext,
  queryGraph,
  resolveDefaultGraphPath,
  type GraphifyNode,
} from './graphify-client.js';

describe('queryGraph', () => {
  const files: string[] = [];

  afterEach(() => {
    for (const f of files.splice(0)) {
      fs.rmSync(f, { force: true });
    }
  });

  function writeGraph(nodes: GraphifyNode[]): string {
    const p = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'orchestrator-graphify-')),
      'graph.json',
    );
    fs.writeFileSync(p, JSON.stringify({ nodes }));
    files.push(p);
    return p;
  }

  it('returns warning when graph file missing', () => {
    const ctx = queryGraph('/nonexistent/graph.json', 'apps/server');
    expect(ctx.nodes).toEqual([]);
    expect(ctx.warnings).toHaveLength(1);
    expect(ctx.warnings[0]).toMatch(/not found/);
  });

  it('filters nodes by source_file prefix', () => {
    const p = writeGraph([
      { id: 'a', label: 'A', source_file: 'apps/server/src/main.ts' },
      { id: 'b', label: 'B', source_file: 'apps/server/src/lib.ts' },
      { id: 'c', label: 'C', source_file: 'apps/mobile/App.tsx' },
      { id: 'd', label: 'D', source_file: 'apps/server-other/x.ts' }, // prefix-but-not-dir-boundary
    ]);
    const ctx = queryGraph(p, 'apps/server');
    expect(ctx.nodes.map((n) => n.id)).toEqual(['a', 'b']);
    expect(ctx.truncated).toBe(false);
  });

  it('treats trailing slash in scope idempotently', () => {
    const p = writeGraph([
      { id: 'a', label: 'A', source_file: 'apps/server/main.ts' },
    ]);
    expect(queryGraph(p, 'apps/server').nodes).toHaveLength(1);
    expect(queryGraph(p, 'apps/server/').nodes).toHaveLength(1);
  });

  it('matches exact source_file (no children)', () => {
    const p = writeGraph([
      { id: 'a', label: 'A', source_file: 'nx.json' },
      { id: 'b', label: 'B', source_file: 'nx.jsonx' },
    ]);
    const ctx = queryGraph(p, 'nx.json');
    expect(ctx.nodes.map((n) => n.id)).toEqual(['a']);
  });

  it('truncates to maxNodes and flags truncated=true', () => {
    const nodes: GraphifyNode[] = Array.from({ length: 10 }, (_, i) => ({
      id: `n${i}`,
      label: `L${i}`,
      source_file: 'apps/server/x.ts',
    }));
    const p = writeGraph(nodes);
    const ctx = queryGraph(p, 'apps/server', { maxNodes: 3 });
    expect(ctx.nodes).toHaveLength(3);
    expect(ctx.truncated).toBe(true);
  });

  it('returns warning when JSON is malformed', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orchestrator-graphify-'));
    const p = path.join(dir, 'bad.json');
    fs.writeFileSync(p, '{ not json');
    files.push(p);
    const ctx = queryGraph(p, 'apps/server');
    expect(ctx.nodes).toEqual([]);
    expect(ctx.warnings[0]).toMatch(/failed to parse/);
  });

  it('returns warning when .nodes is missing', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orchestrator-graphify-'));
    const p = path.join(dir, 'noarray.json');
    fs.writeFileSync(p, JSON.stringify({ directed: false }));
    files.push(p);
    const ctx = queryGraph(p, 'apps/server');
    expect(ctx.warnings[0]).toMatch(/missing \.nodes/);
  });
});

describe('formatCodeContext', () => {
  it('reports warning when nodes empty + warnings present', () => {
    const out = formatCodeContext({
      scope: 'apps/server',
      graphPath: '/x',
      nodes: [],
      warnings: ['missing snapshot'],
      truncated: false,
    });
    expect(out).toMatch(/missing snapshot/);
  });

  it('reports no nodes when scope matches nothing', () => {
    const out = formatCodeContext({
      scope: 'apps/server',
      graphPath: '/x',
      nodes: [],
      warnings: [],
      truncated: false,
    });
    expect(out).toMatch(/no nodes match/);
  });

  it('formats nodes with label + source_file', () => {
    const out = formatCodeContext({
      scope: 'apps/server',
      graphPath: '/x',
      nodes: [
        {
          id: 'a',
          label: 'AuthService',
          source_file: 'apps/server/auth.ts',
          source_location: 'L42',
        },
      ],
      warnings: [],
      truncated: false,
    });
    expect(out).toMatch(/AuthService @ apps\/server\/auth\.ts:L42/);
  });

  it('flags truncated in header', () => {
    const out = formatCodeContext({
      scope: 'x',
      graphPath: '/x',
      nodes: [{ id: 'a', label: 'A', source_file: 'x/a.ts' }],
      warnings: [],
      truncated: true,
    });
    expect(out).toMatch(/truncated/);
  });
});

describe('resolveDefaultGraphPath', () => {
  it('resolves to <root>/graphify-out/graph.json', () => {
    const p = resolveDefaultGraphPath('/repo');
    expect(p).toBe(path.resolve('/repo/graphify-out/graph.json'));
  });
});
