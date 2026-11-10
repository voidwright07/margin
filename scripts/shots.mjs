// Headless screenshots of the built Chrome extension against the captured fixtures.
//
//   pnpm build:chrome && node scripts/shots.mjs [outDir] [nameFilter]

import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { algoliaRespond, launch, ROOT, sleep } from './harness.mjs';

const OUT = resolve(process.argv[2] ?? join(ROOT, '.cache', 'shots'));
const FILTER = process.argv[3] ?? '';

const MOBILE = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const DESKTOP = { width: 1280, height: 1000, deviceScaleFactor: 1 };

// Infinite scroll: scroll until `count` page dividers show, or until `selector` appears at the bottom.
const toBottom = (p) => p.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
const loadPages = async (p, count) => {
  for (let n = 1; n <= count; n++) {
    await toBottom(p);
    await p.waitForFunction((k) => document.querySelectorAll('.mg-page-divider').length >= k, { timeout: 5000 }, n);
  }
};
const atBottom = (selector) => async (p) => {
  await toBottom(p);
  await p.waitForSelector(selector, { timeout: 5000 });
  await toBottom(p);
};
const divider = async (p) => {
  await loadPages(p, 1);
  await p.$eval('.mg-page-divider', (d) => scrollTo(0, d.getBoundingClientRect().top + scrollY - innerHeight / 2));
};
const RATE_LIMITED = readFileSync(join(ROOT, 'fixtures', 'synthetic', 'rate-limited.html'), 'utf8');

