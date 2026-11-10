import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseHTML } from 'linkedom';
import { describe, expect, it } from 'vitest';
import { readListPage } from '../src/app/hn-client';
import {
  AUTO_PAGES,
  autoLoads,
  backoff,
  beginLoad,
  canLoad,
  canonical,
  feedOf,
  pageNumberOf,
  settle,
  type Feed,
  type FeedPage,
  type Outcome,
} from '../src/feed/feed';
import { fromSnapshot, parseSnapshot, SNAPSHOT_TTL_MS, toSnapshot } from '../src/feed/restore';
import { parsePage } from '../src/hn/registry';
import type { Comment, Href, Story } from '../src/hn/types';

const HN = 'https://news.ycombinator.com/';
const h = (s: string) => s as Href;
const doc = (file: string) => parseHTML(readFileSync(join(import.meta.dirname, '..', 'fixtures', file), 'utf8')).document as unknown as Document;
const stories = (file: string, path: string) => {
  const page = parsePage(doc(file), new URL(path, HN));
  if (page.kind !== 'stories') throw new Error(`${file} is ${page.kind}`);
  return page;
};

type Item = { id: number; depth?: number };
const items = (...ids: number[]): Item[] => ids.map((id) => ({ id }));
const page = (href: string, number: number, ids: number[]): FeedPage<Item> => ({ href: h(href), number, items: items(...ids) });
const ok = (ids: number[], next: string | null): Outcome<Item> => ({ type: 'page', items: items(...ids), next: next === null ? null : h(next) });

/** Begin and settle one load of the feed's next page. */
const load = (feed: Feed<Item>, outcome: Outcome<Item>, now = 0): Feed<Item> => {
  const loading = beginLoad(feed, now);
  expect(loading.tail.status).toBe('loading');
  if (loading.tail.status !== 'loading') throw new Error('not loading');
  return settle(loading, loading.tail.next, outcome, now);
};

describe('merging pages', () => {
  it('appends the next page after the first, numbered and continuing at its More link', () => {
    const feed = load(feedOf([page('news', 1, [1, 2, 3])], h('news?p=2')), ok([4, 5], 'news?p=3'));
    expect(feed.pages.map((p) => [p.href, p.number, p.items.map((i) => i.id)])).toEqual([
      ['news', 1, [1, 2, 3]],
      ['news?p=2', 2, [4, 5]],
    ]);
    expect(feed.tail).toEqual({ status: 'idle', next: 'news?p=3' });
  });

  it('never shows a story twice when the next page overlaps what is already shown', () => {
    let feed = load(feedOf([page('news', 1, [1, 2, 3])], h('news?p=2')), ok([3, 4, 5], 'news?p=3'));
    feed = load(feed, ok([5, 1, 6], null));
    expect(feed.pages.map((p) => p.items.map((i) => i.id))).toEqual([[1, 2, 3], [4, 5], [6]]);
  });

  it('drops the replies of a repeated comment along with it', () => {
    const tree: Item[] = [{ id: 10, depth: 0 }, { id: 11, depth: 1 }, { id: 12, depth: 2 }, { id: 20, depth: 0 }, { id: 21, depth: 1 }];
    const feed = load(feedOf([{ href: h('threads?id=a'), number: 1, items: [{ id: 10, depth: 0 }] }], h('threads?id=a&next=1')), { type: 'page', items: tree, next: null });
    expect(feed.pages[1]!.items.map((i) => i.id)).toEqual([20, 21]);
  });

  it('dedupes real HN pages: a shifted page two loses the three stories that fell from page one', () => {
    const one = stories('news.html', 'news');
    const two = readListPage('stories', 200, doc('synthetic/news-p2-shifted.html'), new URL('news?p=2', HN));
    expect(two.type).toBe('page');
    if (two.type !== 'page') return;
    let feed: Feed<Story> = feedOf([{ href: h('news'), number: 1, items: one.stories }], h('news?p=2'));
    feed = beginLoad(feed, 0);
    feed = settle(feed, h('news?p=2'), two, 0);
    const shown = feed.pages.flatMap((p) => p.items.map((s) => s.id));
    expect(new Set(shown).size).toBe(shown.length);
    expect(feed.pages[1]!.items).toHaveLength(27);
    expect(feed.pages[1]!.items[0]!.rank).toBe(34);
  });
});

