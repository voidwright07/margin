import type { Href } from './types';

export const text = (el: Element | null | undefined): string =>
  (el?.textContent ?? '').replace(/ /g, ' ').trim();

export const hrefOf = (el: Element | null | undefined): Href | null => {
  const h = el?.getAttribute('href');
  return h ? (h as Href) : null;
};

/** First integer in a string, ignoring thousands separators: "1,234 points" -> 1234. */
export const intIn = (s: string | null | undefined): number | null => {
  const m = s?.replace(/,/g, '').match(/-?\d+/);
  return m ? Number(m[0]) : null;
};

/** span.age carries title="2026-11-10T16:37:44" (sometimes followed by a unix time); HN times are UTC. */
export const ageOf = (row: Element | null): { time: string; ageText: string } => {
  const age = row?.querySelector('span.age') ?? null;
  const raw = age?.getAttribute('title')?.split(' ')[0] ?? '';
  return { time: raw && !raw.endsWith('Z') ? `${raw}Z` : raw, ageText: text(age) };
};

export const userOf = (el: Element | null): string | null => {
  const a = el?.querySelector('a.hnuser') ?? el?.querySelector('a[href^="user?id="]');
  return a ? text(a) : null;
};

export const idFromHref = (h: string | null | undefined): number | null => {
  const m = h?.match(/[?&]id=(\d+)/);
  return m ? Number(m[1]) : null;
};
