import * as fs from 'node:fs';
import {
  ApiContractsSchema,
  ConstitutionCheckSchema,
  OrchestratorConfigSchema,
  PlanFrontmatterSchema,
  type ApiContracts,
  type ConstitutionCheck,
  type OrchestratorConfig,
  type PlanFrontmatter,
} from '../schemas/plan.js';
import { parseFrontmatterRaw } from './common/gray-matter-wrap.js';
import { cleanseJson5 } from './common/json5-cleanse.js';

export interface ParsedPlan {
  frontmatter: PlanFrontmatter;
  config: OrchestratorConfig;
  contracts: ApiContracts;
  constitution: ConstitutionCheck;
  architectureNotes: string;
}

export class ConstitutionViolationError extends Error {
  constructor(
    public readonly featureId: string,
    public readonly violations: ConstitutionCheck['violations'],
  ) {
    super(
      `Constitution check failed for ${featureId}: ${violations.length} violation(s)`,
    );
    this.name = 'ConstitutionViolationError';
  }
}

export class PlanAnalyzer {
  parse(filePath: string): ParsedPlan {
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    return this.parseContent(fileContent);
  }

  parseContent(fileContent: string): ParsedPlan {
    const { data, body } = parseFrontmatterRaw(fileContent);
    const frontmatter = PlanFrontmatterSchema.parse(data);

    const configRaw = this.extractJsonBlock(body, 'orchestrator_config');
    const config = OrchestratorConfigSchema.parse(configRaw);
    const contracts = ApiContractsSchema.parse(
      this.extractJsonBlock(body, 'api_contracts'),
    );
    const constitution = ConstitutionCheckSchema.parse(
      this.extractJsonBlock(body, 'constitution_check'),
    );

    if (!constitution.passed) {
      throw new ConstitutionViolationError(
        frontmatter.feature_id,
        constitution.violations,
      );
    }

    const architectureNotes = this.extractMarkdownSection(
      body,
      'Architecture Notes',
    );

    return {
      frontmatter,
      config,
      contracts,
      constitution,
      architectureNotes,
    };
  }

  private extractJsonBlock(body: string, blockId: string): unknown {
    const regex = new RegExp(
      `\`\`\`json\\s+${blockId}\\s*\\n([\\s\\S]*?)\\n\`\`\``,
    );
    const match = body.match(regex);
    if (!match) {
      throw new Error(`Missing mandatory fenced JSON block: ${blockId}`);
    }
    return cleanseJson5(match[1]);
  }

  private extractMarkdownSection(body: string, heading: string): string {
    const headingRegex = new RegExp(`^##\\s+${heading}\\b[^\\n]*\\n`, 'm');
    const m = body.match(headingRegex);
    if (!m || m.index === undefined) return '';
    const after = body.slice(m.index + m[0].length);
    const nextHeading = after.search(/\n##\s/);
    const content = nextHeading === -1 ? after : after.slice(0, nextHeading);
    return content.trim();
  }
}
