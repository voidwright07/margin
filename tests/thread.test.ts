import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseHTML } from 'linkedom';
import { describe, expect, it } from 'vitest';
import { parsePage } from '../src/hn/registry';
import type { Comment, PageMeta } from '../src/hn/types';
import { frontDay } from '../src/ui/FrontDayNav';
import { applyHighlights } from '../src/ui/highlight';
import { markQuotes } from '../src/ui/commentText';
import { subtreeSizes, visibleRows } from '../src/ui/Thread';

const itemDoc = () => parseHTML(readFileSync(join(import.meta.dirname, '..', 'fixtures', 'item.html'), 'utf8')).document as unknown as Document;

const itemComments = (): Comment[] => {
  const page = parsePage(itemDoc(), new URL('https://news.ycombinator.com/item?id=50442736'));
  if (page.kind !== 'item') throw new Error('expected item');
  return page.comments;
};

const blankDoc = () => parseHTML('<html><body></body></html>').document as unknown as Document;

describe('collapsing works on the flat comment array', () => {
  const comments = itemComments();
  const sizes = subtreeSizes(comments);

  it('subtree sizes match the counts HN prints on its own toggles', () => {
    const html = readFileSync(join(import.meta.dirname, '..', 'fixtures', 'item.html'), 'utf8');
    const hn = new Map([...html.matchAll(/class="togg clicky" id="(\d+)" n="(\d+)"/g)].map((m) => [Number(m[1]), Number(m[2])]));
    expect(hn.size).toBe(comments.length);
    comments.forEach((c, i) => expect(sizes[i], `comment ${c.id}`).toBe(hn.get(c.id)));
  });

  it('collapsing a comment hides exactly its descendants', () => {
    const all = visibleRows(comments, sizes, new Set());
    expect(all).toHaveLength(comments.length);
    const first = comments[0]!;
    const rows = visibleRows(comments, sizes, new Set([first.id]));
    expect(rows).toHaveLength(comments.length - (sizes[0]! - 1));
    expect(rows[0]).toMatchObject({ collapsed: true, size: sizes[0] });
    expect(rows[1]!.comment.depth).toBe(0);
  });

  it('rows carry their ancestor chain for the thread lines', () => {
    const rows = visibleRows(comments, sizes, new Set());
    for (const row of rows) {
      expect(row.ancestors).toHaveLength(row.comment.depth);
      if (row.comment.depth > 0) expect(row.ancestors.at(-1)).toBe(row.comment.parentId);
    }
  });
});

describe('front day navigation', () => {
  const meta = (path: string): PageMeta => ({ viewer: null, url: new URL(path, 'https://news.ycombinator.com/'), section: 'front', notice: null });
  it('uses ?day= when present, else the date in HN heading', () => {
    expect(frontDay(meta('front?day=2026-11-01'), null)).toBe('2026-11-01');
    expect(frontDay(meta('front'), 'Stories from November 9, 2026')).toBe('2026-11-09');
  });
});

describe('highlights re-apply by text match', () => {
  it('wraps a match that spans an inline element', () => {
    const { document } = parseHTML('<div id="c">Hello <i>brave new</i> world</div>');
    const el = document.getElementById('c') as unknown as HTMLElement;
    applyHighlights(el, [{ id: 'h1', text: 'lo brave' }]);
    const marks = [...el.querySelectorAll('mark')].map((m) => m.textContent);
    expect(marks).toEqual(['lo ', 'brave']);
    expect(el.textContent).toBe('Hello brave new world');
  });
});

describe('quote blocks come from the rendered comment DOM', () => {
  const render = (html: string) => {
    const el = blankDoc().createElement('div');
    el.innerHTML = html;
    const before = el.innerHTML;
    markQuotes(el);
    return { el, before };
  };

  it('marks the bare first paragraph and later paragraphs that start with ">"', () => {
    const { el } = render('&gt; quoted first<p>my reply</p><p>&gt; <i>second</i> quote</p>');
    const quotes = Array.from(el.querySelectorAll('.mg-quote'));
    expect(quotes.map((q) => q.textContent)).toEqual(['> quoted first', '> second quote']);
    expect(quotes.map((q) => Array.from(q.querySelectorAll('.mg-quote-mark'), (m) => m.textContent).join(''))).toEqual(['> ', '> ']);
    expect(el.querySelector('p:not(.mg-quote)')?.textContent).toBe('my reply');
    expect(el.textContent, 'text is unchanged, so highlights still match').toBe('> quoted firstmy reply> second quote');
  });

  it('leaves <pre>, and ">" that does not start a paragraph, untouched', () => {
    const { el, before } = render('a &gt; b<p>x</p><pre><code>&gt; not a quote\n  indented</code></pre>');
    expect(el.querySelector('.mg-quote')).toBeNull();
    expect(el.innerHTML).toBe(before);
  });

  it('highlights still apply inside a quote', () => {
    const { el } = render('&gt; quoted first<p>my reply</p>');
    applyHighlights(el as unknown as HTMLElement, [{ id: 'h1', text: 'quoted first' }]);
    expect(el.querySelector('.mg-quote mark.mg-hl')?.textContent).toBe('quoted first');
  });

  it('finds the quote HN rendered in the item fixture', () => {
    const { el } = render(itemComments()[0]!.html);
    const quotes = Array.from(el.querySelectorAll('.mg-quote'));
    expect(quotes).toHaveLength(1);
    expect(quotes[0]!.textContent).toMatch(/^> After a long and expensive battle/);
  });
});
