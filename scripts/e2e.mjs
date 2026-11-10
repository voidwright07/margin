// Headless behaviour checks for the built Chrome extension. Each check drives the real content script on a
// fixture page and asserts an observable effect: DOM, storage, or the exact request sent to HN.
//
//   pnpm build:chrome && node scripts/e2e.mjs [nameFilter]

import assert from 'node:assert/strict';
import { algoliaRespond, HN, launch, sleep } from './harness.mjs';

const requests = [];
const algolia = [];
let algoliaStatus = 200;
let replyResponse = null;
/** Pages the content script fetched from HN (infinite scroll), as `path?query`. */
const fetches = [];
/** Per-check answers for HN paths: `{ status, body }`, served instead of the fixture router. */
const overrides = new Map();

// Back always reloads the document here, so the restore checks prove the page restores itself without bfcache.
const { browser, page, resetStorage, readStorage, open, fixture, warnings } = await launch({
  bfcache: false,
  onRequest: async (req, url) => {
    if (url.hostname === 'hn.algolia.com') {
      algolia.push(url);
      if (algoliaStatus === 200) return false;
      await algoliaRespond(req, algoliaStatus, JSON.stringify({ message: 'Too many requests' }));
      return true;
    }
    if (url.hostname !== 'news.ycombinator.com') return false;
    const key = url.pathname.slice(1) + url.search;
    if (req.resourceType() === 'fetch' && !/^(vote|fave|hide|flag|reply|comment|user)\b/.test(key)) fetches.push(key);
    const override = overrides.get(key);
    if (override) {
      await req.respond({ status: override.status ?? 200, contentType: 'text/html; charset=utf-8', body: override.body });
      return true;
    }
    if (/^(vote|fave|hide|flag)\?/.test(key)) {
      requests.push({ method: req.method(), key });
      await req.respond({ status: 200, contentType: 'text/html', body: '<html><body>ok</body></html>' });
      return true;
    }
    if (key.startsWith('reply?id=')) {
      requests.push({ method: req.method(), key });
      const html = `<html op="reply"><body><table class="fatitem"></table><form action="comment" method="post"><input type="hidden" name="parent" value="9101"><input type="hidden" name="goto" value="item?id=9100#9101"><input type="hidden" name="hmac" value="cafe01"><textarea name="text"></textarea></form></body></html>`;
      await req.respond({ status: 200, contentType: 'text/html', body: html });
      return true;
    }
    if (key === 'comment' && req.method() === 'POST') {
      requests.push({ method: 'POST', key, body: req.postData() });
      await req.respond({ status: 200, contentType: 'text/html', body: replyResponse });
      return true;
    }
    return false;
  },
});

const results = [];
const ONLY = process.argv[2] ?? '';
const check = async (name, fn) => {
  if (!name.includes(ONLY)) return;
  requests.length = 0;
  algolia.length = 0;
  algoliaStatus = 200;
  fetches.length = 0;
  overrides.clear();
  try {
    await fn();
    results.push(['ok', name]);
  } catch (e) {
    results.push(['FAIL', `${name}: ${e.message}`]);
  }
};

await page.setViewport({ width: 1280, height: 1000 });

await check('renders page two and ?next= pagination in the new design', async () => {
  await resetStorage();
  for (const path of ['news?p=2', 'newest?next=50445284&n=31', 'threads?id=dang&next=50429394', 'front?day=2026-11-01']) {
    assert.equal(await open(path), 'margin', path);
  }
  assert.equal(await page.$eval('[data-mg-next]', (a) => a.getAttribute('href')), 'front?day=2026-11-01&p=2');
});

await check('keys do not fire inside a textarea', async () => {
  await resetStorage();
  await open('item?id=9100');
  await page.focus('.mg-root-composer textarea');
  await page.keyboard.type('jk?');
  assert.equal(await page.$eval('.mg-root-composer textarea', (t) => t.value), 'jk?');
  assert.equal(await page.$('[data-mg-focused]'), null);
  assert.equal(await page.$('.mg-modal'), null);
});

await check('j moves focus and x collapses the focused thread', async () => {
  await resetStorage();
  await open('item?id=50442736');
  const before = await page.$$eval('.mg-c', (els) => els.length);
  await page.keyboard.type('jx');
  const toggle = await page.$eval('.mg-c[data-mg-focused] .mg-c-toggle', (b) => b.textContent);
  assert.equal(toggle, '[+14]');
  const after = await page.$$eval('.mg-c', (els) => els.length);
  assert.equal(before - after, 13);
  await page.keyboard.type('x');
  assert.equal(await page.$$eval('.mg-c', (els) => els.length), before);
});

await check('upvote sends the auth link once and shows the vote', async () => {
  await resetStorage();
  await open('item?id=9100');
  await page.click('[id="9104"] [data-mg-vote]');
  await sleep(200);
  assert.deepEqual(requests, [{ method: 'GET', key: 'vote?id=9104&how=up&auth=c4&goto=item%3Fid%3D9100' }]);
  assert.equal(await page.$eval('[id="9104"] [data-mg-vote]', (b) => b.classList.contains('is-on')), true);
  requests.length = 0;
  await page.click('[id="9104"] [data-mg-vote]');
  await sleep(200);
  assert.equal(requests[0]?.key, 'vote?id=9104&how=un&auth=c4&goto=item%3Fid%3D9100');
});

await check('un-favorite flips to favorite after the request', async () => {
  await resetStorage();
  await open('item?id=9100');
  const fave = await page.$$('.mg-item-meta .mg-act');
  const labels = await Promise.all(fave.map((b) => b.evaluate((x) => x.textContent)));
  await fave[labels.indexOf('unfavorite')].click();
  await sleep(200);
  assert.deepEqual(requests, [{ method: 'GET', key: 'fave?id=9100&un=t&auth=bb0' }]);
  assert.ok((await page.$$eval('.mg-item-meta .mg-act', (b) => b.map((x) => x.textContent))).includes('favorite'));
});