describe('feed state transitions', () => {
  const start = () => feedOf([page('news', 1, [1])], h('news?p=2'));

  it('loads one page at a time: a second trigger while loading changes nothing', () => {
    const loading = beginLoad(start(), 0);
    expect(loading.tail).toEqual({ status: 'loading', next: 'news?p=2' });
    expect(beginLoad(loading, 0)).toBe(loading);
    expect(canLoad(loading, 0)).toBe(false);
  });

  it('ignores a result for a page that is not the one loading', () => {
    const loading = beginLoad(start(), 0);
    expect(settle(loading, h('news?p=9'), ok([2], null), 0)).toBe(loading);
    expect(settle(start(), h('news?p=2'), ok([2], null), 0)).toEqual(start());
  });

  it('ends when HN has no More link, or when the link leads back to a page already shown', () => {
    expect(load(start(), ok([2], null)).tail).toEqual({ status: 'end' });
    expect(load(start(), ok([2], 'news')).tail).toEqual({ status: 'end' });
    expect(feedOf([page('news', 1, [1])], null).tail).toEqual({ status: 'end' });
    const ended = load(start(), ok([2], null));
    expect(canLoad(ended, 0)).toBe(false);
    expect(beginLoad(ended, 0)).toBe(ended);
  });

  it('a rate limit waits before Retry works, doubles the wait each time, and never loads on its own', () => {
    const limited = load(start(), { type: 'rate-limited' }, 1000);
    expect(limited.tail).toEqual({ status: 'rate-limited', next: 'news?p=2', retryAt: 1000 + backoff(1) });
    expect(autoLoads(limited)).toBe(false);
    expect(canLoad(limited, 1000 + backoff(1) - 1)).toBe(false);
    expect(beginLoad(limited, 1000)).toBe(limited);
    const again = load(limited, { type: 'rate-limited' }, 1000 + backoff(1));
    expect(again.strikes).toBe(2);
    expect(backoff(2)).toBe(2 * backoff(1));
    if (again.tail.status !== 'rate-limited') throw new Error('expected rate-limited');
    expect(again.tail.retryAt).toBe(1000 + backoff(1) + backoff(2));
    expect(backoff(50)).toBe(60_000);
    const recovered = load(again, ok([2], 'news?p=3'), again.tail.retryAt);
    expect(recovered.strikes).toBe(0);
    expect(recovered.tail.status).toBe('idle');
  });

  it('an error keeps the page to open normally, and Retry may try it again at once', () => {
    const failed = load(start(), { type: 'error', message: 'Margin could not read this page.' });
    expect(failed.tail).toEqual({ status: 'error', next: 'news?p=2', message: 'Margin could not read this page.' });
    expect(autoLoads(failed)).toBe(false);
    expect(canLoad(failed, 0)).toBe(true);
  });

  it(`auto-loads ${AUTO_PAGES} pages, then waits for the reader`, () => {
    let feed = start();
    for (let n = 2; n <= AUTO_PAGES + 1; n++) {
      expect(autoLoads(feed)).toBe(true);
      feed = load(feed, ok([n], `news?p=${n + 1}`));
    }
    expect(feed.pages).toHaveLength(AUTO_PAGES + 1);
    expect(autoLoads(feed)).toBe(false);
    expect(canLoad(feed, 0)).toBe(true);
  });
});

describe('links and page numbers', () => {
  it('resolves a More link against the page it came from', () => {
    expect(canonical('?p=3', `${HN}news?p=2`)).toBe('news?p=3');
    expect(canonical('newest?next=50444876&n=61', `${HN}newest?next=50445284&n=31`)).toBe('newest?next=50444876&n=61');
  });

  it('numbers pages from ?p= or from the first rank in n=', () => {
    expect(pageNumberOf(new URL('news', HN))).toBe(1);
    expect(pageNumberOf(new URL('news?p=3', HN))).toBe(3);
    expect(pageNumberOf(new URL('newest?next=1&n=31', HN))).toBe(2);
    expect(pageNumberOf(new URL('news?p=zero', HN))).toBe(1);
  });
});

describe('reading a fetched list page', () => {
  it('parses page two with the registry and resolves its More link', () => {
    const out = readListPage('stories', 200, doc('news-p2.html'), new URL('news?p=2', HN));
    expect(out.type).toBe('page');
    if (out.type !== 'page') return;
    expect(out.items).toHaveLength(30);
    expect(out.items[0]).toMatchObject({ id: 50437752, rank: 31 });
    expect(out.next).toBe('news?p=3');
  });

  it('reads comment listings', () => {
    const out = readListPage('comments', 200, doc('threads-p2.html'), new URL('threads?id=dang&next=50429394', HN));
    expect(out).toMatchObject({ type: 'page', next: 'threads?id=dang&next=50409705' });
  });

  it("treats HN's throttle sentence, a 503 and a 429 as a rate limit", () => {
    expect(readListPage('stories', 200, doc('synthetic/rate-limited.html'), new URL('news?p=2', HN))).toEqual({ type: 'rate-limited' });
    expect(readListPage('stories', 503, doc('news-p2.html'), new URL('news?p=2', HN))).toEqual({ type: 'rate-limited' });
    expect(readListPage('comments', 429, doc('threads.html'), new URL('threads?id=dang', HN))).toEqual({ type: 'rate-limited' });
  });

  it('reports other failures and pages of the wrong shape as errors', () => {
    expect(readListPage('stories', 500, doc('news-p2.html'), new URL('news?p=2', HN))).toEqual({ type: 'error', message: 'Hacker News answered 500.' });
    expect(readListPage('stories', 200, doc('item.html'), new URL('news?p=2', HN)).type).toBe('error');
    expect(readListPage('comments', 200, doc('news-p2.html'), new URL('news?p=2', HN)).type).toBe('error');
  });
});

