import JSON5 from 'json5';
import { z } from 'zod';

/**
 * Three-layer parse pipeline for LLM-emitted JSON-ish payloads.
 *
 * Layer 1: textual cleanse (markdown fence strip + smart-quote → ASCII).
 * Layer 2: json5.parse (tolerates trailing comma, single quotes, unquoted keys, line comments).
 * Layer 3: Zod schema validation.
 *
 * On any failure, throws an Error with the input slice for diagnostic — orchestrator
 * Ralph-loop catches and feeds back to LLM for rewrite (per plan §5.1.6 + §5.2.18).
 */
export function parseJson5<T>(raw: string, schema: z.ZodType<T>): T {
  const cleaned = raw
    .replace(/```\w*\s*/g, '')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON5.parse(cleaned);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`[json5] parse failed: ${msg}\nInput: ${truncate(cleaned)}`);
  }

  return schema.parse(parsed);
}

/**
 * Inline cleanse without schema — for callers that need raw object first
 * (e.g. when delegating schema validation to a refinement step).
 */
export function cleanseJson5(raw: string): unknown {
  const cleaned = raw
    .replace(/```\w*\s*/g, '')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .trim();
  try {
    return JSON5.parse(cleaned);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`[json5] parse failed: ${msg}\nInput: ${truncate(cleaned)}`);
  }
}

function truncate(s: string, limit = 200): string {
  return s.length > limit ? `${s.slice(0, limit)}…` : s;
}
