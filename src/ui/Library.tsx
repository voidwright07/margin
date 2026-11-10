import { useState } from 'preact/hooks';
import { clearHistory, forgetVisit, removeHighlight, toggleBookmark } from '../store/ops';
import type { Bookmark } from '../store/schema';
import { update, useStore } from '../store/store';
import { ago, plural } from './common';
import { IconClose } from './icons';
import { usePanel } from './panels';

const HN = 'https://news.ycombinator.com/';

const host = (url: string) => {
  try {
    return /^https?:/.test(url) ? new URL(url).hostname.replace(/^www\./, '') : null;
  } catch {
    return null;
  }
};

type Tab = 'history' | 'bookmarks' | 'highlights';

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" class="mg-lib-x" title={label} aria-label={label} onClick={onClick}>
      <IconClose size={14} />
    </button>
  );
}

function History({ query }: { query: string }) {
  const history = useStore((s) => s.history);
  const q = query.toLowerCase();
  const entries = Object.entries(history)
    .filter(([, e]) => !q || e.title.toLowerCase().includes(q) || e.url.toLowerCase().includes(q))
    .sort((a, b) => b[1].lastVisit - a[1].lastVisit)
    .slice(0, 300);
  if (entries.length === 0) {
    return <p class="mg-lib-empty">{q ? 'No visited stories match.' : 'Stories you open appear here, with new comments counted since each visit.'}</p>;
  }
  return (
    <>
      <ul class="mg-lib-list">
        {entries.map(([id, e]) => (
          <li>
            <a class="mg-lib-title" href={`${HN}item?id=${id}`}>{e.title}</a>
            <span class="mg-lib-meta">
              {host(e.url) && <span>{host(e.url)}</span>}
              <span>{plural(e.commentCount, 'comment')}</span>
              <span>visited {ago(e.lastVisit)}</span>
            </span>
            <RemoveButton label="Remove from history" onClick={() => void update((s) => forgetVisit(s, Number(id)))} />
          </li>
        ))}
      </ul>
      {!q && (
        <button type="button" class="mg-btn mg-btn-ghost mg-lib-clear" onClick={() => void update(clearHistory)}>
          Clear history
        </button>
      )}
    </>
  );
}

const BOOKMARK_FILTERS = ['all', 'story', 'comment', 'user'] as const;
const FILTER_LABEL = { all: 'All', story: 'Stories', comment: 'Comments', user: 'Users' } as const;

function BookmarkRow({ b }: { b: Bookmark }) {
  const remove = <RemoveButton label="Remove bookmark" onClick={() => void update((s) => toggleBookmark(s, b))} />;
  switch (b.type) {
    case 'story':
      return (
        <li>
          <a class="mg-lib-title" href={`${HN}item?id=${b.id}`}>{b.snapshot.title}</a>
          <span class="mg-lib-meta">
            {b.snapshot.site && <span>{b.snapshot.site}</span>}
            {b.snapshot.by && <span>by {b.snapshot.by}</span>}
            <span>saved {ago(b.savedAt)}</span>
          </span>
          {remove}
        </li>
      );
    case 'comment':
      return (
        <li>
          <a class="mg-lib-quote" href={b.snapshot.storyId ? `${HN}item?id=${b.snapshot.storyId}#${b.id}` : `${HN}item?id=${b.id}`}>
            {b.snapshot.excerpt || '(no text)'}
          </a>
          <span class="mg-lib-meta">
            <span>{b.snapshot.by}</span>
            {b.snapshot.storyTitle && <span>on {b.snapshot.storyTitle}</span>}
            <span>saved {ago(b.savedAt)}</span>
          </span>
          {remove}
        </li>
      );
    case 'user':
      return (
        <li>
          <a class="mg-lib-title" href={`${HN}user?id=${b.id}`}>{b.id}</a>
          <span class="mg-lib-meta">
            {b.snapshot.karma !== null && <span>{plural(b.snapshot.karma, 'karma point')}</span>}
            <span>saved {ago(b.savedAt)}</span>
          </span>
          {remove}
        </li>
      );
  }
}

