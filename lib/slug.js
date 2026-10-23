/**
 * Slug derivation for feature branch names. Pure, no LLM calls: the slug is
 * either provided explicitly (user/human-directed) or derived mechanically
 * from the task summary the main agent already produced.
 */

// NOTE: CJK text is split per-character before filtering, so multi-char CJK
// stopwords can never match; only single-char/latin stopwords are listed.
const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'for', 'to', 'of', 'in', 'on', 'with',
  'add', 'make', 'build', 'create', 'implement', 'fix', 'update',
  'improve', 'refactor', 'enable', 'allow', 'let', 'should', 'must', 'need',
  'needs', 'want', 'wants', 'please', '一个', '的', '了',
]);

/** Keep only CJK chars, letters, digits, hyphens; kebab-case; cap length. */
export function slugify(input, { maxWords = 6, maxLength = 64 } = {}) {
  const words = String(input ?? '')
    .toLowerCase()
    // Treat each CJK char as its own word; split latin on non-alphanumeric.
    .replace(/[\u4e00-\u9fff]/g, (c) => ` ${c} `)
    .split(/[^a-z0-9\u4e00-\u9fff]+/)
    .filter((w) => w.length > 0 && !STOPWORDS.has(w));
  const capped = words.slice(0, maxWords).join('-').slice(0, maxLength);
  return capped.replace(/^-+|-+$/g, '');
}

/** Resolve the branch slug: explicit slug wins, else derive from the task. */
export function branchSlug({ slug, taskSummary } = {}) {
  const explicit = slugify(slug ?? '', { maxWords: 8 });
  if (explicit) return explicit;
  const derived = slugify(taskSummary ?? '');
  if (derived) return derived;
  return 'feature';
}
