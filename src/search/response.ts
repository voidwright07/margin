import type { CommentHit, SearchResult, StoryHit } from '../hn/types';

export class BadResponse extends Error {}

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/**
 * HN markup (as Algolia stores comment_text and story_text) to plain text. Hits render as text nodes, so
 * nothing from the response is ever parsed as HTML on the page.
 */
export const htmlToText = (html: string): string =>
  html
    .replace(/<p>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
      if (code[0] !== '#') return NAMED[code.toLowerCase()] ?? whole;
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : whole;
    })
    .trim();

type Raw = Record<string, unknown>;

const isObject = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

const parseHit = (h: Raw): StoryHit | CommentHit | null => {
  const id = Number(h.objectID);
  const created = num(h.created_at_i);
  const author = str(h.author);
  if (!Number.isInteger(id) || id <= 0 || created === null || author === null) return null;
  const tags = Array.isArray(h._tags) ? h._tags : [];
  if (tags.includes('comment')) {
    const storyId = num(h.story_id);
    const text = str(h.comment_text);
    if (storyId === null || text === null) return null;
    return { type: 'comment', id, author, created, text: htmlToText(text), storyId, storyTitle: str(h.story_title) };
  }
  const title = str(h.title);
  if (title === null) return null;
  const text = str(h.story_text);
  return {
    type: 'story',
    id,
    title,
    url: str(h.url),
    author,
    points: num(h.points),
    comments: num(h.num_comments),
    created,
    text: text === null ? null : htmlToText(text) || null,
  };
};

/**
 * The Algolia boundary. Throws BadResponse when the envelope is not a search response; drops single hits
 * Margin cannot show (poll options, half-deleted items) rather than failing the page.
 */
export const parseSearchResponse = (json: unknown): SearchResult => {
  if (!isObject(json) || !Array.isArray(json.hits)) throw new BadResponse('Not a search response.');
  const total = num(json.nbHits);
  const page = num(json.page);
  const pages = num(json.nbPages);
  if (total === null || page === null || pages === null) throw new BadResponse('Search response is missing its counts.');
  return {
    hits: json.hits.flatMap((h) => {
      const hit = isObject(h) ? parseHit(h) : null;
      return hit ? [hit] : [];
    }),
    total,
    page: page + 1,
    pages,
  };
};
