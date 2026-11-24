// Headless responsive audit: every page kind and overlay at widths from 320 to 2560 px. It reports anything
// that makes the page scroll sideways or pokes past the viewport, and overlap between top-bar items, then
// writes a screenshot of each case. Exits 1 when it finds a problem.
//
//   pnpm build:chrome && node scripts/responsive.mjs [outDir] [nameFilter]

import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { launch, ROOT, sleep } from './harness.mjs';

const OUT = resolve(process.argv[2] ?? join(ROOT, '.cache', 'responsive'));
const FILTER = process.argv[3] ?? '';

export const WIDTHS = [320, 360, 390, 430, 600, 768, 900, 1024, 1280, 1440, 1920, 2560];
const click = (sel) => (p) => p.click(sel);

const CASES = [
  { name: 'news', path: 'news' },
  { name: 'news-loggedin', path: 'news?synthetic=1' },
  { name: 'news-table', path: 'news', settings: { indexView: 'table' } },
  { name: 'news-compact', path: 'news', settings: { indexView: 'compact' } },
  { name: 'front-day', path: 'front?day=2026-11-01' },
  { name: 'jobs', path: 'jobs' },
  { name: 'item', path: 'item?id=50442736' },
  { name: 'item-ask', path: 'item?id=50444380' },
  { name: 'item-deep', path: 'item?id=9200' },
  { name: 'item-composer', path: 'item?id=9100' },
  { name: 'threads', path: 'threads?id=dang' },
  { name: 'newcomments', path: 'newcomments' },
  { name: 'user', path: 'user?id=dang' },
  { name: 'user-own', path: 'user?id=margintest' },
  { name: 'login', path: 'login?goto=news' },
  { name: 'lists', path: 'lists' },
  { name: 'search', path: 'search?q=rust' },
  { name: 'search-comments', path: 'search?q=rust&type=comment' },
  { name: 'open-more', path: 'news', run: click('button[aria-controls="mg-more-menu"]') },
  { name: 'open-account', path: 'news?synthetic=1', run: click('button[aria-controls="mg-account-menu"]') },
  { name: 'open-settings', path: 'news', run: click('button[aria-label="Settings"]') },
  { name: 'open-library', path: 'news', run: click('button[aria-label="Library"]') },
  { name: 'open-help', path: 'news', run: (p) => p.keyboard.type('?') },
];

/** Runs in the page: what pokes past the viewport, and which top-bar items overlap. */
const audit = () => {
  const vw = document.documentElement.clientWidth;
  const label = (el) => {
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.') : '';
    return el.tagName.toLowerCase() + (cls ? `.${cls}` : '') + (el.getAttribute('aria-label') ? `[${el.getAttribute('aria-label')}]` : '');
  };
  // An element inside a box that clips or scrolls sideways cannot widen the page.
  const clipped = (el) => {
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      const ox = getComputedStyle(a).overflowX;
      if (ox !== 'visible') {
        const r = a.getBoundingClientRect();
        if (r.right <= vw + 1 && r.left >= -1) return true;
      }
    }
    return false;
  };
  const root = document.getElementById('margin-root') ?? document.body;
  const offenders = [];
  for (const el of root.querySelectorAll('*')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (getComputedStyle(el).position === 'fixed' && getComputedStyle(el).visibility === 'hidden') continue;
    if ((r.right > vw + 1 || r.left < -1) && !clipped(el)) {
      // Report the outermost offender only.
      if (!offenders.some((o) => o.el.contains(el))) offenders.push({ el, left: Math.round(r.left), right: Math.round(r.right) });
    }
  }
  const top = document.querySelector('.mg-top-inner');
  const overlaps = [];
  if (top) {
    const items = [...top.querySelectorAll('.mg-brand, .mg-tab, .mg-search, .mg-account, .mg-top-tools > .mg-btn, .mg-icon-btn')]
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.width > 0);
    for (let i = 0; i < items.length; i++)
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i].r;
        const b = items[j].r;
        const x = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (x > 1 && y > 1) overlaps.push(`${label(items[i].el)} × ${label(items[j].el)}`);
      }
  }
  return {
    scrollX: document.documentElement.scrollWidth - vw,
    offenders: offenders.map((o) => `${label(o.el)} ${o.left}..${o.right}`),
    overlaps,
    topHeight: top ? Math.round(top.getBoundingClientRect().height) : 0,
  };
};

const { browser, page, resetStorage, open } = await launch();
mkdirSync(OUT, { recursive: true });
let problems = 0;
for (const c of CASES.filter((c) => c.name.includes(FILTER))) {
  for (const width of WIDTHS) {
    const touch = width < 768;
    await resetStorage(c.settings ?? {});
    await page.setViewport({ width, height: touch ? 800 : 900, deviceScaleFactor: 1, isMobile: touch, hasTouch: touch });
    const mode = await open(c.path);
    if (c.run) await c.run(page);
    await sleep(250);
    const r = await page.evaluate(audit);
    const bad = mode !== 'margin' || r.scrollX > 0 || r.offenders.length || r.overlaps.length;
    if (bad) {
      problems++;
      console.log(`FAIL ${c.name} @${width} (${mode})${r.scrollX > 0 ? ` scrolls ${r.scrollX}px sideways` : ''}`);
      for (const o of r.offenders.slice(0, 6)) console.log(`       past edge: ${o}`);
      for (const o of r.overlaps.slice(0, 6)) console.log(`       top bar overlap: ${o}`);
    }
    await page.screenshot({ path: join(OUT, `${c.name}-${width}.png`) });
  }
}
await browser.close();
console.log(problems ? `\n${problems} case(s) with problems` : '\nno problems found');
process.exit(problems ? 1 : 0);
