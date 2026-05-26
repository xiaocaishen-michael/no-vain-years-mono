import { z } from 'zod';

/**
 * YAML date coercion: `2026-05-20` (unquoted) → JS `Date` via js-yaml.
 * Coerce back to `YYYY-MM-DD` string so schemas stay declarative.
 */
export const IsoDateString = z.preprocess(
  (val) => {
    if (val instanceof Date) {
      const yyyy = val.getUTCFullYear();
      const mm = String(val.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(val.getUTCDate()).padStart(2, '0');
      return `${yyyy}-${mm}-${dd}`;
    }
    return val;
  },
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
);

/**
 * Drop `_`-prefixed keys from an object before schema validation. Lets authors
 * leave human-readable `_note` annotations inside an otherwise machine-read
 * `z.record(...)` (whose value schema would otherwise reject the note string).
 * Plain `unknown → unknown` — keep it out of generic Zod wrappers so `z.record`
 * inference stays concrete (z.preprocess + generics erases to `unknown`).
 * Forward-compat invariant per orchestrator-command-parity p1 §2.1.
 */
export function stripUnderscoreKeys(val: unknown): unknown {
  if (val && typeof val === 'object' && !Array.isArray(val)) {
    return Object.fromEntries(
      Object.entries(val as Record<string, unknown>).filter(([k]) => !k.startsWith('_')),
    );
  }
  return val;
}
