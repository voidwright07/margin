import { intIn, text } from './dom';
import { parseMeta } from './meta';
import type { Page, UserProfile } from './types';

/** Cells of the profile table keyed by their label ("user", "karma", …). */
const cellsByLabel = (doc: Document): Map<string, Element> => {
  const out = new Map<string, Element>();
  for (const tr of Array.from(doc.querySelectorAll('#bigbox tr'))) {
    const [labelCell, valueCell] = Array.from(tr.children);
    const label = text(labelCell).replace(/:$/, '');
    if (label && valueCell && !out.has(label)) out.set(label, valueCell);
  }
  return out;
};

export const parseUserProfile = (doc: Document): UserProfile => {
  const cells = cellsByLabel(doc);
  const idCell = doc.querySelector('tr.athing td[timestamp]')!;
  const about = cells.get('about');
  const textarea = about?.querySelector('textarea');
  const aboutHtml = textarea ? (textarea.textContent ?? '').trim() : about?.innerHTML.trim();
  return {
    id: text(idCell),
    created: Number(idCell.getAttribute('timestamp')),
    createdText: text(cells.get('created')),
    karma: intIn(text(cells.get('karma'))) ?? 0,
    about: aboutHtml || null,
    editable: textarea != null,
  };
};

export const parseUser = (doc: Document, url: URL): Page => ({
  kind: 'user',
  meta: parseMeta(doc, url),
  user: parseUserProfile(doc),
});
