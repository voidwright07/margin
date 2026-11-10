import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseHTML } from 'linkedom';
import { describe, expect, it } from 'vitest';
import { parsePage } from '../src/hn/registry';
import type { Comment, Page, PageKind, Story } from '../src/hn/types';

const FIXTURES = join(import.meta.dirname, '..', 'fixtures');
const HN = 'https://news.ycombinator.com/';

const load = (file: string, path: string): Page => {
  const { document } = parseHTML(readFileSync(join(FIXTURES, file), 'utf8'));
  return parsePage(document as unknown as Document, new URL(path, HN));
};

type Case = { file: string; path: string; kind: PageKind; check: (page: Page) => void };

function as<K extends PageKind>(page: Page, kind: K): Extract<Page, { kind: K }> {
  expect(page.kind).toBe(kind);
  return page as Extract<Page, { kind: K }>;
}

const first = <T>(xs: T[]): T => {
  expect(xs.length).toBeGreaterThan(0);
  return xs[0]!;
};

const storyPage = (
  expected: { count: number; more: string | null; first: Partial<Story> },
) => (page: Page) => {
  const p = as(page, 'stories');
  expect(p.stories).toHaveLength(expected.count);
  expect(first(p.stories)).toMatchObject(expected.first);
  expect(p.more).toBe(expected.more);
  for (const s of p.stories) {
    expect(s.id).toBeGreaterThan(0);
    expect(s.title).not.toBe('');
    expect(s.time).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
  }
};

const commentPage = (
  expected: { count: number; more: string | null; first: Partial<Comment>; maxDepth: number },
) => (page: Page) => {
  const p = as(page, 'comments');
  expect(p.comments).toHaveLength(expected.count);
  expect(first(p.comments)).toMatchObject(expected.first);
  expect(Math.max(...p.comments.map((c) => c.depth))).toBe(expected.maxDepth);
  expect(p.more).toBe(expected.more);
  for (const c of p.comments) {
    expect(c.by).not.toBe('');
    expect(c.html).not.toBe('');
    expect(c.story?.id).toBeGreaterThan(0);
  }
};

