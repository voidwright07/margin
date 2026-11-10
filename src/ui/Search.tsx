import { Fragment, type ComponentChildren } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import type { CommentHit, Href, SearchQuery, SearchRange, SearchResult, SearchSort, SearchType, Story, StoryHit } from '../hn/types';
import { excerptAt, searchTerms } from '../search/match';
import { isBlank, pageWindow, toAlgoliaWeb, toUrl } from '../search/query';
import { useStore } from '../store/store';
import { Adopt } from './Adopt';
import { ago, plural, UserLink } from './common';
import { IconChevronLeft, IconChevronRight, IconClose, IconComment, IconSearch } from './icons';
import { focusSearch } from './keyboard';
import { Marked } from './Marked';
import { FeedTail, PageMark } from './Feed';
import { loadSearchPage, searchNext, useSearch, type Load, type Search } from './searchState';
import { StoryRow } from './StoryIndex';
import { useFeed } from './useFeed';

const HITS_PER_PAGE = 20;

/**
 * The search box in the top bar. On the search page it drives live results; everywhere else it is a plain GET
 * form that lands on `search?q=…`.
 */
export function SearchField() {
  const s = useSearch();
  return (
    <form
      class="mg-search"
      action="search"
      method="get"
      role="search"
      onSubmit={
        s
          ? (e) => {
              e.preventDefault();
              s.go({ ...s.query, page: 1 });
            }
          : undefined
      }
    >
      <IconSearch size={15} />
      <input
        class="mg-input"
        type="search"
        name="q"
        data-mg-search
        placeholder="Search"
        aria-label="Search Hacker News"
        autocomplete="off"
        spellcheck={false}
        value={s?.query.q}
        onInput={s ? (e) => s.type(e.currentTarget.value) : undefined}
        onKeyDown={(e) => {
          if (e.key !== 'Escape') return;
          e.preventDefault();
          e.currentTarget.blur();
        }}
      />
      <kbd class="mg-search-key" aria-hidden="true">/</kbd>
    </form>
  );
}

const TYPES: Array<[SearchType, string]> = [
  ['story', 'Stories'],
  ['comment', 'Comments'],
  ['ask_hn', 'Ask HN'],
  ['show_hn', 'Show HN'],
  ['job', 'Jobs'],
  ['all', 'All'],
];
const SORTS: Array<[SearchSort, string]> = [
  ['popularity', 'Popular'],
  ['date', 'Newest'],
];
const RANGES: Array<[SearchRange, string]> = [
  ['all', 'All time'],
  ['day', '24 hours'],
  ['week', 'Week'],
  ['month', 'Month'],
  ['year', 'Year'],
];

type LinkAttrs = {
  class?: string | undefined;
  rel?: string;
  title?: string;
  'aria-current'?: 'page' | 'true' | undefined;
  'data-mg-prev'?: boolean;
  'data-mg-next'?: boolean;
};

/** A real link to the query's URL, so middle-click and copy work; a plain click searches in place. */
function QueryLink({ s, to, children, ...rest }: { s: Search; to: SearchQuery; children: ComponentChildren } & LinkAttrs) {
  return (
    <a
      {...rest}
      href={toUrl(to)}
      onClick={(e) => {
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        s.go(to);
      }}
    >
      {children}
    </a>
  );
}

function Segments<K extends keyof SearchQuery>({ s, field, options, label }: { s: Search; field: K; options: Array<[SearchQuery[K], string]>; label: string }) {
  return (
    <nav class="mg-seg mg-search-seg" aria-label={label}>
      {options.map(([value, text]) => {
        const on = s.query[field] === value;
        return (
          <QueryLink s={s} to={{ ...s.query, [field]: value, page: 1 }} class={on ? 'is-on' : undefined} aria-current={on ? 'true' : undefined}>
            {text}
          </QueryLink>
        );
      })}
    </nav>
  );
}

function Filters({ s }: { s: Search }) {
  const { author, site } = s.query;
  if (!author && !site) return null;
  return (
    <div class="mg-search-filters">
      {author && (
        <QueryLink s={s} to={{ ...s.query, author: null, page: 1 }} class="mg-chip" title="Remove this filter">
          by {author} <IconClose size={12} />
        </QueryLink>
      )}
      {site && (
        <QueryLink s={s} to={{ ...s.query, site: null, page: 1 }} class="mg-chip" title="Remove this filter">
          from {site} <IconClose size={12} />
        </QueryLink>
      )}
    </div>
  );
}

const shown = (load: Load): SearchResult | null => (load.status === 'ready' ? load.result : load.status === 'loading' ? load.stale : null);

