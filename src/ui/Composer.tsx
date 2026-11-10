import { useEffect, useRef, useState } from 'preact/hooks';
import { fetchReplyForm, HnError, postReply } from '../app/hn-client';
import type { Href, Page, ReplyForm } from '../hn/types';

type Source = { form: ReplyForm } | { replyHref: Href };

/** Inline reply box. Root replies use the page's form; comment replies fetch reply?id= for its hmac first. */
export function Composer({ source, draft, onDraft, onPosted, onCancel, submitLabel = 'Reply', autoFocus }: {
  source: Source;
  draft: string;
  onDraft: (text: string) => void;
  onPosted: (page: Extract<Page, { kind: 'item' }>) => void;
  onCancel?: () => void;
  submitLabel?: string;
  autoFocus?: boolean;
}) {
  const [status, setStatus] = useState<{ phase: 'idle' } | { phase: 'posting' } | { phase: 'error'; message: string }>({ phase: 'idle' });
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!autoFocus || !ref.current) return;
    const el = ref.current;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [autoFocus]);

  const submit = async (e: Event) => {
    e.preventDefault();
    if (!draft.trim() || status.phase === 'posting') return;
    setStatus({ phase: 'posting' });
    try {
      const form = 'form' in source ? source.form : await fetchReplyForm(source.replyHref);
      const page = await postReply(form, draft);
      setStatus({ phase: 'idle' });
      onPosted(page);
    } catch (err) {
      setStatus({ phase: 'error', message: err instanceof HnError ? err.message : 'Could not reach Hacker News. Your text is still here; try again.' });
    }
  };

  return (
    <form class="mg-composer" onSubmit={submit}>
      <textarea
        ref={ref}
        class="mg-input mg-textarea"
        rows={5}
        value={draft}
        placeholder="Write a reply"
        aria-label="Reply text"
        onInput={(e) => onDraft((e.currentTarget as HTMLTextAreaElement).value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void submit(e);
          if (e.key === 'Escape' && onCancel) onCancel();
        }}
      />
      {status.phase === 'error' && <p class="mg-error">{status.message}</p>}
      <div class="mg-composer-bar">
        <a class="mg-composer-help" href="formatdoc" target="_blank" rel="noopener">
          Formatting help
        </a>
        <span class="mg-spacer" />
        {onCancel && (
          <button type="button" class="mg-btn mg-btn-ghost" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button type="submit" class="mg-btn mg-btn-primary" disabled={!draft.trim() || status.phase === 'posting'}>
          {status.phase === 'posting' ? 'Posting…' : submitLabel}
        </button>
      </div>
    </form>
  );
}
