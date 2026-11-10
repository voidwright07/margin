import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import type { Page, Story } from '../hn/types';
import { DEFAULT_QUERY, toUrl } from '../search/query';
import { newCommentCount, storyBookmark } from '../store/ops';
import type { HistoryEntry, TableColumn } from '../store/schema';
import { useStore } from '../store/store';
import { BookmarkButton, MoreLink, plural, profileTabFor, ProfileTabs, UserLink } from './common';
import { FrontDayNav } from './FrontDayNav';
import { IconComment, IconUp } from './icons';
import { Marked } from './Marked';
import { useHnToggle } from './useToggle';

type StoriesPage = Extract<Page, { kind: 'stories' }>;

const commentsLabel = (n: number | null) => (n === null ? null : n === 0 ? 'discuss' : plural(n, 'comment'));

type Vote = ReturnType<typeof useHnToggle>;

/** The row's vote toggle plus the score it implies, so both update together. */
export function useStoryVote(story: Story): { vote: Vote; score: number | null } {
  const vote = useHnToggle('vote', story.actions.unvote, story.actions.upvote);
  const base = story.score === null ? null : story.score - (story.actions.unvote ? 1 : 0);
  return { vote, score: base === null ? null : base + (vote.active ? 1 : 0) };
}

export function VoteButton({ vote, compact }: { vote: Vote; compact?: boolean }) {
  if (!vote.available) return <span class="mg-vote mg-vote-none" />;
  return (
    <button
      type="button"
      class={`mg-vote${vote.active ? ' is-on' : ''}${compact ? ' is-compact' : ''}`}
      data-mg-vote
      aria-pressed={vote.active}
      title={vote.active ? 'Remove your vote (u)' : 'Upvote (u)'}
      onClick={vote.toggle}
    >
      <IconUp size={compact ? 12 : 14} />
    </button>
  );
}

function TitleLink({ story, newTab, terms }: { story: Story; newTab: boolean; terms?: string[] }) {
  const external = /^https?:/.test(story.url);
  return (
    <a
      class="mg-title"
      href={story.url}
      data-mg-open
      target={external && newTab ? '_blank' : undefined}
      rel={external ? 'noopener' : undefined}
    >
      {terms ? <Marked text={story.title} terms={terms} /> : story.title}
    </a>
  );
}

function NewBadge({ entry, story }: { entry: HistoryEntry | undefined; story: Story }) {
  const n = newCommentCount(entry, story.comments);
  if (!n) return null;
  return (
    <a class="mg-new" href={`item?id=${story.id}`} title={`${plural(n, 'new comment')} since your last visit`}>
      +{n}
    </a>
  );
}

function HideButton({ story, onHidden }: { story: Story; onHidden: () => void }) {
  const hide = useHnToggle('hide', story.actions.unhide, story.actions.hide, (hidden) => hidden && onHidden());
  if (!hide.available) return null;
  return (
    <button type="button" class="mg-act" onClick={hide.toggle}>
      {hide.active ? 'unhide' : 'hide'}
    </button>
  );
}

/** One story in list view. Search results reuse it with the query's terms marked and an excerpt as children. */
export function StoryRow({ story, newTab, entry, onHidden, terms, children }: {
  story: Story;
  newTab: boolean;
  entry: HistoryEntry | undefined;
  onHidden: () => void;
  terms?: string[];
  children?: ComponentChildren;
}) {
  const comments = commentsLabel(story.comments);
  const { vote, score } = useStoryVote(story);
  return (
    <li class={`mg-story${entry ? ' is-visited' : ''}${story.flagged || story.dead ? ' is-flagged' : ''}`} data-mg-nav data-id={story.id}>
      <div class="mg-story-rail">
        {story.rank !== null && <span class="mg-rank">{story.rank}</span>}
        <VoteButton vote={vote} />
      </div>
      <div class="mg-story-main">
        <div class="mg-titleline">
          {(story.flagged || story.dead) && <span class="mg-flag-tag">{story.dead ? 'dead' : 'flagged'}</span>}
          <TitleLink story={story} newTab={newTab} terms={terms} />
          {story.site && (
            <a class="mg-site" href={`from?site=${story.site}`}>
              {story.site}
            </a>
          )}
        </div>
        {children}
        <div class="mg-meta">
          {score !== null && <span>{plural(score, 'point')}</span>}
          {story.by && (
            <span>
              by <UserLink name={story.by} />
            </span>
          )}
          <a href={`item?id=${story.id}`} title={story.time}>
            {story.ageText}
          </a>
          {comments && (
            <a href={`item?id=${story.id}`} class="mg-comments-link" data-mg-comments>
              {comments}
            </a>
          )}
          <NewBadge entry={entry} story={story} />
          <span class="mg-meta-acts">
            <HideButton story={story} onHidden={onHidden} />
            {story.actions.edit && <a class="mg-act" href={story.actions.edit}>edit</a>}
            {story.actions.delete && <a class="mg-act" href={story.actions.delete}>delete</a>}
            <BookmarkButton label="story" make={() => storyBookmark(story, Date.now())} />
          </span>
        </div>
      </div>
    </li>
  );
}