await check('logged-out readers get a login link instead of a composer', async () => {
  await resetStorage();
  await open('item?id=50442736');
  assert.equal(await page.$('.mg-root-composer'), null);
  assert.equal(await page.$eval('.mg-login-prompt a', (a) => a.getAttribute('href')), 'login?goto=item%3Fid%3D50442736');
  assert.equal(await page.$('[data-mg-reply]'), null, 'comment replies stay plain HN links');
});

await check('logged-out vote goes to HN instead of fetching', async () => {
  await resetStorage();
  await open('news');
  await Promise.all([page.waitForNavigation({ waitUntil: 'load' }), page.click('.mg-story [data-mg-vote]')]);
  assert.equal(new URL(page.url()).pathname, '/vote');
  assert.equal(requests.length, 1);
});

await check('inline reply fetches the hmac, posts it, and renders the returned thread', async () => {
  await resetStorage();
  replyResponse = fixture('item.html');
  await open('item?id=9100');
  await page.click('[id="9101"] [data-mg-reply]');
  await page.type('[id="9101"] textarea', 'Agreed, and thanks.');
  await page.click('[id="9101"] button[type="submit"]');
  await page.waitForFunction(() => document.querySelector('.mg-item-title')?.textContent === '.name Grandfathered', { timeout: 3000 });
  const post = requests.find((r) => r.method === 'POST');
  assert.ok(requests.some((r) => r.key.startsWith('reply?id=9101')), 'fetched reply page');
  assert.equal(new URLSearchParams(post.body).get('hmac'), 'cafe01');
  assert.equal(new URLSearchParams(post.body).get('parent'), '9101');
  assert.equal(new URLSearchParams(post.body).get('text'), 'Agreed, and thanks.');
});

await check('visiting a thread records history, and new comments are flagged on the next visit', async () => {
  await resetStorage();
  await open('item?id=50442736');
  await sleep(200);
  const stored = await readStorage();
  assert.equal(stored.history['50442736'].seen.length, 78);
  const trimmed = { ...stored.history['50442736'], seen: stored.history['50442736'].seen.slice(0, 75), commentCount: 75 };
  await resetStorage({}, { history: { '50442736': trimmed } });
  await open('news');
  assert.equal(await page.$eval('[data-id="50442736"] .mg-new', (el) => el.textContent), '+3');
  await open('item?id=50442736');
  assert.equal(await page.$$eval('[data-mg-new]', (els) => els.length), 3);
  await page.keyboard.type('n');
  assert.equal(await page.$eval('[data-mg-focused]', (el) => el.hasAttribute('data-mg-new')), true);
  await open('news');
  assert.equal(await page.$('[data-id="50442736"] .mg-new'), null, 'seen after the visit');
});

await check('bookmark with b persists a story bookmark', async () => {
  await resetStorage();
  await open('news');
  await page.keyboard.type('jb');
  await sleep(150);
  const { bookmarks } = await readStorage();
  assert.equal(bookmarks[0].type, 'story');
  assert.equal(bookmarks[0].id, 50442736);
});

await check('highlight from a selection persists and re-applies on reload', async () => {
  await resetStorage();
  await open('item?id=50442736');
  await page.evaluate(() => {
    const el = document.querySelector('[id="50443236"] .mg-commtext');
    // The first paragraph is an HN quote; the selection is inside the rendered quote block.
    const text = el.querySelector('.mg-quote').lastChild;
    const range = document.createRange();
    range.setStart(text, 2);
    range.setEnd(text, 40);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await page.waitForSelector('.mg-selpop');
  const buttons = await page.$$eval('.mg-selpop button', (b) => b.map((x) => x.textContent));
  assert.deepEqual(buttons, ['Highlight', 'Copy', 'Speak', 'Search HN'], 'logged out: no Quote');
  await page.click('.mg-selpop button');
  await sleep(150);
  const { highlights } = await readStorage();
  assert.equal(highlights.length, 1);
  assert.equal(highlights[0].commentId, 50443236);
  await open('item?id=50442736');
  assert.equal(await page.$eval('[id="50443236"] mark.mg-hl', (m) => m.textContent), highlights[0].text);
});

await check('quote puts the selection into the reply box when replying is possible', async () => {
  await resetStorage();
  await open('item?id=9100');
  await page.evaluate(() => {
    const el = document.querySelector('[id="9101"] .mg-commtext');
    const range = document.createRange();
    range.selectNodeContents(el);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await page.waitForSelector('.mg-selpop');
  const buttons = await page.$$('.mg-selpop button');
  await buttons[1].click();
  await page.waitForSelector('[id="9101"] textarea');
  assert.equal(await page.$eval('[id="9101"] textarea', (t) => t.value), '> Top-level comment the viewer upvoted.\n\n');
});

await check('user hover card appears after the delay with parsed karma', async () => {
  await resetStorage();
  await open('news');
  await page.hover('a[data-mg-user]');
  await sleep(150);
  assert.equal(await page.$('.mg-hovercard'), null, 'not before 400 ms');
  await page.waitForSelector('.mg-hovercard-meta', { timeout: 3000 });
  assert.match(await page.$eval('.mg-hovercard-meta', (e) => e.textContent), /43,706 karma/);
});

await check('old-design toggle restores the untouched page and the pill brings Margin back', async () => {
  await resetStorage();
  await open('login?goto=news');
  assert.equal(await page.$eval('#margin-root form input[name="acct"]', () => true), true, 'login form adopted');
  await page.click('button[aria-label="Show original design"]');
  await page.waitForSelector('.mg-return');
  assert.equal(await page.$('#margin-root form'), null, 'form moved back out');
  assert.equal(await page.$eval('body > form input[name="acct"]', () => true), true);
  await page.click('.mg-return');
  await page.waitForFunction(() => document.documentElement.classList.contains('mg-on'));
  assert.equal(await page.$eval('#margin-root form input[name="acct"]', () => true), true);
  assert.equal((await readStorage()).settings.enabled, true);
});

await check('a page HN serves that Margin cannot parse falls back to the original, never blank', async () => {
  await resetStorage();
  const mode = await open('item?id=1');
  assert.equal(mode, 'margin');
  assert.ok((await page.$eval('#margin-root', (r) => r.textContent)).includes('Unknown.'));
});

await check('the theme stored in settings themes the page', async () => {
  await resetStorage({ theme: 'slate' });
  await open('news');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.mgTheme), 'slate');
});

const isCollapsed = (id) => page.$eval(`[id="${id}"]`, (el) => el.classList.contains('is-collapsed'));
const focusedId = () => page.$eval('[data-mg-focused]', (el) => Number(el.dataset.id)).catch(() => null);
const shift = async (code) => {
  await page.keyboard.down('Shift');
  await page.keyboard.press(code);
  await page.keyboard.up('Shift');
};

await check('a click on bare header space collapses; links, buttons and selected text do not', async () => {
  await resetStorage();
  await open('item?id=50442736');
  const head = '[id="50443236"] > .mg-c-main > .mg-c-head';
  const bare = await page.$eval(head, (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.right - 3, y: r.top + r.height / 2 };
  });
  assert.equal(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.classList.contains('mg-c-head'), bare), true, 'the point is bare header space');
  await page.mouse.click(bare.x, bare.y);
  assert.equal(await isCollapsed(50443236), true, 'header click collapses');
  await page.mouse.click(bare.x, bare.y);
  assert.equal(await isCollapsed(50443236), false, 'second click expands');

  await page.evaluate(() => document.addEventListener('click', (e) => e.target.closest('a') && e.preventDefault(), { capture: true, once: true }));
  await page.click(`${head} .mg-c-age`);
  assert.equal(await isCollapsed(50443236), false, 'a link click inside the header does not collapse');
  await page.click('[id="50444082"] .mg-c-navs a');
  assert.equal(await isCollapsed(50444082), false, 'the parent link does not collapse');
  assert.equal(await focusedId(), 50443236, 'the parent link focuses the parent');

  await page.mouse.click(bare.x, bare.y);
  const preview = await page.$eval(`${head} .mg-c-preview`, (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.left + 4, y: r.top + r.height / 2, w: r.width };
  });
  await page.mouse.move(preview.x, preview.y);
  await page.mouse.down();
  await page.mouse.move(preview.x + preview.w / 2, preview.y, { steps: 5 });
  await page.mouse.up();
  assert.ok((await page.evaluate(() => getSelection().toString())).length > 5, 'text got selected');
  assert.equal(await isCollapsed(50443236), true, 'selecting header text does not expand');
});