function Bookmarks({ query }: { query: string }) {
  const bookmarks = useStore((s) => s.bookmarks);
  const [filter, setFilter] = useState<(typeof BOOKMARK_FILTERS)[number]>('all');
  const q = query.toLowerCase();
  const text = (b: Bookmark) =>
    b.type === 'story' ? b.snapshot.title : b.type === 'comment' ? `${b.snapshot.by} ${b.snapshot.excerpt}` : b.id;
  const shown = bookmarks.filter((b) => (filter === 'all' || b.type === filter) && (!q || text(b).toLowerCase().includes(q)));
  return (
    <>
      <div class="mg-chips" role="radiogroup" aria-label="Bookmark type">
        {BOOKMARK_FILTERS.map((f) => (
          <button type="button" role="radio" aria-checked={filter === f} class={filter === f ? 'is-on' : ''} onClick={() => setFilter(f)}>
            {FILTER_LABEL[f]}
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <p class="mg-lib-empty">Bookmark stories, comments and people with the bookmark button or the b key.</p>
      ) : (
        <ul class="mg-lib-list">
          {shown.map((b) => (
            <BookmarkRow b={b} />
          ))}
        </ul>
      )}
    </>
  );
}

function Highlights({ query }: { query: string }) {
  const highlights = useStore((s) => s.highlights);
  const history = useStore((s) => s.history);
  const q = query.toLowerCase();
  const shown = highlights.filter((h) => !q || h.text.toLowerCase().includes(q));
  if (shown.length === 0) return <p class="mg-lib-empty">Select text in a story or comment and choose Highlight to keep it here.</p>;
  return (
    <ul class="mg-lib-list">
      {shown.map((h) => (
        <li>
          <a class="mg-lib-quote mg-lib-hl" href={`${HN}item?id=${h.itemId}${h.commentId ? `#${h.commentId}` : ''}`}>
            {h.text}
          </a>
          <span class="mg-lib-meta">
            {history[h.itemId] && <span>{history[h.itemId]!.title}</span>}
            <span>{ago(h.createdAt)}</span>
          </span>
          <RemoveButton label="Remove highlight" onClick={() => void update((s) => removeHighlight(s, h.id))} />
        </li>
      ))}
    </ul>
  );
}

export function LibraryContent({ initial = 'history' }: { initial?: Tab }) {
  const [tab, setTab] = useState<Tab>(initial);
  const [query, setQuery] = useState('');
  const counts = useStore((s) => ({ history: Object.keys(s.history).length, bookmarks: s.bookmarks.length, highlights: s.highlights.length }));
  return (
    <div class="mg-library">
      <nav class="mg-subtabs" role="tablist">
        {(['history', 'bookmarks', 'highlights'] as const).map((t) => (
          <a
            href="#"
            role="tab"
            aria-selected={tab === t}
            class={tab === t ? 'is-active' : ''}
            onClick={(e) => {
              e.preventDefault();
              setTab(t);
            }}
          >
            {t[0]!.toUpperCase() + t.slice(1)} <span class="mg-count">{counts[t]}</span>
          </a>
        ))}
      </nav>
      <input class="mg-input mg-lib-search" type="search" placeholder={`Search ${tab}`} value={query} onInput={(e) => setQuery((e.currentTarget as HTMLInputElement).value)} />
      {tab === 'history' && <History query={query} />}
      {tab === 'bookmarks' && <Bookmarks query={query} />}
      {tab === 'highlights' && <Highlights query={query} />}
    </div>
  );
}

/** The library as a side drawer inside HN pages. */
export function LibraryDrawer() {
  const [panel, setPanel] = usePanel();
  if (panel !== 'library') return null;
  return (
    <div class="mg-drawer" role="dialog" aria-label="Library">
      <div class="mg-drawer-head">
        <h2>Library</h2>
        <button type="button" class="mg-icon-btn" aria-label="Close library" onClick={() => setPanel(null)}>
          <IconClose size={16} />
        </button>
      </div>
      <LibraryContent />
    </div>
  );
}
