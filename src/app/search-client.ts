import type { SearchResult } from '../hn/types';
import { parseSearchResponse } from '../search/response';

/**
 * The extension's one request outside news.ycombinator.com. hn.algolia.com answers the HN origin with
 * access-control-allow-origin, so this needs no extra permission, and it sends no cookies.
 */

export type SearchFailure = 'rate-limited' | 'http' | 'network' | 'bad-response';

export class SearchError extends Error {
  constructor(readonly failure: SearchFailure, message: string) {
    super(message);
  }
}

export const fetchSearch = async (apiUrl: string, signal: AbortSignal): Promise<SearchResult> => {
  let res: Response;
  try {
    res = await fetch(apiUrl, { signal, credentials: 'omit' });
  } catch (e) {
    if (signal.aborted) throw e;
    throw new SearchError('network', 'Could not reach hn.algolia.com.');
  }
  if (res.status === 429) throw new SearchError('rate-limited', 'hn.algolia.com is limiting requests.');
  if (!res.ok) throw new SearchError('http', `hn.algolia.com answered ${res.status}.`);
  try {
    return parseSearchResponse(await res.json());
  } catch (e) {
    if (signal.aborted) throw e;
    throw new SearchError('bad-response', 'hn.algolia.com sent a response Margin could not read.');
  }
};
