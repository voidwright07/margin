# Margin for Hacker News: design

Working name "Margin". It is a free, store-bound browser extension (Chrome/Edge + Firefox, Manifest V3). It redesigns every Hacker News page and ships every feature ModernHN sells as Pro, at no cost. Branding, visuals and code are original. Do not copy ModernHN's name, CSS or assets.

## The problem with ModernHN

ModernHN shows the new design only on some URLs, so `news?p=2`, `newest?next=…` and other pages fall back to the old look. Margin chooses a renderer from the **shape of the DOM** and ignores the URL path. Every HN list page uses the same `tr.athing.submission` + `td.subtext` rows. Every comment listing uses `tr.athing.comtr`. One parser per shape therefore covers every URL that produces that shape, including pagination and pages added in the future.

## Stack

- WXT (MV3, builds `chrome-mv3` and `firefox-mv3`), TypeScript strict, Preact, Vitest + linkedom for the parser tests.
- Permissions: `storage` only. Host permission: `https://news.ycombinator.com/*`. No remote code, no analytics, and all data stays local. This keeps store review simple. Search reads `hn.algolia.com/api/v1`, which answers the HN origin with `access-control-allow-origin`, so it needs no further permission.

## Core data shape

`src/hn/types.ts` defines a discriminated union. Each parser returns one variant, and the app renders on `page.kind`.

```ts
type Href = string & { __brand: 'Href' }      // absolute or HN-relative link taken from the page

type Viewer = { name: string; karma: number; logout: Href } | null   // from #me / #logout in .pagetop

type PageMeta = {
  viewer: Viewer
  url: URL
  section: Section | null      // 'news'|'newest'|'front'|'ask'|'show'|'jobs'|'best'|'active'|'threads'|'newcomments'|... from .topsel / path
  notice: string | null        // HN banner / error text, if any
}

type Story = {
  id: number; rank: number | null; title: string; url: Href; site: string | null
  score: number | null; by: string | null; time: string /* ISO, from span.age[title] */; ageText: string
  comments: number | null      // null for jobs and when there is no discuss link
  text: string | null          // toptext HTML (Ask HN / item page only)
  dead: boolean; flagged: boolean
  actions: Partial<Record<'upvote'|'unvote'|'downvote'|'hide'|'unhide'|'fave'|'unfave'|'flag'|'unflag'|'past'|'edit'|'delete', Href>>
}

type Comment = {
  id: number; by: string; time: string; ageText: string
  html: string                 // innerHTML of .commtext. HN already sanitizes it.
  depth: number                // td.ind[indent]
  dead: boolean; deleted: boolean
  story: { id: number; title: string } | null    // .onstory, present on listing pages
  parentId: number | null                         // derived from depth on trees; the 'parent' link on listings
  actions: Partial<Record<'upvote'|'unvote'|'downvote'|'reply'|'edit'|'delete'|'flag'|'fave'|'context', Href>>
}

type ReplyForm = { action: Href; fields: Record<string, string> /* parent, goto, hmac */; textName: 'text' }

type Page =
  | { kind: 'stories';  meta: PageMeta; stories: Story[]; more: Href | null; heading: string | null }
  | { kind: 'search';   meta: PageMeta; query: SearchQuery }                                   // results load from Algolia, not the DOM
  | { kind: 'comments'; meta: PageMeta; comments: Comment[]; more: Href | null }              // threads, newcomments, bestcomments, favorites&comments=t
  | { kind: 'item';     meta: PageMeta; root: Story | Comment; form: ReplyForm | null; comments: Comment[]; more: Href | null }
  | { kind: 'user';     meta: PageMeta; user: UserProfile }
  | { kind: 'passthrough'; meta: PageMeta }      // login, submit, reply, edit, lists, formatdoc, etc. They get theme CSS only.
```

The comment list stays flat in document order with `depth`, the same way HN stores it. The renderer and keyboard navigation work on that flat array. Collapsing a comment skips forward until `depth <= collapsed.depth`. No tree object is built.

### Routing is a detector registry, not URL branches

