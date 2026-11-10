import { useEffect, useState } from 'preact/hooks';
import { browser } from 'wxt/browser';
import { defaultState, parseState, STATE_KEYS, type Settings, type State, type Theme } from './schema';

/**
 * The single owner of chrome.storage.local. Nothing else in the extension touches storage:
 * components read through `useStore` and write through `update`.
 */

let state: State = defaultState();
let loaded: Promise<State> | null = null;
const listeners = new Set<(s: State) => void>();

const emit = () => {
  for (const l of listeners) l(state);
};

/**
 * A tiny synchronous hint, kept in the page's localStorage, so the content script can theme the page and hide
 * the old design at document_start before chrome.storage answers. It holds only `enabled` and `theme`.
 */
const BOOT_KEY = 'margin:boot';
export type BootHint = { enabled: boolean; theme: Theme };

export const readBootHint = (): BootHint | null => {
  try {
    const raw = globalThis.localStorage?.getItem(BOOT_KEY);
    if (!raw) return null;
    const s = parseState({ settings: JSON.parse(raw) }).settings;
    return { enabled: s.enabled, theme: s.theme };
  } catch {
    return null;
  }
};

const writeBootHint = (s: Settings) => {
  if (globalThis.location?.hostname !== 'news.ycombinator.com') return;
  try {
    globalThis.localStorage.setItem(BOOT_KEY, JSON.stringify({ enabled: s.enabled, theme: s.theme }));
  } catch {
    // Storage can be blocked; the hint is an optimisation only.
  }
};

const listenForChanges = () => {
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    const merged: Record<string, unknown> = { ...state };
    for (const [k, change] of Object.entries(changes)) merged[k] = change.newValue;
    state = parseState(merged);
    writeBootHint(state.settings);
    emit();
  });
};

export const loadState = (): Promise<State> => {
  loaded ??= browser.storage.local.get(null).then((raw) => {
    state = parseState(raw);
    writeBootHint(state.settings);
    listenForChanges();
    emit();
    return state;
  });
  return loaded;
};

export const getState = (): State => state;

/** Apply a pure transition and persist only the top-level keys it changed. */
export const update = async (fn: (s: State) => State): Promise<void> => {
  const prev = state;
  const next = fn(prev);
  if (next === prev) return;
  const changed = STATE_KEYS.filter((k) => next[k] !== prev[k]);
  state = next;
  writeBootHint(next.settings);
  emit();
  await browser.storage.local.set(Object.fromEntries(changed.map((k) => [k, next[k]])));
};

export const updateSettings = (patch: Partial<Settings>) =>
  update((s) => ({ ...s, settings: { ...s.settings, ...patch } }));

/** Replace everything, as a restore does. */
export const replaceState = async (next: State): Promise<void> => {
  state = next;
  writeBootHint(next.settings);
  emit();
  await browser.storage.local.clear();
  await browser.storage.local.set(next);
};

export const subscribe = (fn: (s: State) => void): (() => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export function useStore<T>(select: (s: State) => T): T {
  const [value, setValue] = useState(() => select(state));
  useEffect(() => {
    setValue(() => select(state));
    return subscribe((s) => setValue(() => select(s)));
  }, []);
  return value;
}
