import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseHTML } from 'linkedom';
import { describe, expect, it } from 'vitest';
import { parsePage } from '../src/hn/registry';
import type { SearchQuery } from '../src/hn/types';
import { excerptAt, markTerms, searchTerms } from '../src/search/match';
import { DEFAULT_QUERY, pageWindow, parseQuery, toAlgolia, toAlgoliaWeb, toUrl } from '../src/search/query';
import { BadResponse, htmlToText, parseSearchResponse } from '../src/search/response';

const HN = 'https://news.ycombinator.com/';
const ALGOLIA = join(import.meta.dirname, '..', 'fixtures', 'algolia');
const fromUrl = (href: string) => parseQuery(new URL(href, HN).searchParams);
const q = (patch: Partial<SearchQuery>): SearchQuery => ({ ...DEFAULT_QUERY, ...patch });
const raw = (name: string) => JSON.parse(readFileSync(join(ALGOLIA, name), 'utf8')) as { hits: Array<Record<string, unknown>>; nbHits: number; nbPages: number; page: number; params: string };

describe('search route', () => {
  const page = (html: string, path: string) => parsePage(parseHTML(html).document as unknown as Document, new URL(path, HN));

  it('is /search answered with HN\'s "Unknown." page, and carries the parsed query', () => {
    const p = page('<html><head></head><body>Unknown.</body></html>', 'search?q=rust&type=comment&p=2');
    expect(p.kind).toBe('search');
    expect(p.kind === 'search' && p.query).toEqual(q({ q: 'rust', type: 'comment', page: 2 }));
  });

  it('needs both the path and the body', () => {
    expect(page('<html><body>Unknown.</body></html>', 'item?id=1').kind).toBe('passthrough');
    expect(page('<html><body>Something else</body></html>', 'search?q=x').kind).toBe('passthrough');
    expect(page(readFileSync(join(import.meta.dirname, '..', 'fixtures', 'news.html'), 'utf8'), 'search?q=x').kind).toBe('stories');
  });
});

describe('SearchQuery parsing', () => {
  it('fills every default for a bare /search', () => {
    expect(fromUrl('search')).toEqual({ q: '', type: 'story', sort: 'popularity', range: 'all', page: 1, author: null, site: null });
  });

  it('reads every field', () => {
    expect(fromUrl('search?q=rust+lang&type=comment&sort=date&range=week&p=3&author=pg&site=github.com')).toEqual({
      q: 'rust lang', type: 'comment', sort: 'date', range: 'week', page: 3, author: 'pg', site: 'github.com',
    });
  });

  it('falls back to defaults for unknown or malformed values', () => {
    expect(fromUrl('search?q=x&type=poll&sort=best&range=decade&p=two&author=&site=%20')).toEqual(q({ q: 'x' }));
    for (const p of ['0', '-2', '1.5', '']) expect(fromUrl(`search?p=${p}`).page).toBe(1);
  });
});

describe('toUrl', () => {
  it('leaves defaults out so links stay short', () => {
    expect(toUrl(DEFAULT_QUERY)).toBe('search');
    expect(toUrl(q({ q: 'rust', page: 2 }))).toBe('search?q=rust&p=2');
    expect(toUrl(q({ q: 'a&b c', type: 'all', sort: 'date', range: 'day', author: 'dang', site: 'x.com' }))).toBe(
      'search?q=a%26b+c&type=all&sort=date&range=day&author=dang&site=x.com',
    );
  });

  const samples: SearchQuery[] = [
    DEFAULT_QUERY,
    q({ q: 'rust' }),
    q({ q: '  "exact phrase" & ?=# ', page: 7 }),
    q({ q: 'café 日本', type: 'show_hn', sort: 'date', range: 'year' }),
    ...(['story', 'comment', 'ask_hn', 'show_hn', 'job', 'all'] as const).map((type) => q({ q: 'x', type })),
    ...(['all', 'day', 'week', 'month', 'year'] as const).map((range) => q({ range })),
    q({ author: 'pg', type: 'all' }),
    q({ site: 'github.com', q: 'rust', page: 2 }),
  ];

  it('round-trips through the URL boundary', () => {
    for (const s of samples) expect(fromUrl(toUrl(s))).toEqual(s);
  });

  it('round-trips into the same Algolia request', () => {
    for (const s of samples) expect(toAlgolia(fromUrl(toUrl(s)), 1_800_000_000)).toBe(toAlgolia(s, 1_800_000_000));
  });
});

