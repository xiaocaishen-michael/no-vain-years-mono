import * as fs from 'node:fs/promises';
import { z } from 'zod';
import type { Git } from './git-flow.js';
import type {
  LlmClient,
  LlmInvokeOptions,
  LlmInvokeResult,
} from './llm-client.js';
import { parseJson5 } from './parsers/common/json5-cleanse.js';
import {
  TaskMetaSchema,
  type ParsedTask,
  type TaskFileOp,
} from './schemas/tasks.js';
import { normalizePath } from './drift-classifier.js';

/**
 * Orphan Self-Justify Ralph Loop (PoC blind spot #22 P1).
 *
 * When the drift classifier says `needs-ralph`, this loop invokes the LLM
 * with a structured JSON-intent prompt asking it to either:
 *   - `expand`: "the orphan files are a legitimate ripple — add them to my
 *     declared scope" → orchestrator (sole reducer) edits tasks.md's
 *     task-meta `files` array and re-parses to validate; then recomputes
 *     drift via git.diffNameOnly.
 *   - `revert`: "the orphan files are a hallucination — discard them" →
 *     orchestrator calls git.restore on (intent.files ∩ orphans). Files
 *     outside the orphan set are rejected (would corrupt verify-pass edits).
 *   - `stuck`: "I can't decide" → immediate hard stop, no further retries.
 *
 * Anti-deadlock discipline (per user stop-signal): the LLM may only return
 * intent JSON in this loop — it MUST NOT be re-invoked for code edits in
 * the same `claude -p` round. `allowedTools` is restricted to `['Read']`
 * so the subprocess physically cannot Write/Edit files; the prompt also
 * tells the model to output only JSON.
 */

// ---------------------------------------------------------------------------
// Intent schema (LLM → orchestrator contract)
// ---------------------------------------------------------------------------

export const OrphanIntentSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('expand'),
    files: z.array(z.string().min(1)).min(1),
    rationale: z.string().optional(),
  }),
  z.object({
    action: z.literal('revert'),
    files: z.array(z.string().min(1)).min(1),
    rationale: z.string().optional(),
  }),
  z.object({
    action: z.literal('stuck'),
    reason: z.string().min(1),
  }),
]);

export type OrphanIntent = z.infer<typeof OrphanIntentSchema>;

// ---------------------------------------------------------------------------
// Loop input / output
// ---------------------------------------------------------------------------

export interface RunOrphanRalphInput {
  task: ParsedTask;
  /** Initial declared = filesToStage(task) (repo-root-relative, normalized). */
  declared: readonly string[];
  /** Initial orphans = actual − declared (repo-root-relative, normalized). */
  orphans: readonly string[];
  /**
   * SHA captured before the LLM run (= commitTask's headBefore). Used to
   * recompute drift after each expand/revert via git.diffNameOnly.
   */
  headBefore: string;
  llm: LlmClient;
  llmInvokeOpts: LlmInvokeOptions;
  git: Git;
  repoRoot: string;
  /** Absolute path to the feature's tasks.md (for the expand mutator). */
  tasksMdPath: string;
  /** Default 2. */
  maxRetries?: number;
}

export type OrphanRalphTerminalReason =
  | 'resolved-expand'
  | 'resolved-revert'
  | 'stuck'
  | 'max-retries-exceeded'
  | 'invalid-intent-budget-exhausted'
  | 'llm-error';

export interface OrphanRalphHistoryEntry {
  attemptNumber: number;
  prompt: string;
  llmStdout?: string;
  llmStderr?: string;
  llmDurationMs?: number;
  parsedIntent?: OrphanIntent;
  /** Set when intent could not be parsed (text is not valid JSON / schema fails). */
  parseError?: string;
  /** Set when intent passed parse but failed semantic validation (e.g. revert files outside orphans). */
  semanticError?: string;
  /** Orphans remaining AFTER this attempt's reducer ran. */
  orphansAfter?: string[];
  llmError?: string;
}

