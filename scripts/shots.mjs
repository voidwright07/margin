// Headless screenshots of the built Chrome extension against the captured fixtures.
// Never opens a window: Chrome for Testing runs with headless: true, and every news.ycombinator.com request is
// answered from fixtures/ through request interception, so nothing reaches HN.
//
//   pnpm build:chrome && node scripts/shots.mjs [outDir] [filter]

import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

const ROOT = resolve(import.meta.dirname, '..');
const EXT = join(ROOT, '.output', 'chrome-mv3');
const OUT = resolve(process.argv[2] ?? join(ROOT, '.cache', 'shots'));
const FILTER = process.argv[3] ?? '';

const findChrome = () => {
  const base = join(ROOT, '.cache', 'browsers', 'chrome');
  for (const dir of existsSync(base) ? readdirSync(base) : []) {
    for (const rel of ['chrome-win64/chrome.exe', 'chrome-linux64/chrome', 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing', 'chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing']) {
      const p = join(base, dir, rel);
      if (existsSync(p)) return p;
    }
  }
  throw new Error('Chrome for Testing not found. Run: pnpm dlx @puppeteer/browsers install chrome@stable --path .cache/browsers');
};

/** HN path + query -> fixture file. */
const ROUTES = {
  'news': 'news.html',
  'news?p=2': 'news-p2.html',
  'newest': 'newest.html',
  'newest?next=50445284&n=31': 'newest-next.html',
  'front?day=2026-11-01': 'front-day.html',
  'ask': 'ask.html',
  'show': 'show.html',
  'jobs': 'jobs.html',
  'best': 'best.html',
  'active': 'active.html',
  'from?site=github.com': 'from-site.html',
  'submitted?id=pg': 'submitted.html',
  'favorites?id=simonw': 'favorites.html',
  'favorites?id=simonw&comments=t': 'favorites-comments.html',
  'threads?id=dang': 'threads.html',
  'threads?id=dang&next=50429394': 'threads-p2.html',
  'newcomments': 'newcomments.html',
  'bestcomments': 'bestcomments.html',
  'item?id=50442736': 'item.html',
  'item?id=50444380': 'item-ask.html',
  'item?id=50428266': 'item-job.html',
  'item?id=50445581': 'item-comment.html',
  'user?id=dang': 'user.html',
  'login?goto=news': 'login.html',
  'lists': 'lists.html',
  'item?id=9100': 'synthetic/item-loggedin.html',
  'user?id=margintest': 'synthetic/user-own.html',
  'news?synthetic=1': 'synthetic/news-loggedin.html',
};

const HN = 'https://news.ycombinator.com/';

/** name, HN path, settings patch, color scheme, viewport, scroll target */
const SCENES = [];
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
SCENES.push(
  { name: 'news-table-light', path: 'news', scheme: 'light', settings: { indexView: 'table' } },
  { name: 'news-table-dark', path: 'news', scheme: 'dark', settings: { indexView: 'table' } },
  { name: 'news-compact-light', path: 'news', scheme: 'light', settings: { indexView: 'compact' } },
  { name: 'news-classic', path: 'news', settings: { theme: 'classic' } },
  { name: 'item-slate', path: 'item?id=50442736', settings: { theme: 'slate' }, scrollTo: '.mg-thread-bar' },
  { name: 'item-black', path: 'item?id=50442736', settings: { theme: 'black' }, scrollTo: '.mg-thread-bar' },
  { name: 'item-serif-justify', path: 'item?id=50444380', scheme: 'light', settings: { font: 'serif', justify: true, columnWidth: 700 } },
  { name: 'item-loggedin-light', path: 'item?id=9100', scheme: 'light' },
  { name: 'news-loggedin-dark', path: 'news?synthetic=1', scheme: 'dark' },
  { name: 'user-own-light', path: 'user?id=margintest', scheme: 'light' },
  { name: 'newcomments-light', path: 'newcomments', scheme: 'light' },
  { name: 'favorites-comments-dark', path: 'favorites?id=simonw&comments=t', scheme: 'dark' },
  { name: 'item-ask-light', path: 'item?id=50444380', scheme: 'light' },
  { name: 'item-comment-dark', path: 'item?id=50445581', scheme: 'dark' },
  { name: 'jobs-light', path: 'jobs', scheme: 'light' },
  { name: 'lists-dark', path: 'lists', scheme: 'dark' },
  { name: 'submitted-light', path: 'submitted?id=pg', scheme: 'light' },
  { name: 'news-mobile-light', path: 'news', scheme: 'light', viewport: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true } },
  { name: 'item-mobile-dark', path: 'item?id=50442736', scheme: 'dark', scrollTo: '.mg-thread-bar', viewport: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true } },
  { name: 'news-original-light', path: 'news', scheme: 'light', settings: { enabled: false } },
  { name: 'settings-open-light', path: 'news', scheme: 'light', click: 'button[aria-label="Settings"]' },
  { name: 'library-open-dark', path: 'item?id=50442736', scheme: 'dark', click: 'button[aria-label="Library"]', afterVisit: true },
  { name: 'help-open-light', path: 'item?id=50442736', scheme: 'light', keys: ['?'] },
  { name: 'keyboard-nav-light', path: 'news', scheme: 'light', keys: ['j', 'j', 'j'] },
  { name: 'collapse-light', path: 'item?id=50442736', scheme: 'light', clickAll: '.mg-c-toggle', clickCount: 1, scrollTo: '.mg-thread-bar' },
);