function CompactRow({ story, newTab, entry }: { story: Story; newTab: boolean; entry: HistoryEntry | undefined }) {
  const { vote, score } = useStoryVote(story);
  return (
    <li class={`mg-compact-row${entry ? ' is-visited' : ''}`} data-mg-nav data-id={story.id}>
      <span class="mg-rank">{story.rank ?? ''}</span>
      <VoteButton vote={vote} compact />
      <span class="mg-compact-title">
        <TitleLink story={story} newTab={newTab} />
        {story.site && <span class="mg-site">{story.site}</span>}
      </span>
      <span class="mg-compact-num" title={score === null ? undefined : plural(score, 'point')}>
        {score ?? ''}
      </span>
      <a class="mg-compact-num mg-comments-link" href={`item?id=${story.id}`} data-mg-comments title={story.comments === null ? undefined : plural(story.comments, 'comment')}>
        {story.comments !== null && <IconComment size={13} class="mg-compact-icon" />}
        {story.comments ?? ''}
        <NewBadge entry={entry} story={story} />
      </a>
    </li>
  );
}

const COLUMN_HEAD: Record<TableColumn, string> = {
  rank: '#',
  vote: '',
  title: 'Title',
  site: 'Site',
  score: 'Points',
  by: 'Author',
  age: 'Age',
  comments: 'Comments',
};
const NUMERIC: ReadonlySet<TableColumn> = new Set(['rank', 'score', 'comments']);

function TableCell({ col, story, newTab, entry, vote, score }: { col: TableColumn; story: Story; newTab: boolean; entry: HistoryEntry | undefined; vote: Vote; score: number | null }) {
  switch (col) {
    case 'rank':
      return <>{story.rank ?? ''}</>;
    case 'vote':
      return <VoteButton vote={vote} compact />;
    case 'title':
      return (
        <>
          <TitleLink story={story} newTab={newTab} />
          {story.flagged && <span class="mg-flag-tag">flagged</span>}
        </>
      );
    case 'site':
      return story.site ? <a class="mg-site" href={`from?site=${story.site}`}>{story.site}</a> : null;
    case 'score':
      return <>{score ?? ''}</>;
    case 'by':
      return story.by ? <UserLink name={story.by} /> : null;
    case 'age':
      return <a href={`item?id=${story.id}`} title={story.time}>{story.ageText}</a>;
    case 'comments':
      return story.comments === null ? null : (
        <a href={`item?id=${story.id}`} data-mg-comments>
          {story.comments}
          <NewBadge entry={entry} story={story} />
        </a>
      );
  }
}

function TableRow({ story, columns, newTab, entry }: { story: Story; columns: TableColumn[]; newTab: boolean; entry: HistoryEntry | undefined }) {
  const { vote, score } = useStoryVote(story);
  return (
    <tr data-mg-nav data-id={story.id} class={entry ? 'is-visited' : ''}>
      {columns.map((c) => (
        <td class={`mg-col-${c}${NUMERIC.has(c) ? ' is-num' : ''}`}>
          <TableCell col={c} story={story} newTab={newTab} entry={entry} vote={vote} score={score} />
        </td>
      ))}
    </tr>
  );
}

function StoryTable({ stories, columns, newTab, history }: { stories: Story[]; columns: TableColumn[]; newTab: boolean; history: Record<string, HistoryEntry> }) {
  return (
    <div class="mg-table-wrap">
      <table class="mg-table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th class={`mg-col-${c}${NUMERIC.has(c) ? ' is-num' : ''}`} scope="col">
                {COLUMN_HEAD[c]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {stories.map((s) => (
            <TableRow story={s} columns={columns} newTab={newTab} entry={history[s.id]} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function StoryIndex({ page }: { page: StoriesPage }) {
  const settings = useStore((s) => s.settings);
  const history = useStore((s) => s.history);
  const [hidden, setHidden] = useState<ReadonlySet<number>>(new Set());
  const stories = page.stories.filter((s) => !hidden.has(s.id));
  const profile = profileTabFor(page.meta);
  const fromSite = page.meta.section === 'from' ? page.meta.url.searchParams.get('site') : null;
  const newTab = settings.openLinksInNewTab;

  let body;
  switch (settings.indexView) {
    case 'table':
      body = <StoryTable stories={stories} columns={settings.tableColumns} newTab={newTab} history={history} />;
      break;
    case 'compact':
      body = (
        <ol class="mg-compact">
          {stories.map((s) => (
            <CompactRow story={s} newTab={newTab} entry={history[s.id]} />
          ))}
        </ol>
      );
      break;
    case 'list':
      body = (
        <ol class="mg-stories">
          {stories.map((s) => (
            <StoryRow story={s} newTab={newTab} entry={history[s.id]} onHidden={() => setHidden(new Set([...hidden, s.id]))} />
          ))}
        </ol>
      );
      break;
  }

  return (
    <div class={`mg-index mg-view-${settings.indexView}`}>
      {profile && (
        <div class="mg-profile-strip">
          <a class="mg-profile-strip-name" href={`user?id=${profile.id}`}>{profile.id}</a>
          <ProfileTabs id={profile.id} active={profile.active} />
        </div>
      )}
      {page.meta.section === 'front' && <FrontDayNav meta={page.meta} heading={page.heading} />}
      {page.meta.section !== 'front' && page.heading && <p class="mg-heading">{page.heading}</p>}
      {fromSite && (
        <p class="mg-heading mg-from-head">
          <span>Stories from {fromSite}</span>
          <a href={toUrl({ ...DEFAULT_QUERY, site: fromSite })} data-mg-search-site>
            Search {fromSite}
          </a>
        </p>
      )}
      {stories.length === 0 ? <p class="mg-empty">No stories here yet.</p> : body}
      <MoreLink href={page.more} />
    </div>
  );
}