```ts
const detectors: Array<{ kind: Page['kind']; test(doc: Document): boolean; parse(doc, url): Page }> = [
  item (doc has table.fatitem), user (td[timestamp] inside the "user:" row), comments (tr.athing holding td.default),
  stories (tr.athing.submission), search (path /search and HN's "Unknown." body), passthrough (fallback, always matches)
]
```

The first match wins. Adding a page type means adding one entry. `test` also receives the URL, for search only: HN has no search page, so `/search` answers with a bare "Unknown." and the path is the only signal. The detector requires both.

The captured HTML corrected three details of the first draft:

- Comment *listings* (`newcomments`, `bestcomments`, `favorites?comments=t`) use plain `tr.athing`; only trees (`item`, `threads`) add `.comtr`. The comments detector therefore matches any `tr.athing` that holds a `td.default` comment cell.
- `section` comes from `<html op="…">`, which HN sets on every framed page (`news`, `newest`, `front`, `threads`, …). No URL path is consulted.
- On item pages HN writes the `parent` link as a fragment (`#50443236`), so `parentId` on trees comes from the depth stack; on listings the `parent` link's `?id=` wins.

`Story` and `Comment` carry a `type: 'story' | 'comment'` tag so `item.root: Story | Comment` can be narrowed without guessing from fields. `UserProfile` is `{ id, created (unix seconds from td[timestamp]), createdText, karma, about (HTML or null), editable }`; `editable` is true on your own profile, where HN renders the settings form, and the renderer adopts that form into the About tab.

## Search

HN's own search lives on hn.algolia.com. Margin keeps it inside the redesign on `news.ycombinator.com/search?…`.

```ts
type SearchQuery = {
  q: string; type: 'story'|'comment'|'ask_hn'|'show_hn'|'job'|'all'; sort: 'popularity'|'date'
  range: 'all'|'day'|'week'|'month'|'year'; page: number /* 1-based, like ?p= */; author: string | null; site: string | null
}
type SearchResult = { hits: Array<StoryHit | CommentHit>; total: number; page: number /* 1-based */; pages: number }
```

- `src/search/query.ts` holds the pure parts. `parseQuery(searchParams)` fills defaults for anything missing or invalid. `toUrl(query)` writes Margin's URL with defaults left out, so links are short and shareable. `toAlgolia(query, now)` writes the API request: `search` or `search_by_date`, a type tag plus `author_<name>`, `numericFilters=created_at_i>…` for a range, `page` counted from 0, and `restrictSearchableAttributes=url` with the site in the query text for a site filter. `toAlgoliaWeb(query)` links the same search on hn.algolia.com.
- `src/search/response.ts` is the API boundary. It checks the envelope, reads each hit into a `StoryHit` or `CommentHit`, and drops hits it cannot show. `comment_text` and `story_text` become plain text there (paragraphs kept, tags dropped, entities decoded). Results render as text nodes only: no response HTML is ever parsed on the page. Comment excerpts are clamped to a few lines, so HN's italics and links add little, and text-only rendering keeps markup from a third-party service out of the page.
- `src/search/match.ts` highlights terms itself. It splits text into segments at word-start matches of the query's words, and the UI wraps matches in `<mark>`. Algolia's `_highlightResult` HTML is never used.
- `src/ui/searchState.ts` is the page's controller, shared through a context by the top-bar field and the results. Loading is a union: `idle | loading (with the previous results, shown dimmed) | ready | failed (rate-limited | http | network | bad-response)`. Results are cached per URL for the page's lifetime, so Back and `[` are instant and Algolia sees fewer requests.
- History: typing updates the field at once, then after 300 ms replaces the current entry's URL and searches. Enter, a filter and a page link push an entry. Before pushing, the controller restores the last deliberate URL on the current entry, so Back returns to the previous search and never to a half-typed draft. `popstate` reparses the URL.
- With `settings.infiniteScroll` on, results continue the same way story lists do (see Infinite scroll): the pager gives way to page dividers, the next page loads through `loadSearchPage`, which shares the per-URL result cache, and ranks continue from the page number. A `ready` load carries the query that produced it, so a half-typed draft never relabels the results on screen. A 429 from Algolia is the same calm rate-limit tail, naming hn.algolia.com. With the setting off, the pager and `[`/`]` paging are unchanged.
- Story hits render through the same `StoryRow` as story lists, so they get the bookmark action, visited state and new-comment badges. Comment hits show author, age (linking to the comment), "on:" the story, and the clamped text.
- In the original design `/search` would show HN's bare "Unknown.", so `boot.tsx` replaces the location with `toAlgoliaWeb` of the current URL instead of showing the return pill. Switching to the original design while on a search page does the same.
- The search page hides HN's loose "Unknown." text node with the same adopt-and-restore helper passthrough pages use, and `boot.tsx` adds a mobile viewport meta when a page has none, as that 404 page does not.
- Entry points: the top-bar field on every page (`/`), the selection popup's Search HN, "Search <name>'s posts" on a profile (`author=` with type All), and "Search <site>" on HN's own `from?site=` page. Domain links on story rows still open `from?site=`, which HN serves and Margin already redesigns.

