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

  it('parses happy path with frontmatter / US / FR / entities / SC / clarifications / mermaid', () => {
    const result = analyzer.parseContent(happy);

    expect(result.frontmatter.feature_id).toBe('002-account-profile-base');
    expect(result.frontmatter.modules).toEqual(['account']);
    expect(result.frontmatter.status).toBe('planned');

    expect(result.userStories).toHaveLength(1);
    expect(result.userStories[0].meta.id).toBe('US1');
    expect(result.userStories[0].meta.trace_fr).toEqual(['FR-001']);

    expect(result.functionalRequirements).toHaveLength(2);
    expect(result.functionalRequirements[0].meta.id).toBe('FR-001');
    expect(result.functionalRequirements[1].meta.id).toBe('FR-002');

    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].id).toBe('E1');
    expect(result.entities[0].aggregate_root).toBe(true);
    expect(result.entities[0].attrs.find((a) => a.name === 'phone')?.format).toBe(
      'E.164',
    );

    expect(result.successCriteria.map((s) => s.id)).toEqual(['SC-001', 'SC-002']);

    expect(result.clarifications).toHaveLength(1);
    expect(result.clarifications[0].meta.id).toBe('CL-001');
    expect(result.clarifications[0].meta.resolved).toBe(true);

    expect(result.userJourneyMermaid).toContain('sequenceDiagram');
    expect(result.edgeCases).toContain('emoji');
    expect(result.assumptions).toContain('登录流程');
  });

  it('throws when frontmatter is missing required field (modules)', () => {
    const bad = happy.replace(/^modules: \[account\]\n/m, '');
    expect(() => analyzer.parseContent(bad)).toThrowError(/modules/);
  });

  it('tolerates trailing comma in us-meta (JSON5 cleanse)', () => {
    const usHeading =
      '### User Story 1 — 查看个人信息 (Priority: P1)\n<!-- us-meta: {"id":"US1","priority":"P1","independent_test":"Login with valid phone → see profile","trace_fr":["FR-001"]} -->';
    const usHeadingDirty =
      '### User Story 1 — 查看个人信息 (Priority: P1)\n<!-- us-meta: {"id":"US1","priority":"P1","independent_test":"Login with valid phone → see profile","trace_fr":["FR-001",],} -->';
    const dirty = happy.replace(usHeading, usHeadingDirty);

    const result = analyzer.parseContent(dirty);
    expect(result.userStories).toHaveLength(1);
    expect(result.userStories[0].meta.id).toBe('US1');
  });

  it('tolerates smart quote in fr-meta (JSON5 cleanse)', () => {
    const frLine =
      '- **FR-001**: System MUST return account profile <!-- fr-meta: {"id":"FR-001","priority":"must","needs_clarification":false,"questions":[],"trace_us":["US1"],"trace_sc":["SC-001"]} -->';
    const frDirty =
      '- **FR-001**: System MUST return account profile <!-- fr-meta: {“id”:”FR-001”,”priority”:”must”,”needs_clarification”:false,”questions”:[],”trace_us”:[”US1”],”trace_sc”:[”SC-001”]} -->';
    const dirty = happy.replace(frLine, frDirty);

    const result = analyzer.parseContent(dirty);
    expect(result.functionalRequirements[0].meta.id).toBe('FR-001');
    expect(result.functionalRequirements[0].meta.priority).toBe('must');
  });

  it('returns empty entities array when entities block is absent (optional section)', () => {
    const noEntities = happy.replace(
      /```json entities[\s\S]*?```/,
      '(entities deferred)',
    );
    const result = analyzer.parseContent(noEntities);
    expect(result.entities).toEqual([]);
    // Other sections still parse
    expect(result.functionalRequirements).toHaveLength(2);
  });

  it('rejects fr-meta with invalid priority enum', () => {
    const bad = happy.replace('"priority":"must"', '"priority":"CRITICAL"');
    expect(() => analyzer.parseContent(bad)).toThrowError(
      /priority|CRITICAL|invalid/i,
    );
  });
});
