/**
 * Transforms on HN's already-rendered comment HTML. HN writes the first paragraph as bare inline nodes and
 * each later one as a <p>, and renders `> quote` as an ordinary paragraph that starts with "&gt;".
 */

const BLOCKS = new Set(['P', 'PRE', 'DIV', 'UL', 'OL', 'BLOCKQUOTE', 'TABLE']);

const isBlock = (n: Node): n is Element => n.nodeType === 1 && BLOCKS.has(n.nodeName);

const startsWithQuote = (nodes: Node[]): boolean => nodes.map((n) => n.textContent ?? '').join('').trimStart().startsWith('>');

/** Wrap the leading run of `>` and whitespace in a span, so the bar can replace it while the text stays intact. */
const wrapMarker = (p: Element) => {
  const doc = p.ownerDocument;
  const walker = doc.createTreeWalker(p, 4 /* NodeFilter.SHOW_TEXT */);
  const texts: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) texts.push(n as Text);
  for (const t of texts) {
    const len = /^[\s>]*/.exec(t.data)![0].length;
    if (len === 0) return;
    const mark = doc.createElement('span');
    mark.className = 'mg-quote-mark';
    mark.textContent = t.data.slice(0, len);
    t.parentNode!.insertBefore(mark, t);
    if (len === t.data.length) {
      t.parentNode!.removeChild(t);
    } else {
      t.data = t.data.slice(len);
      return;
    }
  }
};

const markQuote = (p: Element) => {
  p.classList.add('mg-quote');
  wrapMarker(p);
};

/**
 * Turn paragraphs whose text starts with ">" into quote blocks. Only top-level paragraphs are considered,
 * so <pre> blocks and their contents are never touched.
 */
export const markQuotes = (root: Element): void => {
  const doc = root.ownerDocument;
  let run: Node[] = [];
  const flush = () => {
    if (run.length > 0 && startsWithQuote(run)) {
      const p = doc.createElement('p');
      root.insertBefore(p, run[0]!);
      for (const n of run) p.appendChild(n);
      markQuote(p);
    }
    run = [];
  };
  for (const node of Array.from(root.childNodes)) {
    if (!isBlock(node)) {
      run.push(node);
      continue;
    }
    flush();
    if (node.nodeName === 'P' && !node.querySelector('pre') && startsWithQuote([node])) markQuote(node);
  }
  flush();
};

const textOf = (n: Node): string =>
  n.nodeType === 3 ? (n as Text).data : `${isBlock(n) ? ' ' : ''}${Array.from(n.childNodes, textOf).join('')}`;

/** Plain text of comment HTML, paragraphs joined by spaces, whitespace collapsed. Parsed inert, in a template. */
export const plainText = (html: string, doc: Document): string => {
  const t = doc.createElement('template');
  t.innerHTML = html;
  return Array.from(t.content.childNodes, textOf).join('').replace(/\s+/g, ' ').trim();
};

/** The excerpt a collapsed comment shows: about `max` characters, cut at a word, with an ellipsis when cut. */
export const collapsedPreview = (html: string, doc: Document, max = 80): string => {
  const text = plainText(html, doc);
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s.,;:!?-]+$/, '')}…`;
};
