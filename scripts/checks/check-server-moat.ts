#!/usr/bin/env node
/**
 * check-server-moat.ts — ts-morph AST 护城河探针 (Plan 05-24 R-6, 合并
 * ADR-0034 Evolutionary Path Stage C). 把 ADR-0043 §5「当前仅约定」的两条
 * 边界从人工 / AI CR 引导转为机器强制:
 *
 *   Check 1 — 数据护城河 (ADR-0043 §5 + §3 R1/R2):
 *     某 bounded context 访问**非自有** Prisma model 的 `<x>.<model>.<op>()`:
 *       - 写操作 (create/update/upsert/delete/...) → 永远违规 (R2: 跨 ctx 写
 *         必须委托对方 UseCase, 禁 `tx.<otherTable>.*`)。
 *       - 读操作 (find* / count / aggregate / ...) → 违规, **除非**该访问语句上方标
 *         `// CROSS-CONTEXT-READ:` (catalog Q7-B 临时只读逃生口)。
 *     boundaries ESLint 看不见 Prisma 调用 (它只管 import 方向), 故此探针正交补位。
 *
 *   Check 2 — 跨 ctx 注入注释 (ADR-0034 Stage C, R2 CROSS-CTX-SYNC):
 *     构造器注入参数, 若其类型 import 自**另一个业务 context** (auth ↔ account;
 *     security 是平台基座, 豁免 per ADR-0041) → 该参数上方必须有
 *     `// CROSS-CONTEXT-{SYNC,ASYNC,READ}:` 注释 (注入点 = 行为耦合点)。
 *     纯函数 (normalizePhone) / 异常类 / NestJS Module import 不是构造器注入,
 *     天然不在扫描面 — 注释信号不被稀释。
 *
 * 设计同 check-adr-index.ts: 始终全量扫描 (护城河是 holistic invariant), lefthook
 * 的 glob 只决定**是否**跑, 不决定**扫什么**。语法级遍历 (不做类型解析) → 快,
 * 不依赖 `prisma generate` 是否跑过。
 *
 * Usage: pnpm tsx scripts/checks/check-server-moat.ts
 * Exit:  0 全过 / 1 ≥1 违规
 *
 * Deps (@nvy/checks): ts-morph; run via root tsx。
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Node, Project, SyntaxKind, type ParameterDeclaration, type SourceFile } from 'ts-morph';

const SERVER_ROOT = 'apps/server';
const SRC_GLOBS = [
  `${SERVER_ROOT}/src/**/*.ts`,
  `!${SERVER_ROOT}/src/**/*.spec.ts`,
  `!${SERVER_ROOT}/src/**/*.test.ts`,
  `!${SERVER_ROOT}/src/**/*.it.spec.ts`,
  `!${SERVER_ROOT}/src/generated/**`,
  `!${SERVER_ROOT}/src/__smoke__/**`,
];
const SCHEMA_PATH = `${SERVER_ROOT}/prisma/schema.prisma`;

/**
 * 业务 context 的 Prisma model 归属 (accessor = camelCase model 名)。
 * 只声明**已落地**的 model; dormant model (db pull 带入但尚未接线的
 * accountSmsCode / credential / realnameProfile) 故意不列 —
 * 它们 0 访问, 一旦未来被跨 ctx 访问, Check 1 会以「未声明归属」报错, 逼迫
 * 接线者显式声明 owner (defense-in-depth, 不让新表悄悄绕过护城河)。
 */
const MODEL_OWNERSHIP: Record<string, string> = {
  account: 'account',
  outboxEvent: 'security',
  // refreshToken 归 security 平台层: RefreshTokenService 持久化/轮换/撤销 (003-tokens)。
  refreshToken: 'security',
};

const WRITE_OPS = new Set([
  'create',
  'createMany',
  'createManyAndReturn',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'upsert',
  'delete',
  'deleteMany',
]);
const READ_OPS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
]);
const PRISMA_OPS = new Set([...WRITE_OPS, ...READ_OPS]);

/** 平台基座 — 作为 import 目标永远豁免注释 (per ADR-0041)。 */
const PLATFORM_CTX = 'security';

/**
 * 业务 bounded context (per ADR-0032 当前 3-ctx 模型: auth 编排 / account 数据 /
 * security 平台基座)。Check 2 只在「业务 ctx 注入另一业务 ctx」时要求注释 ——
 * security 平台基座 + app 组合根 + observability 等非业务 seg 不在此列。
 * 新增 bounded context (走 ADR-0032 sunset trigger 评估) 时, 同步加入本集合。
 */
const BUSINESS_CTX = new Set(['auth', 'account']);

