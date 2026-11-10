import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseHTML } from 'linkedom';
import { describe, expect, it } from 'vitest';
import { parsePage } from '../src/hn/registry';
import type { Comment, PageMeta } from '../src/hn/types';
import { frontDay } from '../src/ui/FrontDayNav';
import { applyHighlights } from '../src/ui/highlight';
import { collapsedPreview, markQuotes, plainText } from '../src/ui/commentText';
import { subtreeSizes, visibleRows } from '../src/ui/Thread';
import { navTarget } from '../src/ui/threadNav';

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

describe('thread navigation agrees with the links HN prints on each comment', () => {
  const doc = itemDoc();
  const comments = itemComments();
  const hnLink = (id: number, label: string): number | null => {
    const a = Array.from(doc.querySelectorAll(`tr.comtr[id="${id}"] .navs a`)).find((x) => x.textContent === label);
    return a ? Number(a.getAttribute('href')!.slice(1)) : null;
  };
  const idAt = (i: number | null) => (i === null ? null : comments[i]!.id);

  it('parent and root', () => {
    comments.forEach((c, i) => {
      expect(idAt(navTarget(comments, i, 'parent')), `parent of ${c.id}`).toBe(hnLink(c.id, 'parent'));
      // HN prints "root" only from depth 2; at depth 1 the root is the parent.
      expect(idAt(navTarget(comments, i, 'root')), `root of ${c.id}`).toBe(hnLink(c.id, 'root') ?? hnLink(c.id, 'parent'));
    });
  });

  it('next and previous top-level comment', () => {
    const tops = comments.flatMap((c, i) => (c.depth === 0 ? [i] : []));
    expect(tops.length).toBeGreaterThan(5);
    for (const i of tops) {
      const id = comments[i]!.id;
      expect(idAt(navTarget(comments, i, 'nextTop')), `next of ${id}`).toBe(hnLink(id, 'next'));
      expect(idAt(navTarget(comments, i, 'prevTop')), `prev of ${id}`).toBe(hnLink(id, 'prev'));
    }
  });

  it('from a reply, top-level moves leave the thread forward and return to its root backward', () => {
    const i = comments.findIndex((c) => c.depth === 3);
    const root = navTarget(comments, i, 'root')!;
    expect(navTarget(comments, i, 'prevTop')).toBe(root);
    expect(idAt(navTarget(comments, i, 'nextTop'))).toBe(hnLink(comments[root]!.id, 'next'));
  });

  it('gives the same answers on the visible rows after a collapse', () => {
    const sizes = subtreeSizes(comments);
    const rows = visibleRows(comments, sizes, new Set([comments.find((c) => c.depth === 1)!.id]));
    rows.forEach((row, i) => {
      const parent = navTarget(rows.map((r) => r.comment), i, 'parent');
      expect(parent === null ? null : rows[parent]!.comment.id).toBe(hnLink(row.comment.id, 'parent'));
    });
  });

  it('returns null when the ancestor is not on the page', () => {
    expect(navTarget([{ depth: 2 }, { depth: 0 }, { depth: 3 }], 2, 'parent')).toBeNull();
    expect(navTarget([{ depth: 0 }], 0, 'parent')).toBeNull();
    expect(navTarget([{ depth: 0 }], 0, 'nextTop')).toBeNull();
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

describe('collapsed preview text', () => {
  const doc = blankDoc();

  it('is plain text with paragraphs joined and entities decoded', () => {
    expect(plainText('Short &amp; <i>sweet</i>.<p>Second <a href="x">link</a>.</p><pre><code>a\n  b</code></pre>', doc)).toBe('Short & sweet. Second link. a b');
    expect(collapsedPreview('Short &amp; <i>sweet</i>.', doc)).toBe('Short & sweet.');
  });

  it('cuts long text near 80 characters at a word and adds an ellipsis', () => {
    const p = collapsedPreview(itemComments()[0]!.html, doc);
    expect(p).toBe('> After a long and expensive battle, news just dropped that Verisign is…');
    expect(p.length).toBeLessThanOrEqual(81);
    const medium = 'word '.repeat(24).trim();
    expect(medium.length).toBeGreaterThan(80);
    expect(collapsedPreview(medium, doc)).toBe(`${'word '.repeat(16).trim()}…`);
  });
});
