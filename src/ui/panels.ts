import { useEffect, useState } from 'preact/hooks';

/** At most one overlay is open at a time; this is its single source of truth. */
export type Panel = 'settings' | 'library' | 'help' | null;

let current: Panel = null;
const listeners = new Set<(p: Panel) => void>();

export const setPanel = (p: Panel): void => {
  current = p;
  for (const l of listeners) l(p);
};
export const getPanel = (): Panel => current;

export function usePanel(): [Panel, (p: Panel) => void] {
  const [p, set] = useState(current);
  useEffect(() => {
    listeners.add(set);
    return () => void listeners.delete(set);
  }, []);
  return [p, setPanel];
}