await check('Shift+J, Shift+K, h and r move focus by thread structure', async () => {
  await resetStorage();
  await open('item?id=9200');
  await page.keyboard.type('j');
  assert.equal(await focusedId(), 9201);
  await shift('KeyJ');
  assert.equal(await focusedId(), 9213, 'Shift+J: next top-level');
  await shift('KeyJ');
  assert.equal(await focusedId(), 9216);
  await shift('KeyK');
  assert.equal(await focusedId(), 9213, 'Shift+K: previous top-level');
  await shift('KeyK');
  await page.keyboard.type('jjjjjjjjj');
  assert.equal(await focusedId(), 9210, 'depth 9');
  await page.keyboard.type('h');
  assert.equal(await focusedId(), 9209, 'h: parent');
  await page.keyboard.type('h');
  assert.equal(await focusedId(), 9208);
  await page.keyboard.type('r');
  assert.equal(await focusedId(), 9201, 'r: root');
  await page.keyboard.type('jjjjjjjjjj');
  assert.equal(await focusedId(), 9211);
  await shift('KeyK');
  assert.equal(await focusedId(), 9201, 'Shift+K from a reply returns to its top-level comment');
  await page.keyboard.type('?');
  const keys = await page.$$eval('.mg-keys dt', (d) => d.map((x) => x.textContent));
  for (const k of ['Shift+J', 'Shift+K', 'h', 'r', 'Shift+R']) assert.ok(keys.includes(k), `help lists ${k}`);
});

await check('past depth 6 a comment says who it replies to, and the preview shows that parent', async () => {
  await resetStorage();
  await open('item?id=9200');
  const rails = await page.$$eval('[id="9210"] .mg-rail', (r) => r.length);
  assert.equal(rails, 6, 'rails stop at the cap');
  const visible = (id) => page.$eval(`[id="${id}"] .mg-c-replyto`, (el) => el.checkVisibility()).catch(() => false);
  assert.equal(await visible(9207), false, 'depth 6 has no label');
  assert.equal(await visible(9205), false, 'depth 4 label is mobile only');
  assert.equal(await visible(9208), true, 'depth 7 has a label');
  assert.equal(await page.$eval('[id="9208"] .mg-replyto-btn b', (b) => b.textContent), 'dara');
  await page.hover('[id="9209"] .mg-replyto-btn');
  await page.waitForSelector('[id="9209"] .mg-parentpop', { timeout: 2000 });
  assert.equal(await page.$eval('[id="9209"] .mg-parentpop-head b', (b) => b.textContent), 'ada');
  await page.mouse.move(5, 5);
  await page.waitForFunction(() => !document.querySelector('[id="9209"] .mg-parentpop'), { timeout: 2000 });
  await page.focus('[id="9210"] .mg-replyto-btn');
  await page.waitForSelector('[id="9210"] .mg-parentpop', { timeout: 2000 });
  assert.equal(await page.$eval('[id="9210"] .mg-parentpop-head b', (b) => b.textContent), 'cole', 'keyboard focus opens the preview too');
  await page.setViewport({ width: 390, height: 844 });
  assert.equal(await visible(9205), true, 'mobile shows the label from depth 4');
  assert.equal(await page.$$eval('[id="9205"] .mg-rail', (r) => r.filter((x) => x.checkVisibility()).length), 3, 'mobile caps rails at 3');
  await page.setViewport({ width: 1280, height: 1000 });
});