## Infinite scroll

Every page whose `Page` is `stories` or `comments` continues at its `more` link as the reader nears the bottom, and the search page continues at its next result page. `settings.infiniteScroll` (on by default) turns it off, and then the More link is exactly as before.

```ts
type FeedPage<T> = { href: Href; number: number; items: T[] }      // href is HN-relative: news?p=2
type Tail =
  | { status: 'idle'; next: Href } | { status: 'loading'; next: Href }
  | { status: 'error'; next: Href; message: string }
  | { status: 'rate-limited'; next: Href; retryAt: number }
  | { status: 'end' }                                                // no next: an ended feed holds no link
type Feed<T> = { pages: FeedPage<T>[]; tail: Tail; strikes: number /* rate limits in a row */ }
type Outcome<T> = { type: 'page'; items: T[]; next: Href | null } | { type: 'rate-limited' } | { type: 'error'; message: string }
```

- `src/feed/feed.ts` holds the transitions, all pure: `beginLoad` (a no-op unless a load is allowed, so a second trigger never starts a second request), `settle` (applies an `Outcome` only to the load in flight), `autoLoads` and `canLoad`. Merging drops items whose id is already shown, because `news` and `newest` shift while the reader scrolls; a repeated comment takes its deeper replies with it. A `next` link that points at a page already shown ends the feed.
- `readListPage` in `src/app/hn-client.ts` reads a fetched page with the same registry as a page load. HN's throttle page ("Sorry, we're not able to serve your requests this quickly."), a 503 and a 429 are `rate-limited`. Any other failure, or a page of another shape, is an `error`: the tail shows "Page N could not be shown here" with a link that opens the page normally.
- Politeness. Nothing loads until the reader scrolls (or presses `j` past the end), so opening a page costs HN one request. An IntersectionObserver with a 1200 px bottom margin starts one load at a time, at least a second apart, and never while the tab is hidden. A rate limit stops auto-loading; Retry is disabled for 5 s, doubling with each limit in a row up to 60 s, and nothing retries on its own. After ten pages loaded without asking, a "Load more" button takes over.
- Each added page starts with a divider, "Page N", linking to that page's own URL. Page one gets an invisible marker. Ranks are HN's own numbers, so a deduped page can skip a rank. Hidden stories are filtered when rendering and stay in the feed, so ranks and the dedupe of later pages do not change.
- The address bar follows the page in view (the last marker in the top third of the screen) through `history.replaceState`, so no history entries are added and a copied URL opens that page.
- Back. `src/feed/session.ts` gives each history entry an id in `history.state` and saves the entry's feed and scroll offset to `sessionStorage` after each page and on `pagehide` (the six most recent entries). When the document is loaded by Back or Forward (`PerformanceNavigationTiming.type === 'back_forward'`, meaning bfcache did not keep it), `parseSnapshot` in `src/feed/restore.ts` validates the saved JSON: the same version and kind of list, saved in the last 30 minutes, with well-formed items, and holding the URL in the address bar among its pages. A valid snapshot renders every saved page and restores the offset, with items on the freshly loaded page taking its current data. Anything else is a normal load of the URL in the address bar.
- Keys. `j` past the last item asks for the next page. `]` and `[` jump to the next and previous page marker and focus its first row; past the last marker `]` loads more, and above the first `[` keeps its old meaning. Votes, hide, bookmarks, hover cards, new-reply badges and the selection popup need nothing extra: they live on each row or listen on the document.
- `src/ui/useFeed.ts` is the only effectful part: fetching, the observer, the scroll listener, the address bar and saving. `src/ui/Feed.tsx` renders the markers and the tail (the sentinel the observer watches).

