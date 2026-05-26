import * as fs from 'node:fs';
import { SpecFrontmatterSchema, type FrPriority, type SpecFrontmatter } from '../schemas/spec.js';
import { parseFrontmatterRaw } from './common/gray-matter-wrap.js';

export interface UserStory {
  id: string; // "US<n>"
  priority?: string; // "P<n>" if declared in the heading
  title: string;
}

export interface FunctionalRequirement {
  id: string; // "FR-NNN"
  priority: FrPriority; // prose carries none → defaults to 'should' (p1 §2)
  text: string;
}

export interface SuccessCriterion {
  id: string;
  text: string;
}

export interface Clarification {
  text: string;
}

export interface ParsedSpec {
  frontmatter: SpecFrontmatter;
  userJourneyMermaid: string | null;
  clarifications: Clarification[];
  userStories: UserStory[];
  edgeCases: string;
  functionalRequirements: FunctionalRequirement[];
  successCriteria: SuccessCriterion[];
  assumptions: string;
}

// Strip a trailing `<!-- ... -->` HTML comment (e.g. legacy us-meta/fr-meta
// annotations) so prose extraction yields clean text from both vanilla and
// legacy meta-bearing specs.
function stripTrailingComment(s: string): string {
  return s.replace(/\s*<!--[\s\S]*?-->\s*$/, '');
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
      successCriteria,
      assumptions,
    };
  }

  private extractMermaid(body: string): string | null {
    const m = body.match(/```mermaid\s*\n([\s\S]*?)\n```/);
    return m ? m[1].trim() : null;
  }

  private extractUserStories(body: string): UserStory[] {
    // Prose heading: `### User Story <n> [—/–/-] <title> (Priority: P<n>)`.
    // The title separator and the trailing `(Priority: ...)` are both optional;
    // any legacy `<!-- us-meta -->` on the following line is ignored.
    const regex = /^###\s+User Story\s+(\d+)\b(.*)$/gm;
    const out: UserStory[] = [];
    let m: RegExpExecArray | null;
    while ((m = regex.exec(body)) !== null) {
      const id = `US${m[1]}`;
      let rest = m[2].trim();
      let priority: string | undefined;
      const pm = rest.match(/\(Priority:\s*(P\d+)\)\s*$/i);
      if (pm) {
        priority = pm[1].toUpperCase();
        rest = rest.slice(0, pm.index).trim();
      }
      const title = rest.replace(/^[—–\-:\s]+/, '').trim();
      out.push({ id, priority, title });
    }
    return out;
  }

  private extractFunctionalRequirements(body: string): FunctionalRequirement[] {
    // Prose line: `- **FR-NNN**: text`. Prose carries no priority → 'should'.
    const regex = /^-\s+\*\*(FR-\d{3})\*\*:\s*(.+)$/gm;
    const out: FunctionalRequirement[] = [];
    let m: RegExpExecArray | null;
    while ((m = regex.exec(body)) !== null) {
      const text = stripTrailingComment(m[2]).trim();
      out.push({ id: m[1], priority: 'should', text });
    }
    return out;
  }

  private extractSuccessCriteria(body: string): SuccessCriterion[] {
    const sectionRaw = this.extractSection(body, 'Success Criteria');
    if (!sectionRaw) return [];
    const regex = /^-\s+\*\*(SC-\d{3})\*\*:\s*(.+)$/gm;
    const out: SuccessCriterion[] = [];
    let m: RegExpExecArray | null;
    while ((m = regex.exec(sectionRaw)) !== null) {
      out.push({ id: m[1], text: stripTrailingComment(m[2]).trim() });
    }
    return out;
  }

  private extractClarifications(body: string): Clarification[] {
    // Prose-tolerant + best-effort: each bullet under `## Clarifications`
    // becomes one entry (legacy `<!-- cl-meta -->` comments are ignored).
    // Unused by the executor — kept for summary/visibility only.
    const sectionRaw = this.extractSection(body, 'Clarifications');
    if (!sectionRaw) return [];
    const regex = /^-\s+(.+)$/gm;
    const out: Clarification[] = [];
    let m: RegExpExecArray | null;
    while ((m = regex.exec(sectionRaw)) !== null) {
      const text = stripTrailingComment(m[1]).trim();
      if (text) out.push({ text });
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