await check('collapsed comments stay collapsed after a reload', async () => {
  await resetStorage();
  await open('item?id=50442736');
  await page.click('[id="50443236"] .mg-c-toggle');
  await page.click('[id="50443986"] .mg-c-toggle');
  await page.click('[id="50443986"] .mg-c-toggle');
  await sleep(150);
  assert.deepEqual((await readStorage()).history['50442736'].collapsed, [50443236]);
  await open('item?id=50442736');
  assert.equal(await isCollapsed(50443236), true, 'still collapsed');
  assert.equal(await isCollapsed(50443986), false);
  assert.match(await page.$eval('[id="50443236"] .mg-c-preview', (el) => el.textContent), /^“> After a long and expensive battle.*…”$/);
});

await check('the threadLines setting changes the rail colour', async () => {
  await resetStorage();
  await open('item?id=50442736');
  // The rail's background has a short transition; read it once it has finished, not mid-way.
  const rail = () =>
    page.$eval('[id="50444082"] .mg-rail', async (el) => {
      getComputedStyle(el, '::before').backgroundColor;
      await Promise.all(document.getAnimations().map((a) => a.finished));
      return getComputedStyle(el, '::before').backgroundColor;
    });
  const rainbow = await rail();
  const colours = { rainbow };
  for (const threadLines of ['accent', 'mono']) {
    await resetStorage({ threadLines });
    await page.waitForFunction((v) => document.documentElement.dataset.mgLines === v, { timeout: 2000 }, threadLines);
    colours[threadLines] = await rail();
  }
  assert.equal(new Set(Object.values(colours)).size, 3, JSON.stringify(colours));
});

// ---- infinite scroll ----

const toBottom = () => page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
const storyIds = () => page.$$eval('#margin-root .mg-story', (els) => els.map((e) => Number(e.dataset.id)));
const here_ = () => page.evaluate(() => location.pathname.slice(1) + location.search);
/** The first `count` ranks after the first page divider. */
const ranksAfterDivider = (count) =>
  page.evaluate((n) => {
    const divider = document.querySelector('.mg-page-divider');
    return [...document.querySelectorAll('.mg-story')]
      .filter((s) => divider.compareDocumentPosition(s) & Node.DOCUMENT_POSITION_FOLLOWING)
      .slice(0, n)
      .map((s) => s.querySelector('.mg-rank').textContent);
  }, count);
/** Scroll to the bottom and wait until `count` page dividers show. */
const loadNext = async (count) => {
  await toBottom();
  await page.waitForFunction((n) => document.querySelectorAll('.mg-page-divider').length >= n, { timeout: 4000 }, count);
};
/** news?p=2 as HN serves it to a logged-in reader: vote and hide links carry an auth token. */
const loggedInP2 = () =>
  fixture('news-p2.html')
    .toString()
    .replace(/how=up&amp;goto/g, 'how=up&amp;auth=t1&amp;goto')
    .replace(/(hide\?id=\d+)&amp;goto/g, '$1&amp;auth=t2&amp;goto');
/** Open a story from page two, then come back with the Back button. */
const visitStoryAndReturn = async (id) => {
  await page.$eval(`[data-id="${id}"]`, (el) => el.scrollIntoView({ block: 'center' }));
  await page.waitForFunction(() => location.search === '?p=2', { timeout: 2000 });
  await Promise.all([page.waitForNavigation({ waitUntil: 'load' }), page.click(`[data-id="${id}"] .mg-meta a[href^="item?id="]`)]);
};

await check('scrolling to the bottom fetches the More link once and continues with page two', async () => {
  await resetStorage();
  await open('news');
  await sleep(400);
  assert.deepEqual(fetches, [], 'opening a page fetches nothing');
  await loadNext(1);
  await sleep(1500);
  assert.deepEqual(fetches, ['news?p=2'], 'exactly the More link, once');
  const ids = await storyIds();
  assert.equal(ids.length, 60);
  assert.equal(ids[0], 50442736);
  assert.equal(ids[30], 50437752, 'page two follows page one');
  assert.deepEqual(await ranksAfterDivider(3), ['31', '32', '33'], "HN's own ranks continue");
  assert.deepEqual(await page.$eval('.mg-page-divider a', (a) => [a.textContent, a.getAttribute('href')]), ['Page 2', 'news?p=2']);
  assert.equal(await page.$('.mg-more'), null, 'no classic More link');
});

await check('the address bar follows the page in view without adding history entries', async () => {
  await resetStorage();
  await open('news');
  const length = await page.evaluate(() => history.length);
  await loadNext(1);
  await page.$eval('.mg-page-divider', (d) => d.scrollIntoView({ block: 'start' }));
  await page.waitForFunction(() => location.search === '?p=2', { timeout: 2000 });
  assert.equal(await here_(), 'news?p=2');
  await page.evaluate(() => scrollTo(0, 0));
  await page.waitForFunction(() => location.search === '', { timeout: 2000 });
  assert.equal(await here_(), 'news');
  assert.equal(await page.evaluate(() => history.length), length, 'replaced, never pushed');
});

await check('a hidden tab does not fetch; showing it again does', async () => {
  // Compact rows are short, so after page two the bottom is still close and page three would follow.
  await resetStorage({ indexView: 'compact' });
  await open('news');
  await loadNext(1);
  const other = await browser.newPage();
  try {
    await other.bringToFront();
    await page.waitForFunction(() => document.hidden, { timeout: 2000 });
    await page.evaluate(() => scrollBy(0, 200));
    await sleep(2000);
    assert.deepEqual(fetches, ['news?p=2'], 'nothing while hidden');
  } finally {
    await other.close();
    await page.bringToFront();
  }
  await page.waitForFunction(() => !document.hidden, { timeout: 2000 });
  await loadNext(2);
  assert.deepEqual(fetches, ['news?p=2', 'news?p=3']);
});