const CASES: Case[] = [
  {
    file: 'news.html', path: 'news', kind: 'stories',
    check: storyPage({
      count: 30, more: '?p=2',
      first: { id: 50442736, rank: 1, title: '.name Grandfathered', url: 'https://neil.fraser.name/news/2026/11/10/' as Story['url'],
        site: 'neil.fraser.name', score: 421, by: 'p4bl0', comments: 78, time: '2026-11-10T16:37:44Z', ageText: '3 hours ago',
        actions: { upvote: 'vote?id=50442736&how=up&goto=news', hide: 'hide?id=50442736&goto=news' } as Story['actions'] },
    }),
  },
  {
    file: 'news-p2.html', path: 'news?p=2', kind: 'stories',
    check: storyPage({ count: 30, more: '?p=3', first: { id: 50437752, rank: 31, title: 'Fossil CO2 emissions decrease in 2026', score: 153, by: 'giuliomagnifico', comments: 177 } }),
  },
  {
    file: 'newest.html', path: 'newest', kind: 'stories',
    check: storyPage({ count: 30, more: 'newest?next=50445284&n=31', first: { id: 50445580, rank: 1, title: 'Complete World Order', score: 1, by: 'jaekwon', comments: 1 } }),
  },
  {
    file: 'newest-next.html', path: 'newest?next=50445284&n=31', kind: 'stories',
    check: storyPage({ count: 30, more: 'newest?next=50444876&n=61', first: { id: 50445284, rank: 31, title: 'Building Durable Streams on Postgres', score: 3, by: 'abelanger' } }),
  },
  {
    file: 'front-day.html', path: 'front?day=2026-11-01', kind: 'stories',
    check: (page) => {
      storyPage({ count: 30, more: 'front?day=2026-11-01&p=2', first: { id: 50326821, rank: 1, score: 1869, by: 'roansh', comments: 308 } })(page);
      const p = as(page, 'stories');
      expect(p.heading).toBe('Stories from November 1, 2026');
      expect(p.stories[0]!.title.startsWith('Show HN: HackerBooks')).toBe(true);
      expect(p.meta.section).toBe('front');
    },
  },
  {
    file: 'ask.html', path: 'ask', kind: 'stories',
    check: storyPage({ count: 30, more: 'ask?p=2', first: { id: 50444380, title: 'How do you keep up quality when you vibe-code?', url: 'item?id=50444380' as Story['url'], site: null, score: 7, by: 'nkcodes', comments: 10 } }),
  },
  {
    file: 'show.html', path: 'show', kind: 'stories',
    check: storyPage({ count: 30, more: 'show?p=2', first: { id: 50443812, score: 92, by: 'paulirish', comments: 31 } }),
  },
  {
    file: 'jobs.html', path: 'jobs', kind: 'stories',
    check: (page) => {
      storyPage({ count: 30, more: 'jobs?next=49708774&n=31', first: { id: 50428266, score: null, by: null, comments: null, site: 'ycombinator.com' } })(page);
      expect(as(page, 'stories').stories.every((s) => s.score === null && s.comments === null)).toBe(true);
    },
  },
  {
    file: 'best.html', path: 'best', kind: 'stories',
    check: storyPage({ count: 30, more: 'best?p=2', first: { id: 50424581, title: 'Foldable Flight: The Best Paper Airplanes', score: 1170, by: 'vismit2000', comments: 167 } }),
  },
  {
    file: 'active.html', path: 'active', kind: 'stories',
    check: (page) => {
      storyPage({ count: 30, more: 'active?p=2', first: { id: 50438318, score: 236, by: 'plun9', comments: 285 } })(page);
      const flagged = as(page, 'stories').stories.find((s) => s.id === 50433079);
      expect(flagged).toMatchObject({ flagged: true, title: 'A year after the 100% AI mandate nobody understands our code' });
      expect(as(page, 'stories').stories.filter((s) => s.flagged).length).toBe(2);
    },
  },
  {
    file: 'from-site.html', path: 'from?site=github.com', kind: 'stories',
    check: storyPage({ count: 30, more: 'from?site=github.com&kind=story&next=50443075&n=31', first: { id: 50445577, score: 1, by: 'p1zz4h4ck', comments: 0 } }),
  },
  {
    file: 'submitted.html', path: 'submitted?id=pg', kind: 'stories',
    check: storyPage({ count: 30, more: 'submitted?id=pg&next=6589919&n=31', first: { id: 37278345, score: 374, by: 'pg', comments: 209 } }),
  },
  {
    file: 'favorites.html', path: 'favorites?id=simonw', kind: 'stories',
    check: storyPage({ count: 30, more: 'favorites?id=simonw&next=22657447&n=31&time=1.58492450254885e9', first: { id: 49535752, title: 'A note on subscription prices from LWN', score: 733, by: 'rwky', comments: 151 } }),
  },
  {
    file: 'favorites-comments.html', path: 'favorites?id=simonw&comments=t', kind: 'comments',
    check: commentPage({ count: 3, more: null, maxDepth: 0, first: { id: 34223538, by: 'saila', depth: 0, parentId: 34207974, story: { id: 34207974, title: 'Understanding the N + 1 queries problem' } } }),
  },
  {
    file: 'threads.html', path: 'threads?id=dang', kind: 'comments',
    check: (page) => {
      commentPage({ count: 22, more: 'threads?id=dang&next=50429394', maxDepth: 4, first: { id: 50443815, by: 'dang', depth: 0, parentId: 50443325 } })(page);
      const p = as(page, 'comments');
      const nested = p.comments.find((c) => c.depth === 1)!;
      const owner = p.comments[p.comments.indexOf(nested) - 1]!;
      expect(nested.parentId).toBe(owner.id);
      expect(nested.story).toEqual(owner.story);
    },
  },
  {
    file: 'threads-p2.html', path: 'threads?id=dang&next=50429394', kind: 'comments',
    check: commentPage({ count: 13, more: 'threads?id=dang&next=50409705', maxDepth: 2, first: { by: 'dang', depth: 0 } }),
  },
  {
    file: 'newcomments.html', path: 'newcomments', kind: 'comments',
    check: commentPage({
      count: 30, more: 'newcomments?next=50445532', maxDepth: 0,
      first: { id: 50445581, by: 'jemmyw', depth: 0, parentId: 50444415, time: '2026-11-10T20:06:08Z',
        story: { id: 50437242, title: 'M John Harrison becomes first science fiction author to win the Booker' } },
    }),
  },
  {
    file: 'bestcomments.html', path: 'bestcomments', kind: 'comments',
    check: commentPage({ count: 30, more: 'bestcomments?p=2', maxDepth: 0, first: { id: 50430261, by: 'skeledrew', parentId: 50429068, story: { id: 50429068, title: 'Claude Fable 5.2 and Mythos 5.2' } } }),
  },
  {
    file: 'item.html', path: 'item?id=50442736', kind: 'item',
    check: (page) => {
      const p = as(page, 'item');
      expect(p.root).toMatchObject({ type: 'story', id: 50442736, title: '.name Grandfathered', score: 425, by: 'p4bl0', comments: 78, text: null });
      expect(p.root.type === 'story' && p.root.actions.fave).toBe('fave?id=50442736');
      expect(p.comments).toHaveLength(78);
      expect(p.comments.slice(0, 4).map((c) => c.depth)).toEqual([0, 1, 2, 3]);
      expect(Math.max(...p.comments.map((c) => c.depth))).toBe(4);
      const [c0, c1] = p.comments;
      expect(c0).toMatchObject({ id: 50443236, by: 'giancarlostoro', parentId: 50442736, depth: 0 });
      expect(c0!.html).toContain('After a long and expensive battle');
      expect(c0!.actions.reply).toBe('reply?id=50443236&goto=item%3Fid%3D50442736%2350443236');
      expect(c1!.parentId).toBe(50443236);
      expect(p.form).toEqual({ action: 'comment', textName: 'text', fields: { parent: '50442736', goto: 'item?id=50442736', hmac: 'e6499e63d19ed90a883e0c2f762ad4b71509e918' } });
      expect(p.more).toBeNull();
      for (const c of p.comments) if (c.depth > 0) expect(p.comments.find((x) => x.id === c.parentId)?.depth).toBe(c.depth - 1);
    },
  },
  {
    file: 'item-ask.html', path: 'item?id=50444380', kind: 'item',
    check: (page) => {
      const p = as(page, 'item');
      expect(p.root).toMatchObject({ type: 'story', id: 50444380, score: 7, by: 'nkcodes', comments: 10 });
      expect(p.root.type === 'story' && p.root.text).toContain('really hard time working with claude');
      expect(p.comments.map((c) => c.depth).slice(0, 8)).toEqual([0, 0, 1, 2, 2, 0, 1, 0]);
    },
  },
  {
    file: 'item-job.html', path: 'item?id=50428266', kind: 'item',
    check: (page) => {
      const p = as(page, 'item');
      expect(p.root).toMatchObject({ type: 'story', id: 50428266, score: null, by: null, comments: null });
      expect(p.comments).toEqual([]);
      expect(p.form).toBeNull();
    },
  },
  {
    file: 'item-comment.html', path: 'item?id=50445581', kind: 'item',
    check: (page) => {
      const p = as(page, 'item');
      expect(p.root).toMatchObject({ type: 'comment', id: 50445581, by: 'jemmyw', parentId: 50444415, story: { id: 50437242 } });
      expect(p.root.type === 'comment' && p.root.actions.fave).toBe('fave?id=50445581');
      expect(p.form?.fields.parent).toBe('50445581');
      expect(p.comments).toEqual([]);
    },
  },
  {
    file: 'user.html', path: 'user?id=dang', kind: 'user',
    check: (page) => {
      const { user } = as(page, 'user');
      expect(user).toMatchObject({ id: 'dang', karma: 43706, created: 1187454947, createdText: 'August 18, 2007', editable: false });
      expect(user.about).toContain('Marion Milner');
    },
  },
  {
    file: 'login.html', path: 'login?goto=news', kind: 'passthrough',
    check: (page) => {
      expect(page.meta.viewer).toBeNull();
      expect(page.meta.notice).toBeNull();
    },
  },
  {
    file: 'lists.html', path: 'lists', kind: 'passthrough',
    check: (page) => expect(page.meta.section).toBe('lists'),
  },
  // Synthetic fixtures for logged-in states the logged-out capture lacks.
  {
    file: 'synthetic/news-loggedin.html', path: 'news', kind: 'stories',
    check: (page) => {
      const p = as(page, 'stories');
      expect(p.meta.viewer).toEqual({ name: 'margintest', karma: 1234, logout: 'logout?auth=0f0f0f&goto=news' });
      const [voted, own] = p.stories;
      expect(voted!.actions).toEqual({ unvote: 'vote?id=9001&how=un&auth=aa1&goto=news', hide: 'hide?id=9001&auth=aa1&goto=news' });
      expect(voted!.time).toBe('2026-11-10T10:00:00Z');
      expect(own!.actions).toMatchObject({ edit: 'edit?id=9002', delete: 'delete-confirm?id=9002&goto=news' });
      expect(own!.actions.upvote).toBeUndefined();
      expect(own!.comments).toBe(0);
    },
  },
  {
    file: 'synthetic/item-loggedin.html', path: 'item?id=9100', kind: 'item',
    check: (page) => {
      const p = as(page, 'item');
      expect(p.meta.viewer?.name).toBe('margintest');
      expect(p.root.type === 'story' && p.root.actions).toMatchObject({ unfave: 'fave?id=9100&un=t&auth=bb0', flag: 'flag?id=9100&auth=bb0&goto=item%3Fid%3D9100' });
      expect(p.comments.map((c) => [c.id, c.depth, c.parentId])).toEqual([[9101, 0, 9100], [9102, 1, 9101], [9103, 2, 9102], [9104, 0, 9100]]);
      const [voted, own, deleted, dead] = p.comments;
      expect(voted!.actions.unvote).toContain('how=un');
      expect(voted!.actions.upvote).toBeUndefined();
      expect(own!.actions).toMatchObject({ edit: 'edit?id=9102', delete: 'delete-confirm?id=9102&goto=item%3Fid%3D9100%239102' });
      expect(deleted).toMatchObject({ deleted: true, by: '' });
      expect(dead).toMatchObject({ dead: true, by: 'dave' });
      expect(p.more).toBe('item?id=9100&p=2');
    },
  },
  {
    file: 'synthetic/item-deep.html', path: 'item?id=9200', kind: 'item',
    check: (page) => {
      const p = as(page, 'item');
      expect(p.meta.viewer).toBeNull();
      expect(Math.max(...p.comments.map((c) => c.depth))).toBe(9);
      expect(p.comments.find((c) => c.id === 9210)).toMatchObject({ depth: 9, parentId: 9209, by: 'dara' });
      expect(p.comments.find((c) => c.id === 9203)!.html).toContain('<pre><code>');
    },
  },
  {
    file: 'synthetic/user-own.html', path: 'user?id=margintest', kind: 'user',
    check: (page) => {
      expect(as(page, 'user').user).toEqual({ id: 'margintest', created: 1600000000, createdText: 'September 13, 2020', karma: 1234, about: 'I build quiet tools.', editable: true });
    },
  },
];

describe('every fixture routes to its kind and parses real values', () => {
  it.each(CASES)('$file -> $kind', ({ file, path, kind, check }) => {
    const page = load(file, path);
    expect(page.kind).toBe(kind);
    check(page);
  });

  it('covers every captured fixture', () => {
    const real = readdirSync(FIXTURES).filter((f) => f.endsWith('.html'));
    const synthetic = readdirSync(join(FIXTURES, 'synthetic')).map((f) => `synthetic/${f}`);
    expect(CASES.map((c) => c.file).sort()).toEqual([...real, ...synthetic].sort());
  });
});
