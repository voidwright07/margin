import { commentRows, parseComments } from './comments';
import { parseItem } from './item';
import { parseMeta } from './meta';
import { parseStories } from './stories';
import type { Page, PageKind } from './types';
import { parseUser } from './user';

type Detector = { kind: PageKind; test(doc: Document): boolean; parse(doc: Document, url: URL): Page };

/** Routing by DOM shape, never by URL path. First match wins; passthrough always matches. */
export const detectors: readonly Detector[] = [
  { kind: 'item', test: (d) => d.querySelector('table.fatitem tr.athing') !== null, parse: parseItem },
  { kind: 'user', test: (d) => d.querySelector('tr.athing td[timestamp]') !== null, parse: parseUser },
  { kind: 'comments', test: (d) => commentRows(d).length > 0, parse: parseComments },
  { kind: 'stories', test: (d) => d.querySelector('tr.athing.submission') !== null, parse: parseStories },
  { kind: 'passthrough', test: () => true, parse: (d, url) => ({ kind: 'passthrough', meta: parseMeta(d, url) }) },
];

export const parsePage = (doc: Document, url: URL): Page => detectors.find((d) => d.test(doc))!.parse(doc, url);
