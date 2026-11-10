import { parseReplyForm } from '../hn/item';
import { parsePage } from '../hn/registry';
import { parseUserProfile } from '../hn/user';
import type { Href, Page, ReplyForm, UserProfile } from '../hn/types';

/**
 * Every network call the extension makes. All of them are same-origin requests to news.ycombinator.com
 * with the user's own cookies, exactly as HN's own links and forms would make them.
 */

const abs = (h: string): URL => new URL(h, globalThis.location?.href ?? 'https://news.ycombinator.com/');

/** Logged-out action links carry no auth token; following them lands on HN's login page. */
export const hasAuth = (h: Href): boolean => /[?&]auth=/.test(h);

export type Toggle = 'vote' | 'fave' | 'hide' | 'flag';

/** The other state's link: votes swap how=up/how=un, the rest add or drop un=t. */
export const flipHref = (kind: Toggle, h: Href, nowOn: boolean): Href => {
  const url = abs(h);
  if (kind === 'vote') url.searchParams.set('how', nowOn ? 'un' : 'up');
  else if (nowOn) url.searchParams.set('un', 't');
  else url.searchParams.delete('un');
  return `${url.pathname.slice(1)}${url.search}` as Href;
};

export class HnError extends Error {}

const fetchHtml = async (h: string, init?: RequestInit): Promise<Document> => {
  const res = await fetch(abs(h), { credentials: 'include', ...init });
  if (!res.ok) throw new HnError(`Hacker News answered ${res.status}.`);
  return new DOMParser().parseFromString(await res.text(), 'text/html');
};

/** Perform an account action. Returns false when the user had to be sent to log in instead. */
export const performAction = async (h: Href): Promise<boolean> => {
  if (!hasAuth(h)) {
    globalThis.location.href = abs(h).href;
    return false;
  }
  await fetchHtml(h);
  return true;
};

const userCache = new Map<string, Promise<UserProfile>>();

export const fetchUser = (id: string): Promise<UserProfile> => {
  let p = userCache.get(id);
  if (!p) {
    p = fetchHtml(`user?id=${encodeURIComponent(id)}`).then(parseUserProfile);
    p.catch(() => userCache.delete(id));
    userCache.set(id, p);
  }
  return p;
};

/** HN signs each reply form with an hmac; replying to a comment needs that comment's reply page. */
export const fetchReplyForm = async (replyHref: Href): Promise<ReplyForm> => {
  const doc = await fetchHtml(replyHref);
  const form = parseReplyForm(doc);
  if (!form) throw new HnError(doc.body?.textContent?.trim().slice(0, 200) || 'Hacker News did not return a reply form. Are you logged in?');
  return form;
};

/** Post a comment. HN redirects to the thread, which comes back parsed so the page can update in place. */
export const postReply = async (form: ReplyForm, text: string): Promise<Extract<Page, { kind: 'item' }>> => {
  const body = new URLSearchParams({ ...form.fields, [form.textName]: text });
  const res = await fetch(abs(form.action), {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new HnError(`Hacker News answered ${res.status}.`);
  const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
  const page = parsePage(doc, new URL(res.url || globalThis.location.href));
  if (page.kind !== 'item') {
    throw new HnError(doc.body?.textContent?.trim().slice(0, 200) || 'Hacker News did not accept the comment.');
  }
  return page;
};
