import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Comment, Page } from '../hn/types';
import { commentBookmark, saveCollapsed } from '../store/ops';
import type { Highlight } from '../store/schema';
import { getState, update, useStore } from '../store/store';
import { BookmarkButton, UserLink } from './common';
import { collapsedPreview, markQuotes } from './commentText';
import { Composer, QUOTE_EVENT, quoteText, type QuoteDetail } from './Composer';
import { applyHighlights } from './highlight';
import { IconDown, IconUp } from './icons';
import { focusComment } from './keyboard';
import { navTarget } from './threadNav';
import { useHnToggle } from './useToggle';

type ItemPage = Extract<Page, { kind: 'item' }>;

/**
 * Deeper comments stop indenting at this many rails and show "replying to" instead. thread.css hides rails
 * past the narrow cap on mobile widths, so the label renders from the narrow cap and CSS shows it there.
 */
export const RAIL_CAP = { wide: 6, narrow: 3 } as const;

/** Size of each comment's subtree (itself included), from the flat depth-ordered array. */
export const subtreeSizes = (comments: Comment[]): number[] => {
  const sizes = comments.map(() => 1);
  const stack: number[] = [];
  comments.forEach((c, i) => {
    while (stack.length && comments[stack[stack.length - 1]!]!.depth >= c.depth) stack.pop();
    for (const j of stack) sizes[j]! += 1;
    stack.push(i);
  });
  return sizes;
};

/**
 * What one rail column draws in a row. Column k carries the line of the ancestor at depth k. In the last column
 * that line bends into this comment: 'tee' when a later sibling keeps the line going, 'end' when this is the
 * last reply. Columns further left pass straight through ('pipe') while that branch has more replies below,
 * and are blank ('none') once it has ended.
 */
export type Line = 'pipe' | 'none' | 'tee' | 'end';

type Row = {
  comment: Comment;
  index: number;
  ancestors: number[];
  lines: Line[];
  size: number;
  collapsed: boolean;
  /** The next visible row is a reply, so this comment's own line runs down to it. */
  repliesShown: boolean;
};

/** For each comment, whether another reply to the same parent follows it. One backward pass over the flat array. */
export const hasLaterSibling = (comments: Comment[]): boolean[] => {
  const later = comments.map(() => false);
  const seen: boolean[] = [];
  for (let i = comments.length - 1; i >= 0; i--) {
    const d = comments[i]!.depth;
    later[i] = seen[d] === true;
    seen.length = d;
    seen[d] = true;
  }
  return later;
};

/** Walk the flat array once, skipping everything under a collapsed comment until depth returns to its level. */
export const visibleRows = (comments: Comment[], sizes: number[], collapsed: ReadonlySet<number>): Row[] => {
  const later = hasLaterSibling(comments);
  const rows: Row[] = [];
  const ancestors: number[] = [];
  const path: number[] = []; // indices of the comments on the way down to this one, by depth
  let skipBelow = Infinity;
  comments.forEach((comment, i) => {
    if (comment.depth > skipBelow) return;
    skipBelow = Infinity;
    const d = comment.depth;
    ancestors.length = d;
    path.length = d;
    path[d] = i;
    const lines = ancestors.map((_, k): Line => {
      if (k === d - 1) return later[i] ? 'tee' : 'end';
      const branch = path[k + 1];
      return branch !== undefined && later[branch] ? 'pipe' : 'none';
    });
    const isCollapsed = collapsed.has(comment.id);
    rows.push({ comment, index: i, ancestors: [...ancestors], lines, size: sizes[i]!, collapsed: isCollapsed, repliesShown: false });
    ancestors[d] = comment.id;
    if (isCollapsed) skipBelow = d;
  });
  rows.forEach((row, j) => (row.repliesShown = (rows[j + 1]?.comment.depth ?? -1) > row.comment.depth));
  return rows;
};

/** Light up every segment of one ancestor's thread line, across rows, without re-rendering. */
const setHot = (id: number, on: boolean) => {
  for (const el of Array.from(document.querySelectorAll(`.mg-rail[data-anc="${id}"]`))) el.classList.toggle('is-hot', on);
};

export function CommentBody({ comment, highlights, itemId, canQuote }: { comment: Comment; highlights: Highlight[]; itemId: number; canQuote: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current!;
    el.innerHTML = comment.html;
    markQuotes(el);
    applyHighlights(el, highlights);
  }, [comment.html, highlights]);
  return <div ref={ref} class="mg-commtext" data-mg-text data-comment-id={comment.id} data-item-id={itemId} data-can-quote={String(canQuote)} />;
}

