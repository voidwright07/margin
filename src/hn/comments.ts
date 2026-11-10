import { collectActions, COMMENT_ACTIONS } from './actions';
import { ageOf, idFromHref, text, userOf } from './dom';
import { moreOf, parseMeta } from './meta';
import type { Comment, Page } from './types';

type CommentRow = Omit<Comment, 'parentId'> & { parentLink: number | null };

/** Parse one comment row: `tr.athing.comtr` on trees, plain `tr.athing` on listings. */
export const parseCommentRow = (row: Element, doc: ParentNode): CommentRow => {
  const id = Number(row.getAttribute('id'));
  const head = row.querySelector('span.comhead');
  const commtext = row.querySelector('.commtext');
  const headText = text(head);
  const onstory = head?.querySelector('.onstory a');
  const parentA = Array.from(head?.querySelectorAll('.navs a') ?? []).find((a) => text(a) === 'parent');
  const by = userOf(head) ?? '';
  const indent = row.querySelector('td.ind')?.getAttribute('indent');
  return {
    type: 'comment',
    id,
    by,
    ...ageOf(head),
    html: commtext?.innerHTML.trim() ?? '',
    depth: indent ? Number(indent) : 0,
    dead: headText.includes('[dead]') || headText.includes('[flagged]'),
    deleted: by === '' && !commtext,
    story: onstory
      ? { id: idFromHref(onstory.getAttribute('href')) ?? 0, title: onstory.getAttribute('title') ?? text(onstory) }
      : null,
    parentLink: parentA ? idFromHref(parentA.getAttribute('href')) : null,
    actions: collectActions([head, row.querySelector('.reply')], doc, id, COMMENT_ACTIONS),
  };
};

/**
 * Resolve parentId and story in document order. On a tree, a comment's parent is the nearest
 * earlier comment one level shallower; on listings HN's explicit 'parent' link wins.
 */
export const resolveThread = (rows: CommentRow[], rootId: number | null): Comment[] => {
  const stack: Comment[] = [];
  return rows.map(({ parentLink, ...c }) => {
    stack.length = Math.min(stack.length, c.depth);
    const comment: Comment = {
      ...c,
      parentId: parentLink ?? stack[c.depth - 1]?.id ?? rootId,
      story: c.story ?? stack[0]?.story ?? null,
    };
    stack[c.depth] = comment;
    return comment;
  });
};

/** Listings (newcomments, bestcomments) use plain tr.athing, trees add .comtr; both hold td.default. */
export const commentRows = (root: ParentNode): Element[] =>
  Array.from(root.querySelectorAll('tr.athing')).filter((r) => r.querySelector('td.default') !== null);

export const parseComments = (doc: Document, url: URL): Page => ({
  kind: 'comments',
  meta: parseMeta(doc, url),
  comments: resolveThread(commentRows(doc).map((r) => parseCommentRow(r, doc)), null),
  more: moreOf(doc),
});
