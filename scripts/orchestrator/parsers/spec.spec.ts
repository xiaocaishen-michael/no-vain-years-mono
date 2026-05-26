import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SpecAnalyzer } from './spec.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, '..', '__fixtures__');
const happy = fs.readFileSync(path.join(FIXTURES, 'spec-happy.md'), 'utf-8');

describe('SpecAnalyzer', () => {
  const analyzer = new SpecAnalyzer();

  it('parses prose spec: frontmatter / US / FR / SC / clarifications / mermaid', () => {
    const result = analyzer.parseContent(happy);

    expect(result.frontmatter.feature_id).toBe('002-account-profile-base');
    expect(result.frontmatter.modules).toEqual(['account']);
    expect(result.frontmatter.status).toBe('planned');

    expect(result.userStories).toHaveLength(1);
    expect(result.userStories[0].id).toBe('US1');
    expect(result.userStories[0].priority).toBe('P1');
    expect(result.userStories[0].title).toContain('查看个人信息');

    expect(result.functionalRequirements).toHaveLength(2);
    expect(result.functionalRequirements.map((f) => f.id)).toEqual(['FR-001', 'FR-002']);
    // prose carries no priority → default 'should'
    expect(result.functionalRequirements[0].priority).toBe('should');
    expect(result.functionalRequirements[0].text).toBe('System MUST return account profile');

    expect(result.successCriteria.map((s) => s.id)).toEqual(['SC-001', 'SC-002']);

    // prose-tolerant best-effort: one bullet under ## Clarifications
    expect(result.clarifications).toHaveLength(1);
    expect(result.clarifications[0].text).toContain('掩码');

    expect(result.userJourneyMermaid).toContain('sequenceDiagram');
    expect(result.edgeCases).toContain('emoji');
    expect(result.assumptions).toContain('登录流程');
  });

  it('throws when frontmatter is missing required governance field (modules)', () => {
    const bad = happy.replace(/^modules: \[account\]\n/m, '');
    expect(() => analyzer.parseContent(bad)).toThrowError(/modules/);
  });

  it('accepts frontmatter without optional version fields (vanilla-ish spec)', () => {
    const lean = happy
      .replace(/^spec_kit_version:.*\n/m, '')
      .replace(/^orchestrator_compat:.*\n/m, '');
    const result = analyzer.parseContent(lean);
    expect(result.frontmatter.feature_id).toBe('002-account-profile-base');
    expect(result.functionalRequirements).toHaveLength(2);
  });

  it('is forward-compatible: an undeclared frontmatter key does not break parse (§2.1)', () => {
    const withExtra = happy.replace(
      /^status: planned\n/m,
      'status: planned\nsome_future_field: whatever\n',
    );
    const result = analyzer.parseContent(withExtra);
    expect(result.frontmatter.feature_id).toBe('002-account-profile-base');
  });

  it('is backward-compatible: legacy us-meta / fr-meta comments are ignored, not parsed', () => {
    const legacy = happy
      .replace(
        '### User Story 1 — 查看个人信息 (Priority: P1)',
        '### User Story 1 — 查看个人信息 (Priority: P1)\n<!-- us-meta: {"id":"US1","priority":"P1","independent_test":"x","trace_fr":["FR-001"]} -->',
      )
      .replace(
        '- **FR-001**: System MUST return account profile',
        '- **FR-001**: System MUST return account profile <!-- fr-meta: {"id":"FR-001","priority":"must","needs_clarification":false,"questions":[],"trace_us":["US1"],"trace_sc":["SC-001"]} -->',
      );
    const result = analyzer.parseContent(legacy);
    expect(result.userStories).toHaveLength(1);
    expect(result.userStories[0].id).toBe('US1');
    // comment stripped from FR text; legacy 'must' priority NOT carried over
    expect(result.functionalRequirements[0].text).toBe('System MUST return account profile');
    expect(result.functionalRequirements[0].priority).toBe('should');
  });

  it('extracts a US heading without an explicit priority (priority omitted)', () => {
    const noPriority = happy.replace(
      '### User Story 1 — 查看个人信息 (Priority: P1)',
      '### User Story 1 — 查看个人信息',
    );
    const result = analyzer.parseContent(noPriority);
    expect(result.userStories[0].id).toBe('US1');
    expect(result.userStories[0].priority).toBeUndefined();
    expect(result.userStories[0].title).toContain('查看个人信息');
  });
});
