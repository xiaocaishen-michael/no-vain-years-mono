import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ConstitutionViolationError, PlanAnalyzer } from './plan.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, '..', '__fixtures__');
const happy = fs.readFileSync(path.join(FIXTURES, 'plan-happy.md'), 'utf-8');

describe('PlanAnalyzer', () => {
  const analyzer = new PlanAnalyzer();

  it('parses happy path with frontmatter / config / contracts / constitution / architecture notes', () => {
    const result = analyzer.parseContent(happy);

    expect(result.frontmatter.feature_id).toBe('002-account-profile-base');
    expect(result.frontmatter.status).toBe('approved');
    expect(result.frontmatter.adr_refs).toContain('0024');

    expect(result.config.workspaces).toHaveLength(3);
    const server = result.config.workspaces.find((w) => w.id === 'server-app');
    expect(server?.verify_commands.test).toBe('pnpm nx test server --watch=false');
    expect(server?.verify_commands.e2e).toBe('pnpm nx run server:e2e');

    expect(result.config.module_boundaries['server-app'].modules).toEqual(['account']);

    expect(result.contracts.endpoints).toHaveLength(2);
    expect(result.contracts.endpoints[0].id).toBe('EP1');
    expect(result.contracts.endpoints[1].method).toBe('PATCH');

    expect(result.constitution.passed).toBe(true);
    expect(result.architectureNotes).toContain('ProfileController');
  });

  it('rejects frontmatter feature_id with wrong format', () => {
    const bad = happy.replace('feature_id: 002-account-profile-base', 'feature_id: ProfileBase');
    expect(() => analyzer.parseContent(bad)).toThrowError(/feature_id/);
  });

  it('throws when orchestrator_config block is missing', () => {
    const bad = happy.replace(/```json orchestrator_config[\s\S]*?```/, '');
    expect(() => analyzer.parseContent(bad)).toThrowError(
      /Missing mandatory fenced JSON block: orchestrator_config/,
    );
  });

  it('throws ConstitutionViolationError when constitution.passed=false', () => {
    const bad = happy.replace(
      /"passed": true,\s*\n\s*"violations": \[\]/,
      '"passed": false,\n  "violations": [{"rule_id":"no-circular-deps","justification":"none"}]',
    );
    expect(() => analyzer.parseContent(bad)).toThrowError(ConstitutionViolationError);
  });

  it('rejects endpoint with empty trace_fr (Zod min(1))', () => {
    const bad = happy.replace('"trace_fr": ["FR-001"]', '"trace_fr": []');
    expect(() => analyzer.parseContent(bad)).toThrowError(/trace_fr/);
  });

  it('tolerates unquoted keys in api_contracts JSON (JSON5)', () => {
    const dirty = happy.replace(
      /```json api_contracts\s*\n\{[\s\S]*?\}\n```/,
      `\`\`\`json api_contracts
{
  endpoints: [
    {
      id: "EP1",
      method: "GET",
      path: "/v1/account/profile",
      auth: "bearer",
      request: null,
      response_schema_ref: "E1",
      trace_fr: ["FR-001"],
    },
  ],
}
\`\`\``,
    );
    const result = analyzer.parseContent(dirty);
    expect(result.contracts.endpoints).toHaveLength(1);
    expect(result.contracts.endpoints[0].id).toBe('EP1');
  });

  it('rejects response_schema_ref with malformed expression', () => {
    const bad = happy.replace('"response_schema_ref": "E1"', '"response_schema_ref": "Account"');
    expect(() => analyzer.parseContent(bad)).toThrowError(/response_schema_ref/);
  });
});
