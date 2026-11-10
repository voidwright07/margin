import { render } from 'preact';
import { parsePage } from '../hn/registry';
import type { Page } from '../hn/types';
import type { Settings } from '../store/schema';
import { loadState, readBootHint, subscribe, updateSettings } from '../store/store';
import { App } from '../ui/App';
import { applySettings } from '../ui/apply';
import { Logo } from '../ui/icons';

/**
 * Content-script lifecycle. Three display modes, decided from settings and the parse result:
 *  - 'margin': the new design is mounted and the original page is hidden but kept intact;
 *  - 'original': the user switched back; only a small pill to return is shown;
 *  - 'raw': parsing or rendering failed; the original page shows with theme colours only.
 */
type Mode = 'margin' | 'original' | 'raw';

const html = document.documentElement;
const ROOT_ID = 'margin-root';

const domReady = () =>
  new Promise<void>((resolve) => {
    if (document.readyState !== 'loading') resolve();
    else document.addEventListener('DOMContentLoaded', () => resolve(), { once: true });
  });

const hnStylesheets = () => Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"][href*="news.css"]'));

let mode: Mode | null = null;
let page: Page | null = null;
let root: HTMLElement | null = null;

const ensureRoot = () => {
  if (!root) {
    root = document.createElement('div');
    root.id = ROOT_ID;
    document.body.prepend(root);
  }
  return root;
};

/** HN links comments as item?id=…#<comment id>; the browser scrolled before the new layout existed. */
const scrollToHash = () => {
  const id = decodeURIComponent(location.hash.slice(1));
  if (!id) return;
  requestAnimationFrame(() => document.querySelector(`#${ROOT_ID} [id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'start' }));
};

const fail = (error: unknown) => {
  console.warn('[Margin] could not redesign this page; showing the original.', error);
  page = null;
  setMode('raw');
};

function ReturnPill() {
  return (
    <button type="button" class="mg-return" title="Use the Margin design again" onClick={() => void updateSettings({ enabled: true })}>
      <Logo size={18} />
      <span>Margin</span>
    </button>
  );
}

const setMode = (next: Mode) => {
  if (next === mode) return;
  mode = next;
  const el = ensureRoot();
  render(null, el);
  html.classList.toggle('mg-on', next === 'margin');
  html.classList.toggle('mg-raw', next === 'raw');
  for (const link of hnStylesheets()) link.disabled = next === 'margin';
  switch (next) {
    case 'margin':
      try {
        render(<App page={page!} onError={fail} />, el);
        scrollToHash();
      } catch (e) {
        fail(e);
      }
      break;
    case 'original':
      render(<ReturnPill />, el);
      break;
    case 'raw':
      break;
  }
  html.classList.remove('mg-loading');
};

const modeFor = (s: Settings): Mode => (!s.enabled ? 'original' : page ? 'margin' : 'raw');

export const boot = async () => {
  const hint = readBootHint();
  html.dataset.mgTheme = hint?.theme ?? 'system';
  if (hint?.enabled ?? true) html.classList.add('mg-loading');
  // Never leave the page hidden, whatever goes wrong below.
  const failsafe = setTimeout(() => html.classList.remove('mg-loading'), 3000);

  const [state] = await Promise.all([loadState(), domReady()]);
  try {
    page = parsePage(document, new URL(location.href));
  } catch (e) {
    console.warn('[Margin] could not parse this page; showing the original.', e);
    page = null;
  }
  applySettings(html, state.settings);
  setMode(modeFor(state.settings));
  clearTimeout(failsafe);

  subscribe((s) => {
    applySettings(html, s.settings);
    setMode(modeFor(s.settings));
  });
};
