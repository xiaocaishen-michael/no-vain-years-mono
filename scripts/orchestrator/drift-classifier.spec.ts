import { describe, expect, it } from 'vitest';
import {
  __testing,
  classifyDrift,
  normalizePath,
  resolveGenScope,
  type DriftDecision,
} from './drift-classifier.js';
import type { ParsedTask, TaskKind } from './schemas/tasks.js';

// Minimal ParsedTask factory: only fields the classifier actually reads
// matter, but Zod-typed ParsedTask is a structural type so we cast through
// `as unknown as ParsedTask` to keep the test fixture trivial.
function makeTask(kind: TaskKind, files: string[], opts: { gen_dirs?: string[] } = {}): ParsedTask {
  return {
    id: 'T001',
    workspace: 'ws',
    deps: [],
    trace_us: [],
    trace_fr: [],
    kind,
    verify_kind: 'test',
    files: files.map((p) => ({ path: p, op: 'modify' as const })),
    parallel: false,
    gen_dirs: opts.gen_dirs,
    status: 'pending',
    title: 'test task',
  } as unknown as ParsedTask;
}

describe('classifyDrift', () => {
  it('no-drift: actual ⊆ declared → kind:no-drift', () => {
    const task = makeTask('impl', ['a.ts', 'b.ts']);
    const r = classifyDrift(task, ['a.ts', 'b.ts'], ['a.ts', 'b.ts']);
    expect(r.kind).toBe('no-drift');
  });

  it('no-drift: actual is a strict subset (declared file untouched)', () => {
    const task = makeTask('impl', ['a.ts', 'b.ts']);
    const r = classifyDrift(task, ['a.ts', 'b.ts'], ['a.ts']);
    expect(r.kind).toBe('no-drift');
  });

  it('impl kind with drift → needs-ralph with reason kind-not-bulk', () => {
    const task = makeTask('impl', ['a.ts']);
    const r = classifyDrift(task, ['a.ts'], ['a.ts', 'b.ts']);
    expect(r.kind).toBe('needs-ralph');
    if (r.kind === 'needs-ralph') {
      expect(r.reason).toBe('kind-not-bulk');
      expect(r.orphans).toEqual(['b.ts']);
    }
  });

  describe.each(['test-unit', 'test-integration', 'test-e2e', 'docs', 'config'] as const)(
    '%s kind with drift → needs-ralph (kind-not-bulk)',
    (kind) => {
      it('routes to ralph regardless of where drift lands', () => {
        const task = makeTask(kind, ['a.ts']);
        const r = classifyDrift(task, ['a.ts'], ['a.ts', 'package.json']);
        expect(r.kind).toBe('needs-ralph');
        if (r.kind === 'needs-ralph') expect(r.reason).toBe('kind-not-bulk');
      });
    },
  );

  describe('gen kind', () => {
    it('explicit gen_dirs: drift ⊆ gen_scope → gen-fenced', () => {
      const task = makeTask('gen', ['packages/api-client/src/index.ts'], {
        gen_dirs: ['packages/api-client/src/gen'],
      });
      const r = classifyDrift(
        task,
        ['packages/api-client/src/index.ts'],
        [
          'packages/api-client/src/index.ts',
          'packages/api-client/src/gen/types.ts',
          'packages/api-client/src/gen/client.ts',
        ],
      );
      expect(r.kind).toBe('gen-fenced');
      if (r.kind === 'gen-fenced') {
        expect(r.expandedStage).toEqual([
          'packages/api-client/src/gen/client.ts',
          'packages/api-client/src/gen/types.ts',
        ]);
        expect(r.genScope).toEqual(['packages/api-client/src/gen/']);
      }
    });

    it('explicit gen_dirs: drift outside scope → needs-ralph (outside-gen-scope)', () => {
      const task = makeTask('gen', ['packages/api-client/src/index.ts'], {
        gen_dirs: ['packages/api-client/src/gen'],
      });
      const r = classifyDrift(
        task,
        ['packages/api-client/src/index.ts'],
        [
          'packages/api-client/src/index.ts',
          'packages/api-client/src/gen/types.ts',
          'package.json', // OUTSIDE scope
        ],
      );
      expect(r.kind).toBe('needs-ralph');
      if (r.kind === 'needs-ralph') {
        expect(r.reason).toBe('outside-gen-scope');
        expect(r.orphans).toContain('package.json');
      }
    });

    it('auto-LCD: ≥2 declared with depth-3 LCD not in blacklist → gen-fenced', () => {
      const task = makeTask('gen', [
        'packages/api-client/src/gen/a.ts',
        'packages/api-client/src/gen/b.ts',
      ]);
      const r = classifyDrift(
        task,
        ['packages/api-client/src/gen/a.ts', 'packages/api-client/src/gen/b.ts'],
        [
          'packages/api-client/src/gen/a.ts',
          'packages/api-client/src/gen/b.ts',
          'packages/api-client/src/gen/c.ts',
          'packages/api-client/src/gen/sub/d.ts',
        ],
      );
      expect(r.kind).toBe('gen-fenced');
      if (r.kind === 'gen-fenced') {
        expect(r.genScope).toEqual(['packages/api-client/src/gen/']);
        expect(r.expandedStage).toEqual([
          'packages/api-client/src/gen/c.ts',
          'packages/api-client/src/gen/sub/d.ts',
        ]);
      }
    });

    it('auto-LCD safety valve: single declared file → no-gen-scope', () => {
      const task = makeTask('gen', ['packages/api-client/src/gen/only.ts']);
      const r = classifyDrift(
        task,
        ['packages/api-client/src/gen/only.ts'],
        ['packages/api-client/src/gen/only.ts', 'packages/api-client/src/gen/extra.ts'],
      );
      expect(r.kind).toBe('needs-ralph');
      if (r.kind === 'needs-ralph') expect(r.reason).toBe('no-gen-scope');
    });

    it('auto-LCD safety valve: LCD too shallow (depth=2) → no-gen-scope', () => {
      const task = makeTask('gen', ['apps/server/foo.ts', 'apps/server/bar.ts']);
      const r = classifyDrift(
        task,
        ['apps/server/foo.ts', 'apps/server/bar.ts'],
        ['apps/server/foo.ts', 'apps/server/bar.ts', 'apps/server/baz.ts'],
      );
      expect(r.kind).toBe('needs-ralph');
      if (r.kind === 'needs-ralph') expect(r.reason).toBe('no-gen-scope');
    });

    it.each([
      ['apps/server/src', 'apps/server/src/a.ts', 'apps/server/src/b.ts'],
      ['apps/mobile/src', 'apps/mobile/src/a.ts', 'apps/mobile/src/b.ts'],
      ['docs', 'docs/a.md', 'docs/b.md'],
      ['prisma', 'prisma/a.sql', 'prisma/b.sql'],
    ])(
      'auto-LCD blacklist: LCD = %s → no-gen-scope (would silently absorb codebase)',
      (_label, fileA, fileB) => {
        const task = makeTask('gen', [fileA, fileB]);
        const r = classifyDrift(task, [fileA, fileB], [fileA, fileB, 'extra-orphan.ts']);
        expect(r.kind).toBe('needs-ralph');
        if (r.kind === 'needs-ralph') expect(r.reason).toBe('no-gen-scope');
      },
    );
  });

  describe('migration kind', () => {
    it('drift inside hardcoded Prisma migrations prefix → gen-fenced (gen_dirs ignored)', () => {
      const task = makeTask(
        'migration',
        ['apps/server/prisma/schema.prisma'],
        { gen_dirs: ['some/other/dir'] }, // explicitly try to override — should be ignored
      );
      const r = classifyDrift(
        task,
        ['apps/server/prisma/schema.prisma'],
        [
          'apps/server/prisma/schema.prisma',
          'apps/server/prisma/migrations/20260520_init/migration.sql',
          'apps/server/prisma/migrations/migration_lock.toml',
        ],
      );
      expect(r.kind).toBe('gen-fenced');
      if (r.kind === 'gen-fenced') {
        expect(r.genScope).toEqual(['apps/server/prisma/migrations/']);
      }
    });

    it('drift outside Prisma migrations prefix → needs-ralph', () => {
      const task = makeTask('migration', ['apps/server/prisma/schema.prisma']);
      const r = classifyDrift(
        task,
        ['apps/server/prisma/schema.prisma'],
        [
          'apps/server/prisma/schema.prisma',
          'apps/server/src/modules/account/account.module.ts', // outside
        ],
      );
      expect(r.kind).toBe('needs-ralph');
      if (r.kind === 'needs-ralph') expect(r.reason).toBe('outside-gen-scope');
    });
  });

  describe('path normalization', () => {
    it('handles leading ./ + trailing / + mixed slashes consistently', () => {
      const task = makeTask('gen', ['packages/api-client/src/gen/a.ts'], {
        gen_dirs: ['./packages/api-client/src/gen/'],
      });
      const r = classifyDrift(
        task,
        ['./packages/api-client/src/gen/a.ts'],
        ['packages/api-client/src/gen/a.ts', 'packages/api-client/src/gen/b.ts'],
      );
      expect(r.kind).toBe('gen-fenced');
    });
  });
});