export interface OrphanRalphResult {
  ok: boolean;
  reason: OrphanRalphTerminalReason;
  attempts: number;
  history: OrphanRalphHistoryEntry[];
  /**
   * Final declared list after all expansions (≥ input.declared). On revert-only
   * resolution this equals input.declared.
   */
  finalDeclared: string[];
  /** Final orphans at termination (empty on resolved-*). */
  finalOrphans: string[];
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function runOrphanRalph(
  input: RunOrphanRalphInput,
): Promise<OrphanRalphResult> {
  const max = input.maxRetries ?? 2;
  const history: OrphanRalphHistoryEntry[] = [];
  let declared = input.declared.map(normalizePath);
  let orphans = input.orphans.map(normalizePath);
  let lastResolution: 'expand' | 'revert' | null = null;
  let parseFailuresInARow = 0;
  const MAX_PARSE_FAILURES = 2;

  for (let attempt = 1; attempt <= max; attempt++) {
    const lastEntry = history[history.length - 1];
    const prompt = buildOrphanRalphPrompt({
      task: input.task,
      declared,
      orphans,
      attemptNumber: attempt,
      previousError:
        lastEntry?.parseError ?? lastEntry?.semanticError ?? undefined,
    });
    const entry: OrphanRalphHistoryEntry = { attemptNumber: attempt, prompt };
    history.push(entry);

    let llmResult: LlmInvokeResult;
    try {
      llmResult = await input.llm.invoke(prompt, {
        ...input.llmInvokeOpts,
        // Physical lockdown: the LLM cannot touch files in this loop —
        // intent is consumed by the orchestrator only.
        allowedTools: ['Read'],
        maxTurns: 1,
      });
    } catch (e) {
      entry.llmError = e instanceof Error ? e.message : String(e);
      return {
        ok: false,
        reason: 'llm-error',
        attempts: attempt,
        history,
        finalDeclared: declared,
        finalOrphans: orphans,
      };
    }
    entry.llmStdout = llmResult.stdout;
    entry.llmStderr = llmResult.stderr;
    entry.llmDurationMs = llmResult.durationMs;

    const parsed = extractIntent(llmResult);
    if ('error' in parsed) {
      entry.parseError = parsed.error;
      parseFailuresInARow += 1;
      if (parseFailuresInARow >= MAX_PARSE_FAILURES) {
        return {
          ok: false,
          reason: 'invalid-intent-budget-exhausted',
          attempts: attempt,
          history,
          finalDeclared: declared,
          finalOrphans: orphans,
        };
      }
      continue;
    }
    parseFailuresInARow = 0;
    const intent = parsed.intent;
    entry.parsedIntent = intent;

    if (intent.action === 'stuck') {
      return {
        ok: false,
        reason: 'stuck',
        attempts: attempt,
        history,
        finalDeclared: declared,
        finalOrphans: orphans,
      };
    }

    if (intent.action === 'revert') {
      const normalized = intent.files.map(normalizePath);
      const orphanSet = new Set(orphans);
      const outOfScope = normalized.filter((f) => !orphanSet.has(f));
      if (outOfScope.length > 0) {
        entry.semanticError = `revert.files outside orphans: ${outOfScope.join(', ')}. Only files in the orphan set may be reverted.`;
        continue;
      }
      try {
        await input.git.restore(normalized, { cwd: input.repoRoot });
      } catch (e) {
        entry.semanticError = `git restore failed: ${e instanceof Error ? e.message : String(e)}`;
        continue;
      }
      lastResolution = 'revert';
    } else {
      // expand: orchestrator mutates tasks.md task-meta files array.
      const normalized = intent.files.map(normalizePath);
      try {
        const updated = await applyExpand({
          tasksMdPath: input.tasksMdPath,
          taskId: input.task.id,
          newFiles: normalized,
        });
        declared = updated.declared;
      } catch (e) {
        entry.semanticError = `expand failed: ${e instanceof Error ? e.message : String(e)}`;
        continue;
      }
      lastResolution = 'expand';
    }

    // Recompute drift from ground truth (git index + worktree).
    const actual = await input.git.diffNameOnly(input.headBefore, {
      cwd: input.repoRoot,
    });
    const declaredSet = new Set(declared);
    orphans = actual.map(normalizePath).filter((f) => !declaredSet.has(f));
    entry.orphansAfter = orphans.slice();

    if (orphans.length === 0) {
      return {
        ok: true,
        reason:
          lastResolution === 'revert' ? 'resolved-revert' : 'resolved-expand',
        attempts: attempt,
        history,
        finalDeclared: declared,
        finalOrphans: [],
      };
    }
  }

  return {
    ok: false,
    reason: 'max-retries-exceeded',
    attempts: max,
    history,
    finalDeclared: declared,
    finalOrphans: orphans,
  };
}

// ---------------------------------------------------------------------------
// Intent extraction
// ---------------------------------------------------------------------------

type IntentExtractResult = { intent: OrphanIntent } | { error: string };

export function extractIntent(result: LlmInvokeResult): IntentExtractResult {
  // claude-cli with --output-format=json wraps the model's reply in a
  // metadata envelope under `result` (string) or, in some versions, an
  // object. We accept both, and also accept raw stdout that's already JSON
  // (for FakeLlmClient tests that script the response directly).
  const candidates: string[] = [];
  if (result.parsed && typeof result.parsed === 'object') {
    const r = (result.parsed as { result?: unknown }).result;
    if (typeof r === 'string') candidates.push(r);
    else if (r && typeof r === 'object') candidates.push(JSON.stringify(r));
  }
  candidates.push(result.stdout);

  for (const text of candidates) {
    const jsonText = stripFences(text).trim();
    if (jsonText.length === 0) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(jsonText);
    } catch {
      continue;
    }
    const safe = OrphanIntentSchema.safeParse(raw);
    if (safe.success) return { intent: safe.data };
    return {
      error: `intent JSON did not match schema: ${safe.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ')}`,
    };
  }
  return { error: 'no parseable JSON intent in LLM output' };
}

/** Strip ```json fences if the model wrapped its reply. Tolerant: returns
 *  input unchanged when no fence is found. */
function stripFences(text: string): string {
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  return fence ? fence[1] : text;
}

