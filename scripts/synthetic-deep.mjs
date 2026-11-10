// Writes fixtures/synthetic/item-deep.html: a logged-out item page in HN's markup with a thread nested ten
// levels deep, quotes, a <pre> block and OP replies. HN's own fixtures stop at depth 4.
//
//   node scripts/synthetic-deep.mjs

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './harness.mjs';

const STORY = 9200;
const OP = 'ada';

/** [id, depth, author, comment HTML as HN renders it: first paragraph bare, later ones in <p>] */
const COMMENTS = [
  [9201, 0, 'brin', '&gt; Every level indents 22px with no cap.<p>That is the whole problem with deep threads on a phone. By the eighth reply you are reading a column of four words.</p>'],
  [9202, 1, OP, 'Fair, but the cap has to come from somewhere.<p>&gt; on a phone</p><p>Phones are exactly where a fixed cap hurts least, because nobody follows nine levels there anyway.</p>'],
  [9203, 2, 'cole', 'Here is what I measured on an 800px column:<pre><code>depth  indent  usable width\n  0       0px    800px\n  6     132px    668px   // a deliberately long line that has to scroll sideways instead of wrapping onto the next line\n&gt; this line starts with a quote marker but sits inside pre\n</code></pre>So six levels still leaves plenty of room.'],
  [9204, 3, 'dara', 'Six on desktop, three on mobile sounds right. Past that a "replying to" label carries the context.'],
  [9205, 4, OP, '&gt; a "replying to" label carries the context<p>Only if you can see who they replied to without scrolling back up. A hover preview would do it.</p>'],
  [9206, 5, 'cole', 'Hover is not enough. It has to work from the keyboard too, or it is a mouse-only feature.'],
  [9207, 6, 'dara', 'Agreed. Focus the label, get the same preview. Escape closes it.'],
  [9208, 7, OP, 'This is the first comment past the cap. It should line up with its parent and say who it answers.'],
  [9209, 8, 'cole', 'And this one answers ada, still at the same indent.<p>&gt; still at the same indent</p><p>Which is the point: the text column stops shrinking.</p>'],
  [9210, 9, 'dara', 'Ten levels deep. The parent link and the h key should both land on cole.'],
  [9211, 7, 'erin', 'A second reply to dara at depth seven, so siblings past the cap are covered too.'],
  [9212, 1, 'finn', 'Unrelated: the rails need colour. Right now every line is the same faint gray.'],
  [9213, 0, 'gale', '&gt; Quotes look like ordinary text.<p>&gt; HN renders them as a paragraph that starts with a greater-than sign.</p><p>Two quoted paragraphs in a row, then my reply. They should read as one quote block followed by an answer.</p>'],
  [9214, 1, OP, 'Quote blocks are in. Highlights still work inside them.'],
  [9215, 2, 'hugo', 'Nice. Inline code like <i>&gt;</i> in the middle of a sentence should stay plain text.'],
  [9216, 0, 'iris', 'A long top-level comment that gets collapsed in the screenshots, so the preview has enough text to show the ellipsis at about eighty characters and then some more.'],
  [9217, 1, OP, 'Replying to iris so the collapsed count is more than one.'],
];

const sizes = COMMENTS.map((c, i) => {
  let n = 1;
  for (let j = i + 1; j < COMMENTS.length && COMMENTS[j][1] > c[1]; j++) n++;
  return n;
});

const navs = (i) => {
  const [, depth] = COMMENTS[i];
  const links = [];
  const back = (d) => {
    for (let j = i - 1; j >= 0; j--) if (COMMENTS[j][1] === d) return COMMENTS[j][0];
    return null;
  };
  if (depth >= 2) links.push(['root', back(0)]);
  if (depth >= 1) links.push(['parent', back(depth - 1)]);
  let next = null;
  for (let j = i + 1; j < COMMENTS.length && COMMENTS[j][1] >= depth; j++) {
    if (COMMENTS[j][1] === depth) {
      next = COMMENTS[j][0];
      break;
    }
  }
  if (next) links.push(['next', next]);
  return links.map(([label, id]) => ` | <a href="#${id}" class="clicky" aria-hidden="true">${label}</a>`).join('');
};

