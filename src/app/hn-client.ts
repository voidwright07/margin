import { parseReplyForm } from '../hn/item';
import { parsePage } from '../hn/registry';
import { parseUserProfile } from '../hn/user';
import { canonical, type FeedItems, type Outcome } from '../feed/feed';
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

/**
 * HN's answer when it throttles a reader: sometimes a 503, sometimes a 200 holding only this sentence, outside
 * the page frame. Inside a framed page the sentence is just a comment quoting it.
 */
const RATE_LIMIT_TEXT = /not able to serve your requests this quickly/i;

export type ListKind = 'stories' | 'comments';

/** Each list kind's items, when the parsed page is that kind. */
const LIST_ITEMS: { [K in ListKind]: (page: Page) => { items: FeedItems[K][]; more: Href | null } | null } = {
  stories: (page) => (page.kind === 'stories' ? { items: page.stories, more: page.more } : null),
  comments: (page) => (page.kind === 'comments' ? { items: page.comments, more: page.more } : null),
};

/**
 * Turn HN's answer for a list page into the next feed page, parsed by the same registry as a normal page load.
 * `url` is where the page was fetched from; its More link is relative to that page, not to the one on screen.
 */
export const readListPage = <K extends ListKind>(kind: K, status: number, doc: Document, url: URL): Outcome<FeedItems[K]> => {
  const throttled = !doc.querySelector('#hnmain') && RATE_LIMIT_TEXT.test(doc.body?.textContent ?? '');
  if (status === 429 || status === 503 || throttled) return { type: 'rate-limited' };
  if (status < 200 || status >= 300) return { type: 'error', message: `Hacker News answered ${status}.` };
  let page: Page;
  try {
    page = parsePage(doc, url);
  } catch {
    page = { kind: 'passthrough', meta: { viewer: null, url, section: null, notice: null } };
  }
  const list = LIST_ITEMS[kind](page);
  if (!list) return { type: 'error', message: 'Margin could not read this page.' };
  return { type: 'page', items: list.items, next: list.more === null ? null : canonical(list.more, url) };
};

/** Fetch one more page of a story or comment list. Never throws: every failure is an outcome the feed shows. */
export const fetchListPage = async <K extends ListKind>(kind: K, href: Href, signal: AbortSignal): Promise<Outcome<FeedItems[K]>> => {
  const url = abs(href);
  let res: Response;
  try {
    res = await fetch(url, { credentials: 'include', signal });
  } catch (e) {
    if (signal.aborted) throw e;
    return { type: 'error', message: 'Could not reach Hacker News.' };
  }
  const html = await res.text();
  return readListPage(kind, res.status, new DOMParser().parseFromString(html, 'text/html'), new URL(res.url || url.href));
};