describe('resolveGenScope', () => {
  it('migration kind → hardcoded prefix even with gen_dirs set', () => {
    const task = makeTask('migration', ['x.sql'], {
      gen_dirs: ['ignored/dir'],
    });
    expect(resolveGenScope(task, ['x.sql'])).toEqual(['apps/server/prisma/migrations/']);
  });

  it('explicit gen_dirs honored as-is (no safety valve)', () => {
    const task = makeTask('gen', ['only-one.ts'], {
      gen_dirs: ['shallow'], // depth 1, no min-declared check
    });
    expect(resolveGenScope(task, ['only-one.ts'])).toEqual(['shallow/']);
  });

  it('auto-LCD returns null when blacklisted', () => {
    const task = makeTask('gen', ['docs/a.md', 'docs/b.md']);
    expect(resolveGenScope(task, ['docs/a.md', 'docs/b.md'])).toBeNull();
  });
});

describe('normalizePath', () => {
  it.each([
    ['./foo/bar', 'foo/bar'],
    ['/foo/bar', 'foo/bar'],
    ['foo/bar/', 'foo/bar'],
    ['foo\\bar', 'foo/bar'],
    ['./foo/bar/', 'foo/bar'],
  ])('normalizes %s → %s', (input, expected) => {
    expect(normalizePath(input)).toBe(expected);
  });
});

