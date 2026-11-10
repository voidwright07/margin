import type { RefObject } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { fetchListPage, type ListKind } from '../app/hn-client';
import { autoLoads, beginLoad, cancelLoad, canonical, feedOf, pageNumberOf, settle, type Feed, type FeedItems, type FeedKind, type FeedPage, type Outcome } from '../feed/feed';
import { fromSnapshot, parseSnapshot, toSnapshot } from '../feed/restore';
import { cameBack, ensureEntryId, entryId, readFeed, writeFeed } from '../feed/session';
import type { Href, PageMeta } from '../hn/types';
import { FEED_MORE_EVENT } from './keyboard';

/** How far below the screen the bottom of the list starts the next load. */
const LOOKAHEAD_PX = 1200;
/** The shortest pause between two pages loaded without the reader asking. */
const GAP_MS = 1000;
const MARKS = '#margin-root [data-mg-page]';

export type Loader<T> = (href: Href, signal: AbortSignal) => Promise<Outcome<T>>;

export type FeedControl<T> = {
  feed: Feed<T>;
  /** The reader asked for the next page: a button, Retry, `j` past the end or `]`. */
  loadMore: () => void;
  /** The element at the bottom of the list. Nearing it loads the next page. */
  sentinel: RefObject<HTMLDivElement | null>;
};

const here = (): Href => canonical(location.href, location.href);

/** Only the first feed to mount after a Back navigation may restore; later ones (a new search) start fresh. */
let restoreTried = false;

const initialFeed = <K extends FeedKind>(kind: K, enabled: boolean, first: FeedPage<FeedItems[K]>, next: Href | null) => {
  const start = { feed: feedOf([first], next), scrollY: null as number | null };
  if (!enabled || restoreTried) return start;
  restoreTried = true;
  const id = entryId();
  const snap = id !== null && cameBack() ? parseSnapshot(readFeed(id), { kind, here: here(), now: Date.now() }) : null;
  return snap ? { feed: fromSnapshot(snap, first.items), scrollY: snap.scrollY } : start;
};

/** The page whose marker is in the top third of the screen, or the first page above every marker. */
const pageInView = (): string | undefined => {
  const marks = Array.from(document.querySelectorAll<HTMLElement>(MARKS));
  let href = marks[0]?.dataset.href;
  for (const m of marks) {
    if (m.getBoundingClientRect().top > innerHeight / 3) break;
    href = m.dataset.href;
  }
  return href;
};

/**
 * Infinite scroll for one list. The pure transitions live in `feed/feed.ts`; this hook performs the effects:
 * it fetches one page at a time when the reader nears the bottom, keeps the address bar on the page in view,
 * and saves the feed for Back. Nothing loads until the reader scrolls, so opening a page costs HN one request.
 */