await check('a next page that overlaps what is shown never repeats a story', async () => {
  await resetStorage();
  overrides.set('news?p=2', { body: fixture('synthetic/news-p2-shifted.html') });
  await open('news');
  await loadNext(1);
  const ids = await storyIds();
  assert.equal(new Set(ids).size, ids.length, 'no duplicates');
  assert.equal(ids.length, 57, 'the three stories that slid onto page two are dropped');
  assert.deepEqual(await ranksAfterDivider(2), ['34', '35']);
});

await check('Back from a story restores the added pages and the scroll offset, without bfcache', async () => {
  await resetStorage();
  await open('news');
  await loadNext(1);
  await page.$eval('[data-id="50443587"]', (el) => el.scrollIntoView({ block: 'center' }));
  await page.waitForFunction(() => location.search === '?p=2', { timeout: 2000 });
  await page.evaluate(() => (window.marginE2eMarker = 1));
  const y = await page.evaluate(() => scrollY);
  await visitStoryAndReturn(50443587);
  await page.goBack({ waitUntil: 'load' });
  await page.waitForFunction(() => document.documentElement.classList.contains('mg-on'));
  await sleep(300);
  const back = await page.evaluate(() => ({
    marker: window.marginE2eMarker ?? null,
    nav: performance.getEntriesByType('navigation')[0].type,
    y: scrollY,
    url: location.pathname.slice(1) + location.search,
  }));
  assert.deepEqual({ marker: back.marker, nav: back.nav, url: back.url }, { marker: null, nav: 'back_forward', url: 'news?p=2' }, 'a fresh document');
  assert.ok(Math.abs(back.y - y) <= 2, `scroll offset ${back.y}, was ${y}`);
  const ids = await storyIds();
  assert.equal(ids.length, 60, 'both pages are back');
  assert.equal(ids[0], 50442736, 'page one comes first');
  assert.equal(await page.$$eval('.mg-page-divider', (d) => d.length), 1);
  assert.deepEqual(fetches, ['news?p=2'], 'restored from the tab, not refetched');
});

await check('stale restore data falls back to a normal load, never a blank page', async () => {
  await resetStorage();
  await open('news');
  await loadNext(1);
  await visitStoryAndReturn(50443587);
  await page.evaluate(() => {
    for (const k of Object.keys(sessionStorage)) {
      if (k.startsWith('margin:feed:')) sessionStorage.setItem(k, sessionStorage.getItem(k).replace(/"savedAt":\d+/, '"savedAt":1'));
    }
  });
  await page.goBack({ waitUntil: 'load' });
  await page.waitForFunction(() => document.documentElement.classList.contains('mg-on'));
  const ids = await storyIds();
  assert.equal(ids[0], 50437752, 'the page in the address bar, loaded normally');
  assert.equal(ids.includes(50442736), false, 'page one is not restored');
  assert.equal(await page.$eval('.mg-story .mg-rank', (r) => r.textContent), '31');
});

await check('a rate-limited page shows Retry, backs off, and never refetches on its own', async () => {
  await resetStorage();
  overrides.set('news?p=2', { body: fixture('synthetic/rate-limited.html') });
  await open('news');
  await toBottom();
  await page.waitForSelector('.mg-feed-notice.is-limited', { timeout: 4000 });
  assert.equal(await page.$eval('.mg-feed-notice h2', (h) => h.textContent), 'Hacker News needs a moment');
  assert.equal(await page.$eval('[data-mg-retry]', (b) => b.disabled), true, 'Retry waits');
  assert.match(await page.$eval('[data-mg-retry]', (b) => b.textContent), /^Retry in \ds$/);
  assert.equal(await page.$eval('.mg-feed-notice a', (a) => a.getAttribute('href')), 'news?p=2');
  for (let i = 0; i < 4; i++) {
    await page.evaluate(() => scrollBy(0, -400));
    await sleep(250);
    await toBottom();
    await sleep(250);
  }
  await page.keyboard.press('j');
  await sleep(1500);
  assert.deepEqual(fetches, ['news?p=2'], 'no refetch while rate-limited');
  overrides.delete('news?p=2');
  await page.waitForFunction(() => document.querySelector('[data-mg-retry]')?.disabled === false, { timeout: 6000 });
  assert.deepEqual(fetches, ['news?p=2'], 'not even once the wait is over');
  await page.click('[data-mg-retry]');
  await page.waitForSelector('.mg-page-divider', { timeout: 4000 });
  assert.deepEqual(fetches, ['news?p=2', 'news?p=2']);
  assert.equal((await storyIds()).length, 60);
});

await check('a page that cannot be read shows an error row with a link to open it normally', async () => {
  await resetStorage();
  overrides.set('news?p=2', { body: fixture('item.html') });
  await open('news');
  await toBottom();
  await page.waitForSelector('.mg-feed-notice.is-error', { timeout: 4000 });
  assert.equal(await page.$eval('[data-mg-open-page]', (a) => a.getAttribute('href')), 'news?p=2');
  assert.equal(await page.$eval('.mg-feed-notice h2', (h) => h.textContent), 'Page 2 could not be shown here');
  assert.equal((await storyIds()).length, 30, 'page one is untouched');
});

await check('with the setting off, the plain More link is back and nothing loads on scroll', async () => {
  await resetStorage();
  await open('news');
  await page.click('button[aria-label="Settings"]');
  const toggle = await page.waitForSelector('xpath///label[contains(., "Load more as you scroll")]//input');
  await toggle.click();
  await page.waitForSelector('.mg-more a[rel="next"]', { timeout: 2000 });
  assert.equal((await readStorage()).settings.infiniteScroll, false, 'the panel writes the setting');
  await resetStorage({ infiniteScroll: false });
  await open('news');
  assert.deepEqual(await page.$eval('.mg-more a.mg-btn', (a) => [a.getAttribute('href'), a.textContent]), ['?p=2', 'More']);
  assert.equal(await page.$('[data-mg-page], .mg-feed-tail'), null);
  await toBottom();
  await sleep(1200);
  assert.deepEqual(fetches, []);
  await Promise.all([page.waitForNavigation({ waitUntil: 'load' }), page.keyboard.press(']')]);
  assert.equal(await here_(), 'news?p=2', '] still opens the next page');
});