function CommentVotes({ comment }: { comment: Comment }) {
  const up = useHnToggle('vote', comment.actions.unvote, comment.actions.upvote);
  const canDown = comment.actions.downvote !== undefined;
  const down = useHnToggle('vote', undefined, comment.actions.downvote);
  if (!up.available) return <span class="mg-cvote-none" />;
  return (
    <span class="mg-cvotes">
      <button type="button" class={`mg-cvote${up.active ? ' is-on' : ''}`} data-mg-vote aria-pressed={up.active} title={up.active ? 'Remove your vote (u)' : 'Upvote (u)'} onClick={up.toggle}>
        <IconUp size={12} />
      </button>
      {canDown && !up.active && (
        <button type="button" class={`mg-cvote${down.active ? ' is-on is-down' : ''}`} aria-pressed={down.active} title="Downvote" onClick={down.toggle}>
          <IconDown size={12} />
        </button>
      )}
    </span>
  );
}

function FaveFlag({ comment }: { comment: Comment }) {
  const fave = useHnToggle('fave', comment.actions.unfave, comment.actions.fave);
  const flag = useHnToggle('flag', comment.actions.unflag, comment.actions.flag);
  return (
    <>
      {fave.available && (
        <button type="button" class="mg-act" onClick={fave.toggle}>
          {fave.active ? 'unfavorite' : 'favorite'}
        </button>
      )}
      {flag.available && (
        <button type="button" class="mg-act" onClick={flag.toggle}>
          {flag.active ? 'unflag' : 'flag'}
        </button>
      )}
    </>
  );
}

const INTERACTIVE = 'a, button, input, textarea, select, label, [role="button"]';

/** A click on bare header space toggles collapse; controls, links and a text selection keep their own meaning. */
const isHeaderToggleClick = (e: MouseEvent): boolean => {
  if ((e.target as Element).closest(INTERACTIVE)) return false;
  const sel = window.getSelection();
  return !sel || sel.isCollapsed || sel.toString().trim() === '';
};

function ParentText({ html }: { html: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    ref.current!.innerHTML = html;
    markQuotes(ref.current!);
  }, [html]);
  return <div ref={ref} class="mg-commtext mg-parentpop-text" />;
}

/** Past the indent cap, a comment names the one it answers; hover or focus previews it, click goes there. */
function ReplyingTo({ parent, deep }: { parent: Comment; deep: boolean }) {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const show = (delay: number) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(true), delay);
  };
  const hide = () => {
    clearTimeout(timer.current);
    setOpen(false);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  const author = parent.deleted ? '[deleted]' : parent.by;
  return (
    <div class={`mg-c-replyto${deep ? ' is-deep' : ''}`} onMouseEnter={() => show(250)} onMouseLeave={hide}>
      <button
        type="button"
        class="mg-replyto-btn"
        aria-expanded={open}
        title="Go to the parent comment"
        onFocus={() => show(0)}
        onBlur={hide}
        onKeyDown={(e) => e.key === 'Escape' && hide()}
        onClick={() => focusComment(parent.id)}
      >
        ↳ replying to <b>{author}</b>
      </button>
      {open && (
        <div class="mg-popover mg-parentpop" role="tooltip">
          <div class="mg-parentpop-head">
            <b>{author}</b> {parent.ageText}
          </div>
          {!parent.deleted && <ParentText html={parent.html} />}
        </div>
      )}
    </div>
  );
}

const jumpTo = (id: number) => (e: MouseEvent) => {
  e.preventDefault();
  focusComment(id);
};

