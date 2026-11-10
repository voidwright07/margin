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
    const text = el.firstChild;
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

for (const [status, line] of results) console.log(`${status.padEnd(4)} ${line}`);
const relevant = warnings.filter((w) => !w.includes('Failed to load resource'));
if (relevant.length) console.log('page warnings:', relevant);
await browser.close();
if (results.some(([s]) => s === 'FAIL')) process.exitCode = 1;