const SCENES = [];
const DEEP_IDS = Array.from({ length: 17 }, (_, i) => 9201 + i);
const both = (name, path, extra = {}) => {
  SCENES.push({ name: `${name}-light`, path, scheme: 'light', ...extra });
  SCENES.push({ name: `${name}-dark`, path, scheme: 'dark', ...extra });
};
both('news', 'news');
both('news-p2', 'news?p=2');
both('newest-next', 'newest?next=50445284&n=31');
both('front-day', 'front?day=2026-11-01');
both('item', 'item?id=50442736');
both('item-comments', 'item?id=50442736', { scrollTo: '.mg-thread-bar' });
both('threads', 'threads?id=dang');
both('user', 'user?id=dang');
both('login', 'login?goto=news');
both('news-table', 'news', { settings: { indexView: 'table' } });
both('feed-divider', 'news', { run: divider });
both('feed-loading', 'news', { hn: { 'news?p=2': 'hang' }, run: atBottom('.mg-feed-tail[data-state="loading"]') });
both('feed-rate-limited', 'news', { hn: { 'news?p=2': { status: 200, body: RATE_LIMITED } }, run: atBottom('.mg-feed-notice.is-limited') });
both('feed-load-more', 'news', { settings: { indexView: 'compact' }, run: async (p) => (await loadPages(p, 10), atBottom('[data-mg-load-more]')(p)) });
SCENES.push(
  { name: 'news-compact-light', path: 'news', settings: { indexView: 'compact' } },
  { name: 'news-classic', path: 'news', settings: { theme: 'classic' } },
  { name: 'item-slate', path: 'item?id=50442736', settings: { theme: 'slate' }, scrollTo: '.mg-thread-bar' },
  { name: 'item-black', path: 'item?id=50442736', settings: { theme: 'black' }, scrollTo: '.mg-thread-bar' },
  { name: 'item-ask-serif-justify', path: 'item?id=50444380', settings: { font: 'serif', justify: true, columnWidth: 700 } },
  { name: 'item-loggedin-light', path: 'item?id=9100' },
  { name: 'news-loggedin-dark', path: 'news?synthetic=1', scheme: 'dark' },
  { name: 'user-own-light', path: 'user?id=margintest' },
  { name: 'newcomments-light', path: 'newcomments' },
  { name: 'favorites-comments-dark', path: 'favorites?id=simonw&comments=t', scheme: 'dark' },
  { name: 'item-comment-dark', path: 'item?id=50445581', scheme: 'dark' },
  { name: 'jobs-light', path: 'jobs' },
  { name: 'lists-dark', path: 'lists', scheme: 'dark' },
  { name: 'submitted-light', path: 'submitted?id=pg' },
  { name: 'news-mobile-light', path: 'news', viewport: MOBILE },
  { name: 'item-mobile-dark', path: 'item?id=50442736', scheme: 'dark', scrollTo: '.mg-thread-bar', viewport: MOBILE },
  { name: 'news-original-light', path: 'news', settings: { enabled: false } },
  { name: 'settings-open-light', path: 'news', run: (p) => p.click('button[aria-label="Settings"]') },
  { name: 'library-open-dark', path: 'item?id=50442736', scheme: 'dark', visitFirst: 'item?id=50444380', run: (p) => p.click('button[aria-label="Library"]') },
  { name: 'help-open-light', path: 'item?id=50442736', run: (p) => p.keyboard.type('?') },
  { name: 'keyboard-nav-light', path: 'news', run: (p) => p.keyboard.type('jjj') },
  { name: 'collapse-light', path: 'item?id=50442736', scrollTo: '.mg-thread-bar', run: (p) => p.click('.mg-c-toggle') },
  { name: 'hovercard-light', path: 'news', run: async (p) => (await p.hover('a[data-mg-user]'), sleep(900)) },
  {
    name: 'selection-dark',
    path: 'item?id=50442736',
    scheme: 'dark',
    scrollTo: '.mg-thread-bar',
    run: async (p) => {
      const box = await p.$eval('.mg-thread .mg-commtext', (el) => {
        const r = el.getBoundingClientRect();
        return { x: r.left + 4, y: r.top + 10, w: r.width };
      });
      await p.mouse.move(box.x, box.y);
      await p.mouse.down();
      await p.mouse.move(box.x + box.w * 0.6, box.y, { steps: 5 });
      await p.mouse.up();
    },
  },
  { name: 'replying-light', path: 'item?id=9100', run: (p) => p.click('[id="9101"] [data-mg-reply]') },
  // Thread readability. item?id=9200 is the synthetic deep fixture (fixtures/synthetic/item-deep.html).
  ...['rainbow', 'accent', 'mono'].flatMap((threadLines) =>
    ['light', 'dark'].map((scheme) => ({ name: `rails-${threadLines}-${scheme}`, path: 'item?id=50442736', scheme, settings: { threadLines }, scrollTo: '[id="50444082"]' })),
  ),
  { name: 'rails-hover-light', path: 'item?id=50442736', scrollTo: '[id="50444082"]', run: async (p) => (await p.hover('[id="50444179"] .mg-rail:nth-child(2)'), sleep(200)) },
  { name: 'synthetic-deep-capped-light', path: 'item?id=9200', scrollTo: '[id="9205"]' },
  { name: 'synthetic-deep-capped-dark', path: 'item?id=9200', scheme: 'dark', scrollTo: '[id="9205"]' },
  { name: 'synthetic-deep-preview-light', path: 'item?id=9200', scrollTo: '[id="9206"]', run: async (p) => (await p.hover('[id="9209"] .mg-replyto-btn'), sleep(500)) },
  { name: 'synthetic-deep-preview-dark', path: 'item?id=9200', scheme: 'dark', scrollTo: '[id="9206"]', run: async (p) => (await p.focus('[id="9210"] .mg-replyto-btn'), sleep(200)) },
  { name: 'synthetic-collapsed-light', path: 'item?id=9200', scrollTo: '.mg-thread-bar', history: { '9200': { title: 'Deep threads', url: '', lastVisit: 1, commentCount: 17, seen: DEEP_IDS, collapsed: [9204, 9213, 9216] } } },
  { name: 'synthetic-collapsed-dark', path: 'item?id=9200', scheme: 'dark', scrollTo: '.mg-thread-bar', history: { '9200': { title: 'Deep threads', url: '', lastVisit: 1, commentCount: 17, seen: DEEP_IDS, collapsed: [9204, 9213, 9216] } } },
  { name: 'synthetic-quotes-light', path: 'item?id=9200', scrollTo: '[id="9213"]' },
  { name: 'synthetic-quotes-dark', path: 'item?id=9200', scheme: 'dark', scrollTo: '[id="9213"]' },
  { name: 'synthetic-pre-light', path: 'item?id=9200', scrollTo: '[id="9202"]' },
  { name: 'synthetic-pre-dark', path: 'item?id=9200', scheme: 'dark', scrollTo: '[id="9202"]' },
  { name: 'item-mobile-light', path: 'item?id=50442736', scrollTo: '.mg-thread-bar', viewport: MOBILE },
  { name: 'synthetic-deep-mobile-light', path: 'item?id=9200', scrollTo: '[id="9203"]', viewport: MOBILE },
  { name: 'synthetic-deep-mobile-dark', path: 'item?id=9200', scheme: 'dark', scrollTo: '[id="9203"]', viewport: MOBILE },
  { name: 'new-replies-light', path: 'item?id=50442736', scrollTo: '.mg-thread-bar', history: { '50442736': { title: '.name Grandfathered', url: '', lastVisit: 1, commentCount: 70, seen: [] } }, seenAllBut: 6 },
  { name: 'from-site-light', path: 'from?site=github.com' },
  { name: 'search-idle-light', path: 'search' },
  { name: 'search-results-light', path: 'search?q=rust' },
  { name: 'search-results-dark', path: 'search?q=rust', scheme: 'dark' },
  { name: 'search-comments-light', path: 'search?q=rust&type=comment' },
  { name: 'search-comments-dark', path: 'search?q=rust&type=comment&sort=date', scheme: 'dark' },
  { name: 'search-ask-week-light', path: 'search?q=hiring&type=ask_hn&range=week' },
  { name: 'search-filters-light', path: 'search?q=rust&author=pg&site=github.com&type=all' },
  { name: 'search-pager-light', path: 'search?q=rust&p=2', scrollTo: '.mg-pager' },
  { name: 'search-empty-light', path: 'search?q=zzqqxx&range=month' },
  { name: 'search-loading-light', path: 'search?q=rust', algolia: 'hang' },
  { name: 'search-error-dark', path: 'search?q=rust', scheme: 'dark', algolia: 429 },
  { name: 'search-error-light', path: 'search?q=rust', algolia: 500 },
  { name: 'search-mobile-light', path: 'search?q=rust', viewport: MOBILE },
  { name: 'search-mobile-dark', path: 'search?q=rust&type=comment', scheme: 'dark', viewport: MOBILE },
  { name: 'search-typing-dark', path: 'news', scheme: 'dark', run: (p) => p.keyboard.press('/') },
  { name: 'feed-error-light', path: 'news', hn: { 'news?p=2': { status: 500, body: 'Internal error' } }, run: atBottom('.mg-feed-notice.is-error') },
  { name: 'feed-table-dark', path: 'news', scheme: 'dark', settings: { indexView: 'table' }, run: divider },
  { name: 'feed-threads-light', path: 'threads?id=dang', run: divider },
  { name: 'feed-search-dark', path: 'search?q=rust', scheme: 'dark', run: divider },
  { name: 'news-badges-light', path: 'news', history: { '50442736': { title: '.name Grandfathered', url: '', lastVisit: 1, commentCount: 70, seen: [] }, '50441707': { title: 'x', url: '', lastVisit: 1, commentCount: 140, seen: [] } } },
);