export function CommentView({ row, op, isNew, showStory, onToggle, onCollapseAncestor, onReply, highlights, reply, itemId, canQuote, parent, root }: {
  row: Row;
  itemId: number;
  canQuote: boolean;
  op: string | null;
  isNew: boolean;
  showStory: boolean;
  onToggle: () => void;
  onCollapseAncestor: (id: number) => void;
  onReply: (() => void) | null;
  highlights: Highlight[];
  reply: preact.ComponentChildren;
  /** Parent and root of this comment in the rendered thread, or null when they are not on the page. */
  parent: Comment | null;
  root: Comment | null;
}) {
  const { comment: c, ancestors, size, collapsed } = row;
  const story = c.story;
  const isOp = op !== null && c.by === op;
  const replying = reply !== null;
  const preview = useMemo(() => (collapsed && !c.deleted ? collapsedPreview(c.html, document) : ''), [collapsed, c.deleted, c.html]);
  return (
    <article
      id={String(c.id)}
      class={`mg-c${c.depth === 0 ? ' is-top' : ''}${collapsed ? ' is-collapsed' : ''}${isNew ? ' is-new' : ''}${c.dead ? ' is-dead' : ''}${isOp ? ' is-op' : ''}${replying ? ' is-replying' : ''}`}
      data-mg-nav
      data-id={c.id}
      data-depth={c.depth}
      data-mg-new={isNew ? '' : undefined}
      aria-label={c.deleted ? 'Deleted comment' : `Comment by ${c.by}`}
    >
      <div class="mg-rails" aria-hidden="true">
        {ancestors.slice(0, RAIL_CAP.wide).map((id, k) => (
          <button
            type="button"
            tabIndex={-1}
            class="mg-rail"
            data-anc={id}
            data-level={k}
            data-line={row.lines[k]}
            title="Collapse this thread"
            onClick={() => onCollapseAncestor(id)}
            onMouseEnter={() => setHot(id, true)}
            onMouseLeave={() => setHot(id, false)}
          />
        ))}
      </div>
      <div class="mg-c-main">
        {parent && !collapsed && c.depth > RAIL_CAP.narrow && <ReplyingTo parent={parent} deep={c.depth > RAIL_CAP.wide} />}
        <div class="mg-c-head" onClick={(e) => isHeaderToggleClick(e) && onToggle()}>
          {!c.deleted && <CommentVotes comment={c} />}
          {c.deleted ? <span class="mg-c-deleted">[deleted]</span> : <UserLink name={c.by} op={isOp} />}
          {isOp && <span class="mg-op">OP</span>}
          <a class="mg-c-age" href={`item?id=${c.id}`} title={c.time}>
            {c.ageText}
          </a>
          {isNew && <span class="mg-new">new</span>}
          {c.dead && <span class="mg-flag-tag">dead</span>}
          <button type="button" class="mg-c-toggle" data-mg-collapse aria-expanded={!collapsed} title={collapsed ? 'Expand (x)' : 'Collapse (x)'} onClick={onToggle}>
            {collapsed ? `[+${size}]` : '[–]'}
          </button>
          {preview && <span class="mg-c-preview">“{preview}”</span>}
          {!collapsed && parent && (
            <span class="mg-c-navs">
              {root && root !== parent && (
                <a href={`#${root.id}`} title="Root of this thread (r)" onClick={jumpTo(root.id)}>
                  root
                </a>
              )}
              <a href={`#${parent.id}`} title="Parent comment (h)" onClick={jumpTo(parent.id)}>
                parent
              </a>
            </span>
          )}
          {!collapsed && !c.deleted && (
            <span class="mg-c-acts">
              {onReply && (
                <button type="button" class="mg-act" data-mg-reply onClick={onReply}>
                  reply
                </button>
              )}
              {!onReply && c.actions.reply && (
                <a class="mg-act" href={c.actions.reply}>
                  reply
                </a>
              )}
              {c.actions.context && (
                <a class="mg-act" href={c.actions.context}>
                  context
                </a>
              )}
              {!parent && c.parentId !== null && !c.actions.context && story !== null && c.parentId !== story.id && (
                <a class="mg-act" href={`item?id=${c.parentId}`}>
                  parent
                </a>
              )}
              <FaveFlag comment={c} />
              {c.actions.edit && <a class="mg-act" href={c.actions.edit}>edit</a>}
              {c.actions.delete && <a class="mg-act" href={c.actions.delete}>delete</a>}
              <BookmarkButton label="comment" make={() => commentBookmark(c, story, Date.now())} />
            </span>
          )}
          {showStory && story && (
            <span class="mg-c-on">
              on <a href={`item?id=${story.id}`}>{story.title}</a>
            </span>
          )}
        </div>
        {!collapsed && (
          <div class="mg-c-body">
            {row.repliesShown && c.depth < RAIL_CAP.wide && (
              <button
                type="button"
                tabIndex={-1}
                class="mg-rail mg-rail-own"
                aria-hidden="true"
                data-anc={c.id}
                data-level={c.depth}
                title="Collapse this thread"
                onClick={onToggle}
                onMouseEnter={() => setHot(c.id, true)}
                onMouseLeave={() => setHot(c.id, false)}
              />
            )}
            {!c.deleted && <CommentBody comment={c} highlights={highlights} itemId={itemId} canQuote={canQuote} />}
            {reply}
          </div>
        )}
      </div>
    </article>
  );
}

