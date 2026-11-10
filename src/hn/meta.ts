import { hrefOf, intIn, text } from './dom';
import { SECTIONS, type Href, type PageMeta, type Section, type Viewer } from './types';

const parseViewer = (doc: Document): Viewer => {
  const me = doc.querySelector('#me');
  const logout = hrefOf(doc.querySelector('#logout'));
  if (!me || !logout) return null;
  return { name: text(me), karma: intIn(text(doc.querySelector('#karma'))) ?? 0, logout };
};

const isSection = (s: string): s is Section => (SECTIONS as readonly string[]).includes(s);

/** HN names every page in <html op="…">; that names the section, so the URL path is never consulted. */
const parseSection = (doc: Document): Section | null => {
  const op = doc.documentElement.getAttribute('op') ?? '';
  return isSection(op) ? op : null;
};

/** Pages outside the #hnmain frame (login errors, "Unknown." replies) put their message as leading body text. */
const parseNotice = (doc: Document): string | null => {
  if (doc.querySelector('#hnmain')) return null;
  const first = doc.body?.firstChild;
  const t = first && first.nodeType === 3 ? (first.textContent ?? '').trim() : '';
  return t || null;
};

export const parseMeta = (doc: Document, url: URL): PageMeta => ({
  viewer: parseViewer(doc),
  url,
  section: parseSection(doc),
  notice: parseNotice(doc),
});

export const moreOf = (root: ParentNode): Href | null => hrefOf(root.querySelector('a.morelink'));
