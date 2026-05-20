import * as fs from 'node:fs';
import {
  ClMetaSchema,
  EntitiesBlockSchema,
  FrMetaSchema,
  SpecFrontmatterSchema,
  UsMetaSchema,
  type ClMeta,
  type Entity,
  type FrMeta,
  type SpecFrontmatter,
  type UsMeta,
} from '../schemas/spec.js';
import { parseFrontmatterRaw } from './common/gray-matter-wrap.js';
import { parseJson5 } from './common/json5-cleanse.js';

export interface UserStory {
  meta: UsMeta;
  title: string;
}

export interface FunctionalRequirement {
  meta: FrMeta;
  text: string;
}

export interface SuccessCriterion {
  id: string;
  text: string;
}

export interface Clarification {
  meta: ClMeta;
}

export interface ParsedSpec {
  frontmatter: SpecFrontmatter;
  userJourneyMermaid: string | null;
  clarifications: Clarification[];
  userStories: UserStory[];
  edgeCases: string;
  functionalRequirements: FunctionalRequirement[];
  entities: Entity[];
  successCriteria: SuccessCriterion[];
  assumptions: string;
}

export class SpecAnalyzer {
  parse(filePath: string): ParsedSpec {
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    return this.parseContent(fileContent);
  }

  parseContent(fileContent: string): ParsedSpec {
    const { data, body } = parseFrontmatterRaw(fileContent);
    const frontmatter = SpecFrontmatterSchema.parse(data);

    const userJourneyMermaid = this.extractMermaid(body);
    const userStories = this.extractUserStories(body);
    const functionalRequirements = this.extractFunctionalRequirements(body);
    const entities = this.extractEntities(body);
    const successCriteria = this.extractSuccessCriteria(body);
    const clarifications = this.extractClarifications(body);
    const edgeCases = this.extractSection(body, 'Edge Cases', 3);
    const assumptions = this.extractSection(body, 'Assumptions', 2);

    return {
      frontmatter,
      userJourneyMermaid,
      clarifications,
      userStories,
      edgeCases,
      functionalRequirements,
      entities,
      successCriteria,
      assumptions,
    };
  }

  private extractMermaid(body: string): string | null {
    const m = body.match(/```mermaid\s*\n([\s\S]*?)\n```/);
    return m ? m[1].trim() : null;
  }

  private extractUserStories(body: string): UserStory[] {
    // Heading `### User Story N — title (Priority: PX)` followed (possibly after blanks)
    // by `<!-- us-meta: {...} -->`.
    const regex =
      /^###\s+User Story[^\n]*?\n+\s*<!--\s*us-meta:\s*([\s\S]*?)\s*-->/gm;
    const out: UserStory[] = [];
    let m: RegExpExecArray | null;
    while ((m = regex.exec(body)) !== null) {
      const headingLine = body.slice(0, m.index).split('\n').pop() ?? '';
      // Re-extract the heading line for title (m.index points to the `###` line start)
      const lineEnd = body.indexOf('\n', m.index);
      const heading = body.slice(m.index, lineEnd === -1 ? body.length : lineEnd);
      const title = heading.replace(/^###\s+/, '').trim();
      const meta = parseJson5(m[1], UsMetaSchema);
      out.push({ meta, title });
      void headingLine;
    }
    return out;
  }

  private extractFunctionalRequirements(body: string): FunctionalRequirement[] {
    // Line shape: `- **FR-NNN**: text <!-- fr-meta: {...} -->`
    const regex =
      /^-\s+\*\*FR-\d{3}\*\*:\s*([\s\S]*?)\s*<!--\s*fr-meta:\s*([\s\S]*?)\s*-->/gm;
    const out: FunctionalRequirement[] = [];
    let m: RegExpExecArray | null;
    while ((m = regex.exec(body)) !== null) {
      const text = m[1].trim();
      const meta = parseJson5(m[2], FrMetaSchema);
      out.push({ meta, text });
    }
    return out;
  }

  private extractEntities(body: string): Entity[] {
    const m = body.match(/```json\s+entities\s*\n([\s\S]*?)\n```/);
    if (!m) return [];
    const block = parseJson5(m[1], EntitiesBlockSchema);
    return block.entities;
  }

  private extractSuccessCriteria(body: string): SuccessCriterion[] {
    const sectionRaw = this.extractSection(body, 'Success Criteria');
    if (!sectionRaw) return [];
    const regex = /^-\s+\*\*(SC-\d{3})\*\*:\s*(.+)$/gm;
    const out: SuccessCriterion[] = [];
    let m: RegExpExecArray | null;
    while ((m = regex.exec(sectionRaw)) !== null) {
      out.push({ id: m[1], text: m[2].trim() });
    }
    return out;
  }

  private extractClarifications(body: string): Clarification[] {
    const sectionRaw = this.extractSection(body, 'Clarifications');
    if (!sectionRaw) return [];
    const regex = /<!--\s*cl-meta:\s*([\s\S]*?)\s*-->/g;
    const out: Clarification[] = [];
    let m: RegExpExecArray | null;
    while ((m = regex.exec(sectionRaw)) !== null) {
      const meta = parseJson5(m[1], ClMetaSchema);
      out.push({ meta });
    }
    return out;
  }

  private extractSection(body: string, heading: string, level: 2 | 3 = 2): string {
    const hashes = '#'.repeat(level);
    const headingRegex = new RegExp(`^${hashes}\\s+${heading}\\b[^\\n]*\\n`, 'm');
    const m = body.match(headingRegex);
    if (!m || m.index === undefined) return '';
    const after = body.slice(m.index + m[0].length);
    // h2 section ends at next h2; h3 section ends at next h2 or h3
    const stopRegex = level === 2 ? /\n##\s/ : /\n#{2,3}\s/;
    const nextHeading = after.search(stopRegex);
    const content = nextHeading === -1 ? after : after.slice(0, nextHeading);
    return content.trim();
  }
}