## Persistent state

`src/store/` holds a single versioned schema in `chrome.storage.local`, with `{ version, settings, history, bookmarks, highlights }`. Backup exports exactly this JSON. Restore validates it at the boundary and migrates by version.

- `settings`: theme (`system|light|classic|slate|dark|black`), font (`sans|serif|mono`), fontSize, columnWidth, lineHeight, justify, indexView (`list|table|compact`), tableColumns, openLinksInNewTab, enabled (old-design toggle), keyboard on/off, threadLines (`rainbow|accent|mono`, the rail colours), infiniteScroll (on by default; off keeps HN's More link).
- `history`: `Record<storyId, { title, url, lastVisit, commentCount, seen: number[], collapsed: number[] }>` capped by LRU at 2000 stories. `seen` stores the comment ids already rendered on a visit. "New replies" means the ids on the current visit minus `seen`. `collapsed` holds the comments the reader collapsed in that story's threads (the 200 most recent), so it is capped, pruned, backed up and restored together with its history entry.
- `bookmarks`: a tagged union `{ type: 'story' | 'comment' | 'user'; id; savedAt; snapshot }`.
- `highlights`: `{ id, itemId, commentId | null, text, createdAt }`, re-applied by text match inside the target node.

Keep all storage access behind one module. Components subscribe through a single hook, and nothing else reads `chrome.storage`.

## Runtime flow (content script, `news.ycombinator.com/*`)

1. `document_start`: if enabled, add `html.margin-loading`, which hides the body, and inject the theme variables early so no flash shows.
2. On `DOMContentLoaded`: run the detector registry, parse, hide the original `<center>` and mount Preact in `#margin-root`. Keep the original DOM so the old-design toggle is instant. A failed parse is caught: unhide the original, apply theme CSS only, and `console.warn`. A page never ends up blank.
3. Navigation stays full page loads on plain links. Actions (vote, hide, fave, flag) call `fetch(href, { credentials: 'include' })` and update optimistically. Inline reply posts the `ReplyForm`. To reply to a comment, fetch `reply?id=…`, parse its form for the `hmac`, then POST.

### Implementation notes

These details were settled while building and differ from, or add to, the plan above.

- The store keeps a boot hint (`enabled` and `theme` only) in the page's `localStorage` under `margin:boot`. `chrome.storage` is asynchronous, and the hint lets step 1 theme the page and hide the old design before the first paint. The store module writes and reads the hint; nothing else touches it.
- Display has three modes, chosen in `src/app/boot.tsx`: `margin` (new design), `original` (user toggled off; a small pill returns) and `raw` (parse or render failed; original page with theme colours). A Preact error boundary reports render failures into `raw`.
- Passthrough pages, and the settings form on your own profile, move HN's original nodes into the themed layout and put them back on unmount, so the old-design toggle restores an untouched DOM.
- Logged-out readers see HN's reply form markup, but HN rejects their posts. Margin shows "Log in to comment" instead of a composer when `meta.viewer` is null, and comment replies stay plain links to HN.
- Keyboard focus is a `data-mg-focused` attribute, not a class, because Preact rewrites `className` when a row re-renders.
- The section tabs include Comments (`newcomments`) in addition to the sections HN lists in its header.

### Comment threads

Thread styles live in `src/ui/thread.css`; the structure helpers work on the flat comment array.

- Rails are coloured by depth. `thread.css` defines six hues per theme and mixes each into the page background, so a rail is easy to follow but stays quiet. `settings.threadLines` sets `html[data-mg-lines]`: `rainbow` cycles the six hues, `accent` uses the accent hue and fades it with depth, and `mono` is gray. Hovering a rail draws its whole branch in the full hue.
- Quotes are found in the rendered DOM, not in the HTML string. After a comment's HTML is inserted, `markQuotes` (`src/ui/commentText.ts`) walks its top-level nodes. A paragraph whose text starts with `>`, including HN's bare first paragraph, becomes a `p.mg-quote` block. The leading `>` stays in the DOM inside a hidden span, so highlights, copy and quoting still match the original text. `<pre>` is never touched; it scrolls sideways in the mono font.
- Indentation stops at 6 rails (3 below 760px wide). A deeper comment shows "↳ replying to <author>". Hovering or focusing the label previews the parent in a popover, and clicking it moves focus there.
- Parent, root and top-level moves come from `navTarget` in `src/ui/threadNav.ts`, a scan over any depth-ordered list. The thread renderer runs it on the comment array. The keyboard runs it on the rendered rows' `data-depth`, which works because collapsing hides only descendants. Comments at depth 1 and deeper get muted `parent` and `root` links in the header, as on HN.
- A click on bare header space toggles collapse; clicks on links, buttons and inputs, and clicks that end a text selection, do not. A collapsed row is one line: author, age, `[+N]` and a plain-text preview of about 80 characters.
- Top-level threads are separated by extra space and a hairline. OP comments get a faint accent tint, and the comment being replied to keeps a highlight while its reply box is open.
- Collapsed ids persist on the story's history entry (see Persistent state), so collapse survives a reload. Listings span many stories and keep collapse in memory only.

## Feature checklist (ModernHN free + Pro)

Free: themes, fonts, styles (width, line height, justify), history page/panel, inline reply and collapsible threads, list/table index with configurable columns, redesigned profile with tabs (about / submissions / comments / favorites), every account action, one-click old-design toggle.

Pro (free here): bookmarks (stories, comments, users) and a bookmarks panel; highlighter; new-reply badges on story rows plus jumping between new comments; user hover card (reuses the user parser on a same-origin `user?id=` fetch, cached, 400 ms hover delay); selection popup (highlight, quote into reply, copy, speak via `speechSynthesis`, search HN on Margin's search page); control pad with keyboard shortcuts (`j/k` move, `Shift+J`/`Shift+K` next/prev top-level comment, `h` parent, `r` thread root, `n/p` next/prev new comment, `R` reply, `[`/`]` page, `o` open, `c` comments, `u` upvote, `b` bookmark, `x` collapse, `/` search, `?` help); date picker for `front?day=`; backup and restore as JSON.

Beyond ModernHN: every list and comment page in its paginated forms, plus `item?id=…&p=N` comment pagination, infinite scroll on story and comment lists that survives the Back button, and native search in the top bar with type, sort and date filters.

## Verification

- `pnpm test`: the fixture suite in `fixtures/` (real HN HTML, captured 2026-11-10). Every fixture must route to its expected `kind` and parse non-empty, correct data. A table in the test maps each fixture to its kind. `fixtures/synthetic/` holds labelled synthetic pages for states the capture lacks; `item-deep.html` (a thread ten levels deep, with quotes and a `<pre>` block) is generated by `scripts/synthetic-deep.mjs`.
- `pnpm e2e` (`scripts/e2e.mjs`): headless behaviour checks on the built extension against fixtures, asserting the exact requests sent for votes, favorites and replies, plus keys, history, highlights and the old-design toggle. The harness answers `hn.algolia.com/api/v1` from `fixtures/algolia/` (real responses captured 2026-11-10) with the CORS header the real API sends, and serves `/search` under a strict page CSP. The search checks assert the exact API URLs for typing, filters and pages, history push and Back, `/`, the selection popup and the 429 state. The infinite-scroll checks assert the exact HN pages fetched (one More link per load, none before a scroll, none while hidden or rate-limited), dedupe, ranks, the address bar, `j`, `[`/`]`, the ten-page cap and Back restore. The e2e browser runs with bfcache off, so Back always reloads and restore is proven without it. `scripts/synthetic-feed.mjs` writes the synthetic shifted page two and throttle page, and the harness serves synthetic `news?p=3` and beyond from the same module.
- Visual check: a headless Puppeteer script (Chrome for Testing, `headless: true`, extension loaded) serves fixtures through request interception for `news.ycombinator.com` and writes screenshots to a scratch directory for review. **It must never open a visible window** (the user's standing rule). Keep live requests to HN at a minimum, because HN rate-limits.