function Summary({ s }: { s: Search }) {
  const infinite = useStore((st) => st.settings.infiniteScroll);
  const result = shown(s.load);
  let text = '';
  if (s.load.status === 'loading') text = 'Searching…';
  else if (result) text = plural(result.total, 'result') + (result.pages > 1 && !infinite ? ` · page ${result.page} of ${result.pages}` : '');
  return (
    <div class="mg-search-summary">
      <span aria-live="polite">{text}</span>
      {!isBlank(s.query) && (
        <a href={toAlgoliaWeb(s.query)} target="_blank" rel="noopener">
          Open on Algolia
        </a>
      )}
    </div>
  );
}

/** A clamped excerpt has no room for blank lines between paragraphs. */
const excerpt = (text: string, terms: string[]) => excerptAt(text, terms).replace(/\n\s*\n/g, '\n');

const isoOf = (created: number) => new Date(created * 1000).toISOString().replace('.000Z', 'Z');

const hitStory = (h: StoryHit, rank: number): Story => ({
  type: 'story',
  id: h.id,
  rank,
  title: h.title,
  url: (h.url ?? `item?id=${h.id}`) as Href,
  site: h.site,
  score: h.points,
  by: h.author,
  time: isoOf(h.created),
  ageText: ago(h.created * 1000),
  comments: h.comments,
  text: null,
  dead: false,
  flagged: false,
  actions: {},
});

function CommentHitRow({ hit, terms, rank }: { hit: CommentHit; terms: string[]; rank: number }) {
  return (
    <li class="mg-story mg-hit-c" data-mg-nav data-id={hit.id}>
      <div class="mg-story-rail">
        <span class="mg-rank">{rank}</span>
        <span class="mg-hit-glyph" title="Comment">
          <IconComment size={14} />
        </span>
      </div>
      <div class="mg-story-main">
        <div class="mg-meta">
          <UserLink name={hit.author} />
          <a href={`item?id=${hit.id}`} data-mg-open title={isoOf(hit.created)}>
            {ago(hit.created * 1000)}
          </a>
          {hit.storyTitle && (
            <span class="mg-hit-on">
              on:{' '}
              <a href={`item?id=${hit.storyId}`} data-mg-comments>
                <Marked text={hit.storyTitle} terms={terms} />
              </a>
            </span>
          )}
        </div>
        <p class="mg-hit-text">
          <Marked text={excerpt(hit.text, terms)} terms={terms} />
        </p>
      </div>
    </li>
  );
}

/** One page of results; `page` (1-based) numbers the rows. */
function Hits({ hits, page, terms, stale }: { hits: Array<StoryHit | CommentHit>; page: number; terms: string[]; stale: boolean }) {
  const newTab = useStore((st) => st.settings.openLinksInNewTab);
  const history = useStore((st) => st.history);
  const offset = (page - 1) * HITS_PER_PAGE;
  return (
    <ol class={`mg-stories mg-hits${stale ? ' is-stale' : ''}`} aria-busy={stale}>
      {hits.map((hit, i) =>
        hit.type === 'story' ? (
          <StoryRow story={hitStory(hit, offset + i + 1)} newTab={newTab} entry={history[hit.id]} onHidden={() => {}} terms={terms}>
            {hit.text && (
              <p class="mg-hit-text mg-hit-text-story">
                <Marked text={excerpt(hit.text, terms)} terms={terms} />
              </p>
            )}
          </StoryRow>
        ) : (
          <CommentHitRow hit={hit} terms={terms} rank={offset + i + 1} />
        ),
      )}
    </ol>
  );
}

function Skeleton() {
  return (
    <ol class="mg-hits-skeleton" aria-label="Loading results">
      {[0, 1, 2, 3, 4, 5].map(() => (
        <li>
          <span class="mg-skel-line" />
          <span class="mg-skel-line is-short" />
        </li>
      ))}
    </ol>
  );
}

function Empty({ s }: { s: Search }) {
  const q = s.query;
  return (
    <div class="mg-search-state">
      <h2>{q.q.trim() ? `No results for “${q.q.trim()}”` : 'No results'}</h2>
      <p>Check the spelling, or widen the search.</p>
      <div class="mg-search-state-acts">
        {q.range !== 'all' && (
          <QueryLink s={s} to={{ ...q, range: 'all', page: 1 }} class="mg-btn">
            Search all time
          </QueryLink>
        )}
        {q.type !== 'all' && (
          <QueryLink s={s} to={{ ...q, type: 'all', page: 1 }} class="mg-btn">
            Search stories and comments
          </QueryLink>
        )}
      </div>
    </div>
  );
}