describe('restoring after Back', () => {
  const NOW = 1_800_000_000_000;
  const one = stories('news.html', 'news');
  const two = stories('news-p2.html', 'news?p=2');
  const feed = (): Feed<Story> =>
    feedOf(
      [
        { href: h('news'), number: 1, items: one.stories },
        { href: h('news?p=2'), number: 2, items: two.stories },
      ],
      h('news?p=3'),
    );
  const saved = (patch: Record<string, unknown> = {}) => JSON.stringify({ ...toSnapshot('stories', feed(), 2400, NOW), ...patch });
  const expect2 = { kind: 'stories' as const, here: h('news?p=2'), now: NOW + 60_000 };

  it('round-trips the pages, the next link and the scroll offset', () => {
    const snap = parseSnapshot(saved(), expect2);
    expect(snap).not.toBeNull();
    expect(snap!.scrollY).toBe(2400);
    const restored = fromSnapshot(snap!, two.stories);
    expect(restored.pages.map((p) => [p.href, p.items.length])).toEqual([['news', 30], ['news?p=2', 30]]);
    expect(restored.tail).toEqual({ status: 'idle', next: 'news?p=3' });
  });

  it('takes current data for items on the freshly loaded page', () => {
    const fresh = two.stories.map((s, i) => (i === 0 ? { ...s, score: 999 } : s));
    const restored = fromSnapshot(parseSnapshot(saved(), expect2)!, fresh);
    expect(restored.pages[1]!.items[0]!.score).toBe(999);
    expect(restored.pages[0]!.items[0]).toEqual(one.stories[0]);
  });

  it('restores a feed that had ended as ended', () => {
    const ended = JSON.stringify(toSnapshot('stories', feedOf(feed().pages, null), 0, NOW));
    expect(fromSnapshot(parseSnapshot(ended, expect2)!, []).tail).toEqual({ status: 'end' });
  });

  it.each([
    ['missing', null],
    ['not JSON', '{"v":1,'],
    ['stale', saved({ savedAt: NOW - SNAPSHOT_TTL_MS - 1 })],
    ['from the future', saved({ savedAt: NOW + 3_600_000 })],
    ['another version', saved({ v: 2 })],
    ['another kind of list', saved({ kind: 'comments' })],
    ['a negative scroll offset', saved({ scrollY: -5 })],
    ['no pages', saved({ pages: [] })],
    ['a malformed story', saved({ pages: [{ href: 'news', number: 1, items: [{ type: 'story', id: 1 }] }] })],
    ['a comment among stories', saved({ pages: [{ href: 'news?p=2', number: 2, items: [{ type: 'comment', id: 1, depth: 0, by: 'a', html: '', ageText: '', actions: {} }] }] })],
    ['a bad next link', saved({ next: 3 })],
  ])('falls back to a normal load when the saved data is %s', (_, json) => {
    expect(parseSnapshot(json as string | null, expect2)).toBeNull();
  });

  it('refuses a snapshot that does not hold the page in the address bar', () => {
    expect(parseSnapshot(saved(), { ...expect2, here: h('news?p=7') })).toBeNull();
  });

  it('validates comment and search snapshots by their own item shapes', () => {
    const threads = parsePage(doc('threads.html'), new URL('threads?id=dang', HN));
    if (threads.kind !== 'comments') throw new Error('threads');
    const json = JSON.stringify(toSnapshot('comments', feedOf<Comment>([{ href: h('threads?id=dang'), number: 1, items: threads.comments }], null), 10, NOW));
    expect(parseSnapshot(json, { kind: 'comments', here: h('threads?id=dang'), now: NOW })?.pages[0]!.items).toHaveLength(threads.comments.length);
    const hits = JSON.stringify({ v: 1, kind: 'search', next: 'search?q=rust&p=2', scrollY: 0, savedAt: NOW, pages: [{ href: 'search?q=rust', number: 1, items: [
      { type: 'story', id: 1, title: 'Rust', author: 'a', created: 1, url: null, site: null, points: 1, comments: 0, text: null },
      { type: 'comment', id: 2, text: 'hi', author: 'b', created: 1, storyId: 1, storyTitle: null },
    ] }] });
    expect(parseSnapshot(hits, { kind: 'search', here: h('search?q=rust'), now: NOW })?.pages[0]!.items).toHaveLength(2);
    expect(parseSnapshot(hits.replace('"text":"hi"', '"text":5'), { kind: 'search', here: h('search?q=rust'), now: NOW })).toBeNull();
  });
});
