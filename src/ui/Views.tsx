import type { Page } from '../hn/types';
import { userBookmark } from '../store/ops';
import { Adopt } from './Adopt';
import { BookmarkButton, MoreLink, PageHead, plural, profileTabFor, ProfileTabs } from './common';
import { Thread } from './Thread';

type CommentsPage = Extract<Page, { kind: 'comments' }>;
type UserPage = Extract<Page, { kind: 'user' }>;

const NO_NEW: ReadonlySet<number> = new Set();

const COMMENT_TITLES: Partial<Record<NonNullable<CommentsPage['meta']['section']>, string>> = {
  newcomments: 'New comments',
  bestcomments: 'Best comments',
};

export function CommentListing({ page }: { page: CommentsPage }) {
  const profile = profileTabFor(page.meta);
  const title = page.meta.section ? COMMENT_TITLES[page.meta.section] : undefined;
  return (
    <div class="mg-listing">
      {profile && (
        <div class="mg-profile-strip">
          <a class="mg-profile-strip-name" href={`user?id=${profile.id}`}>{profile.id}</a>
          <ProfileTabs id={profile.id} active={profile.active} />
        </div>
      )}
      {profile?.active === 'favorites' && (
        <nav class="mg-subtabs mg-subtabs-small" aria-label="Favorite kind">
          <a href={`favorites?id=${profile.id}`}>Submissions</a>
          <a href={`favorites?id=${profile.id}&comments=t`} class="is-active">Comments</a>
        </nav>
      )}
      {title && <PageHead title={title} />}
      {page.comments.length === 0 ? (
        <p class="mg-empty">No comments here yet.</p>
      ) : (
        <Thread comments={page.comments} op={null} newIds={NO_NEW} showStory onPosted={null} itemId={null} />
      )}
      <MoreLink href={page.more} />
    </div>
  );
}

const memberFor = (created: number) => {
  const years = (Date.now() / 1000 - created) / (365.25 * 24 * 3600);
  return years >= 1 ? plural(Math.floor(years), 'year') : 'less than a year';
};

export function Profile({ page }: { page: UserPage }) {
  const { user } = page;
  return (
    <div class="mg-profile">
      <header class="mg-profile-head">
        <div class="mg-avatar" aria-hidden="true">
          {user.id.slice(0, 1).toUpperCase()}
        </div>
        <div class="mg-profile-id">
          <h1>{user.id}</h1>
          <p class="mg-meta">
            <span>{plural(user.karma, 'karma point')}</span>
            <span title={new Date(user.created * 1000).toISOString()}>
              joined {user.createdText}, {memberFor(user.created)} ago
            </span>
          </p>
        </div>
        <BookmarkButton label="user" make={() => userBookmark({ id: user.id, karma: user.karma }, Date.now())} />
      </header>
      <ProfileTabs id={user.id} active="about" />
      {user.editable ? (
        <section class="mg-profile-about">
          <h2 class="mg-section-title">Your profile and settings</h2>
          <Adopt class="mg-adopted mg-profile-form" nodes={() => [document.querySelector('form.profileform')].filter((n): n is HTMLFormElement => n !== null)} />
        </section>
      ) : (
        <section class="mg-profile-about">
          {user.about ? (
            <div class="mg-commtext" data-mg-text dangerouslySetInnerHTML={{ __html: user.about }} />
          ) : (
            <p class="mg-empty">{user.id} has not written an about section.</p>
          )}
        </section>
      )}
    </div>
  );
}

/**
 * Pages Margin does not redesign (login, submit, reply, edit, lists, …) keep HN's own forms, moved into the
 * themed layout. They go back where they came from when the original design is shown.
 */
export const passthroughNodes = (): Node[] => {
  const cell = document.querySelector('#bigbox > td');
  if (cell) return Array.from(cell.childNodes);
  const main = document.querySelector('#hnmain');
  if (main) {
    const rows = Array.from(main.querySelectorAll(':scope > tbody > tr, :scope > tr')).slice(2);
    return rows.flatMap((r) => Array.from(r.querySelectorAll(':scope > td')).flatMap((td) => Array.from(td.childNodes)));
  }
  // A leading text node is HN's notice ("Bad login."); Passthrough shows it separately.
  const nodes = Array.from(document.body.childNodes).filter(
    (n) => !(n instanceof HTMLElement && (n.id === 'margin-root' || n.tagName === 'SCRIPT')),
  );
  return nodes[0]?.nodeType === Node.TEXT_NODE ? nodes.slice(1) : nodes;
};

export function Passthrough({ page }: { page: Extract<Page, { kind: 'passthrough' }> }) {
  return (
    <div class="mg-passthrough">
      {page.meta.notice && <p class="mg-notice">{page.meta.notice}</p>}
      <Adopt class="mg-adopted" nodes={passthroughNodes} />
    </div>
  );
}
