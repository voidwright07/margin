/**
 * The one persisted shape. Everything in chrome.storage.local is exactly this object, split by top-level key,
 * and a backup file is exactly this object as JSON. `parseState` is the only way raw data becomes a State.
 */

export const THEMES = ['system', 'light', 'classic', 'slate', 'dark', 'black'] as const;
export const FONTS = ['sans', 'serif', 'mono'] as const;
export const INDEX_VIEWS = ['list', 'table', 'compact'] as const;
export const TABLE_COLUMNS = ['rank', 'vote', 'title', 'site', 'score', 'by', 'age', 'comments'] as const;

export type Theme = (typeof THEMES)[number];
export type Font = (typeof FONTS)[number];
export type IndexView = (typeof INDEX_VIEWS)[number];
export type TableColumn = (typeof TABLE_COLUMNS)[number];

export type Settings = {
  enabled: boolean;
  theme: Theme;
  font: Font;
  fontSize: number;
  columnWidth: number;
  lineHeight: number;
  justify: boolean;
  indexView: IndexView;
  tableColumns: TableColumn[];
  openLinksInNewTab: boolean;
  keyboard: boolean;
};

export type HistoryEntry = {
  title: string;
  url: string;
  lastVisit: number;
  commentCount: number;
  /** Comment ids already rendered on earlier visits. */
  seen: number[];
};

export type Bookmark =
  | { type: 'story'; id: number; savedAt: number; snapshot: { title: string; url: string; by: string | null; site: string | null } }
  | { type: 'comment'; id: number; savedAt: number; snapshot: { by: string; excerpt: string; storyId: number | null; storyTitle: string | null } }
  | { type: 'user'; id: string; savedAt: number; snapshot: { karma: number | null } };

export type Highlight = { id: string; itemId: number; commentId: number | null; text: string; createdAt: number };

export const SCHEMA_VERSION = 1;

export type State = {
  version: typeof SCHEMA_VERSION;
  settings: Settings;
  history: Record<string, HistoryEntry>;
  bookmarks: Bookmark[];
  highlights: Highlight[];
};

export const STATE_KEYS = ['version', 'settings', 'history', 'bookmarks', 'highlights'] as const;

export const RANGES = {
  fontSize: { min: 13, max: 22, step: 1 },
  columnWidth: { min: 560, max: 1400, step: 20 },
  lineHeight: { min: 1.3, max: 2, step: 0.05 },
} as const;

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  theme: 'system',
  font: 'sans',
  fontSize: 15,
  columnWidth: 800,
  lineHeight: 1.6,
  justify: false,
  indexView: 'list',
  tableColumns: ['rank', 'vote', 'title', 'score', 'by', 'age', 'comments'],
  openLinksInNewTab: false,
  keyboard: true,
};

export const HISTORY_CAP = 2000;

export const defaultState = (): State => ({
  version: SCHEMA_VERSION,
  settings: { ...DEFAULT_SETTINGS, tableColumns: [...DEFAULT_SETTINGS.tableColumns] },
  history: {},
  bookmarks: [],
  highlights: [],
});

// ---- boundary validation -------------------------------------------------------------------------------

type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const oneOf = <T extends string>(all: readonly T[], v: unknown, fallback: T): T =>
  (all as readonly unknown[]).includes(v) ? (v as T) : fallback;
const clamp = (v: unknown, r: { min: number; max: number }, fallback: number) =>
  isNum(v) ? Math.min(r.max, Math.max(r.min, v)) : fallback;
const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);
const strOrNull = (v: unknown) => (isStr(v) ? v : null);
const numOrNull = (v: unknown) => (isNum(v) ? v : null);

export const parseSettings = (raw: unknown): Settings => {
  const r = isObj(raw) ? raw : {};
  const d = DEFAULT_SETTINGS;
  const cols = Array.isArray(r.tableColumns)
    ? [...new Set(r.tableColumns.filter((c): c is TableColumn => (TABLE_COLUMNS as readonly unknown[]).includes(c)))]
    : null;
  return {
    enabled: bool(r.enabled, d.enabled),
    theme: oneOf(THEMES, r.theme, d.theme),
    font: oneOf(FONTS, r.font, d.font),
    fontSize: clamp(r.fontSize, RANGES.fontSize, d.fontSize),
    columnWidth: clamp(r.columnWidth, RANGES.columnWidth, d.columnWidth),
    lineHeight: clamp(r.lineHeight, RANGES.lineHeight, d.lineHeight),
    justify: bool(r.justify, d.justify),
    indexView: oneOf(INDEX_VIEWS, r.indexView, d.indexView),
    tableColumns: cols && cols.includes('title') ? cols : [...d.tableColumns],
    openLinksInNewTab: bool(r.openLinksInNewTab, d.openLinksInNewTab),
    keyboard: bool(r.keyboard, d.keyboard),
  };
};