await check('j past the last story loads the next page', async () => {
  await resetStorage();
  // Tall enough that the page cannot scroll, so only the key can ask for more.
  await page.setViewport({ width: 1280, height: 6000 });
  try {
    await open('news');
    await sleep(300);
    for (let i = 0; i < 30; i++) await page.keyboard.press('j');
    const ids = await storyIds();
    assert.equal(await focusedId(), ids[29], 'on the last story');
    assert.deepEqual(fetches, [], 'nothing before the end');
    await page.keyboard.press('j');
    await page.waitForSelector('.mg-page-divider', { timeout: 4000 });
    assert.deepEqual(fetches, ['news?p=2']);
    await page.keyboard.press('j');
    assert.equal(await focusedId(), 50437752, 'j continues into page two');
  } finally {
    await page.setViewport({ width: 1280, height: 1000 });
  }
});

await check('] and [ jump between page dividers', async () => {
  await resetStorage();
  await open('news');
  await loadNext(1);
  await page.evaluate(() => scrollTo(0, 0));
  await sleep(100);
  await page.keyboard.press(']');
  await sleep(100);
  assert.equal(await focusedId(), 50437752, '] lands on page two');
  const offset = await page.$eval('.mg-page-divider', (d) => d.getBoundingClientRect().top - parseFloat(getComputedStyle(d).scrollMarginTop));
  assert.ok(Math.abs(offset) < 2, `divider at the top, off by ${offset}`);
  await page.keyboard.press('[');
  await sleep(100);
  assert.equal(await focusedId(), 50442736, '[ returns to page one');
});

await check('after ten pages a Load more button takes over', async () => {
  await resetStorage({ indexView: 'compact' });
  await open('news');
  for (let n = 1; n <= 10; n++) await loadNext(n);
  await toBottom();
  await page.waitForSelector('[data-mg-load-more]', { timeout: 4000 });
  await sleep(1500);
  assert.equal(fetches.length, 10, `ten automatic pages, got ${fetches.join(', ')}`);
  assert.equal(fetches[9], 'news?p=11');
  await page.click('[data-mg-load-more]');
  await page.waitForFunction(() => document.querySelectorAll('.mg-page-divider').length === 11, { timeout: 4000 });
  assert.equal(fetches[10], 'news?p=12');
  assert.equal(await page.$$eval('.mg-page-divider a', (a) => a[a.length - 1].textContent), 'Page 12');
});

await check('votes, hide, bookmarks, hover cards and new-reply badges work on added stories', async () => {
  await resetStorage({}, { history: { 50437752: { title: 'Fossil', url: '', lastVisit: 1, commentCount: 170, seen: [] } } });
  overrides.set('news?p=2', { body: loggedInP2() });
  await open('news');
  await loadNext(1);
  const row = '[data-id="50408336"]';
  await page.click(`${row} [data-mg-vote]`);
  await sleep(200);
  assert.deepEqual(requests, [{ method: 'GET', key: 'vote?id=50408336&how=up&auth=t1&goto=news%3Fp%3D2' }]);
  assert.equal(await page.$eval(`${row} [data-mg-vote]`, (b) => b.classList.contains('is-on')), true);
  const rankBelow = await page.$eval('[data-id="50443587"] .mg-rank', (r) => r.textContent);
  await page.$$eval(`${row} .mg-act`, (bs) => bs.find((b) => b.textContent === 'hide').click());
  await page.waitForFunction((sel) => !document.querySelector(sel), { timeout: 2000 }, row);
  assert.equal(requests[1].key, 'hide?id=50408336&auth=t2&goto=news%3Fp%3D2');
  assert.equal(await page.$eval('[data-id="50443587"] .mg-rank', (r) => r.textContent), rankBelow, 'ranks unchanged');
  assert.equal((await storyIds()).length, 59);
  assert.equal(await page.$eval('[data-id="50437752"] .mg-new', (el) => el.textContent), '+7', 'new-reply badge');
  await page.$eval('[data-id="50443587"]', (el) => el.scrollIntoView({ block: 'center' }));
  await page.hover('[data-id="50443587"] a[data-mg-user]');
  await page.waitForSelector('.mg-hovercard-meta', { timeout: 3000 });
  await page.mouse.move(5, 5);
  await page.$eval('[data-id="50443587"] [data-mg-bookmark]', (b) => b.click());
  await sleep(150);
  assert.equal((await readStorage()).bookmarks[0]?.id, 50443587);
});

await check('a comment listing (threads) appends its next page, with the selection popup on it', async () => {
  await resetStorage();
  await open('threads?id=dang');
  await loadNext(1);
  await sleep(1200);
  assert.deepEqual(fetches, ['threads?id=dang&next=50429394']);
  assert.deepEqual(await page.$eval('.mg-page-divider a', (a) => [a.textContent, a.getAttribute('href')]), ['Page 2', 'threads?id=dang&next=50429394']);
  const after = await page.evaluate(() => {
    const divider = document.querySelector('.mg-page-divider');
    return [...document.querySelectorAll('.mg-c')].filter((c) => divider.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING).map((c) => Number(c.id));
  });
  assert.ok(after.length > 0, 'comments after the divider');
  await page.evaluate((id) => {
    const el = document.querySelector(`[id="${id}"] .mg-commtext`);
    el.scrollIntoView({ block: 'center' });
    const range = document.createRange();
    range.selectNodeContents(el);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  }, after[0]);
  await page.waitForSelector('.mg-selpop', { timeout: 2000 });
});

