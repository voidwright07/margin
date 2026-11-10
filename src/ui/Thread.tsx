import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Comment, Page } from '../hn/types';
import { commentBookmark } from '../store/ops';
import type { Highlight } from '../store/schema';
import { useStore } from '../store/store';
import { BookmarkButton, UserLink } from './common';
import { Composer } from './Composer';
import { applyHighlights } from './highlight';
import { IconDown, IconUp } from './icons';
import { useHnToggle } from './useToggle';

type ItemPage = Extract<Page, { kind: 'item' }>;

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

type Row = { comment: Comment; ancestors: number[]; size: number; collapsed: boolean };

/** Walk the flat array once, skipping everything under a collapsed comment until depth returns to its level. */
export const visibleRows = (comments: Comment[], sizes: number[], collapsed: ReadonlySet<number>): Row[] => {
  const rows: Row[] = [];
  const ancestors: number[] = [];
  let skipBelow = Infinity;
  comments.forEach((comment, i) => {
    if (comment.depth > skipBelow) return;
    skipBelow = Infinity;
    ancestors.length = comment.depth;
    const isCollapsed = collapsed.has(comment.id);
    rows.push({ comment, ancestors: [...ancestors], size: sizes[i]!, collapsed: isCollapsed });
    ancestors[comment.depth] = comment.id;
    if (isCollapsed) skipBelow = comment.depth;
  });
  return rows;
};

/** Light up every segment of one ancestor's thread line, across rows, without re-rendering. */
const setHot = (id: number, on: boolean) => {
  for (const el of Array.from(document.querySelectorAll(`.mg-rail[data-anc="${id}"]`))) el.classList.toggle('is-hot', on);
};

/** A selection popup asks for a quote by dispatching this event on document. */
export type QuoteDetail = { commentId: number | null; text: string };
export const QUOTE_EVENT = 'margin:quote';

export const quoteText = (text: string) =>
  `${text
    .trim()
    .split(/\n+/)
    .map((l) => `> ${l}`)
    .join('\n\n')}\n\n`;

export function CommentBody({ comment, highlights, itemId, canQuote }: { comment: Comment; highlights: Highlight[]; itemId: number; canQuote: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current!;
    el.innerHTML = comment.html;
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

export function CommentView({ row, op, isNew, showStory, onToggle, onCollapseAncestor, onReply, highlights, reply, itemId, canQuote }: {
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
}) {
  const { comment: c, ancestors, size, collapsed } = row;
  const story = c.story;
  return (
    <article
      id={String(c.id)}
      class={`mg-c${collapsed ? ' is-collapsed' : ''}${isNew ? ' is-new' : ''}${c.dead ? ' is-dead' : ''}`}
      data-mg-nav
      data-id={c.id}
      data-mg-new={isNew ? '' : undefined}
      aria-label={c.deleted ? 'Deleted comment' : `Comment by ${c.by}`}
    >
      <div class="mg-rails" aria-hidden="true">
        {ancestors.map((id) => (
          <button
            type="button"
            tabIndex={-1}
            class="mg-rail"
            data-anc={id}
            title="Collapse this thread"
            onClick={() => onCollapseAncestor(id)}
            onMouseEnter={() => setHot(id, true)}
            onMouseLeave={() => setHot(id, false)}
          />
        ))}
      </div>
      <div class="mg-c-main">
        <div class="mg-c-head">
          {!c.deleted && <CommentVotes comment={c} />}
          {c.deleted ? <span class="mg-c-deleted">[deleted]</span> : <UserLink name={c.by} op={op !== null && c.by === op} />}
          {op !== null && c.by === op && <span class="mg-op">OP</span>}
          <a class="mg-c-age" href={`item?id=${c.id}`} title={c.time}>
            {c.ageText}
          </a>
          {isNew && <span class="mg-new">new</span>}
          {c.dead && <span class="mg-flag-tag">dead</span>}
          <button type="button" class="mg-c-toggle" data-mg-collapse aria-expanded={!collapsed} title={collapsed ? 'Expand (x)' : 'Collapse (x)'} onClick={onToggle}>
            {collapsed ? `[+${size}]` : '[–]'}
          </button>
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
              {c.parentId !== null && !c.actions.context && c.depth === 0 && (
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
        {!collapsed && !c.deleted && <CommentBody comment={c} highlights={highlights} itemId={itemId} canQuote={canQuote} />}
        {!collapsed && reply}
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
  const [collapsed, setCollapsed] = useState<ReadonlySet<number>>(new Set());
  const [reply, setReply] = useState<{ id: number; draft: string } | null>(null);
  const allHighlights = useStore((s) => s.highlights);
  const sizes = useMemo(() => subtreeSizes(comments), [comments]);
  const highlightsByComment = useMemo(() => {
    const m = new Map<number, Highlight[]>();
    for (const h of allHighlights) if (h.commentId !== null) m.set(h.commentId, [...(m.get(h.commentId) ?? []), h]);
    return m;
  }, [allHighlights]);
  const rows = visibleRows(comments, sizes, collapsed);

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
      e.preventDefault();
      setReply((r) => ({ id: target.id, draft: (r?.id === target.id ? r.draft : '') + quoteText(text) }));
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
  }, [comments, onPosted]);

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
            onReply={canInline ? () => setReply(reply?.id === c.id ? null : { id: c.id, draft: reply?.id === c.id ? reply.draft : '' }) : null}
            highlights={highlightsByComment.get(c.id) ?? NO_HIGHLIGHTS}
            reply={
              reply?.id === c.id && onPosted && c.actions.reply ? (
                <Composer
                  source={{ replyHref: c.actions.reply }}
                  draft={reply.draft}
                  onDraft={(draft) => setReply({ id: c.id, draft })}
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
