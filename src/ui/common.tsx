import type { ComponentChildren } from 'preact';
import type { Href, PageMeta } from '../hn/types';
import { isBookmarked, toggleBookmark } from '../store/ops';
import type { Bookmark } from '../store/schema';
import { update, useStore } from '../store/store';
import { IconBookmark } from './icons';

export const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

export const ago = (ts: number, now = Date.now()): string => {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return 'just now';
  const units: Array<[number, string]> = [
    [60 * 60 * 24 * 365, 'year'],
    [60 * 60 * 24 * 30, 'month'],
    [60 * 60 * 24, 'day'],
    [60 * 60, 'hour'],
    [60, 'minute'],
  ];
  for (const [size, name] of units) if (s >= size) return `${plural(Math.floor(s / size), name)} ago`;
  return 'just now';
};

export function UserLink({ name, op }: { name: string; op?: boolean }) {
  return (
    <a class={`mg-user${op ? ' is-op' : ''}`} href={`user?id=${encodeURIComponent(name)}`} data-mg-user={name}>
      {name}
    </a>
  );
}

export function BookmarkButton({ make, label }: { make: () => Bookmark; label: string }) {
  const probe = make();
  const on = useStore((s) => isBookmarked(s.bookmarks, probe));
  return (
    <button
      type="button"
      class={`mg-act mg-act-icon${on ? ' is-on' : ''}`}
      data-mg-bookmark
      aria-pressed={on}
      title={on ? `Remove ${label} from bookmarks (b)` : `Bookmark this ${label} (b)`}
      onClick={() => void update((s) => toggleBookmark(s, make()))}
    >
      <IconBookmark size={14} filled={on} />
    </button>
  );
}

/** Tabs for a user's pages. Shown on the profile and on submitted / threads / favorites lists. */
export function ProfileTabs({ id, active }: { id: string; active: 'about' | 'submissions' | 'comments' | 'favorites' }) {
  const tabs = [
    ['about', 'About', `user?id=${id}`],
    ['submissions', 'Submissions', `submitted?id=${id}`],
    ['comments', 'Comments', `threads?id=${id}`],
    ['favorites', 'Favorites', `favorites?id=${id}`],
  ] as const;
  return (
    <nav class="mg-subtabs" aria-label={`${id}'s pages`}>
      {tabs.map(([key, label, href]) => (
        <a href={href} class={key === active ? 'is-active' : ''} aria-current={key === active ? 'page' : undefined}>
          {label}
        </a>
      ))}
    </nav>
  );
}

/** Which profile tab a list page belongs to, from the page section HN reported. */
export const profileTabFor = (meta: PageMeta): { id: string; active: 'submissions' | 'comments' | 'favorites' } | null => {
  const id = meta.url.searchParams.get('id');
  if (!id) return null;
  switch (meta.section) {
    case 'submitted':
      return { id, active: 'submissions' };
    case 'threads':
      return { id, active: 'comments' };
    case 'favorites':
      return { id, active: 'favorites' };
    default:
      return null;
  }
};

export function MoreLink({ href, label = 'More' }: { href: Href | null; label?: string }) {
  if (!href) return null;
  return (
    <div class="mg-more">
      <a class="mg-btn" href={href} rel="next" data-mg-next>
        {label}
      </a>
    </div>
  );
}

export function PageHead({ title, children }: { title: ComponentChildren; children?: ComponentChildren }) {
  return (
    <div class="mg-pagehead">
      <h1>{title}</h1>
      {children}
    </div>
  );
}