const API = 'https://hn.algolia.com/api/v1/';
const here = () => page.evaluate(() => location.pathname.slice(1) + location.search);
const fieldValue = () => page.$eval('[data-mg-search]', (i) => i.value);
const firstTitle = () => page.$eval('.mg-hits .mg-title', (a) => a.textContent);
const settled = () => page.waitForSelector('.mg-hits:not(.is-stale) .mg-story, .mg-search-state:not(.is-idle)', { timeout: 3000 });
const lastRequest = () => algolia[algolia.length - 1];

await check('typing a query fetches the correct API URL once, after the pause', async () => {
  await resetStorage();
  assert.equal(await open('search'), 'margin');
  assert.equal(await page.evaluate(() => document.activeElement?.hasAttribute('data-mg-search')), true, 'blank search focuses the field');
  assert.equal(await page.evaluate(() => document.body.innerText.includes('Unknown.')), false, "HN's 404 text is hidden");
  const before = await page.evaluate(() => history.length);
  await page.keyboard.type('rust', { delay: 40 });
  await sleep(150);
  assert.equal(algolia.length, 0, 'debounced while typing');
  await page.waitForSelector('.mg-hits .mg-story', { timeout: 3000 });
  assert.deepEqual(algolia.map((u) => u.href), [`${API}search?query=rust&tags=story`]);
  assert.equal(await firstTitle(), 'Why Discord is switching from Go to Rust');
  assert.equal(await page.$eval('.mg-hits .mg-title mark.mg-match', (m) => m.textContent), 'Rust');
  assert.equal(await page.$eval('.mg-search-summary span', (s) => s.textContent), '61,306 results · page 1 of 50');
  assert.equal(await here(), 'search?q=rust', 'URL follows the query');
  assert.equal(await page.evaluate(() => history.length), before, 'typing replaces, never pushes');
});

await check('type, sort and range change the request', async () => {
  await resetStorage();
  await open('search?q=rust');
  await settled();
  algolia.length = 0;
  await page.click('nav[aria-label="Result type"] a:nth-child(2)');
  await page.waitForSelector('.mg-hits:not(.is-stale) .mg-hit-c', { timeout: 3000 });
  assert.equal(lastRequest().href, `${API}search?query=rust&tags=comment`);
  assert.equal(await here(), 'search?q=rust&type=comment');
  assert.match(await page.$eval('.mg-hit-c .mg-hit-on', (e) => e.textContent), /^on: \S/);
  await page.click('nav[aria-label="Sort"] a:nth-child(2)');
  await page.waitForFunction(() => location.search.includes('sort=date'));
  await settled();
  assert.equal(lastRequest().pathname, '/api/v1/search_by_date');
  assert.equal(lastRequest().searchParams.get('tags'), 'comment');
  await page.click('nav[aria-label="Date range"] a:nth-child(3)');
  await page.waitForFunction(() => location.search.includes('range=week'));
  await settled();
  const since = Number(lastRequest().searchParams.get('numericFilters').match(/^created_at_i>(\d+)$/)[1]);
  assert.ok(Math.abs(Date.now() / 1000 - 7 * 86400 - since) < 120, `a week ago, got ${since}`);
  assert.equal(await here(), 'search?q=rust&type=comment&sort=date&range=week');
  assert.equal(algolia.length, 3);
});

await check('page 2 requests page=1, from ] and back with [', async () => {
  await resetStorage();
  await open('search?q=rust');
  await settled();
  await page.keyboard.press(']');
  await page.waitForFunction(() => location.search.includes('p=2'));
  await settled();
  assert.equal(lastRequest().href, `${API}search?query=rust&tags=story&page=1`);
  assert.equal(await here(), 'search?q=rust&p=2');
  assert.equal(await page.$eval('.mg-hits .mg-rank', (r) => r.textContent), '21');
  assert.equal(await page.$eval('.mg-pager a.is-on', (a) => a.textContent), '2');
  await page.keyboard.press('[');
  await page.waitForFunction(() => !location.search.includes('p=2'));
  await settled();
  assert.equal(await here(), 'search?q=rust');
  assert.equal(await firstTitle(), 'Why Discord is switching from Go to Rust');
  assert.equal(algolia.length, 2, 'page one came from the cache');
  await open('search?q=rust&p=2');
  await settled();
  assert.equal(lastRequest().searchParams.get('page'), '1', 'a shared page-2 link loads page 2');
});

await check('/ focuses the top-bar field from any page, Enter there opens the search page, and help lists /', async () => {
  await resetStorage();
  await open('news');
  await page.keyboard.press('/');
  assert.equal(await page.evaluate(() => document.activeElement?.hasAttribute('data-mg-search')), true);
  assert.equal(await fieldValue(), '', 'the slash is not typed');
  await page.keyboard.type('rust');
  await Promise.all([page.waitForNavigation({ waitUntil: 'load' }), page.keyboard.press('Enter')]);
  await page.waitForFunction(() => document.documentElement.classList.contains('mg-on'));
  await settled();
  assert.equal(await here(), 'search?q=rust');
  assert.equal(await firstTitle(), 'Why Discord is switching from Go to Rust');
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press('?');
  const help = await page.$$eval('.mg-keys div', (rows) => rows.map((r) => r.textContent));
  assert.ok(help.includes('/Search'), `help lists /: ${help.join(' | ')}`);
});

await check('Enter pushes history and Back restores the previous query', async () => {
  await resetStorage();
  await open('search?q=rust');
  await settled();
  const before = await page.evaluate(() => history.length);
  await page.keyboard.press('/');
  await page.keyboard.type('hiring');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => location.search === '?q=hiring');
  await settled();
  assert.equal(await page.evaluate(() => history.length), before + 1);
  assert.match(await firstTitle(), /^Ask HN: How are companies hiring/);
  await page.evaluate(() => history.back());
  await page.waitForFunction(() => location.search === '?q=rust');
  await settled();
  assert.equal(await fieldValue(), 'rust');
  assert.equal(await firstTitle(), 'Why Discord is switching from Go to Rust');
  await page.evaluate(() => history.forward());
  await page.waitForFunction(() => location.search === '?q=hiring');
  await settled();
  assert.equal(await fieldValue(), 'hiring');
});

