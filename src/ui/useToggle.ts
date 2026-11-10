import { useState } from 'preact/hooks';
import { flipHref, performAction, type Toggle } from '../app/hn-client';
import type { Href } from '../hn/types';
import { toast } from './toast';

const FAILED: Record<Toggle, string> = {
  vote: 'Your vote did not go through. Try again.',
  fave: 'Could not update your favorites. Try again.',
  hide: 'Could not hide the story. Try again.',
  flag: 'Could not update the flag. Try again.',
};

/**
 * One HN account toggle (vote, favorite, hide, flag) with an optimistic UI. `onHref` is the link HN shows in
 * the active state (unvote, un-favorite, …), `offHref` the inactive one; at most one is present on a page.
 */
export function useHnToggle(kind: Toggle, onHref: Href | undefined, offHref: Href | undefined, onDone?: (active: boolean) => void) {
  const [state, setState] = useState<{ active: boolean; href: Href } | null>(() =>
    onHref ? { active: true, href: onHref } : offHref ? { active: false, href: offHref } : null,
  );
  const [busy, setBusy] = useState(false);
  const toggle = async () => {
    if (!state || busy) return;
    const prev = state;
    const active = !prev.active;
    setState({ active, href: flipHref(kind, prev.href, active) });
    setBusy(true);
    try {
      const ok = await performAction(prev.href);
      if (!ok) setState(prev);
      else onDone?.(active);
    } catch {
      setState(prev);
      toast(FAILED[kind]);
    } finally {
      setBusy(false);
    }
  };
  return { available: state !== null, active: state?.active ?? false, toggle };
}
