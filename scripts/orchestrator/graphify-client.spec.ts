import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  formatCodeContext,
  queryGraph,
  queryGraphWithExemplars,
  resolveDefaultGraphPath,
  scopeToDirPrefix,
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

  // p2 §7 F3: plans express scope as a glob ("…/auth/**/*"); the prefix-match
  // must strip the trailing glob to a dir, else EVERY run is context-blind.
  it('matches a glob scope by stripping the trailing /**/* (or /**, /*) to a dir', () => {
    const p = writeGraph([
      { id: 'a', label: 'A', source_file: 'apps/server/src/auth/auth.usecase.ts' },
      { id: 'b', label: 'B', source_file: 'apps/server/src/account/x.ts' },
    ]);
    expect(queryGraph(p, 'apps/server/src/auth/**/*').nodes.map((n) => n.id)).toEqual(['a']);
    expect(queryGraph(p, 'apps/server/src/auth/**').nodes.map((n) => n.id)).toEqual(['a']);
    expect(queryGraph(p, 'apps/server/src/auth/*').nodes.map((n) => n.id)).toEqual(['a']);
  });

  it('treats trailing slash in scope idempotently', () => {
    const p = writeGraph([{ id: 'a', label: 'A', source_file: 'apps/server/main.ts' }]);
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

describe('scopeToDirPrefix (F3)', () => {
  it('strips trailing glob segments to a directory', () => {
    expect(scopeToDirPrefix('apps/server/src/auth/**/*')).toBe('apps/server/src/auth');
    expect(scopeToDirPrefix('apps/server/src/auth/**')).toBe('apps/server/src/auth');
    expect(scopeToDirPrefix('apps/server/src/auth/*')).toBe('apps/server/src/auth');
    expect(scopeToDirPrefix('apps/server/src/auth/')).toBe('apps/server/src/auth');
    expect(scopeToDirPrefix('apps/server/src/auth')).toBe('apps/server/src/auth');
  });
});

describe('queryGraphWithExemplars (F3 greenfield fallback)', () => {
  const files: string[] = [];
  afterEach(() => {
    for (const f of files.splice(0)) fs.rmSync(f, { force: true });
  });
  function writeGraph(nodes: GraphifyNode[]): string {
    const p = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'orchestrator-graphify-ex-')),
      'graph.json',
    );
    fs.writeFileSync(p, JSON.stringify({ nodes }));
    files.push(p);
    return p;
  }

  it('passes through when the target scope already has nodes (no fallback)', () => {
    const p = writeGraph([
      { id: 'a', label: 'A', source_file: 'apps/server/src/auth/auth.usecase.ts' },
    ]);
    const ctx = queryGraphWithExemplars(p, 'apps/server/src/auth/**/*');
    expect(ctx.nodes.map((n) => n.id)).toEqual(['a']);
    expect(ctx.exemplarOf).toBeUndefined();
  });

  it('greenfield target → injects top-N sibling modules ranked by node count', () => {
    const p = writeGraph([
      // auth: 3 nodes, account: 2 nodes, security: 1 node → top-2 = auth, account
      { id: 'a1', label: 'A1', source_file: 'apps/server/src/auth/a1.ts' },
      { id: 'a2', label: 'A2', source_file: 'apps/server/src/auth/a2.ts' },
      { id: 'a3', label: 'A3', source_file: 'apps/server/src/auth/a3.ts' },
      { id: 'c1', label: 'C1', source_file: 'apps/server/src/account/c1.ts' },
      { id: 'c2', label: 'C2', source_file: 'apps/server/src/account/c2.ts' },
      { id: 's1', label: 'S1', source_file: 'apps/server/src/security/s1.ts' },
      { id: 'm', label: 'main', source_file: 'apps/server/src/main.ts' }, // not a module dir
    ]);
    const ctx = queryGraphWithExemplars(p, 'apps/server/src/login-activity/**/*', {
      maxSiblings: 2,
    });
    expect(ctx.exemplarOf).toBe('apps/server/src/auth, apps/server/src/account');
    expect(ctx.nodes.map((n) => n.id).sort()).toEqual(['a1', 'a2', 'a3', 'c1', 'c2']);
    // the file directly under the parent (main.ts) is not treated as a sibling
    expect(ctx.nodes.some((n) => n.id === 'm')).toBe(false);
  });

  it('excludes infra/generated dirs from exemplars even when they have the most nodes', () => {
    const nodes: GraphifyNode[] = [];
    // generated: 100 nodes (largest — would win a naive node-count ranking)
    for (let i = 0; i < 100; i++) {
      nodes.push({
        id: `g${i}`,
        label: `G${i}`,
        source_file: `apps/server/src/generated/g${i}.ts`,
      });
    }
    nodes.push({ id: 'a1', label: 'A1', source_file: 'apps/server/src/auth/a1.ts' });
    nodes.push({ id: 'a2', label: 'A2', source_file: 'apps/server/src/auth/a2.ts' });
    nodes.push({ id: 'c', label: 'C', source_file: 'apps/server/src/account/c.ts' });
    const p = writeGraph(nodes);
    const ctx = queryGraphWithExemplars(p, 'apps/server/src/login-activity/**/*', {
      maxSiblings: 2,
    });
    // generated is excluded → real business modules win despite fewer nodes
    expect(ctx.exemplarOf).toBe('apps/server/src/auth, apps/server/src/account');
    expect(ctx.nodes.some((n) => n.id.startsWith('g'))).toBe(false);
  });

  it('caps nodes per sibling so the budget is shared (largest does not crowd out)', () => {
    const nodes: GraphifyNode[] = [];
    for (let i = 0; i < 20; i++) {
      nodes.push({ id: `a${i}`, label: `A${i}`, source_file: `apps/server/src/auth/a${i}.ts` });
    }
    for (let i = 0; i < 20; i++) {
      nodes.push({ id: `c${i}`, label: `C${i}`, source_file: `apps/server/src/account/c${i}.ts` });
    }
    const p = writeGraph(nodes);
    const ctx = queryGraphWithExemplars(p, 'apps/server/src/login-activity/**/*', {
      maxSiblings: 2,
      maxNodes: 10, // → 5 per sibling
    });
    expect(ctx.nodes.filter((n) => n.id.startsWith('a'))).toHaveLength(5);
    expect(ctx.nodes.filter((n) => n.id.startsWith('c'))).toHaveLength(5);
    expect(ctx.truncated).toBe(true);
  });

  it('returns the empty primary unchanged when there are no siblings', () => {
    const p = writeGraph([{ id: 'm', label: 'main', source_file: 'apps/server/src/main.ts' }]);
    const ctx = queryGraphWithExemplars(p, 'apps/server/src/login-activity/**/*');
    expect(ctx.nodes).toEqual([]);
    expect(ctx.exemplarOf).toBeUndefined();
  });

  it('does not fall back on a load error (warning present)', () => {
    const ctx = queryGraphWithExemplars('/nonexistent/graph.json', 'apps/server/src/x/**/*');
    expect(ctx.warnings).toHaveLength(1);
    expect(ctx.exemplarOf).toBeUndefined();
  });
});

describe('formatCodeContext', () => {
  it('renders the greenfield golden-sample header when exemplarOf is set (F3)', () => {
    const out = formatCodeContext({
      scope: 'apps/server/src/login-activity/**/*',
      graphPath: '/x',
      nodes: [{ id: 'a', label: 'AuthService', source_file: 'apps/server/src/auth/auth.ts' }],
      warnings: [],
      truncated: false,
      exemplarOf: 'apps/server/src/auth, apps/server/src/account',
    });
    expect(out).toMatch(/greenfield/);
    expect(out).toMatch(/golden-sample/);
    expect(out).toMatch(/IMITATE/);
    expect(out).toMatch(/Do NOT copy their business logic/);
    expect(out).toMatch(/AuthService @ apps\/server\/src\/auth\/auth\.ts/);
  });

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