await check("the selection popup's Search HN lands on /search?q=", async () => {
  await resetStorage();
  await open('item?id=50442736');
  const selected = await page.evaluate(() => {
    const el = document.querySelector('[id="50443236"] .mg-commtext');
    const text = el.querySelector('.mg-quote').lastChild;
    const range = document.createRange();
    range.setStart(text, 2);
    range.setEnd(text, 40);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    return getSelection().toString().trim();
  });
  await page.waitForSelector('.mg-selpop');
  const buttons = await page.$$('.mg-selpop button');
  const labels = await Promise.all(buttons.map((b) => b.evaluate((x) => x.textContent)));
  await Promise.all([page.waitForNavigation({ waitUntil: 'load' }), buttons[labels.indexOf('Search HN')].click()]);
  await page.waitForFunction(() => document.documentElement.classList.contains('mg-on'));
  const url = new URL(page.url());
  assert.equal(url.origin + url.pathname, 'https://news.ycombinator.com/search');
  assert.equal(url.searchParams.get('q'), selected);
  await settled();
  assert.equal(lastRequest().searchParams.get('query'), selected);
  assert.match(await page.$eval('.mg-search-state h2', (h) => h.textContent), /^No results for “/);
});

await check('a 429 shows the rate-limit state, and Try again recovers', async () => {
  await resetStorage();
  algoliaStatus = 429;
  await open('search?q=rust');
  await page.waitForSelector('.mg-search-state.is-limited', { timeout: 3000 });
  assert.equal(await page.$eval('.mg-search-state h2', (h) => h.textContent), 'Too many searches for a moment');
  assert.equal(await page.$eval('.mg-search-state a', (a) => a.href), 'https://hn.algolia.com/?query=rust&type=story&sort=byPopularity&dateRange=all&page=0');
  algoliaStatus = 200;
  await page.click('.mg-search-state button');
  await page.waitForSelector('.mg-hits .mg-story', { timeout: 3000 });
  assert.equal(await firstTitle(), 'Why Discord is switching from Go to Rust');
});

await check('profiles and from?site pages search their author or site natively', async () => {
  await resetStorage();
  await open('user?id=dang');
  await Promise.all([page.waitForNavigation({ waitUntil: 'load' }), page.click('[data-mg-search-author]')]);
  await settled();
  assert.equal(await here(), 'search?type=all&author=dang');
  assert.equal(lastRequest().href, `${API}search?query=&tags=author_dang`);
  assert.match(await page.$eval('.mg-chip', (c) => c.textContent), /^by dang/);
  await open('from?site=github.com');
  await Promise.all([page.waitForNavigation({ waitUntil: 'load' }), page.click('[data-mg-search-site]')]);
  await settled();
  assert.equal(await here(), 'search?site=github.com');
  assert.equal(lastRequest().href, `${API}search?query=github.com&tags=story&restrictSearchableAttributes=url`);
  await page.click('.mg-chip');
  await page.waitForFunction(() => location.search === '');
  assert.equal(await page.$eval('.mg-search-state h2', (h) => h.textContent), 'Search Hacker News', 'removing the only filter leaves a blank search');
});

await check('story results carry the bookmark action', async () => {
  await resetStorage();
  await open('search?q=rust');
  await settled();
  await page.keyboard.type('jb');
  await sleep(150);
  const { bookmarks } = await readStorage();
  assert.equal(bookmarks[0].type, 'story');
  assert.equal(bookmarks[0].id, 22238335);
  assert.equal(bookmarks[0].snapshot.site, 'blog.discordapp.com');
});

const algoliaPage = async () => {
  for (let i = 0; i < 60; i++) {
    const hit = algolia.find((u) => u.pathname === '/');
    if (hit) return hit.href;
    await sleep(50);
  }
  return null;
};

await check('in the original design, /search goes to the same search on hn.algolia.com', async () => {
  // Leave any search page first: switching the design off there redirects it too, which would race this check.
  await open('news');
  algolia.length = 0;
  await resetStorage({ enabled: false });
  // The redirect can cancel the page's own load, which goto reports as ERR_ABORTED.
  await page.goto(`${HN}search?q=rust&type=comment&sort=date&p=2`, { waitUntil: 'load' }).catch((e) => {
    if (!e.message.includes('ERR_ABORTED')) throw e;
  });
  assert.equal(await algoliaPage(), 'https://hn.algolia.com/?query=rust&type=comment&sort=byDate&dateRange=all&page=1');
  assert.equal(algolia.filter((u) => u.pathname.startsWith('/api/')).length, 0, 'no API search in the original design');
  await resetStorage();
  await open('search?q=rust');
  await settled();
  algolia.length = 0;
  await page.click('button[aria-label="Show original design"]');
  assert.equal(await algoliaPage(), 'https://hn.algolia.com/?query=rust&type=story&sort=byPopularity&dateRange=all&page=0');
});

await check('search results stay text: no markup from the response reaches the page', async () => {
  await resetStorage();
  await open('search?q=rust&sort=date');
  await settled();
  const tags = await page.$$eval('.mg-hits .mg-hit-text *, .mg-hits .mg-title *', (els) => [...new Set(els.map((e) => e.tagName))]);
  assert.deepEqual(tags.filter((t) => t !== 'MARK'), []);
  assert.ok((await page.$$eval('.mg-hit-text', (els) => els.map((e) => e.textContent).join(' '))).includes('<span>'), 'escaped markup shows literally');
});

for (const [status, line] of results) console.log(`${status.padEnd(4)} ${line}`);
const relevant = warnings.filter((w) => !w.includes('Failed to load resource'));
if (relevant.length) console.log('page warnings:', relevant);
await browser.close();
if (results.some(([s]) => s === 'FAIL')) process.exitCode = 1;
