// Times a big comment thread in headless Chrome: how long until the new design is painted, and how long each keystroke takes in the top-level reply box and in an inline reply.
//
//   pnpm build:chrome && node scripts/perf-thread.mjs <saved item page.html> [runs]

import { readFileSync } from 'node:fs';
import { launch } from './harness.mjs';

const file = process.argv[2];
const runs = Number(process.argv[3] ?? 3);
if (!file) throw new Error('usage: node scripts/perf-thread.mjs <saved item page.html> [runs]');
const body = readFileSync(file);
const PATH = 'item?id=50467087';

const { browser, page, resetStorage } = await launch({
  onRequest: async (req, url) => {
    if (url.hostname !== 'news.ycombinator.com' || url.pathname.slice(1) + url.search !== PATH) return false;
    await req.respond({ status: 200, contentType: 'text/html; charset=utf-8', body });
    return true;
  },
});

await page.evaluateOnNewDocument(() => {
  const t = (globalThis.__perf = { events: [] });
  new PerformanceObserver((l) => t.events.push(...l.getEntries().filter((e) => e.name === 'keydown' || e.name === 'input').map((e) => e.duration))).observe({
    type: 'event',
    durationThreshold: 16,
  });
});

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
const fmt = (n) => `${Math.round(n)} ms`;

const typeInto = async (selector) => {
  await page.evaluate(() => (globalThis.__perf.events.length = 0));
  await page.focus(selector);
  const per = [];
  for (const ch of 'the quick brown fox') {
    const t0 = Date.now();
    await page.keyboard.type(ch);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
    per.push(Date.now() - t0);
  }
  const events = await page.evaluate(() => globalThis.__perf.events);
  return { perKey: median(per), worstKey: Math.max(...per), slowEvents: events.length, worstEvent: Math.max(0, ...events) };
};

await page.setViewport({ width: 1280, height: 900 });
const rows = [];
for (let i = 0; i < runs; i++) {
  await resetStorage();
  const t0 = Date.now();
  await page.goto('https://news.ycombinator.com/' + PATH, { waitUntil: 'domcontentloaded', timeout: 300000 });
  await page.waitForFunction(() => document.documentElement.classList.contains('mg-on'), { timeout: 300000, polling: 100 });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
  const p = { shown: Date.now() - t0, comments: await page.evaluate(() => document.querySelectorAll('#margin-root .mg-c').length) };
  const top = await typeInto('.mg-root-composer .mg-textarea');
  await page.click('#margin-root [data-mg-reply]');
  await page.waitForSelector('#margin-root .mg-thread .mg-textarea', { timeout: 10000 });
  const inline = await typeInto('#margin-root .mg-thread .mg-textarea');
  rows.push({ shown: p.shown, comments: p.comments, top, inline });
}

for (const [i, r] of rows.entries()) {
  console.log(
    `run ${i + 1}: ${r.comments} comments | navigation to new design painted ${fmt(r.shown)}`,
  );
  console.log(`  top reply box: ${fmt(r.top.perKey)}/key median, worst ${fmt(r.top.worstKey)}, ${r.top.slowEvents} events over 16 ms, worst ${fmt(r.top.worstEvent)}`);
  console.log(`  inline reply:  ${fmt(r.inline.perKey)}/key median, worst ${fmt(r.inline.worstKey)}, ${r.inline.slowEvents} events over 16 ms, worst ${fmt(r.inline.worstEvent)}`);
}
await browser.close();
