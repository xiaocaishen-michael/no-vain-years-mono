import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { featureDirOf, gateDir, isOrchestratorShaped } from './parse-gate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, '__fixtures__');

describe('featureDirOf', () => {
  const specs = '/repo/specs';

  it('maps a file under specs/<feature>/ to its feature dir', () => {
    expect(featureDirOf('/repo/specs/002-x/plan.md', specs)).toBe('/repo/specs/002-x');
    expect(featureDirOf('/repo/specs/002-x', specs)).toBe('/repo/specs/002-x');
  });

  it('returns null for paths outside specs/', () => {
    expect(featureDirOf('/repo/apps/server/main.ts', specs)).toBeNull();
    expect(featureDirOf('/repo/specs', specs)).toBeNull();
  });
});

describe('isOrchestratorShaped + gateDir', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'parse-gate-'));
    // Seed a valid orchestrator-shaped feature from the happy fixtures.
    fs.copyFileSync(path.join(FIXTURES, 'spec-happy.md'), path.join(tmp, 'spec.md'));
    fs.copyFileSync(path.join(FIXTURES, 'plan-happy.md'), path.join(tmp, 'plan.md'));
    fs.copyFileSync(path.join(FIXTURES, 'tasks-happy.md'), path.join(tmp, 'tasks.md'));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('detects orchestrator_config presence', () => {
    expect(isOrchestratorShaped(tmp)).toBe(true);
  });

  it('skips a feature whose plan lacks orchestrator_config (manual SDD)', () => {
    fs.writeFileSync(path.join(tmp, 'plan.md'), '# Manual plan\n\nno fenced config here\n');
    expect(isOrchestratorShaped(tmp)).toBe(false);
    expect(gateDir(tmp).status).toBe('skip');
  });

  it('passes a valid orchestrator-shaped feature end-to-end', () => {
    expect(gateDir(tmp)).toMatchObject({ status: 'pass' });
  });

  it('fails (red) when an orchestrator-shaped feature drifts off-contract', () => {
    // Inject drift: break the 3-way feature_id equality on tasks.md.
    const tasks = fs.readFileSync(path.join(tmp, 'tasks.md'), 'utf-8');
    fs.writeFileSync(
      path.join(tmp, 'tasks.md'),
      tasks.replace(/feature_id: 002-account-profile-base/, 'feature_id: 999-drifted-id'),
    );
    const r = gateDir(tmp);
    expect(r.status).toBe('fail');
    expect(r.error).toMatch(/feature_id/);
  });
});
