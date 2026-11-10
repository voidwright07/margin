import {
  SEARCH_RANGES,
  SEARCH_SORTS,
  SEARCH_TYPES,
  type Href,
  type SearchQuery,
  type SearchRange,
  type SearchType,
} from '../hn/types';

export const DEFAULT_QUERY: SearchQuery = { q: '', type: 'story', sort: 'popularity', range: 'all', page: 1, author: null, site: null };

const oneOf = <T extends string>(all: readonly T[], raw: string | null, fallback: T): T =>
  (all as readonly string[]).includes(raw ?? '') ? (raw as T) : fallback;

const nonEmpty = (raw: string | null): string | null => {
  const t = raw?.trim();
  return t ? t : null;
};

/** The URL boundary: any searchParams become a complete query, with defaults for whatever is missing or invalid. */
export const parseQuery = (params: URLSearchParams): SearchQuery => {
  const page = Number(params.get('p'));
  return {
    q: params.get('q') ?? '',
    type: oneOf(SEARCH_TYPES, params.get('type'), DEFAULT_QUERY.type),
    sort: oneOf(SEARCH_SORTS, params.get('sort'), DEFAULT_QUERY.sort),
    range: oneOf(SEARCH_RANGES, params.get('range'), DEFAULT_QUERY.range),
    page: Number.isInteger(page) && page > 1 ? page : 1,
    author: nonEmpty(params.get('author')),
    site: nonEmpty(params.get('site')),
  };
};

/** Margin's own URL for a query, defaults left out so links stay short. */
export const toUrl = (query: SearchQuery): Href => {
  const p = new URLSearchParams();
  if (query.q) p.set('q', query.q);
  if (query.type !== DEFAULT_QUERY.type) p.set('type', query.type);
  if (query.sort !== DEFAULT_QUERY.sort) p.set('sort', query.sort);
  if (query.range !== DEFAULT_QUERY.range) p.set('range', query.range);
  if (query.author) p.set('author', query.author);
  if (query.site) p.set('site', query.site);
  if (query.page > 1) p.set('p', String(query.page));
  const s = p.toString();
  return (s ? `search?${s}` : 'search') as Href;
};

/** True when there is nothing to search for yet. */
export const isBlank = (query: SearchQuery): boolean => !query.q.trim() && !query.author && !query.site;

const TYPE_TAG: Record<SearchType, string | null> = {
  story: 'story',
  comment: 'comment',
  ask_hn: 'ask_hn',
  show_hn: 'show_hn',
  job: 'job',
  all: null,
};

const DAY = 24 * 60 * 60;
const RANGE_SECONDS: Record<Exclude<SearchRange, 'all'>, number> = { day: DAY, week: 7 * DAY, month: 30 * DAY, year: 365 * DAY };

export const ALGOLIA_API = 'https://hn.algolia.com/api/v1/';

/**
 * The Algolia request for a query. `now` is unix seconds, so date ranges stay testable. A site filter searches
 * story URLs (restrictSearchableAttributes=url), the way hn.algolia.com does for HN's `from?site=`, so any
 * words typed alongside it must appear in the URL too.
 */
export const toAlgolia = (query: SearchQuery, now: number): string => {
  const url = new URL(query.sort === 'date' ? 'search_by_date' : 'search', ALGOLIA_API);
  const p = url.searchParams;
  p.set('query', [query.site, query.q.trim()].filter(Boolean).join(' '));
  const tags = [TYPE_TAG[query.type], query.author && `author_${query.author}`].filter(Boolean);
  if (tags.length) p.set('tags', tags.join(','));
  if (query.site) p.set('restrictSearchableAttributes', 'url');
  if (query.range !== 'all') p.set('numericFilters', `created_at_i>${now - RANGE_SECONDS[query.range]}`);
  if (query.page > 1) p.set('page', String(query.page - 1));
  return url.href;
};

const WEB_RANGE: Record<SearchRange, string> = { all: 'all', day: 'last24h', week: 'pastWeek', month: 'pastMonth', year: 'pastYear' };

/** The same search on hn.algolia.com's own site, for "Open on Algolia" and for readers using the original design. */
export const toAlgoliaWeb = (query: SearchQuery): string => {
  const url = new URL('https://hn.algolia.com/');
  const p = url.searchParams;
  p.set('query', [query.q.trim(), query.author && `author:${query.author}`, query.site].filter(Boolean).join(' '));
  p.set('type', query.type);
  p.set('sort', query.sort === 'date' ? 'byDate' : 'byPopularity');
  p.set('dateRange', WEB_RANGE[query.range]);
  p.set('page', String(query.page - 1));
  return url.href;
};
