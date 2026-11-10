import { collectActions, STORY_ACTIONS } from './actions';
import { ageOf, hrefOf, idFromHref, intIn, text, userOf } from './dom';
import { moreOf, parseMeta } from './meta';
import type { Href, Page, Story } from './types';

/** Parse one `tr.athing.submission` and the subtext row that follows it. */
export const parseStoryRow = (row: Element, doc: ParentNode): Story => {
  const id = Number(row.getAttribute('id'));
  const titleline = row.querySelector('.titleline');
  const link = titleline?.querySelector('a') ?? null;
  const sub = row.nextElementSibling?.querySelector('td.subtext') ?? null;
  const commentsLink = Array.from(sub?.querySelectorAll('a') ?? []).find(
    (a) => idFromHref(a.getAttribute('href')) === id && /comment|discuss/i.test(text(a)),
  );
  const marker = text(titleline);
  return {
    type: 'story',
    id,
    rank: intIn(text(row.querySelector('span.rank'))),
    title: text(link),
    url: hrefOf(link) ?? (`item?id=${id}` as Href),
    site: text(titleline?.querySelector('.sitestr')) || null,
    score: intIn(text(sub?.querySelector('span.score'))),
    by: userOf(sub),
    ...ageOf(sub),
    comments: commentsLink ? (intIn(text(commentsLink)) ?? 0) : null,
    text: null,
    dead: marker.includes('[dead]'),
    flagged: marker.includes('[flagged]'),
    actions: collectActions([sub], doc, id, STORY_ACTIONS),
  };
};

/** Text above the list, such as "Stories from November 1, 2026" on front?day=. */
const parseHeading = (doc: Document): string | null => {
  const div = doc.querySelector('#bigbox > td > div');
  const first = div?.firstChild;
  const t = first && first.nodeType === 3 ? (first.textContent ?? '').trim() : '';
  return t || null;
};

export const parseStories = (doc: Document, url: URL): Page => ({
  kind: 'stories',
  meta: parseMeta(doc, url),
  stories: Array.from(doc.querySelectorAll('tr.athing.submission')).map((r) => parseStoryRow(r, doc)),
  more: moreOf(doc),
  heading: parseHeading(doc),
});