const DESKTOP = { width: 1280, height: 1000, deviceScaleFactor: 1 };

const main = async () => {
  mkdirSync(OUT, { recursive: true });
  if (!existsSync(join(EXT, 'manifest.json'))) throw new Error('Build first: pnpm build:chrome');
  const browser = await puppeteer.launch({
    executablePath: findChrome(),
    headless: true,
    pipe: true,
    enableExtensions: true,
    args: ['--no-first-run', '--no-default-browser-check', '--disable-gpu', '--renderer-process-limit=2'],
  });
  const extId = await browser.installExtension(EXT);
  const served = { fixture: 0, stub: 0, blocked: 0 };

  const ext = await browser.newPage();
  await ext.goto(`chrome-extension://${extId}/options.html`);
  const setSettings = async (patch) => {
    await ext.evaluate(async (p) => {
      const { settings = {} } = await chrome.storage.local.get('settings');
      await chrome.storage.local.clear();
      await chrome.storage.local.set({ settings: { ...settings, theme: 'system', indexView: 'list', enabled: true, font: 'sans', justify: false, columnWidth: 800, ...p } });
    }, patch ?? {});
  };

  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const url = new URL(req.url());
    if (url.hostname !== 'news.ycombinator.com') {
      served.blocked++;
      return req.respond({ status: 204, body: '' });
    }
    const key = url.pathname.slice(1) + url.search;
    const fixture = ROUTES[key];
    if (fixture) {
      served.fixture++;
      return req.respond({ status: 200, contentType: 'text/html; charset=utf-8', body: readFileSync(join(ROOT, 'fixtures', fixture)) });
    }
    served.stub++;
    const type = url.pathname.endsWith('.css') ? 'text/css' : url.pathname.endsWith('.js') ? 'text/javascript' : url.pathname.endsWith('.svg') ? 'image/svg+xml' : 'text/html';
    return req.respond({ status: type === 'text/html' ? 404 : 200, contentType: type, body: type === 'text/html' ? 'Unknown.' : '' });
  });
  const warnings = [];
  page.on('console', (m) => {
    if (m.type() === 'warn' || m.type() === 'error') warnings.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => warnings.push(`pageerror: ${e.message}`));

  const results = [];
  for (const scene of SCENES.filter((s) => s.name.includes(FILTER))) {
    await setSettings(scene.settings);
    await page.setViewport(scene.viewport ?? DESKTOP);
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scene.scheme ?? 'light' }]);
    if (scene.afterVisit) {
      await page.goto(HN + 'item?id=50444380', { waitUntil: 'load' });
      await new Promise((r) => setTimeout(r, 300));
    }
    await page.goto(HN + scene.path, { waitUntil: 'load' });
    const mode = await page
      .waitForFunction(() => {
        const h = document.documentElement;
        if (h.classList.contains('mg-loading')) return false;
        return h.classList.contains('mg-on') ? 'margin' : h.classList.contains('mg-raw') ? 'raw' : document.querySelector('.mg-return') ? 'original' : false;
      }, { timeout: 5000 })
      .then((h) => h.jsonValue())
      .catch(() => 'timeout');
    if (scene.scrollTo) await page.$eval(scene.scrollTo, (el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 70)).catch(() => {});
    if (scene.click) await page.click(scene.click).catch((e) => warnings.push(`click ${scene.click}: ${e.message}`));
    if (scene.clickAll) {
      const els = await page.$$(scene.clickAll);
      for (const el of els.slice(0, scene.clickCount ?? els.length)) await el.click();
    }
    for (const k of scene.keys ?? []) await page.keyboard.type(k);
    await new Promise((r) => setTimeout(r, 250));
    const file = join(OUT, `${scene.name}.png`);
    await page.screenshot({ path: file });
    results.push({ scene: scene.name, mode });
    console.log(`${mode.padEnd(8)} ${file}`);
  }
  console.log(JSON.stringify({ served, warnings: [...new Set(warnings)] }, null, 2));
  await browser.close();
  if (results.some((r) => r.mode === 'timeout')) process.exitCode = 1;
};

await main();
