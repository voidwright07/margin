import { getPanel, setPanel } from './panels';

/**
 * Keyboard navigation works on the rendered DOM: rows carry data-mg-nav, and each command clicks a marked
 * control (data-mg-vote, data-mg-open, …) inside the focused row. The command table is the single source for
 * both the key handler and the help overlay.
 */

const NAV = '[data-mg-nav]';
// An attribute, not a class: Preact rewrites className when a row re-renders but leaves unknown attributes alone.
const FOCUS = 'data-mg-focused';
let focused: HTMLElement | null = null;

const navItems = () => Array.from(document.querySelectorAll<HTMLElement>(`#margin-root ${NAV}`));

const focusRow = (el: HTMLElement | null) => {
  focused?.removeAttribute(FOCUS);
  focused = el;
  if (!el) return;
  el.setAttribute(FOCUS, '');
  el.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
};

/** The focused row, re-found by id if a re-render replaced its element. */
const current = (): HTMLElement | null => {
  if (focused?.isConnected) return focused;
  const id = focused?.dataset.id;
  focused = id ? document.querySelector<HTMLElement>(`#margin-root ${NAV}[data-id="${id}"]`) : null;
  focused?.setAttribute(FOCUS, '');
  return focused;
};

export const move = (delta: 1 | -1) => {
  const items = navItems();
  if (items.length === 0) return;
  const at = current() ? items.indexOf(current()!) : -1;
  if (at === -1) {
    // Start from the first row on screen rather than the top of the page.
    const visible = items.find((el) => el.getBoundingClientRect().bottom > 80) ?? items[0]!;
    focusRow(delta === 1 ? visible : items[Math.max(0, items.indexOf(visible) - 1)]!);
    return;
  }
  focusRow(items[Math.min(items.length - 1, Math.max(0, at + delta))]!);
};

export const jumpNew = (delta: 1 | -1) => {
  const items = navItems().filter((el) => el.hasAttribute('data-mg-new'));
  if (items.length === 0) return;
  const cur = current();
  const after = (el: HTMLElement) => (cur ? cur.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING : el.getBoundingClientRect().top > 70);
  const next = delta === 1 ? items.find((el) => after(el)) ?? items[0]! : [...items].reverse().find((el) => cur && !after(el) && el !== cur) ?? items[items.length - 1]!;
  focusRow(next);
};

const clickIn = (selector: string) => {
  const scope = current();
  const el = scope?.querySelector<HTMLElement>(selector) ?? (scope ? null : document.querySelector<HTMLElement>(`#margin-root ${selector}`));
  el?.click();
};

const clickPage = (...selectors: string[]) => {
  for (const s of selectors) {
    const el = document.querySelector<HTMLElement>(`#margin-root ${s}`);
    if (el) {
      el.click();
      return true;
    }
  }
  return false;
};

export type Command = { keys: string[]; label: string; run: () => void };

export const COMMANDS: Command[] = [
  { keys: ['j'], label: 'Next story or comment', run: () => move(1) },
  { keys: ['k'], label: 'Previous story or comment', run: () => move(-1) },
  { keys: ['n'], label: 'Next new comment', run: () => jumpNew(1) },
  { keys: ['p'], label: 'Previous new comment', run: () => jumpNew(-1) },
  { keys: ['o', 'Enter'], label: 'Open the link', run: () => clickIn('[data-mg-open]') },
  { keys: ['c'], label: 'Open the comments', run: () => clickIn('[data-mg-comments]') },
  { keys: ['u'], label: 'Upvote or remove vote', run: () => clickIn('[data-mg-vote]') },
  { keys: ['b'], label: 'Bookmark', run: () => clickIn('[data-mg-bookmark]') },
  { keys: ['x'], label: 'Collapse or expand thread', run: () => clickIn('[data-mg-collapse]') },
  { keys: ['r'], label: 'Reply to the comment', run: () => clickIn('[data-mg-reply]') },
  { keys: [']'], label: 'Next page', run: () => void clickPage('[data-mg-next]', '[data-mg-nextday]') },
  { keys: ['['], label: 'Previous page', run: () => void (clickPage('[data-mg-prev]') || history.back()) },
  { keys: ['g'], label: 'Back to top', run: () => window.scrollTo({ top: 0, behavior: 'smooth' }) },
  { keys: ['l'], label: 'Open the library', run: () => setPanel(getPanel() === 'library' ? null : 'library') },
  { keys: ['?'], label: 'Show these shortcuts', run: () => setPanel(getPanel() === 'help' ? null : 'help') },
  { keys: ['Escape'], label: 'Close a panel', run: () => setPanel(null) },
];

const BY_KEY = new Map(COMMANDS.flatMap((c) => c.keys.map((k) => [k, c] as const)));

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));

/** Returns true when the key was handled. Keys never fire while typing or with a modifier held. */
export const handleKey = (e: KeyboardEvent): boolean => {
  if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return false;
  const cmd = BY_KEY.get(e.key);
  if (!cmd) return false;
  if (e.key === 'Enter' && !current()) return false;
  if (e.key === 'Escape' && getPanel() === null) return false;
  cmd.run();
  return true;
};
