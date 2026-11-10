# Margin for Hacker News

Margin is a free browser extension for Chrome, Edge and Firefox that redesigns every page of [Hacker News](https://news.ycombinator.com). It works on page two and beyond, on `?next=` pagination, on past front pages, on profiles and on the account pages, because it picks a layout from the shape of each page instead of its URL.

What you get:

- Six themes (system, light, classic, slate, dark, black), three font families, and settings for text size, line height, column width and justified text.
- Story lists in list, table (choose the columns) or compact view.
- Comment threads you can collapse by clicking the thread line, inline replies, and badges for comments that are new since your last visit.
- Every account action: vote, unvote, downvote, hide, favorite, flag, edit and delete.
- A library of your history, bookmarks (stories, comments and people) and highlights, with backup and restore as one JSON file.
- Profile cards when you hover a username, a selection menu (highlight, quote into your reply, copy, read aloud, search), and keyboard shortcuts. Press `?` on any page to see them.
- One click back to the original design, and one click to return.

## Privacy

Margin stores everything in your browser's extension storage (`chrome.storage.local`). It has no server, no analytics and no remote code. The only network requests it makes go to `news.ycombinator.com`, with your existing HN session, for the same actions HN's own links perform: votes, favorites, hides, flags, replies, and the profile shown in a hover card. Links you click go where they point, as they would without the extension.

The extension asks for one permission, `storage`, and access to `https://news.ycombinator.com/*`.

## Develop

You need Node 22 and pnpm 10.

```sh
pnpm install
pnpm test          # parser fixtures and store tests (Vitest)
pnpm check         # type check, then tests
```

The parser tests load every page in `fixtures/` (real HN HTML captured logged out, plus three hand-written logged-in pages in `fixtures/synthetic/`) and assert the page kind and parsed values.

Margin never uses WXT's dev server, because it opens a browser window. Build instead, then load the build.

## Build

```sh
pnpm build         # .output/chrome-mv3 and .output/firefox-mv3
pnpm zip           # store zips in .output/, plus a sources zip for Firefox review
pnpm icons         # regenerate public/icon/*.png from scripts/icons.mjs
```

## Load the unpacked extension

Chrome or Edge:

1. Run `pnpm build`.
2. Open `chrome://extensions` (or `edge://extensions`) and turn on **Developer mode**.
3. Select **Load unpacked** and choose `.output/chrome-mv3`.

Firefox:

1. Run `pnpm build`.
2. Open `about:debugging#/runtime/this-firefox`.
3. Select **Load Temporary Add-on** and choose `.output/firefox-mv3/manifest.json`.

Before you publish to addons.mozilla.org, replace the placeholder Gecko id in `wxt.config.ts`.

## Headless checks

These scripts run Chrome for Testing headless with the built extension. They answer every `news.ycombinator.com` request from `fixtures/`, so they never contact HN and never open a window.

```sh
pnpm dlx @puppeteer/browsers install chrome@stable --path .cache/browsers
pnpm build:chrome
pnpm e2e                         # behaviour checks: votes, replies, keys, history, highlights, toggle
node scripts/shots.mjs [outDir]  # screenshots of each page kind in each theme
```

## How it works

`src/hn/` turns an HN page into one typed `Page` value. A registry of detectors picks the parser from the DOM shape (`table.fatitem`, the profile table, comment rows, story rows), so any URL that produces a known shape gets the new design. `src/ui/` renders that value with Preact, and `src/store/` is the only code that reads or writes extension storage. See `DESIGN.md` for the data shapes and the runtime flow.

Hacker News is a trademark of Y Combinator. Margin is not affiliated with Y Combinator.
