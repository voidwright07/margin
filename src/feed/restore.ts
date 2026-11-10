import type { Comment, CommentHit, Href, Story, StoryHit } from '../hn/types';
import { feedOf, type Feed, type FeedItems, type FeedKind, type FeedPage } from './feed';

/**
 * Back-button restore. When the reader leaves a list, the pages loaded so far and the scroll offset are saved in
 * sessionStorage under the history entry, and a Back navigation that reloads the document renders them again.
 * The saved JSON is outside input like any other storage, so `parseSnapshot` checks it before use, and anything
 * stale or malformed means a normal load.
 */

export const SNAPSHOT_VERSION = 1;
export const SNAPSHOT_TTL_MS = 30 * 60 * 1000;

export type Snapshot<K extends FeedKind> = {
  v: typeof SNAPSHOT_VERSION;
  kind: K;
  pages: FeedPage<FeedItems[K]>[];
  next: Href | null;
  scrollY: number;
  savedAt: number;
};

export const toSnapshot = <K extends FeedKind>(kind: K, feed: Feed<FeedItems[K]>, scrollY: number, now: number): Snapshot<K> => ({
  v: SNAPSHOT_VERSION,
  kind,
  pages: feed.pages,
  // A load in flight or a failure is not worth restoring; Back starts that page over.
  next: feed.tail.status === 'end' ? null : feed.tail.next,
  scrollY,
  savedAt: now,
});

type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStrOrNull = (v: unknown) => v === null || isStr(v);
const isNumOrNull = (v: unknown) => v === null || isNum(v);

/** The fields each renderer reads without a fallback. */
const isStory = (v: unknown): v is Story =>
  isObj(v) && v.type === 'story' && isNum(v.id) && isStr(v.title) && isStr(v.url) && isStr(v.ageText) && isNumOrNull(v.rank) && isNumOrNull(v.comments) && isObj(v.actions);
const isComment = (v: unknown): v is Comment =>
  isObj(v) && v.type === 'comment' && isNum(v.id) && isNum(v.depth) && isStr(v.by) && isStr(v.html) && isStr(v.ageText) && isObj(v.actions);
const isHit = (v: unknown): v is StoryHit | CommentHit =>
  isObj(v) && isNum(v.id) && isNum(v.created) && isStr(v.author) && ((v.type === 'story' && isStr(v.title)) || (v.type === 'comment' && isStr(v.text) && isNum(v.storyId)));

const ITEM_GUARDS: { [K in FeedKind]: (v: unknown) => v is FeedItems[K] } = { stories: isStory, comments: isComment, search: isHit };

const parsePage = <K extends FeedKind>(kind: K, v: unknown): FeedPage<FeedItems[K]> | null => {
  if (!isObj(v) || !isStr(v.href) || !isNum(v.number) || !Array.isArray(v.items)) return null;
  const items = v.items;
  return items.every(ITEM_GUARDS[kind]) ? { href: v.href as Href, number: v.number, items } : null;
};

/**
 * A snapshot that may be restored on the page at `here`: the same kind of list, saved recently by this version,
 * and holding `here` among its pages (the address bar follows the page in view, so it is always one of them).
 */
export const parseSnapshot = <K extends FeedKind>(json: string | null, expect: { kind: K; here: Href; now: number }): Snapshot<K> | null => {
  if (!json) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (!isObj(raw) || raw.v !== SNAPSHOT_VERSION || raw.kind !== expect.kind) return null;
  if (!isNum(raw.savedAt) || raw.savedAt > expect.now || expect.now - raw.savedAt > SNAPSHOT_TTL_MS) return null;
  if (!isNum(raw.scrollY) || raw.scrollY < 0 || !isStrOrNull(raw.next) || !Array.isArray(raw.pages) || raw.pages.length === 0) return null;
  const pages: FeedPage<FeedItems[K]>[] = [];
  for (const p of raw.pages) {
    const page = parsePage(expect.kind, p);
    if (!page) return null;
    pages.push(page);
  }
  if (!pages.some((p) => p.href === expect.here)) return null;
  return { v: SNAPSHOT_VERSION, kind: expect.kind, pages, next: raw.next as Href | null, scrollY: raw.scrollY, savedAt: raw.savedAt };
};

/** The restored feed. Items also on the freshly loaded page take its data, so votes and counts are current. */
export const fromSnapshot = <T extends { id: number }>(snap: { pages: FeedPage<T>[]; next: Href | null }, fresh: readonly T[]): Feed<T> => {
  const byId = new Map(fresh.map((i) => [i.id, i]));
  return feedOf(
    snap.pages.map((p) => ({ ...p, items: p.items.map((i) => byId.get(i.id) ?? i) })),
    snap.next,
  );
};
