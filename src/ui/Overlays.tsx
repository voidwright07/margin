import { useEffect, useRef, useState } from 'preact/hooks';
import { fetchUser } from '../app/hn-client';
import type { UserProfile } from '../hn/types';
import { addHighlight, removeHighlight } from '../store/ops';
import { update, useStore } from '../store/store';
import { plural } from './common';
import { IconChevronLeft, IconClose, IconKeyboard } from './icons';
import { COMMANDS, handleKey, jumpNew, move } from './keyboard';
import { usePanel } from './panels';
import { QUOTE_EVENT, type QuoteDetail } from './Thread';
import { toast } from './toast';

/** Binds the shortcut table to the page while keyboard shortcuts are on. */
export function KeyboardLayer() {
  const enabled = useStore((s) => s.settings.keyboard);
  useEffect(() => {
    const onNextNew = () => jumpNew(1);
    document.addEventListener('margin:next-new', onNextNew);
    if (!enabled) return () => document.removeEventListener('margin:next-new', onNextNew);
    const onKey = (e: KeyboardEvent) => {
      if (handleKey(e)) e.preventDefault();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('margin:next-new', onNextNew);
    };
  }, [enabled]);
  return null;
}

const keyLabel = (k: string) => (k === 'Escape' ? 'Esc' : /^[A-Z]$/.test(k) ? `Shift+${k}` : k);

export function HelpOverlay() {
  const [panel, setPanel] = usePanel();
  if (panel !== 'help') return null;
  return (
    <div class="mg-modal-wrap" onClick={() => setPanel(null)}>
      <div class="mg-modal" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" onClick={(e) => e.stopPropagation()}>
        <div class="mg-drawer-head">
          <h2>Keyboard shortcuts</h2>
          <button type="button" class="mg-icon-btn" aria-label="Close" onClick={() => setPanel(null)}>
            <IconClose size={16} />
          </button>
        </div>
        <dl class="mg-keys">
          {COMMANDS.map((c) => (
            <div>
              <dt>
                {c.keys.map((k) => (
                  <kbd>{keyLabel(k)}</kbd>
                ))}
              </dt>
              <dd>{c.label}</dd>
            </div>
          ))}
        </dl>
        <p class="mg-keys-note">Shortcuts never fire while you type in a text box. Turn them off in settings.</p>
      </div>
    </div>
  );
}

/** A small floating pad for moving through a page without the keyboard. */
export function ControlPad() {
  const [, setPanel] = usePanel();
  const [hasNew, setHasNew] = useState(false);
  useEffect(() => setHasNew(document.querySelector('#margin-root [data-mg-new]') !== null), []);
  return (
    <nav class="mg-pad" aria-label="Page controls">
      <button type="button" title="Previous (k)" aria-label="Previous" onClick={() => move(-1)}>
        <IconChevronLeft size={16} class="mg-rot90" />
      </button>
      <button type="button" title="Next (j)" aria-label="Next" onClick={() => move(1)}>
        <IconChevronLeft size={16} class="mg-rot-90" />
      </button>
      {hasNew && (
        <button type="button" class="mg-pad-new" title="Next new comment (n)" aria-label="Next new comment" onClick={() => jumpNew(1)}>
          new
        </button>
      )}
      <button type="button" title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts" onClick={() => setPanel('help')}>
        <IconKeyboard size={16} />
      </button>
    </nav>
  );
}

/** Profile preview on hovering any user link, after 400 ms. Profiles are fetched once per page and cached. */
export function HoverCard() {
  const [card, setCard] = useState<{ id: string; x: number; y: number; user: UserProfile | null; failed?: boolean } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    const over = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.('a[data-mg-user]');
      if (!(a instanceof HTMLElement)) return;
      clearTimeout(timer.current);
      clearTimeout(hideTimer.current);
      const id = a.dataset.mgUser!;
      timer.current = setTimeout(() => {
        const r = a.getBoundingClientRect();
        const x = Math.min(r.left + window.scrollX, window.scrollX + document.documentElement.clientWidth - 316);
        const y = r.bottom + window.scrollY + 6;
        setCard({ id, x, y, user: null });
        fetchUser(id).then(
          (user) => setCard((c) => (c?.id === id ? { ...c, user } : c)),
          () => setCard((c) => (c?.id === id ? { ...c, failed: true } : c)),
        );
      }, 400);
    };
    const out = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.('a[data-mg-user]');
      if (!a) return;
      clearTimeout(timer.current);
      hideTimer.current = setTimeout(() => setCard(null), 200);
    };
    document.addEventListener('mouseover', over);
    document.addEventListener('mouseout', out);
    return () => {
      document.removeEventListener('mouseover', over);
      document.removeEventListener('mouseout', out);
    };
  }, []);

  if (!card) return null;
  const u = card.user;
  return (
    <div
      class="mg-popover mg-hovercard"
      style={{ left: `${card.x}px`, top: `${card.y}px` }}
      onMouseEnter={() => clearTimeout(hideTimer.current)}
      onMouseLeave={() => setCard(null)}
    >
      <div class="mg-hovercard-head">
        <div class="mg-avatar mg-avatar-sm">{card.id.slice(0, 1).toUpperCase()}</div>
        <div>
          <a class="mg-hovercard-name" href={`user?id=${card.id}`}>{card.id}</a>
          {u && (
            <div class="mg-hovercard-meta">
              {plural(u.karma, 'karma point')}, joined {u.createdText}
            </div>
          )}
        </div>
      </div>
      {!u && !card.failed && <div class="mg-skeleton" />}
      {card.failed && <p class="mg-hovercard-about">Could not load this profile.</p>}
      {u?.about && !u.editable && <div class="mg-hovercard-about" dangerouslySetInnerHTML={{ __html: u.about }} />}
    </div>
  );
}