const parseHistoryEntry = (v: unknown): HistoryEntry | null => {
  if (!isObj(v) || !isStr(v.title) || !isNum(v.lastVisit)) return null;
  return {
    title: v.title,
    url: isStr(v.url) ? v.url : '',
    lastVisit: v.lastVisit,
    commentCount: isNum(v.commentCount) ? v.commentCount : 0,
    seen: Array.isArray(v.seen) ? v.seen.filter(isNum) : [],
  };
};

export const capHistory = (h: Record<string, HistoryEntry>): Record<string, HistoryEntry> => {
  const entries = Object.entries(h);
  if (entries.length <= HISTORY_CAP) return h;
  entries.sort((a, b) => b[1].lastVisit - a[1].lastVisit);
  return Object.fromEntries(entries.slice(0, HISTORY_CAP));
};

const parseHistory = (raw: unknown): Record<string, HistoryEntry> => {
  if (!isObj(raw)) return {};
  const out: Record<string, HistoryEntry> = {};
  for (const [k, v] of Object.entries(raw)) {
    const e = /^\d+$/.test(k) ? parseHistoryEntry(v) : null;
    if (e) out[k] = e;
  }
  return capHistory(out);
};

const parseBookmark = (v: unknown): Bookmark | null => {
  if (!isObj(v) || !isNum(v.savedAt) || !isObj(v.snapshot)) return null;
  const s = v.snapshot;
  switch (v.type) {
    case 'story':
      return isNum(v.id) && isStr(s.title)
        ? { type: 'story', id: v.id, savedAt: v.savedAt, snapshot: { title: s.title, url: isStr(s.url) ? s.url : `item?id=${v.id}`, by: strOrNull(s.by), site: strOrNull(s.site) } }
        : null;
    case 'comment':
      return isNum(v.id) && isStr(s.by)
        ? { type: 'comment', id: v.id, savedAt: v.savedAt, snapshot: { by: s.by, excerpt: isStr(s.excerpt) ? s.excerpt : '', storyId: numOrNull(s.storyId), storyTitle: strOrNull(s.storyTitle) } }
        : null;
    case 'user':
      return isStr(v.id) ? { type: 'user', id: v.id, savedAt: v.savedAt, snapshot: { karma: numOrNull(s.karma) } } : null;
    default:
      return null;
  }
};

const parseHighlight = (v: unknown): Highlight | null =>
  isObj(v) && isStr(v.id) && isNum(v.itemId) && isStr(v.text) && v.text.trim() && isNum(v.createdAt)
    ? { id: v.id, itemId: v.itemId, commentId: numOrNull(v.commentId), text: v.text, createdAt: v.createdAt }
    : null;

const list = <T>(raw: unknown, parse: (v: unknown) => T | null): T[] =>
  Array.isArray(raw) ? raw.map(parse).filter((x): x is T => x !== null) : [];

/** Raw object from older schema versions, keyed by the version it upgrades *from*. */
const MIGRATIONS: Record<number, (raw: Raw) => Raw> = {};

export class BackupError extends Error {}

/** Parse anything (storage contents, a backup file) into a valid State, migrating older versions. */
export const parseState = (raw: unknown): State => {
  let r: Raw = isObj(raw) ? raw : {};
  let version = isNum(r.version) ? r.version : SCHEMA_VERSION;
  if (version > SCHEMA_VERSION) throw new BackupError(`This data was written by a newer Margin (schema ${version}).`);
  while (version < SCHEMA_VERSION) {
    const step = MIGRATIONS[version];
    if (!step) throw new BackupError(`No migration from schema ${version}.`);
    r = step(r);
    version += 1;
  }
  return {
    version: SCHEMA_VERSION,
    settings: parseSettings(r.settings),
    history: parseHistory(r.history),
    bookmarks: list(r.bookmarks, parseBookmark),
    highlights: list(r.highlights, parseHighlight),
  };
};

/** A backup must at least look like Margin data; storage contents may be empty. */
export const parseBackup = (json: string): State => {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new BackupError('That file is not valid JSON.');
  }
  if (!isObj(raw) || !isNum(raw.version) || !isObj(raw.settings)) {
    throw new BackupError('That file is not a Margin backup: it has no version or settings.');
  }
  return parseState(raw);
};