const row = ([id, depth, by, html], i) => {
  const minutes = 300 - i * 15;
  const t = new Date(Date.UTC(2026, 10, 10, 12, 0) - minutes * 60e3).toISOString().slice(0, 19);
  const goto = `item%3Fid%3D${STORY}`;
  return `<tr class="athing comtr" id="${id}"><td><table border="0"><tr><td class="ind" indent="${depth}"><img src="s.gif" height="1" width="${depth * 40}"></td><td valign="top" class="votelinks"><center><a id='up_${id}' class='clicky' href='vote?id=${id}&amp;how=up&amp;goto=${goto}#${id}'><div class='votearrow' title='upvote'></div></a></center></td><td class="default"><div style="margin-top:2px; margin-bottom:-10px;"><span class="comhead"><a href="user?id=${by}" class="hnuser">${by}</a> <span class="age" title="${t}"><a href="item?id=${id}">${Math.round(minutes / 60)} hours ago</a></span> <span id="unv_${id}"></span><span class="navs">${navs(i)} <a class="togg clicky" id="${id}" n="${sizes[i]}" href="javascript:void(0)">[–]</a><span class="onstory"></span></span></span></div><br>
<div class="comment"><div class="commtext c00">${html}</div><div class="reply"><p><font size="1"><u><a href="reply?id=${id}&amp;goto=${goto}%23${id}" rel="nofollow">reply</a></u></font></div></div></td></tr></table></td></tr>`;
};

const html = `<!-- SYNTHETIC fixture, generated by scripts/synthetic-deep.mjs: a logged-out item page with a thread ten levels
     deep, quote paragraphs, a <pre> block and OP replies. Not captured from the live site. -->
<html lang="en" op="item"><head><meta name="referrer" content="origin"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Deep threads, quotes and code | Hacker News</title></head><body>
<center><table id="hnmain" border="0" cellpadding="0" cellspacing="0" width="85%" bgcolor="#f6f6ef"><tr><td bgcolor="#ff6600"><table border="0" cellpadding="0" cellspacing="0" width="100%" style="padding:2px"><tr><td style="width:18px;padding-right:4px"><a href="https://news.ycombinator.com"><img src="y18.svg" width="18" height="18" style="border:1px white solid; display:block"></a></td><td style="line-height:12pt; height:10px;"><span class="pagetop"><b class="hnname"><a href="news">Hacker News</a></b><a href="newest">new</a> | <a href="front">past</a> | <a href="newcomments">comments</a> | <a href="ask">ask</a> | <a href="show">show</a> | <a href="jobs">jobs</a> | <a href="submit" rel="nofollow">submit</a></span></td><td style="text-align:right;padding-right:4px;"><span class="pagetop"><a href="login?goto=item%3Fid%3D${STORY}">login</a></span></td></tr></table></td></tr><tr style='height:10px'/>
<tr id="bigbox"><td><table class="fatitem" border="0"><tr class="athing submission" id="${STORY}"><td align="right" valign="top" class="title"><span class="rank"></span></td><td valign="top" class="votelinks"><center><a id='up_${STORY}' class='clicky' href='vote?id=${STORY}&amp;how=up&amp;goto=item%3Fid%3D${STORY}'><div class='votearrow' title='upvote'></div></a></center></td><td class="title"><span class="titleline"><a href="https://example.org/deep-threads">Deep threads, quotes and code</a><span class="sitebit comhead"> (<a href="from?site=example.org"><span class="sitestr">example.org</span></a>)</span></span></td></tr>
<tr><td colspan="2"></td><td class="subtext"><span class="subline"><span class="score" id="score_${STORY}">120 points</span> by <a href="user?id=${OP}" class="hnuser">${OP}</a> <span class="age" title="2026-11-10T06:00:00"><a href="item?id=${STORY}">6 hours ago</a></span> <span id="unv_${STORY}"></span> | <a href="hide?id=${STORY}&amp;goto=item%3Fid%3D${STORY}">hide</a> | <a href="item?id=${STORY}">${COMMENTS.length}&nbsp;comments</a></span></td></tr>
<tr><td colspan="2"></td><td><div class="toptext"></div></td></tr><tr style='height:6px'/><tr><td colspan="2"></td><td><form action="comment" method="post"><input type="hidden" name="parent" value="${STORY}"><input type="hidden" name="goto" value="item?id=${STORY}"><input type="hidden" name="hmac" value="0000"><textarea name="text" rows="8" cols="80" wrap="virtual"></textarea><br><br><input type="submit" value="add comment"></form></td></tr></table><br>
<table border="0" class="comment-tree">
${COMMENTS.map(row).join('\n')}
</table><br></td></tr></table></center></body></html>
`;

writeFileSync(join(ROOT, 'fixtures', 'synthetic', 'item-deep.html'), html);
console.log(`wrote ${COMMENTS.length} comments, max depth ${Math.max(...COMMENTS.map((c) => c[1]))}`);