function Failed({ s, load }: { s: Search; load: Extract<Load, { status: 'failed' }> }) {
  const limited = load.failure === 'rate-limited';
  return (
    <div class={`mg-search-state is-error${limited ? ' is-limited' : ''}`} role="alert">
      <h2>{limited ? 'Too many searches for a moment' : 'Search is unavailable'}</h2>
      <p>{limited ? 'hn.algolia.com is limiting requests from this browser. Wait a minute, then try again.' : load.message}</p>
      <div class="mg-search-state-acts">
        <button type="button" class="mg-btn" onClick={s.retry}>
          Try again
        </button>
        <a class="mg-btn mg-btn-ghost" href={toAlgoliaWeb(s.query)} target="_blank" rel="noopener">
          Open on Algolia
        </a>
      </div>
    </div>
  );
}

function Idle() {
  return (
    <div class="mg-search-state is-idle">
      <h2>Search Hacker News</h2>
      <p>
        Every story and comment, through hn.algolia.com. Press <kbd>/</kbd> on any page to start.
      </p>
    </div>
  );
}

function Pager({ s, result }: { s: Search; result: SearchResult }) {
  if (result.pages <= 1) return null;
  const { page, pages } = result;
  const to = (n: number) => ({ ...s.query, page: n });
  return (
    <nav class="mg-pager" aria-label="Result pages">
      {page > 1 ? (
        <QueryLink s={s} to={to(page - 1)} class="mg-pager-step" rel="prev" data-mg-prev>
          <IconChevronLeft size={14} /> Prev
        </QueryLink>
      ) : (
        <span class="mg-pager-step is-disabled">
          <IconChevronLeft size={14} /> Prev
        </span>
      )}
      {pageWindow(page, pages).map((n) =>
        n === 'gap' ? (
          <span class="mg-pager-gap">…</span>
        ) : (
          <QueryLink s={s} to={to(n)} class={n === page ? 'is-on' : undefined} aria-current={n === page ? 'page' : undefined}>
            {n}
          </QueryLink>
        ),
      )}
      {page < pages ? (
        <QueryLink s={s} to={to(page + 1)} class="mg-pager-step" rel="next" data-mg-next>
          Next <IconChevronRight size={14} />
        </QueryLink>
      ) : (
        <span class="mg-pager-step is-disabled">
          Next <IconChevronRight size={14} />
        </span>
      )}
    </nav>
  );
}

function Results({ s }: { s: Search }) {
  const terms = useMemo(() => searchTerms(s.query.q), [s.query.q]);
  const infinite = useStore((st) => st.settings.infiniteScroll);
  const { load } = s;
  switch (load.status) {
    case 'idle':
      return <Idle />;
    case 'failed':
      return <Failed s={s} load={load} />;
    case 'loading':
      return load.stale ? <Hits hits={load.stale.hits} page={load.stale.page} terms={terms} stale /> : <Skeleton />;
    case 'ready':
      if (load.result.hits.length === 0) return <Empty s={s} />;
      if (infinite) return <ResultFeed key={toUrl(load.query)} query={load.query} result={load.result} terms={terms} />;
      return (
        <>
          <Hits hits={load.result.hits} page={load.result.page} terms={terms} stale={false} />
          <Pager s={s} result={load.result} />
        </>
      );
  }
}

/** Results with infinite scroll: later pages append under dividers, through the same cache as the pager. */
function ResultFeed({ query, result, terms }: { query: SearchQuery; result: SearchResult; terms: string[] }) {
  const [first] = useState(() => ({ href: toUrl(query), number: result.page, items: result.hits }));
  const control = useFeed('search', true, first, searchNext(query, result), loadSearchPage);
  return (
    <>
      {control.feed.pages.map((p, i) => (
        <Fragment key={p.href}>
          <PageMark page={p} index={i} />
          <Hits hits={p.items} page={p.number} terms={terms} stale={false} />
        </Fragment>
      ))}
      <FeedTail control={control} enabled more={null} service="hn.algolia.com" />
    </>
  );
}

/** HN's "Unknown." text sits loose in <body>; tuck it away, and give it back if the original design returns. */
const hnNotice = () => Array.from(document.body.childNodes).filter((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim());

export function SearchView() {
  const s = useSearch()!;
  useEffect(() => {
    if (isBlank(s.query)) focusSearch();
  }, []);
  return (
    <div class="mg-search-page">
      <div class="mg-search-controls">
        <Segments s={s} field="type" options={TYPES} label="Result type" />
        <div class="mg-search-controls-row">
          <Segments s={s} field="sort" options={SORTS} label="Sort" />
          <Segments s={s} field="range" options={RANGES} label="Date range" />
        </div>
      </div>
      <Filters s={s} />
      <Summary s={s} />
      <Results s={s} />
      <Adopt class="mg-hidden" nodes={hnNotice} />
    </div>
  );
}