describe('pageWindow', () => {
  it('shows the ends and two pages either side, with gaps', () => {
    expect(pageWindow(1, 1)).toEqual([1]);
    expect(pageWindow(1, 50)).toEqual([1, 2, 3, 'gap', 50]);
    expect(pageWindow(6, 50)).toEqual([1, 'gap', 4, 5, 6, 7, 8, 'gap', 50]);
    expect(pageWindow(4, 6)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(pageWindow(50, 50)).toEqual([1, 'gap', 48, 49, 50]);
  });
});

describe('toAlgolia', () => {
  const NOW = 1_794_344_400;
  const params = (query: SearchQuery): Record<string, string> => {
    const u = new URL(toAlgolia(query, NOW));
    return { endpoint: u.pathname, ...Object.fromEntries(u.searchParams) };
  };

  it('searches stories by popularity by default', () => {
    expect(toAlgolia(q({ q: 'rust' }), NOW)).toBe('https://hn.algolia.com/api/v1/search?query=rust&tags=story');
  });

  it('maps type, sort and page', () => {
    expect(params(q({ q: 'rust', type: 'comment', sort: 'date', page: 2 }))).toEqual({ endpoint: '/api/v1/search_by_date', query: 'rust', tags: 'comment', page: '1' });
    expect(params(q({ q: 'rust', type: 'all' }))).toEqual({ endpoint: '/api/v1/search', query: 'rust' });
    expect(params(q({ q: 'rust', type: 'job' })).tags).toBe('job');
  });

  it('turns a range into a created_at_i filter relative to now', () => {
    expect(params(q({ range: 'day' })).numericFilters).toBe(`created_at_i>${NOW - 86_400}`);
    expect(params(q({ range: 'year' })).numericFilters).toBe(`created_at_i>${NOW - 365 * 86_400}`);
    expect(params(q({ range: 'all' })).numericFilters).toBeUndefined();
  });

  it('adds author tags and searches URLs for a site', () => {
    expect(params(q({ q: 'arc', author: 'pg' })).tags).toBe('story,author_pg');
    expect(params(q({ q: 'rust', site: 'github.com' }))).toEqual({ endpoint: '/api/v1/search', query: 'github.com rust', tags: 'story', restrictSearchableAttributes: 'url' });
  });

  it('reproduces the requests recorded in the fixtures', () => {
    const recorded = (name: string) => Object.fromEntries(new URLSearchParams(raw(name).params));
    const pick = (o: Record<string, string>) => ({ query: o.query, tags: o.tags, page: o.page, numericFilters: o.numericFilters });
    const ask = recorded('ask-week.json');
    const askNow = Number(ask.numericFilters!.split('>')[1]) + 7 * 86_400;
    const mine = (query: SearchQuery, now = NOW) => pick(Object.fromEntries(new URL(toAlgolia(query, now)).searchParams));
    expect(mine(q({ q: 'hiring', type: 'ask_hn', range: 'week' }), askNow)).toEqual(pick(ask));
    expect(mine(q({ q: 'rust' }))).toEqual(pick(recorded('stories-rust.json')));
    expect(mine(q({ q: 'rust', page: 2 }))).toEqual(pick(recorded('stories-rust-p2.json')));
    expect(mine(q({ q: 'rust', type: 'comment' }))).toEqual(pick(recorded('comments-rust.json')));
  });

  it('links the same search on hn.algolia.com', () => {
    const u = new URL(toAlgoliaWeb(q({ q: 'rust', type: 'comment', sort: 'date', range: 'week', page: 3 })));
    expect(u.origin).toBe('https://hn.algolia.com');
    expect(Object.fromEntries(u.searchParams)).toEqual({ query: 'rust', type: 'comment', sort: 'byDate', dateRange: 'pastWeek', page: '2' });
  });
});

describe('search response parsing', () => {
  const files = readdirSync(ALGOLIA).filter((f) => f.endsWith('.json'));

  it.each(files)('%s parses every hit with its counts', (file) => {
    const json = raw(file);
    const result = parseSearchResponse(json);
    expect(result.hits).toHaveLength(json.hits.length);
    expect(result).toMatchObject({ total: json.nbHits, page: json.page + 1, pages: json.nbPages });
    result.hits.forEach((hit, i) => {
      const h = json.hits[i]!;
      expect(hit.id).toBe(Number(h.objectID));
      expect(hit.author).toBe(h.author);
      expect(hit.created).toBe(h.created_at_i);
      expect(hit.type).toBe((h._tags as string[]).includes('comment') ? 'comment' : 'story');
      const text = hit.type === 'comment' ? hit.text : (hit.text ?? '');
      // HN's own markup is gone; escaped text such as "&lt;span&gt;" legitimately decodes to "<span>".
      expect(text).not.toMatch(/<p>|<a href=|<\/a>|<\/?i>|<pre>|&#x?[0-9a-f]+;|&(quot|amp|gt|lt);/i);
    });
  });

  it('reads story fields, including Ask HN posts without a URL', () => {
    const [discord] = parseSearchResponse(raw('stories-rust.json')).hits;
    expect(discord).toEqual({
      type: 'story', id: 22238335, title: 'Why Discord is switching from Go to Rust',
      url: 'https://blog.discordapp.com/why-discord-is-switching-from-go-to-rust-a190bbca2b1f', site: 'blog.discordapp.com',
      author: 'Sikul', points: 1582, comments: 642, created: 1580837440, text: null,
    });
    const ask = parseSearchResponse(raw('ask-week.json')).hits[0]!;
    expect(ask).toMatchObject({ type: 'story', url: null, site: null, title: 'Ask HN: How are companies hiring developers nowadays?' });
    expect(ask.type === 'story' && ask.text).toMatch(/^Hi, using a throwaway[\s\S]*\n\nSince it's been a while/);
  });

  it('reads comment fields as plain text', () => {
    const c = parseSearchResponse(raw('comments-rust.json')).hits[0]!;
    expect(c).toMatchObject({ type: 'comment', id: 9999959, author: 'eslaught', storyId: 9998140 });
    expect(c.type === 'comment' && c.text).toContain("don't destroy the type info");
    expect(c.type === 'comment' && c.storyTitle).toBeTruthy();
  });

  it('rejects a body that is not a search response', () => {
    expect(() => parseSearchResponse({ message: 'Too many requests' })).toThrow(BadResponse);
    expect(() => parseSearchResponse({ hits: [], page: 0 })).toThrow(BadResponse);
    expect(() => parseSearchResponse('<html>')).toThrow(BadResponse);
  });

  it('drops hits it cannot show instead of failing the page', () => {
    const r = parseSearchResponse({ hits: [{ objectID: '1', _tags: ['pollopt'], author: 'a', created_at_i: 1 }, null, { objectID: 'x' }], nbHits: 3, page: 0, nbPages: 1 });
    expect(r.hits).toEqual([]);
  });
});

describe('htmlToText', () => {
  it('keeps paragraphs and decodes entities without leaving markup', () => {
    expect(htmlToText('One &amp; two<p>Don&#x27;t <i>&lt;b&gt;</i> <a href="https://x.com" rel="nofollow">x.com</a>&#47;&nbsp;ok')).toBe("One & two\n\nDon't <b> x.com/ ok");
    expect(htmlToText('<pre><code>  let x = 1;\n</code></pre>')).toBe('let x = 1;');
    expect(htmlToText('&bogus; &#0; &#x110000;')).toBe('&bogus; &#0; &#x110000;');
  });
});

describe('term highlighting', () => {
  const marked = (text: string, query: string) =>
    markTerms(text, searchTerms(query))
      .filter((s) => s.match)
      .map((s) => s.text);

  it('extracts terms without quotes, punctuation or single letters', () => {
    expect(searchTerms('"rust lang" a Rust, c++ (go)')).toEqual(['rust', 'lang', 'go']);
    expect(searchTerms('   ')).toEqual([]);
  });

  it('marks terms case-insensitively at the start of words', () => {
    expect(marked('Why Discord is switching from Go to Rust', 'rust go')).toEqual(['Go', 'Rust']);
    expect(marked('Rustaceans trust rust', 'rust')).toEqual(['Rust', 'rust']);
    expect(marked('Sherman Anti-Trust Act', 'rust')).toEqual([]);
    expect(marked('node.js nodexjs', 'node.js')).toEqual(['node.js']);
  });

  it('keeps every character, in order, as text', () => {
    for (const [text, query] of [
      ['<img src=x onerror=alert(1)> rust <b>', 'rust img'],
      ['rust', 'rust'],
      ['no match here', 'zzz'],
      ['a.b*c (rust) [x] $1', 'a.b* (rust $1'],
    ] as const) {
      const segs = markTerms(text, searchTerms(query));
      expect(segs.map((s) => s.text).join('')).toBe(text);
      expect(segs.every((s) => s.text.length > 0)).toBe(true);
    }
    expect(markTerms('', ['x'])).toEqual([]);
    expect(markTerms('<b>rust</b>', ['rust'])).toEqual([
      { text: '<b>', match: false },
      { text: 'rust', match: true },
      { text: '</b>', match: false },
    ]);
  });

  it('starts an excerpt shortly before the first match', () => {
    const long = `${'word '.repeat(60)}the rust part`;
    const ex = excerptAt(long, ['rust']);
    expect(ex.startsWith('…word')).toBe(true);
    expect(ex.endsWith('the rust part')).toBe(true);
    expect(ex.length).toBeLessThan(long.length);
    expect(excerptAt('rust early on', ['rust'])).toBe('rust early on');
    expect(excerptAt(long, ['absent'])).toBe(long);
  });
});
