import { useEffect, useState } from 'preact/hooks';
import { appendedCount, autoLoads, type FeedPage } from '../feed/feed';
import type { Href } from '../hn/types';
import { MoreLink } from './common';
import type { FeedControl } from './useFeed';

/**
 * Where each page of a feed starts. The first page gets an invisible marker; later pages a divider that links
 * to the page's own URL, so it can be shared or opened the classic way. `[` and `]` move between markers, and
 * the address bar follows the one in view.
 */
export function PageMark({ page, index }: { page: FeedPage<unknown>; index: number }) {
  if (index === 0) return <div class="mg-page-mark" data-mg-page data-href={page.href} />;
  return (
    <div class="mg-page-divider" data-mg-page data-href={page.href}>
      <a href={page.href}>Page {page.number}</a>
      {page.items.length === 0 && <span>everything here is already above</span>}
    </div>
  );
}

/** The same divider as a table row, for the table view. */
export function PageRow({ page, columns }: { page: FeedPage<unknown>; columns: number }) {
  return (
    <tr class="mg-page-row" data-mg-page data-href={page.href}>
      <td colSpan={columns}>
        <div class="mg-page-divider">
          <a href={page.href}>Page {page.number}</a>
        </div>
      </td>
    </tr>
  );
}

const seconds = (ms: number) => Math.max(1, Math.ceil(ms / 1000));

/** Re-render once a second until `until`, so a countdown stays current. */
function useCountdown(until: number | null): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (until === null) return;
    setNow(Date.now());
    const t = setInterval(() => {
      setNow(Date.now());
      if (Date.now() >= until) clearInterval(t);
    }, 1000);
    return () => clearInterval(t);
  }, [until]);
  return until === null ? 0 : Math.max(0, until - now);
}

/**
 * The bottom of a list. With infinite scroll off it is HN's More link, unchanged. With it on, the element is the
 * sentinel the feed watches, and it shows what the feed is doing: loading, a Load more button after the
 * auto-load cap, a calm rate-limit notice with Retry, an error with a link to open the page normally, or the end.
 */
export function FeedTail<T>({ control, enabled, more, service = 'Hacker News' }: {
  control: FeedControl<T>;
  enabled: boolean;
  more: Href | null;
  /** Who answers the page requests, named in the rate-limit notice. */
  service?: string;
}) {
  const { feed, loadMore, sentinel } = control;
  const { tail } = feed;
  const wait = useCountdown(tail.status === 'rate-limited' ? tail.retryAt : null);
  if (!enabled) return <MoreLink href={more} />;
  const number = feed.pages[feed.pages.length - 1]!.number + 1;
  const ask = (e: Event) => {
    e.preventDefault();
    loadMore();
  };

  let body;
  switch (tail.status) {
    case 'idle':
      body = autoLoads(feed) ? (
        <a class="mg-feed-more" href={tail.next} rel="next" data-mg-next onClick={ask}>
          More
        </a>
      ) : (
        <>
          <p class="mg-feed-note">{appendedCount(feed)} more pages loaded as you scrolled.</p>
          <a class="mg-btn" href={tail.next} rel="next" data-mg-next data-mg-load-more onClick={ask}>
            Load more
          </a>
        </>
      );
      break;
    case 'loading':
      body = (
        <p class="mg-feed-status" role="status">
          <span class="mg-feed-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          Loading page {number}…
        </p>
      );
      break;
    case 'rate-limited':
      body = (
        <div class="mg-feed-notice is-limited" role="status">
          <h2>{service} needs a moment</h2>
          <p>It is limiting how fast this browser loads pages, so Margin stopped loading. Retry in a little while, or open page {number} on its own.</p>
          <div class="mg-feed-acts">
            <button type="button" class="mg-btn" data-mg-retry disabled={wait > 0} onClick={loadMore}>
              {wait > 0 ? `Retry in ${seconds(wait)}s` : 'Retry'}
            </button>
            <a class="mg-btn mg-btn-ghost" href={tail.next}>
              Open page {number}
            </a>
          </div>
        </div>
      );
      break;
    case 'error':
      body = (
        <div class="mg-feed-notice is-error" role="status">
          <h2>Page {number} could not be shown here</h2>
          <p>{tail.message} The page itself may still open normally.</p>
          <div class="mg-feed-acts">
            <a class="mg-btn" href={tail.next} data-mg-open-page>
              Open page {number}
            </a>
            <button type="button" class="mg-btn mg-btn-ghost" data-mg-retry onClick={loadMore}>
              Retry
            </button>
          </div>
        </div>
      );
      break;
    case 'end':
      body = appendedCount(feed) > 0 ? <p class="mg-feed-end">End of the list</p> : null;
      break;
  }
  return (
    <div class="mg-feed-tail" ref={sentinel} data-state={tail.status}>
      {body}
    </div>
  );
}
