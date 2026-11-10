import { createContext } from 'preact';
import { useContext, useEffect, useRef, useState } from 'preact/hooks';
import { fetchSearch, SearchError, type SearchFailure } from '../app/search-client';
import type { Outcome } from '../feed/feed';
import type { CommentHit, Href, SearchQuery, SearchResult, StoryHit } from '../hn/types';
import { isBlank, parseQuery, toAlgolia, toUrl } from '../search/query';

/** What the results area shows. Empty results are `ready` with no hits. */
export type Load =
  | { status: 'idle' }
  | { status: 'loading'; stale: SearchResult | null }
  /** `query` is the search that produced `result`; the field may already hold a newer draft. */
  | { status: 'ready'; result: SearchResult; query: SearchQuery }
  | { status: 'failed'; failure: SearchFailure; message: string };

export type Search = {
  query: SearchQuery;
  load: Load;
  /** Typing: the field updates now; the URL (replaceState) and the request follow after a pause. */
  type: (q: string) => void;
  /** A deliberate search (Enter, a filter, a page link): pushes a history entry and searches now. */
  go: (next: SearchQuery) => void;
  retry: () => void;
};

/** Present only on the search page; the header field reads it to decide whether it drives live results. */
export const SearchContext = createContext<Search | null>(null);
export const useSearch = () => useContext(SearchContext);

const DEBOUNCE_MS = 300;
const here = () => location.pathname.slice(1) + location.search;
const results = new Map<string, SearchResult>();

/** The page after `r`, as infinite scroll continues it. */
export const searchNext = (q: SearchQuery, r: SearchResult): Href | null => (r.page < r.pages ? toUrl({ ...q, page: r.page + 1 }) : null);

/**
 * One more page of results for infinite scroll, through the same cache as the page itself. `href` is Margin's
 * own `search?…` URL for that page.
 */
export const loadSearchPage = async (href: Href, signal: AbortSignal): Promise<Outcome<StoryHit | CommentHit>> => {
  const q = parseQuery(new URL(href, location.href).searchParams);
  const key = toUrl(q);
  let result = results.get(key);
  if (!result) {
    try {
      result = await fetchSearch(toAlgolia(q, Math.floor(Date.now() / 1000)), signal);
    } catch (e) {
      if (signal.aborted) throw e;
      if (e instanceof SearchError && e.failure === 'rate-limited') return { type: 'rate-limited' };
      return { type: 'error', message: e instanceof Error ? e.message : String(e) };
    }
    results.set(key, result);
  }
  return { type: 'page', items: result.hits, next: searchNext(q, result) };
};

/**
 * History model: `committed` is the URL of the last entry the user deliberately made. Typing replaces the
 * current entry with a draft URL so it stays shareable; a deliberate search restores the committed URL on that
 * entry and pushes the new one, so Back returns to the previous search rather than to a half-typed draft.
 */
export function useSearchController(initial: SearchQuery): Search {
  const [query, setQueryState] = useState(initial);
  const [load, setLoad] = useState<Load>(isBlank(initial) ? { status: 'idle' } : { status: 'loading', stale: null });
  const current = useRef(initial);
  const committed = useRef(toUrl(initial));
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const inflight = useRef<AbortController | null>(null);

  const setQuery = (q: SearchQuery) => {
    current.current = q;
    setQueryState(q);
  };

  const run = (q: SearchQuery, fresh = false) => {
    inflight.current?.abort();
    inflight.current = null;
    if (isBlank(q)) return setLoad({ status: 'idle' });
    const key = toUrl(q);
    const cached = fresh ? undefined : results.get(key);
    if (cached) return setLoad({ status: 'ready', result: cached, query: q });
    const ctrl = new AbortController();
    inflight.current = ctrl;
    setLoad((prev) => ({ status: 'loading', stale: prev.status === 'ready' ? prev.result : prev.status === 'loading' ? prev.stale : null }));
    fetchSearch(toAlgolia(q, Math.floor(Date.now() / 1000)), ctrl.signal).then(
      (result) => {
        if (ctrl.signal.aborted) return;
        results.set(key, result);
        setLoad({ status: 'ready', result, query: q });
      },
      (e: unknown) => {
        if (ctrl.signal.aborted) return;
        setLoad(e instanceof SearchError ? { status: 'failed', failure: e.failure, message: e.message } : { status: 'failed', failure: 'network', message: String(e) });
      },
    );
  };

  useEffect(() => {
    if (here() !== committed.current) history.replaceState(history.state, '', committed.current);
    run(initial);
    const onPop = () => {
      clearTimeout(timer.current);
      const q = parseQuery(new URLSearchParams(location.search));
      committed.current = toUrl(q);
      setQuery(q);
      run(q);
    };
    addEventListener('popstate', onPop);
    return () => {
      removeEventListener('popstate', onPop);
      clearTimeout(timer.current);
      inflight.current?.abort();
    };
  }, []);

  return {
    query,
    load,
    type: (q) => {
      const next = { ...current.current, q, page: 1 };
      setQuery(next);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        history.replaceState(history.state, '', toUrl(next));
        run(next);
      }, DEBOUNCE_MS);
    },
    go: (next) => {
      clearTimeout(timer.current);
      const url = toUrl(next);
      if (url !== committed.current) {
        history.replaceState(history.state, '', committed.current);
        history.pushState(null, '', url);
        committed.current = url;
      } else if (here() !== url) {
        history.replaceState(history.state, '', url);
      }
      if (next.page !== current.current.page) scrollTo({ top: 0 });
      setQuery(next);
      run(next);
    },
    retry: () => run(current.current, true),
  };
}