// A scene can hold Algolia's answer (to show loading) or fail it (to show the error states).
let algolia = null;
// A scene can also hold or replace HN's answer for a page that infinite scroll fetches.
let hn = {};
const { browser, page, ext, extId, served, warnings, resetStorage, open } = await launch({
  onRequest: async (req, url) => {
    const answer = url.hostname === 'news.ycombinator.com' ? hn[url.pathname.slice(1) + url.search] : undefined;
    if (answer === 'hang') return true;
    if (answer) {
      await req.respond({ status: answer.status, contentType: 'text/html; charset=utf-8', body: answer.body });
      return true;
    }
    if (url.hostname !== 'hn.algolia.com' || algolia === null) return false;
    if (algolia !== 'hang') await algoliaRespond(req, algolia, JSON.stringify({ message: 'error' }));
    return true;
  },
});
mkdirSync(OUT, { recursive: true });
let failed = 0;
for (const scene of SCENES.filter((s) => s.name.includes(FILTER))) {
  let history = scene.history;
  if (scene.seenAllBut) {
    // Mark every comment seen except the last few, so they render as new.
    const ids = (await import('node:fs')).readFileSync(join(ROOT, 'fixtures', 'item.html'), 'utf8').match(/<tr class="athing comtr" id="(\d+)"/g).map((m) => Number(m.match(/\d+/)[0]));
    history = { '50442736': { ...scene.history['50442736'], seen: ids.slice(0, -scene.seenAllBut) } };
  }
  await resetStorage({ ...(scene.settings ?? {}) }, history ? { history } : {});
  await page.setViewport(scene.viewport ?? DESKTOP);
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scene.scheme ?? 'light' }]);
  algolia = scene.algolia ?? null;
  hn = scene.hn ?? {};
  if (scene.visitFirst) await open(scene.visitFirst);
  const mode = await open(scene.path);
  if (scene.scrollTo) await page.$eval(scene.scrollTo, (el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 70)).catch(() => {});
  if (scene.run) await scene.run(page).catch((e) => warnings.push(`${scene.name}: ${e.message}`));
  await sleep(300);
  const file = join(OUT, `${scene.name}.png`);
  await page.screenshot({ path: file });
  if (mode === 'timeout' || mode === 'raw') failed++;
  console.log(`${String(mode).padEnd(8)} ${file}`);
}
// The extension's own pages: options and the toolbar popup.
for (const [name, path, viewport, scheme] of [
  ['options-light', 'options.html', DESKTOP, 'light'],
  ['options-dark', 'options.html', DESKTOP, 'dark'],
  ['popup-light', 'popup.html', { width: 340, height: 420 }, 'light'],
  ['popup-dark', 'popup.html', { width: 340, height: 420 }, 'dark'],
].filter(([n]) => n.includes(FILTER))) {
  await resetStorage({}, { history: { '50442736': { title: '.name Grandfathered', url: 'https://neil.fraser.name/news/2026/11/10/', lastVisit: Date.now() - 3600e3, commentCount: 78, seen: [] } } });
  const p = await browser.newPage();
  await p.setViewport(viewport);
  await p.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }]);
  await p.goto(`chrome-extension://${extId}/${path}`);
  await sleep(300);
  const file = join(OUT, `${name}.png`);
  await p.screenshot({ path: file });
  await p.close();
  console.log(`page     ${file}`);
}
void ext;
console.log(JSON.stringify({ served, warnings: [...new Set(warnings)] }, null, 2));
await browser.close();
if (failed) {
  console.error(`${failed} scene(s) did not render the Margin design.`);
  process.exitCode = 1;
}