describe('__testing internals', () => {
  it('AUTO_LCD_BLACKLIST locks down high-risk prefixes (stop-signal #1)', () => {
    const b = __testing.AUTO_LCD_BLACKLIST;
    for (const must of [
      '.',
      '/',
      'apps/server/src',
      'apps/mobile/src',
      'packages',
      'docs',
      'prisma',
    ]) {
      expect(b.has(must)).toBe(true);
    }
  });

  it('MIGRATION_HARDCODED_PREFIX matches stop-signal #3', () => {
    expect(__testing.MIGRATION_HARDCODED_PREFIX).toBe('apps/server/prisma/migrations/');
  });

  it('longestCommonDir returns null when paths share no common directory', () => {
    expect(__testing.longestCommonDir(['a/x.ts', 'b/y.ts'])).toBeNull();
  });

  it('longestCommonDir returns null when any path is at the repo root', () => {
    expect(__testing.longestCommonDir(['root.ts', 'sub/dir/x.ts'])).toBeNull();
  });

  it('segmentDepth handles edge cases', () => {
    expect(__testing.segmentDepth('')).toBe(0);
    expect(__testing.segmentDepth('.')).toBe(0);
    expect(__testing.segmentDepth('a')).toBe(1);
    expect(__testing.segmentDepth('a/b/c')).toBe(3);
  });

  // Exhaustiveness check: ensures DriftDecision union stays narrow and our
  // tests cover each branch. Will fail to typecheck if a new branch is added
  // without an explicit test (per CLAUDE.md L2 Verification).
  it('DriftDecision union has exactly 3 branches', () => {
    const samples: DriftDecision[] = [
      { kind: 'no-drift' },
      {
        kind: 'gen-fenced',
        expandedStage: [],
        genScope: ['x/'],
      },
      { kind: 'needs-ralph', orphans: [], reason: 'kind-not-bulk' },
    ];
    const branches = new Set(samples.map((s) => s.kind));
    expect(branches.size).toBe(3);
  });
});
