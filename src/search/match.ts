/**
 * Search-term highlighting over plain text. Results never use Algolia's _highlightResult HTML: the text is
 * split into segments here and the UI renders each one as a text node, matches inside <mark>.
 */

export type Segment = { text: string; match: boolean };

const EDGE = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;

/** Words worth highlighting: quotes and edge punctuation dropped, single letters skipped, longest first. */
export const searchTerms = (q: string): string[] => {
  const seen = new Map<string, string>();
  for (const raw of q.split(/\s+/)) {
    const t = raw.replace(EDGE, '');
    if (t.length > 1 && !seen.has(t.toLowerCase())) seen.set(t.toLowerCase(), t);
  }
  return [...seen.values()].sort((a, b) => b.length - a.length);
};

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Algolia matches words by prefix, so a term matches at the start of a word: "rust" marks "Rustacean", not "trust". */
const matcher = (terms: string[]): RegExp | null =>
  terms.length ? new RegExp(`(?<![\\p{L}\\p{N}])(?:${terms.map(escape).join('|')})`, 'giu') : null;

export const markTerms = (text: string, terms: string[]): Segment[] => {
  const re = matcher(terms);
  if (!re || !text) return text ? [{ text, match: false }] : [];
  const out: Segment[] = [];
  let at = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > at) out.push({ text: text.slice(at, m.index), match: false });
    out.push({ text: m[0], match: true });
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push({ text: text.slice(at), match: false });
  return out;
};

/**
 * Start a long text shortly before its first match, at a word boundary, so a clamped excerpt shows why the
 * hit matched. Text without a match, or with one near the start, is returned unchanged.
 */
export const excerptAt = (text: string, terms: string[], lead = 80): string => {
  const re = matcher(terms);
  const first = re ? (re.exec(text)?.index ?? -1) : -1;
  if (first <= lead) return text;
  const space = text.lastIndexOf(' ', first - lead);
  const from = space === -1 ? first - lead : space + 1;
  return `…${text.slice(from)}`;
};
