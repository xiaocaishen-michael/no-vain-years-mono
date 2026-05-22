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