type Sel = { text: string; x: number; y: number; commentId: number | null; itemId: number; canQuote: boolean };

const selectionInfo = (): Sel | null => {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
  const text = sel.toString().trim();
  if (!text) return null;
  const range = sel.getRangeAt(0);
  const host = (range.commonAncestorContainer instanceof Element ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement)?.closest<HTMLElement>('[data-mg-text]');
  if (!host) return null;
  const r = range.getBoundingClientRect();
  const commentId = host.dataset.commentId ? Number(host.dataset.commentId) : null;
  const itemId = Number(host.dataset.itemId);
  return {
    text,
    x: r.left + r.width / 2 + window.scrollX,
    y: r.top + window.scrollY - 8,
    commentId,
    itemId: Number.isFinite(itemId) ? itemId : 0,
    canQuote: host.dataset.canQuote === 'true',
  };
};

/** Actions on selected text inside a story or comment: highlight, quote into a reply, copy, speak, search. */
export function SelectionPopup() {
  const [sel, setSel] = useState<Sel | null>(null);
  const [mark, setMark] = useState<{ id: string; x: number; y: number } | null>(null);

  useEffect(() => {
    const onUp = (e: MouseEvent | KeyboardEvent) => {
      if ((e.target as Element | null)?.closest?.('.mg-selpop')) return;
      setTimeout(() => setSel(selectionInfo()), 0);
    };
    const onClick = (e: MouseEvent) => {
      const m = (e.target as Element | null)?.closest?.('mark.mg-hl');
      if (!(m instanceof HTMLElement) || !window.getSelection()?.isCollapsed) {
        if (!(e.target as Element | null)?.closest?.('.mg-selpop')) setMark(null);
        return;
      }
      const r = m.getBoundingClientRect();
      setMark({ id: m.dataset.hl!, x: r.left + r.width / 2 + window.scrollX, y: r.top + window.scrollY - 8 });
    };
    document.addEventListener('mouseup', onUp);
    document.addEventListener('keyup', onUp);
    document.addEventListener('click', onClick);
    return () => {
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('keyup', onUp);
      document.removeEventListener('click', onClick);
    };
  }, []);

  if (mark && !sel) {
    return (
      <div class="mg-popover mg-selpop" style={{ left: `${mark.x}px`, top: `${mark.y}px` }}>
        <button
          type="button"
          onClick={() => {
            void update((s) => removeHighlight(s, mark.id));
            setMark(null);
          }}
        >
          Remove highlight
        </button>
      </div>
    );
  }
  if (!sel) return null;

  const done = () => {
    window.getSelection()?.removeAllRanges();
    setSel(null);
  };
  const actions: Array<[string, () => void]> = [
    [
      'Highlight',
      () => {
        void update((s) => addHighlight(s, { id: crypto.randomUUID(), itemId: sel.itemId, commentId: sel.commentId, text: sel.text, createdAt: Date.now() }));
        done();
      },
    ],
    ...(sel.canQuote
      ? ([
          [
            'Quote',
            () => {
              document.dispatchEvent(new CustomEvent<QuoteDetail>(QUOTE_EVENT, { detail: { commentId: sel.commentId, text: sel.text }, cancelable: true }));
              done();
            },
          ],
        ] as Array<[string, () => void]>)
      : []),
    [
      'Copy',
      () => {
        void navigator.clipboard.writeText(sel.text).then(() => toast('Copied.'), () => toast('Copy was blocked by the browser.'));
        done();
      },
    ],
    [
      'Speak',
      () => {
        speechSynthesis.cancel();
        speechSynthesis.speak(new SpeechSynthesisUtterance(sel.text));
        done();
      },
    ],
    [
      'Search HN',
      () => {
        window.open(`https://hn.algolia.com/?q=${encodeURIComponent(sel.text.slice(0, 200))}`, '_blank', 'noopener');
        done();
      },
    ],
  ];
  return (
    <div class="mg-popover mg-selpop" role="toolbar" aria-label="Selection actions" style={{ left: `${sel.x}px`, top: `${sel.y}px` }} onMouseDown={(e) => e.preventDefault()}>
      {actions.map(([label, run]) => (
        <button type="button" onClick={run}>
          {label}
        </button>
      ))}
    </div>
  );
}
