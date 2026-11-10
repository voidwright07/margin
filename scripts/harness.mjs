// Shared headless harness: launches Chrome for Testing with the built extension and answers every
// news.ycombinator.com request from fixtures/ through request interception. It never opens a window and
// never reaches the network.

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
    args: ['--no-first-run', '--no-default-browser-check', '--disable-gpu', '--renderer-process-limit=2'],
  });
  const extId = await browser.installExtension(EXT);
  const served = { fixture: 0, stub: 0, external: 0 };

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
  await page.setRequestInterception(true);
  page.on('request', async (req) => {
    const url = new URL(req.url());
    if (onRequest && (await onRequest(req, url))) return;
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
    return req.respond({ status: type === 'text/html' ? 404 : 200, contentType: type, body: type === 'text/html' ? 'Unknown.' : '' });
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
