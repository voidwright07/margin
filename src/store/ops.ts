import type { Comment, Story, UserProfile } from '../hn/types';
import { capHistory, type Bookmark, type HistoryEntry, type Highlight, type State } from './schema';

/** Pure state transitions. The store applies them; tests call them directly. */

export const newCommentIds = (entry: HistoryEntry | undefined, ids: number[]): Set<number> => {
  if (!entry) return new Set();
  const seen = new Set(entry.seen);
  return new Set(ids.filter((id) => !seen.has(id)));
};

/** New comments since the last visit, as a count for story rows. */
export const newCommentCount = (entry: HistoryEntry | undefined, current: number | null): number =>
  entry && current !== null ? Math.max(0, current - entry.commentCount) : 0;

export const recordVisit = (s: State, story: Story, commentIds: number[], now: number): State => {
  const key = String(story.id);
  const prev = s.history[key];
  const seen = prev ? [...new Set([...prev.seen, ...commentIds])] : commentIds;
  const entry: HistoryEntry = {
    title: story.title,
    url: story.url,
    lastVisit: now,
    commentCount: Math.max(story.comments ?? 0, commentIds.length),
    seen,
  };
  return { ...s, history: capHistory({ ...s.history, [key]: entry }) };
};

export const forgetVisit = (s: State, storyId: number): State => {
  const { [String(storyId)]: _, ...rest } = s.history;
  return { ...s, history: rest };
};

export const clearHistory = (s: State): State => ({ ...s, history: {} });

type BookmarkKey = { type: Bookmark['type']; id: number | string };

export const isBookmarked = (bookmarks: Bookmark[], key: BookmarkKey): boolean =>
  bookmarks.some((b) => b.type === key.type && b.id === key.id);

export const toggleBookmark = (s: State, b: Bookmark): State =>
  isBookmarked(s.bookmarks, b)
    ? { ...s, bookmarks: s.bookmarks.filter((x) => !(x.type === b.type && x.id === b.id)) }
    : { ...s, bookmarks: [b, ...s.bookmarks] };

export const storyBookmark = (story: Story, now: number): Bookmark => ({
  type: 'story',
  id: story.id,
  savedAt: now,
  snapshot: { title: story.title, url: story.url, by: story.by, site: story.site },
});

const plain = (html: string): string => {
  const t = html.replace(/<p>/g, ' ').replace(/<[^>]+>/g, '');
  const el = globalThis.document?.createElement('textarea');
  if (el) {
    el.innerHTML = t;
    return el.value.trim();
  }
  return t.trim();
};

export const commentBookmark = (c: Comment, story: { id: number; title: string } | null, now: number): Bookmark => ({
  type: 'comment',
  id: c.id,
  savedAt: now,
  snapshot: { by: c.by, excerpt: plain(c.html).slice(0, 280), storyId: story?.id ?? null, storyTitle: story?.title ?? null },
});

export const userBookmark = (u: Pick<UserProfile, 'id'> & { karma: number | null }, now: number): Bookmark => ({
  type: 'user',
  id: u.id,
  savedAt: now,
  snapshot: { karma: u.karma },
});

export const addHighlight = (s: State, h: Highlight): State =>
  s.highlights.some((x) => x.commentId === h.commentId && x.itemId === h.itemId && x.text === h.text)
    ? s
    : { ...s, highlights: [h, ...s.highlights] };

export const removeHighlight = (s: State, id: string): State => ({ ...s, highlights: s.highlights.filter((h) => h.id !== id) });
