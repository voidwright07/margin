import { commentRows, parseCommentRow, resolveThread } from './comments';
import { moreOf, parseMeta } from './meta';
import { parseStoryRow } from './stories';
import type { Comment, Href, Page, ReplyForm, Story } from './types';

export const parseReplyForm = (root: ParentNode): ReplyForm | null => {
  const form = root.querySelector('form[action="comment"]');
  if (!form) return null;
  const fields: Record<string, string> = {};
  for (const input of Array.from(form.querySelectorAll('input[type="hidden"]'))) {
    const name = input.getAttribute('name');
    if (name) fields[name] = input.getAttribute('value') ?? '';
  }
  return { action: (form.getAttribute('action') ?? 'comment') as Href, fields, textName: 'text' };
};

const parseRoot = (fat: Element, doc: Document): Story | Comment => {
  const row = fat.querySelector('tr.athing')!;
  if (!row.classList.contains('submission')) return resolveThread([parseCommentRow(row, doc)], null)[0]!;
  const top = fat.querySelector('.toptext')?.innerHTML.trim();
  return { ...parseStoryRow(row, doc), text: top || null };
};

export const parseItem = (doc: Document, url: URL): Page => {
  const fat = doc.querySelector('table.fatitem')!;
  const root = parseRoot(fat, doc);
  const tree = doc.querySelector('table.comment-tree');
  return {
    kind: 'item',
    meta: parseMeta(doc, url),
    root,
    form: parseReplyForm(fat),
    comments: tree ? resolveThread(commentRows(tree).map((r) => parseCommentRow(r, doc)), root.id) : [],
    more: moreOf(doc),
  };
};
