# Margin for Hacker News: design

Working name "Margin". It is a free, store-bound browser extension (Chrome/Edge + Firefox, Manifest V3). It redesigns every Hacker News page and ships every feature ModernHN sells as Pro, at no cost. Branding, visuals and code are original. Do not copy ModernHN's name, CSS or assets.

## The problem with ModernHN

ModernHN shows the new design only on some URLs, so `news?p=2`, `newest?next=…` and other pages fall back to the old look. Margin chooses a renderer from the **shape of the DOM** and ignores the URL path. Every HN list page uses the same `tr.athing.submission` + `td.subtext` rows. Every comment listing uses `tr.athing.comtr`. One parser per shape therefore covers every URL that produces that shape, including pagination and pages added in the future.

## Stack

- WXT (MV3, builds `chrome-mv3` and `firefox-mv3`), TypeScript strict, Preact, Vitest + linkedom for the parser tests.
- Permissions: `storage` only. Host permission: `https://news.ycombinator.com/*`. No remote code, no analytics, and all data stays local. This keeps store review simple.

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
  | { kind: 'comments'; meta: PageMeta; comments: Comment[]; more: Href | null }              // threads, newcomments, bestcomments, favorites&comments=t
  | { kind: 'item';     meta: PageMeta; root: Story | Comment; form: ReplyForm | null; comments: Comment[]; more: Href | null }
  | { kind: 'user';     meta: PageMeta; user: UserProfile }
  | { kind: 'passthrough'; meta: PageMeta }      // login, submit, reply, edit, lists, formatdoc, etc. They get theme CSS only.
```

The comment list stays flat in document order with `depth`, the same way HN stores it. The renderer and keyboard navigation work on that flat array. Collapsing a comment skips forward until `depth <= collapsed.depth`. No tree object is built.

### Routing is a detector registry, not URL branches

```ts
const detectors: Array<{ kind: Page['kind']; test(doc: Document): boolean; parse(doc, url): Page }> = [
  item (doc has table.fatitem), user (td[timestamp] inside the "user:" row), comments (tr.comtr),
  stories (tr.athing.submission), passthrough (fallback, always matches)
]
```

The first match wins. Adding a page type means adding one entry.

## Persistent state

`src/store/` holds a single versioned schema in `chrome.storage.local`, with `{ version, settings, history, bookmarks, highlights }`. Backup exports exactly this JSON. Restore validates it at the boundary and migrates by version.

- `settings`: theme (`system|light|classic|slate|dark|black`), font (`sans|serif|mono`), fontSize, columnWidth, lineHeight, justify, indexView (`list|table|compact`), tableColumns, openLinksInNewTab, enabled (old-design toggle), keyboard on/off.
- `history`: `Record<storyId, { title, url, lastVisit, commentCount, seen: number[] }>` capped by LRU at 2000 stories. `seen` stores the comment ids already rendered on a visit. "New replies" means the ids on the current visit minus `seen`.
- `bookmarks`: a tagged union `{ type: 'story' | 'comment' | 'user'; id; savedAt; snapshot }`.
- `highlights`: `{ id, itemId, commentId | null, text, createdAt }`, re-applied by text match inside the target node.

Keep all storage access behind one module. Components subscribe through a single hook, and nothing else reads `chrome.storage`.

## Runtime flow (content script, `news.ycombinator.com/*`)

1. `document_start`: if enabled, add `html.margin-loading`, which hides the body, and inject the theme variables early so no flash shows.
2. On `DOMContentLoaded`: run the detector registry, parse, hide the original `<center>` and mount Preact in `#margin-root`. Keep the original DOM so the old-design toggle is instant. A failed parse is caught: unhide the original, apply theme CSS only, and `console.warn`. A page never ends up blank.
3. Navigation stays full page loads on plain links. Actions (vote, hide, fave, flag) call `fetch(href, { credentials: 'include' })` and update optimistically. Inline reply posts the `ReplyForm`. To reply to a comment, fetch `reply?id=…`, parse its form for the `hmac`, then POST.

## Feature checklist (ModernHN free + Pro)

Free: themes, fonts, styles (width, line height, justify), history page/panel, inline reply and collapsible threads, list/table index with configurable columns, redesigned profile with tabs (about / submissions / comments / favorites), every account action, one-click old-design toggle.

Pro (free here): bookmarks (stories, comments, users) and a bookmarks panel; highlighter; new-reply badges on story rows plus jumping between new comments; user hover card (reuses the user parser on a same-origin `user?id=` fetch, cached, 400 ms hover delay); selection popup (highlight, quote into reply, copy, speak via `speechSynthesis`, search HN via `hn.algolia.com`); control pad with keyboard shortcuts (`j/k` move, `n/p` next/prev new comment, `[`/`]` page, `o` open, `c` comments, `u` upvote, `b` bookmark, `x` collapse, `?` help); date picker for `front?day=`; backup and restore as JSON.

Beyond ModernHN: every list and comment page in its paginated forms, plus `item?id=…&p=N` comment pagination.

## Verification

- `pnpm test`: the fixture suite in `fixtures/` (real HN HTML, captured 2026-11-10). Every fixture must route to its expected `kind` and parse non-empty, correct data. A table in the test maps each fixture to its kind.
- Visual check: a headless Puppeteer script (Chrome for Testing, `headless: true`, extension loaded) serves fixtures through request interception for `news.ycombinator.com` and writes screenshots to a scratch directory for review. **It must never open a visible window** (the user's standing rule). Keep live requests to HN at a minimum, because HN rate-limits.