const NO_HIGHLIGHTS: Highlight[] = [];

export function Thread({ comments, op, newIds, showStory, onPosted, itemId }: {
  comments: Comment[];
  /** The story this thread belongs to; null on listings, where each comment names its own story. */
  itemId: number | null;
  op: string | null;
  newIds: ReadonlySet<number>;
  showStory: boolean;
  onPosted: ((page: ItemPage) => void) | null;
}) {
  // Collapse state persists on the story's history entry; listings span many stories and keep it in memory only.
  const [collapsed, setCollapsedIds] = useState<ReadonlySet<number>>(() => new Set(itemId === null ? [] : (getState().history[String(itemId)]?.collapsed ?? [])));
  // The open reply box and the text it starts with; the box keeps what is typed after that.
  const [reply, setReply] = useState<{ id: number; seed: string } | null>(null);
  const allHighlights = useStore((s) => s.highlights);
  const sizes = useMemo(() => subtreeSizes(comments), [comments]);
  const highlightsByComment = useMemo(() => {
    const m = new Map<number, Highlight[]>();
    for (const h of allHighlights) if (h.commentId !== null) m.set(h.commentId, [...(m.get(h.commentId) ?? []), h]);
    return m;
  }, [allHighlights]);
  const rows = visibleRows(comments, sizes, collapsed);
  const at = (i: number | null) => (i === null ? null : comments[i]!);

  const setCollapsed = (next: ReadonlySet<number>) => {
    setCollapsedIds(next);
    if (itemId !== null) void update((s) => saveCollapsed(s, itemId, [...next]));
  };
  const toggle = (id: number) => {
    const next = new Set(collapsed);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setCollapsed(next);
  };
  const collapseAncestor = (id: number) => {
    setCollapsed(new Set([...collapsed, id]));
    requestAnimationFrame(() => document.getElementById(String(id))?.scrollIntoView({ block: 'nearest' }));
  };

  useEffect(() => {
    const onQuote = (e: Event) => {
      const { commentId, text } = (e as CustomEvent<QuoteDetail>).detail;
      const target = comments.find((c) => c.id === commentId);
      if (!target || !onPosted || !target.actions.reply) return;
      // An open box for this comment takes the quote itself.
      setReply((r) => (r?.id === target.id ? r : { id: target.id, seed: quoteText(text) }));
    };
    const onCollapseAll = (e: Event) => {
      const all = (e as CustomEvent<boolean>).detail;
      setCollapsed(all ? new Set(comments.filter((c) => c.depth === 0).map((c) => c.id)) : new Set());
    };
    document.addEventListener(QUOTE_EVENT, onQuote);
    document.addEventListener('margin:collapse-all', onCollapseAll);
    return () => {
      document.removeEventListener(QUOTE_EVENT, onQuote);
      document.removeEventListener('margin:collapse-all', onCollapseAll);
    };
  }, [comments, onPosted, itemId]);

  if (comments.length === 0) return null;

  return (
    <div class="mg-thread">
      {rows.map((row) => {
        const c = row.comment;
        const canInline = onPosted !== null && c.actions.reply !== undefined;
        return (
          <CommentView
            key={c.id}
            row={row}
            itemId={itemId ?? c.story?.id ?? c.id}
            canQuote={canInline}
            op={op}
            isNew={newIds.has(c.id)}
            showStory={showStory && c.depth === 0}
            onToggle={() => toggle(c.id)}
            onCollapseAncestor={collapseAncestor}
            onReply={canInline ? () => setReply(reply?.id === c.id ? null : { id: c.id, seed: '' }) : null}
            highlights={highlightsByComment.get(c.id) ?? NO_HIGHLIGHTS}
            parent={at(navTarget(comments, row.index, 'parent'))}
            root={at(navTarget(comments, row.index, 'root'))}
            reply={
              reply?.id === c.id && onPosted && c.actions.reply ? (
                <Composer
                  source={{ replyHref: c.actions.reply }}
                  seed={reply.seed}
                  quotesFor={(id) => id === c.id}
                  onPosted={(page) => {
                    setReply(null);
                    onPosted(page);
                  }}
                  onCancel={() => setReply(null)}
                  autoFocus
                />
              ) : null
            }
          />
        );
      })}
    </div>
  );
}
