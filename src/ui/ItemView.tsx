import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Comment, Page, Story } from '../hn/types';
import { newCommentIds, recordVisit, storyBookmark } from '../store/ops';
import type { Highlight } from '../store/schema';
import { getState, update, useStore } from '../store/store';
import { BookmarkButton, MoreLink, plural, UserLink } from './common';
import { Composer } from './Composer';
import { applyHighlights } from './highlight';
import { IconUp } from './icons';
import { CommentView, QUOTE_EVENT, quoteText, Thread, type QuoteDetail } from './Thread';
import { useStoryVote } from './StoryIndex';
import { useHnToggle } from './useToggle';

type ItemPage = Extract<Page, { kind: 'item' }>;

function StoryText({ story, highlights }: { story: Story; highlights: Highlight[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current!;
    el.innerHTML = story.text ?? '';
    applyHighlights(el, highlights);
  }, [story.text, highlights]);
  return <div ref={ref} class="mg-toptext mg-commtext" data-mg-text data-comment-id="" />;
}

function StoryHeader({ story, newTab }: { story: Story; newTab: boolean }) {
  const { vote, score } = useStoryVote(story);
  const fave = useHnToggle('fave', story.actions.unfave, story.actions.fave);
  const flag = useHnToggle('flag', story.actions.unflag, story.actions.flag);
  const hide = useHnToggle('hide', story.actions.unhide, story.actions.hide);
  const highlights = useStore((s) => s.highlights);
  const own = useMemo(() => highlights.filter((h) => h.itemId === story.id && h.commentId === null), [highlights, story.id]);
  const external = /^https?:/.test(story.url);
  return (
    <header class="mg-item-head">
      <div class="mg-item-titlerow">
        {vote.available && (
          <button type="button" class={`mg-vote mg-vote-lg${vote.active ? ' is-on' : ''}`} data-mg-vote aria-pressed={vote.active} title={vote.active ? 'Remove your vote (u)' : 'Upvote (u)'} onClick={vote.toggle}>
            <IconUp size={16} />
          </button>
        )}
        <div>
          <h1 class="mg-item-title">
            <a href={story.url} target={external && newTab ? '_blank' : undefined} rel={external ? 'noopener' : undefined} data-mg-open>
              {story.title}
            </a>
          </h1>
          {story.site && (
            <a class="mg-site" href={`from?site=${story.site}`}>
              {story.site}
            </a>
          )}
        </div>
      </div>
      <div class="mg-meta mg-item-meta">
        {score !== null && <span>{plural(score, 'point')}</span>}
        {story.by && (
          <span>
            by <UserLink name={story.by} />
          </span>
        )}
        <span title={story.time}>{story.ageText}</span>
        {story.comments !== null && <span>{plural(story.comments, 'comment')}</span>}
        <span class="mg-meta-acts">
          {fave.available && (
            <button type="button" class={`mg-act${fave.active ? ' is-on' : ''}`} onClick={fave.toggle}>
              {fave.active ? 'unfavorite' : 'favorite'}
            </button>
          )}
          {hide.available && (
            <button type="button" class="mg-act" onClick={hide.toggle}>
              {hide.active ? 'unhide' : 'hide'}
            </button>
          )}
          {flag.available && (
            <button type="button" class="mg-act" onClick={flag.toggle}>
              {flag.active ? 'unflag' : 'flag'}
            </button>
          )}
          {story.actions.past && (
            <a class="mg-act" href={story.actions.past}>
              past
            </a>
          )}
          {story.actions.edit && <a class="mg-act" href={story.actions.edit}>edit</a>}
          {story.actions.delete && <a class="mg-act" href={story.actions.delete}>delete</a>}
          <BookmarkButton label="story" make={() => storyBookmark(story, Date.now())} />
        </span>
      </div>
      {story.text && <StoryText story={story} highlights={own} />}
    </header>
  );
}

/** Ids new since the previous visit; computed once per page load, before this visit is recorded. */
function useVisit(root: Story | Comment, comments: Comment[]): ReadonlySet<number> {
  const [newIds] = useState(() =>
    root.type === 'story' ? newCommentIds(getState().history[String(root.id)], comments.map((c) => c.id)) : new Set<number>(),
  );
  useEffect(() => {
    if (root.type !== 'story') return;
    void update((s) => recordVisit(s, root, comments.map((c) => c.id), Date.now()));
  }, [root, comments]);
  return newIds;
}

function ThreadToolbar({ count, newCount }: { count: number; newCount: number }) {
  const [all, setAll] = useState(false);
  const jump = () => document.dispatchEvent(new CustomEvent('margin:next-new'));
  return (
    <div class="mg-thread-bar">
      <h2>{plural(count, 'comment')}</h2>
      {newCount > 0 && (
        <button type="button" class="mg-btn mg-btn-accent" onClick={jump} title="Jump to the next new comment (n)">
          {plural(newCount, 'new comment')}
        </button>
      )}
      <span class="mg-spacer" />
      <button
        type="button"
        class="mg-btn mg-btn-ghost"
        onClick={() => {
          document.dispatchEvent(new CustomEvent('margin:collapse-all', { detail: !all }));
          setAll(!all);
        }}
      >
        {all ? 'Expand all' : 'Collapse all'}
      </button>
    </div>
  );
}

export function ItemView({ page: initial }: { page: ItemPage }) {
  const [page, setPage] = useState(initial);
  const [draft, setDraft] = useState('');
  const newTab = useStore((s) => s.settings.openLinksInNewTab);
  const { root, comments, form } = page;
  const newIds = useVisit(root, comments);
  const op = root.type === 'story' ? root.by : null;

  useEffect(() => {
    const onQuote = (e: Event) => {
      const { commentId, text } = (e as CustomEvent<QuoteDetail>).detail;
      if (e.defaultPrevented || !form) return;
      if (commentId !== null && commentId !== root.id) return;
      setDraft((d) => d + quoteText(text));
      document.querySelector<HTMLTextAreaElement>('.mg-root-composer textarea')?.focus();
    };
    document.addEventListener(QUOTE_EVENT, onQuote);
    return () => document.removeEventListener(QUOTE_EVENT, onQuote);
  }, [form, root.id]);

  const rootComment =
    root.type === 'comment' ? (
      <div class="mg-root-comment">
        <CommentView
          row={{ comment: root, ancestors: [], size: 1, collapsed: false }}
          op={null}
          isNew={false}
          showStory
          onToggle={() => {}}
          onCollapseAncestor={() => {}}
          onReply={null}
          highlights={[]}
          reply={null}
        />
      </div>
    ) : null;

  return (
    <div class="mg-item">
      {root.type === 'story' ? <StoryHeader story={root} newTab={newTab} /> : rootComment}
      {form && (
        <div class="mg-root-composer">
          <Composer
            source={{ form }}
            draft={draft}
            onDraft={setDraft}
            submitLabel={root.type === 'story' ? 'Add comment' : 'Reply'}
            onPosted={(next) => {
              setDraft('');
              setPage(next);
            }}
          />
        </div>
      )}
      {comments.length > 0 && <ThreadToolbar count={comments.length} newCount={newIds.size} />}
      <Thread comments={comments} op={op} newIds={newIds} showStory={false} onPosted={setPage} />
      <MoreLink href={page.more} label="More comments" />
    </div>
  );
}

