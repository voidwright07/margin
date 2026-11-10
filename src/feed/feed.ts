import type { Comment, CommentHit, Href, Story, StoryHit } from '../hn/types';

/**
 * Infinite scroll as data. A feed is the pages shown so far plus a tail that says what happens at the bottom.
 * Every transition is a pure function; the UI hook only performs the effects (fetch, observe, persist).
 */

/** The lists a feed can continue, and what each one holds. Search continues through Algolia, the others through HN. */
export type FeedItems = { stories: Story; comments: Comment; search: StoryHit | CommentHit };
export type FeedKind = keyof FeedItems;

export type FeedPage<T> = { href: Href; number: number; items: T[] };

/** `next` exists exactly when there is somewhere to go, so an ended feed cannot hold a link to load. */
export type Tail =
  | { status: 'idle'; next: Href }
  | { status: 'loading'; next: Href }
  | { status: 'error'; next: Href; message: string }
  | { status: 'rate-limited'; next: Href; retryAt: number }
  | { status: 'end' };

export type Feed<T> = {
  /** Never empty. The first page is the one the browser loaded (or restored). */
  pages: FeedPage<T>[];
  tail: Tail;
  /** Rate limits in a row. Each one doubles the wait before Retry works; a loaded page resets it. */
  strikes: number;
};

/** What loading one more page produced. */
export type Outcome<T> =
  | { type: 'page'; items: T[]; next: Href | null }
  | { type: 'rate-limited' }
  | { type: 'error'; message: string };

/** Comments carry a depth; dropping a repeated comment drops its replies with it. */
export type Keyed = { id: number; depth?: number };

/** Pages loaded without the reader asking. After this many, a "Load more" button takes over. */
export const AUTO_PAGES = 10;
export const BACKOFF_MS = 5_000;
export const MAX_BACKOFF_MS = 60_000;

export const backoff = (strikes: number): number => Math.min(MAX_BACKOFF_MS, BACKOFF_MS * 2 ** Math.max(0, strikes - 1));

/** HN-relative form (`news?p=2`) of a link as written on the page at `base`, so `?p=3` on page two means page three. */
export const canonical = (href: string, base: string | URL): Href => {
  const u = new URL(href, base);
  return `${u.pathname.slice(1)}${u.search}` as Href;
};

/** The page number a URL shows: HN's `?p=`, or `n=` (the first rank) on `newest?next=…&n=31`. */
export const pageNumberOf = (url: URL): number => {
  const p = Number(url.searchParams.get('p'));
  if (Number.isInteger(p) && p > 0) return p;
  const n = Number(url.searchParams.get('n'));
  if (Number.isInteger(n) && n > 1) return Math.floor((n - 1) / 30) + 1;
  return 1;
};

/** A link back to a page already shown would loop, so it ends the feed. */
const tailFor = <T>(next: Href | null, pages: FeedPage<T>[]): Tail =>
  next === null || pages.some((p) => p.href === next) ? { status: 'end' } : { status: 'idle', next };

/** A feed showing `pages` (never empty) that continues at `next`. */
export const feedOf = <T>(pages: FeedPage<T>[], next: Href | null): Feed<T> => ({ pages, tail: tailFor(next, pages), strikes: 0 });

export const appendedCount = (feed: Feed<unknown>): number => feed.pages.length - 1;

/** The feed may load on its own: nothing in flight or failed, and still under the auto-load cap. */
export const autoLoads = (feed: Feed<unknown>): boolean => feed.tail.status === 'idle' && appendedCount(feed) < AUTO_PAGES;

/** The reader may ask for the next page: always, except while loading, at the end, or inside a rate-limit wait. */
export const canLoad = (feed: Feed<unknown>, now: number): boolean => {
  const { tail } = feed;
  switch (tail.status) {
    case 'idle':
    case 'error':
      return true;
    case 'rate-limited':
      return now >= tail.retryAt;
    case 'loading':
    case 'end':
      return false;
  }
};

/** Start loading `tail.next`. Returns the same feed when a load is not allowed, so a second trigger is a no-op. */
export const beginLoad = <T>(feed: Feed<T>, now: number): Feed<T> => {
  if (!canLoad(feed, now) || feed.tail.status === 'end') return feed;
  return { ...feed, tail: { status: 'loading', next: feed.tail.next } };
};

/** Items not shown yet. A repeated item is dropped together with any deeper items that follow it (its replies). */
export const freshItems = <T extends Keyed>(items: readonly T[], seen: ReadonlySet<number>): T[] => {
  const out: T[] = [];
  let droppedDepth: number | null = null;
  for (const item of items) {
    const depth = item.depth ?? 0;
    if (droppedDepth !== null && depth > droppedDepth) continue;
    droppedDepth = null;
    if (seen.has(item.id)) droppedDepth = depth;
    else out.push(item);
  }
  return out;
};

/** Apply the result of loading `href`. Results for anything but the load in flight are ignored. */
export const settle = <T extends Keyed>(feed: Feed<T>, href: Href, outcome: Outcome<T>, now: number): Feed<T> => {
  if (feed.tail.status !== 'loading' || feed.tail.next !== href) return feed;
  switch (outcome.type) {
    case 'page': {
      const seen = new Set(feed.pages.flatMap((p) => p.items.map((i) => i.id)));
      const number = feed.pages[feed.pages.length - 1]!.number + 1;
      const pages = [...feed.pages, { href, number, items: freshItems(outcome.items, seen) }];
      return { pages, tail: tailFor(outcome.next, pages), strikes: 0 };
    }
    case 'rate-limited': {
      const strikes = feed.strikes + 1;
      return { ...feed, strikes, tail: { status: 'rate-limited', next: href, retryAt: now + backoff(strikes) } };
    }
    case 'error':
      return { ...feed, tail: { status: 'error', next: href, message: outcome.message } };
  }
};
