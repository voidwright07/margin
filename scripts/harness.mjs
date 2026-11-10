// Shared headless harness: launches Chrome for Testing with the built extension and answers every
// news.ycombinator.com and hn.algolia.com request from fixtures/ through request interception. It never opens
// a window and never reaches the network.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

export const ROOT = resolve(import.meta.dirname, '..');
export const EXT = join(ROOT, '.output', 'chrome-mv3');
export const HN = 'https://news.ycombinator.com/';

const findChrome = () => {
  const base = join(ROOT, '.cache', 'browsers', 'chrome');
  const rels = [
    'chrome-win64/chrome.exe',
    'chrome-linux64/chrome',
    'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    'chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
  ];
  for (const dir of existsSync(base) ? readdirSync(base) : []) {
    for (const rel of rels) {
      const p = join(base, dir, rel);
      if (existsSync(p)) return p;
    }
  }
  throw new Error('Chrome for Testing not found. Run: pnpm dlx @puppeteer/browsers install chrome@stable --path .cache/browsers');
};

/** HN path + query -> fixture file. */
export const ROUTES = {
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
  'item?id=9200': 'synthetic/item-deep.html',
};

const fixture = (name) => readFileSync(join(ROOT, 'fixtures', name));

/** Algolia API request -> fixtures/algolia file, chosen from the request the way the real API would vary. */
export const algoliaFixture = (url) => {
  const p = url.searchParams;
  const tags = (p.get('tags') ?? '').split(',');
  const query = p.get('query') ?? '';
  if (/hiring/i.test(query)) return 'ask-week.json';
  if (!/rust/i.test(query)) return 'empty.json';
  if (tags.includes('comment')) return 'comments-rust.json';
  if (url.pathname.endsWith('/search_by_date')) return 'stories-rust-bydate.json';
  if (p.get('page') === '1') return 'stories-rust-p2.json';
  return 'stories-rust.json';
};

// hn.algolia.com allows the HN origin; without this header the content script's fetch would fail as it would live.
const ALGOLIA_HEADERS = { 'access-control-allow-origin': 'https://news.ycombinator.com' };
export const algoliaRespond = (req, status, body) =>
  req.respond({ status, contentType: 'application/json; charset=utf-8', headers: ALGOLIA_HEADERS, body });

// A strict page policy on HN's "Unknown." page, so the search checks prove the content script's fetch does not
// depend on HN's CSP allowing hn.algolia.com.
const STRICT_CSP = { 'content-security-policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'" };

/**
 * Launch the browser. `onRequest(req, url)` may answer a request itself (return true) before the fixture
 * router runs; tests use it to observe action and reply requests.
 */
export const launch = async ({ onRequest } = {}) => {
  if (!existsSync(join(EXT, 'manifest.json'))) throw new Error('Build first: pnpm build:chrome');
  const browser = await puppeteer.launch({
    executablePath: findChrome(),
    headless: true,
    pipe: true,
    enableExtensions: true,
    // Every host fails DNS, so a request that escapes interception (a new tab, a service worker) cannot go live.
    args: ['--no-first-run', '--no-default-browser-check', '--disable-gpu', '--renderer-process-limit=2', '--host-resolver-rules=MAP * ~NOTFOUND'],
  });
  const extId = await browser.installExtension(EXT);
  const served = { fixture: 0, algolia: 0, stub: 0, external: 0, popups: [] };

  const ext = await browser.newPage();
  await ext.goto(`chrome-extension://${extId}/options.html`);

  /** Reset storage to defaults plus `patch` (settings) and optional extra top-level keys. */
  const resetStorage = async (patch = {}, extra = {}) => {
    await ext.evaluate(
      async (p, x) => {
        await chrome.storage.local.clear();
        await chrome.storage.local.set({ settings: p, ...x });
      },
      patch,
      extra,
    );
  };
  const readStorage = () => ext.evaluate(() => chrome.storage.local.get(null));

  const page = await browser.newPage();
  // A tab opened by the page (window.open, target=_blank) is closed at once: it is not intercepted, and as the
  // front tab it would pause requestAnimationFrame on the page under test.
  browser.on('targetcreated', async (t) => {
    if (t.type() !== 'page' || t.opener() !== page.target()) return;
    const p = await t.page();
    if (!p) return;
    served.popups.push(t.url());
    await p.close().catch(() => {});
    await page.bringToFront().catch(() => {});
  });
  await page.setRequestInterception(true);
  page.on('request', async (req) => {
    const url = new URL(req.url());
    if (onRequest && (await onRequest(req, url))) return;
    if (url.hostname === 'hn.algolia.com' && url.pathname.startsWith('/api/v1/search')) {
      served.algolia++;
      return algoliaRespond(req, 200, readFileSync(join(ROOT, 'fixtures', 'algolia', algoliaFixture(url))));
    }
    if (url.hostname !== 'news.ycombinator.com') {
      served.external++;
      return req.respond({ status: 204, body: '' });
    }
    const key = url.pathname.slice(1) + url.search;
    const file = ROUTES[key] ?? (key.startsWith('user?id=') ? 'user.html' : null);
    if (file) {
      served.fixture++;
      return req.respond({ status: 200, contentType: 'text/html; charset=utf-8', body: fixture(file) });
    }
    served.stub++;
    const p = url.pathname;
    const type = p.endsWith('.css') ? 'text/css' : p.endsWith('.js') ? 'text/javascript' : p.endsWith('.svg') ? 'image/svg+xml' : p.endsWith('.gif') ? 'image/gif' : 'text/html';
    const html = type === 'text/html';
    return req.respond({ status: html ? 404 : 200, contentType: type, headers: p === '/search' ? STRICT_CSP : {}, body: html ? 'Unknown.' : '' });
  });
  const warnings = [];
  page.on('console', (m) => {
    if (m.type() === 'warn' || m.type() === 'error') warnings.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => warnings.push(`pageerror: ${e.message}`));

  /** Navigate and wait until the content script has settled on a display mode. */
  const open = async (path) => {
    await page.goto(HN + path, { waitUntil: 'load' });
    const mode = await page
      .waitForFunction(
        () => {
          const h = document.documentElement;
          if (h.classList.contains('mg-loading')) return false;
          if (h.classList.contains('mg-on')) return 'margin';
          if (h.classList.contains('mg-raw')) return 'raw';
          return document.querySelector('.mg-return') ? 'original' : false;
        },
        { timeout: 5000 },
      )
      .then((h) => h.jsonValue())
      .catch(() => 'timeout');
    // Preact runs effects (key and hover listeners) after the first paint.
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 30))));
    return mode;
  };

  return { browser, page, ext, extId, served, warnings, resetStorage, readStorage, open, fixture };
};

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