// ---------------------------------------------------------------------------
// tasks.md expand mutator (orchestrator-side reducer)
// ---------------------------------------------------------------------------

interface ApplyExpandInput {
  tasksMdPath: string;
  taskId: string;
  newFiles: string[]; // already normalized; classifier-relative paths
}

interface ApplyExpandResult {
  declared: string[];
}

/**
 * Read tasks.md, find the task-meta JSON5 block for `taskId`, merge
 * `newFiles` into `task-meta.files` (op: 'modify' for each new entry),
 * re-validate via Zod, and persist. Throws on any failure (caller's
 * try/catch turns it into a ralph retry).
 */
export async function applyExpand(
  input: ApplyExpandInput,
): Promise<ApplyExpandResult> {
  const content = await fs.readFile(input.tasksMdPath, 'utf-8');

  // Same anchored regex as the parser, but per-task so we only touch this
  // task's block. Capture the JSON5 body for surgical replacement.
  const escaped = input.taskId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const blockRegex = new RegExp(
    `(^-\\s+\\[[ X]\\]\\s+${escaped}\\b[^\\n]*\\n\\s*<!--\\s*task-meta:\\s*)([\\s\\S]*?)(\\s*-->)`,
    'm',
  );
  const m = blockRegex.exec(content);
  if (!m) {
    throw new Error(`task-meta block for ${input.taskId} not found`);
  }
  const [, before, metaRaw, after] = m;

  const meta = parseJson5(metaRaw, TaskMetaSchema);
  const existingPaths = new Set(meta.files.map((f) => f.path));
  const additions: TaskFileOp[] = [];
  for (const f of input.newFiles) {
    if (!existingPaths.has(f)) {
      additions.push({ path: f, op: 'modify' });
      existingPaths.add(f);
    }
  }
  if (additions.length === 0) {
    return { declared: declaredOf(meta.files) };
  }
  const updatedMeta = { ...meta, files: [...meta.files, ...additions] };
  // Validate the result still satisfies the schema (catches programmer error).
  const validated = TaskMetaSchema.parse(updatedMeta);

  const newMetaRaw = JSON.stringify(validated);
  const newBlock = `${before}${newMetaRaw}${after}`;
  const newContent = content.replace(blockRegex, newBlock);
  await fs.writeFile(input.tasksMdPath, newContent);

  return { declared: declaredOf(validated.files) };
}

function declaredOf(files: ReadonlyArray<TaskFileOp>): string[] {
  return files
    .filter((f) => f.op !== 'delete')
    .map((f) =>
      f.op === 'rename' && f.rename_to ? f.rename_to : f.path,
    )
    .map(normalizePath);
}

// ---------------------------------------------------------------------------
// Prompt template
// ---------------------------------------------------------------------------

interface PromptInput {
  task: ParsedTask;
  declared: readonly string[];
  orphans: readonly string[];
  attemptNumber: number;
  previousError?: string;
}

export function buildOrphanRalphPrompt(input: PromptInput): string {
  const lines: string[] = [];
  lines.push(
    `Task ${input.task.id} (${input.task.kind}) — your verify_command passed (tests are green), but you modified files outside the declared task.files whitelist.`,
  );
  lines.push('');
  lines.push(
    'The orchestrator will only auto-stage your declared files. The files below are currently orphaned in the working tree and will block this task unless you justify them.',
  );
  lines.push('');
  lines.push('## Declared task.files');
  for (const f of input.declared) lines.push(`- ${f}`);
  lines.push('');
  lines.push('## Orphans (touched but not declared)');
  for (const f of input.orphans) lines.push(`- ${f}`);
  lines.push('');
  if (input.previousError) {
    lines.push(`## Previous attempt failed: ${input.previousError}`);
    lines.push('');
  }
  lines.push('## Respond with exactly one JSON intent (no prose, no fences)');
  lines.push('');
  lines.push('Choose ONE of:');
  lines.push('');
  lines.push(
    '(A) Expand — orphans are a legitimate ripple of your declared work; add them to the task scope:',
  );
  lines.push(
    '    {"action":"expand","files":["packages/foo/src/gen/a.ts","packages/foo/src/gen/b.ts"],"rationale":"openapi-ts emitted these alongside the declared barrel"}',
  );
  lines.push('');
  lines.push(
    '(B) Revert — orphans are hallucinations or unwanted side effects; discard them:',
  );
  lines.push(
    '    {"action":"revert","files":["apps/server/src/wrong-file.ts"],"rationale":"unrelated edit, undo"}',
  );
  lines.push('');
  lines.push(
    '(C) Stuck — you cannot decide and need a human (halts the entire feature run):',
  );
  lines.push('    {"action":"stuck","reason":"<one short sentence>"}');
  lines.push('');
  lines.push('Constraints:');
  lines.push(
    '- revert.files MUST be a subset of the orphan list above; out-of-scope reverts are rejected and burn a retry.',
  );
  lines.push(
    '- This is attempt ' +
      input.attemptNumber +
      '. You have a small retry budget; choose carefully.',
  );
  lines.push(
    '- DO NOT edit code in this turn. Only the JSON intent is read by the orchestrator.',
  );
  return lines.join('\n');
}
