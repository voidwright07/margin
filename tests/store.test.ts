import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { Story } from '../src/hn/types';
import { newCommentCount, newCommentIds, recordVisit, storyBookmark, toggleBookmark, addHighlight, removeHighlight } from '../src/store/ops';
import { BackupError, defaultState, HISTORY_CAP, parseBackup, parseState, SCHEMA_VERSION } from '../src/store/schema';

const story = (id: number, comments: number): Story => ({
  type: 'story', id, rank: 1, title: `Story ${id}`, url: `https://example.com/${id}` as Story['url'], site: 'example.com',
  score: 10, by: 'alice', time: '2026-11-10T10:00:00Z', ageText: '1 hour ago', comments, text: null, dead: false, flagged: false, actions: {},
});

describe('parseState at the storage boundary', () => {
  it('fills defaults for empty storage', () => {
    expect(parseState({})).toEqual(defaultState());
  });

  it('clamps numbers, rejects unknown enums and keeps title in table columns', () => {
    const s = parseState({ settings: { theme: 'neon', fontSize: 400, lineHeight: 0.2, columnWidth: 'wide', tableColumns: ['score', 'bogus'], justify: 'yes' } });
    expect(s.settings).toMatchObject({ theme: 'system', fontSize: 22, lineHeight: 1.3, columnWidth: 800, justify: false });
    expect(s.settings.tableColumns).toContain('title');
  });

  it('drops malformed history, bookmarks and highlights instead of failing', () => {
    const s = parseState({
      history: { '1': { title: 'ok', lastVisit: 5, seen: [1, 'x', 2] }, abc: { title: 'bad key', lastVisit: 1 }, '2': { lastVisit: 1 } },
      bookmarks: [{ type: 'story', id: 3, savedAt: 1, snapshot: { title: 't' } }, { type: 'planet', id: 1, savedAt: 1, snapshot: {} }, null],
      highlights: [{ id: 'h', itemId: 1, commentId: null, text: 'quote', createdAt: 1 }, { id: 'e', itemId: 1, text: '  ', createdAt: 1 }],
    });
    expect(Object.keys(s.history)).toEqual(['1']);
    expect(s.history['1']!.seen).toEqual([1, 2]);
    expect(s.bookmarks).toEqual([{ type: 'story', id: 3, savedAt: 1, snapshot: { title: 't', url: 'item?id=3', by: null, site: null } }]);
    expect(s.highlights.map((h) => h.id)).toEqual(['h']);
  });

  it('caps history at the most recent entries', () => {
    const history = Object.fromEntries(Array.from({ length: HISTORY_CAP + 5 }, (_, i) => [String(i + 1), { title: `t${i}`, lastVisit: i, seen: [] }]));
    const s = parseState({ history });
    expect(Object.keys(s.history)).toHaveLength(HISTORY_CAP);
    expect(s.history['1']).toBeUndefined();
    expect(s.history[String(HISTORY_CAP + 5)]).toBeDefined();
  });
});

describe('backup and restore', () => {
  it('round-trips the exact state', () => {
    let s = defaultState();
    s = recordVisit(s, story(7, 3), [70, 71, 72], 1000);
    s = toggleBookmark(s, storyBookmark(story(7, 3), 1001));
    s = addHighlight(s, { id: 'h1', itemId: 7, commentId: 70, text: 'a line worth keeping', createdAt: 1002 });
    s = { ...s, settings: { ...s.settings, theme: 'slate', indexView: 'table' } };
    expect(parseBackup(JSON.stringify(s))).toEqual(s);
  });

  it('rejects files that are not Margin backups', () => {
    expect(() => parseBackup('{not json')).toThrow(BackupError);
    expect(() => parseBackup('{"history":{}}')).toThrow(/not a Margin backup/);
    expect(() => parseBackup(JSON.stringify({ version: SCHEMA_VERSION + 1, settings: {} }))).toThrow(/newer Margin/);
  });
});

describe('history and new replies', () => {
  it('counts only comments added since the last visit', () => {
    const first = recordVisit(defaultState(), story(1, 2), [10, 11], 1);
    const entry = first.history['1'];
    expect([...newCommentIds(entry, [10, 11, 12, 13])]).toEqual([12, 13]);
    expect(newCommentCount(entry, 5)).toBe(3);
    expect(newCommentIds(undefined, [10])).toEqual(new Set());

    const second = recordVisit(first, story(1, 4), [10, 11, 12, 13], 2);
    expect(newCommentIds(second.history['1'], [10, 11, 12, 13]).size).toBe(0);
    expect(second.history['1']).toMatchObject({ lastVisit: 2, commentCount: 4 });
  });

  it('toggles bookmarks and removes highlights by id', () => {
    const b = storyBookmark(story(2, 0), 5);
    const on = toggleBookmark(defaultState(), b);
    expect(on.bookmarks).toHaveLength(1);
    expect(toggleBookmark(on, b).bookmarks).toHaveLength(0);
    const h = addHighlight(defaultState(), { id: 'x', itemId: 2, commentId: null, text: 'abc', createdAt: 1 });
    expect(addHighlight(h, { id: 'y', itemId: 2, commentId: null, text: 'abc', createdAt: 2 }).highlights).toHaveLength(1);
    expect(removeHighlight(h, 'x').highlights).toEqual([]);
  });
});

describe('store module owns chrome.storage.local', () => {
  beforeEach(() => {
    fakeBrowser.reset();
    vi.resetModules();
  });

  it('loads, persists only changed keys, and follows changes from other tabs', async () => {
    await fakeBrowser.storage.local.set({ settings: { theme: 'dark' }, bookmarks: 'garbage' });
    const store = await import('../src/store/store');
    const loaded = await store.loadState();
    expect(loaded.settings.theme).toBe('dark');
    expect(loaded.bookmarks).toEqual([]);

    const setSpy = vi.spyOn(fakeBrowser.storage.local, 'set');
    await store.updateSettings({ fontSize: 18 });
    expect(setSpy).toHaveBeenCalledTimes(1);
    expect(Object.keys(setSpy.mock.calls[0]![0] as object)).toEqual(['settings']);
    expect((await fakeBrowser.storage.local.get('settings')).settings).toMatchObject({ theme: 'dark', fontSize: 18 });

    const seen: string[] = [];
    store.subscribe((s) => seen.push(s.settings.theme));
    await fakeBrowser.storage.local.set({ settings: { ...store.getState().settings, theme: 'black' } });
    expect(store.getState().settings.theme).toBe('black');
    expect(seen).toContain('black');
  });

  it('restore replaces everything in storage', async () => {
    const store = await import('../src/store/store');
    await store.loadState();
    await fakeBrowser.storage.local.set({ stray: 1 });
    const next = recordVisit(defaultState(), story(9, 1), [90], 3);
    await store.replaceState(next);
    const raw = await fakeBrowser.storage.local.get(null);
    expect(raw.stray).toBeUndefined();
    expect(parseState(raw)).toEqual(next);
  });
});
