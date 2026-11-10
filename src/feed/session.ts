import type { Snapshot } from './restore';
import type { FeedKind } from './feed';

/**
 * The tab's saved feeds, in sessionStorage, which lives exactly as long as the tab's history. Each history entry
 * that shows a feed gets an id in `history.state`; the entry's feed is saved under that id. Storage can be full
 * or blocked, so every call here may quietly do nothing: restore is an optimisation over a normal load.
 */

const PREFIX = 'margin:feed:';
const INDEX = 'margin:feeds';
/** Feeds kept per tab, newest first. Older entries fall back to a normal load. */
const KEEP = 6;
const STATE_KEY = 'marginFeed';

type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The id of the current history entry's feed, if this entry has shown one before. */
export const entryId = (): string | null => {
  const s: unknown = history.state;
  return isObj(s) && typeof s[STATE_KEY] === 'string' ? s[STATE_KEY] : null;
};

/** The current entry's id, minted and stored in `history.state` (without changing the URL) on first use. */
export const ensureEntryId = (): string => {
  const existing = entryId();
  if (existing) return existing;
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const s: unknown = history.state;
  history.replaceState({ ...(isObj(s) ? s : {}), [STATE_KEY]: id }, '');
  return id;
};

/** Back or Forward reloaded this document (bfcache did not keep it), so the entry's feed may be restored. */
export const cameBack = (): boolean =>
  (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined)?.type === 'back_forward';

export const readFeed = (id: string): string | null => {
  try {
    return sessionStorage.getItem(PREFIX + id);
  } catch {
    return null;
  }
};

const readIndex = (): string[] => {
  try {
    const raw: unknown = JSON.parse(sessionStorage.getItem(INDEX) ?? '[]');
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
};

const drop = (ids: string[]) => {
  for (const old of ids) sessionStorage.removeItem(PREFIX + old);
};

export const writeFeed = <K extends FeedKind>(id: string, snap: Snapshot<K>) => {
  const json = JSON.stringify(snap);
  try {
    const index = [id, ...readIndex().filter((x) => x !== id)];
    drop(index.slice(KEEP));
    try {
      sessionStorage.setItem(PREFIX + id, json);
    } catch {
      // Full: keep only this entry's feed.
      drop(index.slice(1));
      index.length = 1;
      sessionStorage.setItem(PREFIX + id, json);
    }
    sessionStorage.setItem(INDEX, JSON.stringify(index.slice(0, KEEP)));
  } catch {
    // Blocked or still too large; Back will load the page normally.
  }
};
