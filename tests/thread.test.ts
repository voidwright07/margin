import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseHTML } from 'linkedom';
import { describe, expect, it } from 'vitest';
import { parsePage } from '../src/hn/registry';
import type { Comment, PageMeta } from '../src/hn/types';
import { frontDay } from '../src/ui/FrontDayNav';
import { applyHighlights } from '../src/ui/highlight';
import { subtreeSizes, visibleRows } from '../src/ui/Thread';

const itemComments = (): Comment[] => {
  const { document } = parseHTML(readFileSync(join(import.meta.dirname, '..', 'fixtures', 'item.html'), 'utf8'));
  const page = parsePage(document as unknown as Document, new URL('https://news.ycombinator.com/item?id=50442736'));
  if (page.kind !== 'item') throw new Error('expected item');
  return page.comments;
};

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