interface Violation {
  file: string;
  line: number;
  rule: 'moat-write' | 'moat-read' | 'moat-unmapped' | 'cross-ctx-annotation';
  message: string;
}

/** 从 schema.prisma 抽出全部 model → camelCase accessor 集合 (真 Prisma model 锚)。 */
function readSchemaAccessors(schemaPath: string): Set<string> {
  const accessors = new Set<string>();
  if (!existsSync(schemaPath)) return accessors;
  const text = readFileSync(schemaPath, 'utf-8');
  for (const m of text.matchAll(/^model\s+([A-Za-z_]\w*)\s*\{/gm)) {
    const name = m[1];
    accessors.add(name.charAt(0).toLowerCase() + name.slice(1));
  }
  return accessors;
}

/** src/<seg>/... → seg (context); src 直属文件 / 非 src → null。 */
function ctxOfFile(filePath: string): string | null {
  const m = filePath.replace(/\\/g, '/').match(/\/src\/([^/]+)\//);
  return m ? m[1] : null;
}

/** 相对 import specifier → 目标 context (resolve 后落 src/<seg>/);非 src 内 → null。 */
function ctxOfSpecifier(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null; // 外部包, 不跨 ctx
  const resolved = resolve(dirname(fromFile), specifier).replace(/\\/g, '/');
  const m = resolved.match(/\/src\/([^/]+)(?:\/|$)/);
  return m ? m[1] : null;
}

/**
 * node 起始行**紧邻上方**的连续注释文本 (遇空行 / 代码行即停)。
 * ts-morph 的 leading comment 归属随 trivia 边界漂移 (param 注释可能挂在前一个
 * 逗号的 trailing trivia), 故用确定性的行级回溯, 不依赖 getLeadingCommentRanges。
 */
function contiguousCommentAbove(sf: SourceFile, node: Node): string {
  const lines = sf.getFullText().split('\n');
  const startIdx = node.getStartLineNumber() - 1; // 0-based; getStart() 跳过 leading trivia
  const collected: string[] = [];
  for (let i = startIdx - 1; i >= 0; i--) {
    const t = lines[i].trim();
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') || t.endsWith('*/')) {
      collected.push(t);
      continue;
    }
    break; // 空行或代码行 → 注释块结束
  }
  return collected.join('\n');
}

/** 构造器参数类型的首个类型名 (TypeReference identifier);取不到 → null。 */
function paramTypeName(param: ParameterDeclaration): string | null {
  const typeNode = param.getTypeNode();
  if (!typeNode) return null;
  if (Node.isTypeReference(typeNode)) return typeNode.getTypeName().getText();
  // 退化: 取类型文本的首段 identifier (覆盖 `Foo`、`Foo<Bar>` 等)。
  const text = typeNode.getText().trim();
  const m = text.match(/^[A-Za-z_]\w*/);
  return m ? m[0] : null;
}

/** FS-driven 全量扫描 (CLI 入口): 从 glob 装载 + 读 schema.prisma 锚。 */
export function scanServerMoat(opts?: { srcGlobs?: string[]; schemaPath?: string }): Violation[] {
  const schemaAccessors = readSchemaAccessors(opts?.schemaPath ?? SCHEMA_PATH);
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    compilerOptions: { allowJs: false },
  });
  project.addSourceFilesAtPaths(opts?.srcGlobs ?? SRC_GLOBS);
  return scanSourceFiles(project.getSourceFiles(), schemaAccessors);
}

/**
 * 纯扫描核心 (语法级遍历 SourceFile[])。schemaAccessors = 真 Prisma model 锚集合。
 * 与 FS / glob 解耦 → 单测可喂 in-memory ts-morph fixture (见 check-server-moat.spec.ts)。
 */