export function useFeed<K extends FeedKind>(
  kind: K,
  enabled: boolean,
  first: FeedPage<FeedItems[K]>,
  next: Href | null,
  load: Loader<FeedItems[K]>,
): FeedControl<FeedItems[K]> {
  type T = FeedItems[K];
  const [init] = useState(() => initialFeed(kind, enabled, first, next));
  const [feed, setFeed] = useState(init.feed);
  const sentinel = useRef<HTMLDivElement>(null);
  const live = useRef({
    feed: init.feed,
    load,
    enabled,
    armed: init.scrollY !== null,
    restoreY: init.scrollY,
    lastSettled: 0,
    timer: undefined as ReturnType<typeof setTimeout> | undefined,
    inflight: null as AbortController | null,
  }).current;
  live.load = load;
  live.enabled = enabled;

  const apply = (f: (feed: Feed<T>) => Feed<T>) => {
    live.feed = f(live.feed);
    setFeed(live.feed);
  };

  const start = () => {
    const loading = beginLoad(live.feed, Date.now());
    if (loading === live.feed || loading.tail.status !== 'loading') return;
    const href = loading.tail.next;
    apply(() => loading);
    const ctrl = new AbortController();
    live.inflight = ctrl;
    const finish = (outcome: Outcome<T>) => {
      if (ctrl.signal.aborted) return;
      live.inflight = null;
      live.lastSettled = Date.now();
      apply((f) => settle(f, href, outcome, Date.now()));
    };
    live.load(href, ctrl.signal).then(finish, (e: unknown) => finish({ type: 'error', message: e instanceof Error ? e.message : String(e) }));
  };

  const near = () => {
    const el = sentinel.current;
    return el !== null && el.getBoundingClientRect().top < innerHeight + LOOKAHEAD_PX;
  };

  const maybeAuto = () => {
    clearTimeout(live.timer);
    if (!live.enabled || !live.armed || document.hidden || !autoLoads(live.feed) || !near()) return;
    const wait = live.lastSettled + GAP_MS - Date.now();
    if (wait > 0) live.timer = setTimeout(maybeAuto, wait);
    else start();
  };

  useEffect(() => {
    if (!enabled) {
      // Turned off with a later page in the address bar: only page one is shown now, so name it.
      if (here() !== first.href) history.replaceState(history.state, '', `/${first.href}`);
      return;
    }
    // The entry is looked up on every save: a search can push a new entry under the same mounted feed.
    const save = () => writeFeed(ensureEntryId(), toSnapshot(kind, live.feed, Math.round(scrollY), Date.now()));
    // Restore the offset once; turning the setting off and on again must not jump back.
    const y = live.restoreY;
    live.restoreY = null;
    if (y !== null) {
      scrollTo(0, y);
      // The browser may restore its own idea of the offset when loading finishes; ours wins.
      if (document.readyState !== 'complete') addEventListener('load', () => scrollTo(0, y), { once: true });
    }

    let frame = 0;
    const onScroll = () => {
      live.armed = true;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        // Hrefs are HN-relative, and the front page's is '' (it lives at `/`).
        const href = pageInView();
        if (href !== undefined && href !== here()) history.replaceState(history.state, '', `/${href}`);
        maybeAuto();
      });
    };
    const onVisibility = () => (document.hidden ? save() : maybeAuto());
    const io = new IntersectionObserver(() => maybeAuto(), { rootMargin: `0px 0px ${LOOKAHEAD_PX}px 0px` });
    if (sentinel.current) io.observe(sentinel.current);
    addEventListener('scroll', onScroll, { passive: true });
    addEventListener('pagehide', save);
    document.addEventListener('visibilitychange', onVisibility);
    // A held `j` repeats; after a failed page it may retry at most once a second.
    const onMoreKey = () => {
      if (Date.now() - live.lastSettled >= GAP_MS) start();
    };
    document.addEventListener(FEED_MORE_EVENT, onMoreKey);
    return () => {
      io.disconnect();
      cancelAnimationFrame(frame);
      clearTimeout(live.timer);
      removeEventListener('scroll', onScroll);
      removeEventListener('pagehide', save);
      document.removeEventListener('visibilitychange', onVisibility);
      document.removeEventListener(FEED_MORE_EVENT, onMoreKey);
      live.inflight?.abort();
      live.inflight = null;
      apply(cancelLoad);
    };
  }, [enabled]);

  // Each settled page is saved at once, and the next one may follow if the bottom is still close.
  useEffect(() => {
    if (!enabled || feed.tail.status === 'loading') return;
    writeFeed(ensureEntryId(), toSnapshot(kind, feed, Math.round(scrollY), Date.now()));
    maybeAuto();
  }, [feed, enabled]);

  return { feed, loadMore: start, sentinel };
}

/** Infinite scroll for an HN story or comment list, continuing at the page's More link. */
export function useListFeed<K extends ListKind>(kind: K, enabled: boolean, meta: PageMeta, items: FeedItems[K][], more: Href | null) {
  const [first] = useState(() => ({ href: canonical(meta.url.href, meta.url), number: pageNumberOf(meta.url), items }));
  return useFeed(kind, enabled, first, more === null ? null : canonical(more, meta.url), (href, signal) => fetchListPage(kind, href, signal));
}
