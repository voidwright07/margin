// Headless behaviour checks for the built Chrome extension. Each check drives the real content script on a
// fixture page and asserts an observable effect: DOM, storage, or the exact request sent to HN.
//
//   pnpm build:chrome && node scripts/e2e.mjs

import assert from 'node:assert/strict';
import { launch, sleep } from './harness.mjs';

const requests = [];
let replyResponse = null;

const { browser, page, resetStorage, readStorage, open, fixture, warnings } = await launch({
  onRequest: async (req, url) => {
    if (url.hostname !== 'news.ycombinator.com') return false;
    const key = url.pathname.slice(1) + url.search;
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
const check = async (name, fn) => {
  requests.length = 0;
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
  const rail = () => page.$eval('[id="50444082"] .mg-rail', (el) => getComputedStyle(el, '::before').backgroundColor);
  const rainbow = await rail();
  const colours = { rainbow };
  for (const threadLines of ['accent', 'mono']) {
    await resetStorage({ threadLines });
    await page.waitForFunction((v) => document.documentElement.dataset.mgLines === v, { timeout: 2000 }, threadLines);
    colours[threadLines] = await rail();
  }
  assert.equal(new Set(Object.values(colours)).size, 3, JSON.stringify(colours));
});

for (const [status, line] of results) console.log(`${status.padEnd(4)} ${line}`);
const relevant = warnings.filter((w) => !w.includes('Failed to load resource'));
if (relevant.length) console.log('page warnings:', relevant);
await browser.close();
if (results.some(([s]) => s === 'FAIL')) process.exitCode = 1;