export function scanSourceFiles(
  sourceFiles: SourceFile[],
  schemaAccessors: Set<string>,
): Violation[] {
  const violations: Violation[] = [];
  for (const sf of sourceFiles) {
    const fileCtx = ctxOfFile(sf.getFilePath());
    checkDataMoat(sf, fileCtx, schemaAccessors, violations);
    checkInjectionAnnotations(sf, fileCtx, violations);
  }
  return violations.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

/** Check 1 — 跨 bounded context 的 Prisma model 访问 (写禁 / 读需 CROSS-CONTEXT-READ)。 */
function checkDataMoat(
  sf: SourceFile,
  fileCtx: string | null,
  schemaAccessors: Set<string>,
  violations: Violation[],
): void {
  const filePath = sf.getFilePath();
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    if (!Node.isPropertyAccessExpression(callee)) continue;
    const op = callee.getName();
    if (!PRISMA_OPS.has(op)) continue;
    const inner = callee.getExpression();
    if (!Node.isPropertyAccessExpression(inner)) continue;
    const accessor = inner.getName();
    if (!schemaAccessors.has(accessor)) continue; // 非 Prisma model, 跳过

    const line = inner.getNameNode().getStartLineNumber();
    const owner = MODEL_OWNERSHIP[accessor];
    if (!owner) {
      violations.push({
        file: filePath,
        line,
        rule: 'moat-unmapped',
        message: `Prisma model '${accessor}' 被访问但 MODEL_OWNERSHIP 未声明 owner — 接线新表时必须在 scripts/checks/check-server-moat.ts 声明其所属 context`,
      });
      continue;
    }
    if (fileCtx === owner) continue; // 自有表, 合法

    if (WRITE_OPS.has(op)) {
      violations.push({
        file: filePath,
        line,
        rule: 'moat-write',
        message: `${fileCtx} 跨 ctx **写** ${owner} 的表 '${accessor}.${op}()' — 禁; 委托 ${owner} 的 Commit*UseCase (R2, per ADR-0043 §3)`,
      });
      continue;
    }
    // 读: 允许带 // CROSS-CONTEXT-READ: 的只读逃生口 (catalog Q7-B)
    const stmt = call.getFirstAncestor((a) => Node.isStatement(a)) ?? call;
    if (!/CROSS-CONTEXT-READ\b/.test(contiguousCommentAbove(sf, stmt))) {
      violations.push({
        file: filePath,
        line,
        rule: 'moat-read',
        message: `${fileCtx} 跨 ctx **读** ${owner} 的表 '${accessor}.${op}()' 缺 // CROSS-CONTEXT-READ: 注释 (catalog Q7-B 只读逃生口) — 或优先走 Outbox replay 本地副本 (Q7-A)`,
      });
    }
  }
}

/** Check 2 — 跨业务 ctx 的构造器注入参数需 CROSS-CONTEXT-{SYNC,ASYNC,READ} 注释 (R2 / ADR-0034 Stage C)。 */
function checkInjectionAnnotations(
  sf: SourceFile,
  fileCtx: string | null,
  violations: Violation[],
): void {
  if (fileCtx === null || !BUSINESS_CTX.has(fileCtx)) return;
  const filePath = sf.getFilePath();
  for (const ctor of sf.getDescendantsOfKind(SyntaxKind.Constructor)) {
    for (const param of ctor.getParameters()) {
      const typeName = paramTypeName(param);
      if (!typeName) continue;
      const imp = sf
        .getImportDeclarations()
        .find((d) =>
          d
            .getNamedImports()
            .some((ni) => (ni.getAliasNode() ?? ni.getNameNode()).getText() === typeName),
        );
      if (!imp) continue; // 本 ctx 局部类型, 非跨 ctx
      const targetCtx = ctxOfSpecifier(filePath, imp.getModuleSpecifierValue());
      if (targetCtx === null || targetCtx === PLATFORM_CTX) continue; // 平台基座豁免
      if (targetCtx === fileCtx) continue; // 同 ctx
      if (!BUSINESS_CTX.has(targetCtx)) continue; // 仅业务 ctx 互调要求注释

      if (!/CROSS-CONTEXT-(SYNC|ASYNC|READ)\b/.test(contiguousCommentAbove(sf, param))) {
        violations.push({
          file: filePath,
          line: param.getStartLineNumber(),
          rule: 'cross-ctx-annotation',
          message: `${fileCtx} 注入跨 ctx ${targetCtx} 的 '${typeName}' 缺 // CROSS-CONTEXT-{SYNC,ASYNC,READ}: 注释 (注入点 = 行为耦合点, per ADR-0034 Stage C / R2)`,
        });
      }
    }
  }
}

// ── CLI ────────────────────────────────────────────────────────────────────
function main(): void {
  if (!existsSync(`${SERVER_ROOT}/src`)) {
    console.log('[check-server-moat] no apps/server/src (skip)');
    process.exit(0);
  }
  const violations = scanServerMoat();
  if (violations.length === 0) {
    console.log('[check-server-moat] ✓ 0 护城河违规 (数据归属 + 跨 ctx 注入注释)');
    process.exit(0);
  }
  console.error('❌ check-server-moat: 发现护城河违规 (ADR-0043 §5 + ADR-0034 Stage C)');
  for (const v of violations) {
    const rel = v.file.replace(`${process.cwd()}/`, '');
    console.error(`   - ${rel}:${v.line} [${v.rule}] ${v.message}`);
  }
  console.error(`\n[check-server-moat] ${violations.length} violation(s)`);
  process.exit(1);
}

// tsx 直跑时执行 CLI; 被 import (测试) 时不跑。
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
