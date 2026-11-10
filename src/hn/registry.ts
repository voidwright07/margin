import { parseQuery } from '../search/query';
import { commentRows, parseComments } from './comments';
import { parseItem } from './item';
import { parseMeta } from './meta';
import { parseStories } from './stories';
import type { Page, PageKind } from './types';
import { parseUser } from './user';

type Detector = { kind: PageKind; test(doc: Document, url: URL): boolean; parse(doc: Document, url: URL): Page };

/**
 * HN has no /search page; it answers with a bare "Unknown.", which Margin turns into its search page. This is
 * the one detector that reads the URL path, and only together with that body.
 */
const isSearch = (doc: Document, url: URL) => url.pathname === '/search' && doc.body?.textContent?.trim() === 'Unknown.';

/** Routing by DOM shape, not URL path (search is the one exception). First match wins; passthrough always matches. */
export const detectors: readonly Detector[] = [
  { kind: 'item', test: (d) => d.querySelector('table.fatitem tr.athing') !== null, parse: parseItem },
  { kind: 'user', test: (d) => d.querySelector('tr.athing td[timestamp]') !== null, parse: parseUser },
  { kind: 'comments', test: (d) => commentRows(d).length > 0, parse: parseComments },
  { kind: 'stories', test: (d) => d.querySelector('tr.athing.submission') !== null, parse: parseStories },
  { kind: 'search', test: isSearch, parse: (d, url) => ({ kind: 'search', meta: parseMeta(d, url), query: parseQuery(url.searchParams) }) },
  { kind: 'passthrough', test: () => true, parse: (d, url) => ({ kind: 'passthrough', meta: parseMeta(d, url) }) },
];

export const parsePage = (doc: Document, url: URL): Page => detectors.find((d) => d.test(doc, url))!.parse(doc, url);
