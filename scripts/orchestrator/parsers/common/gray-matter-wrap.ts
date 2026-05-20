import matter from 'gray-matter';

export interface FrontmatterRaw {
  data: Record<string, unknown>;
  body: string;
}

/**
 * Read frontmatter as raw record + body markdown.
 * Caller validates via its own Zod schema (avoids the generic `z.ZodType<T>` ↔
 * `z.preprocess` input/output asymmetry in Zod 3.25).
 */
export function parseFrontmatterRaw(fileContent: string): FrontmatterRaw {
  const { data, content } = matter(fileContent);
  return { data: data as Record<string, unknown>, body: content };
}
