import { hrefOf, text } from './dom';
import type { CommentAction, Href, StoryAction } from './types';

type AnyAction = StoryAction | CommentAction;

/** HN labels each account action with a fixed word; this table is the whole vocabulary. */
const BY_LABEL: Record<string, AnyAction> = {
  hide: 'hide',
  'un-hide': 'unhide',
  past: 'past',
  favorite: 'fave',
  'un-favorite': 'unfave',
  flag: 'flag',
  unflag: 'unflag',
  edit: 'edit',
  delete: 'delete',
  context: 'context',
  reply: 'reply',
};

/** Vote arrows are found by id anywhere in the document; the rest by label inside `scopes`. */
export const collectActions = <A extends AnyAction>(
  scopes: Array<Element | null | undefined>,
  doc: ParentNode,
  id: number,
  allowed: readonly A[],
): Partial<Record<A, Href>> => {
  const found = new Map<AnyAction, Href>();
  const arrow = (prefix: string, key: AnyAction) => {
    const a = doc.querySelector(`a[id="${prefix}_${id}"]`);
    const h = hrefOf(a);
    if (a && h && !a.classList.contains('nosee')) found.set(key, h);
  };
  arrow('up', 'upvote');
  arrow('down', 'downvote');
  arrow('un', 'unvote');
  for (const scope of scopes) {
    for (const a of Array.from(scope?.querySelectorAll('a') ?? [])) {
      const key = BY_LABEL[text(a).toLowerCase()];
      const h = hrefOf(a);
      if (key && h && !h.startsWith('javascript:')) found.set(key, h);
    }
  }
  const result: Partial<Record<A, Href>> = {};
  for (const k of allowed) {
    const h = found.get(k);
    if (h) result[k] = h;
  }
  return result;
};

export const STORY_ACTIONS: readonly StoryAction[] = [
  'upvote', 'unvote', 'downvote', 'hide', 'unhide', 'fave', 'unfave', 'flag', 'unflag', 'past', 'edit', 'delete',
];
export const COMMENT_ACTIONS: readonly CommentAction[] = [
  'upvote', 'unvote', 'downvote', 'reply', 'edit', 'delete', 'flag', 'unflag', 'fave', 'unfave', 'context',
];
