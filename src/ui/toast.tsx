import { useEffect, useState } from 'preact/hooks';

let current: { id: number; text: string } | null = null;
let seq = 0;
const listeners = new Set<(t: typeof current) => void>();

export const toast = (text: string): void => {
  current = { id: ++seq, text };
  const id = current.id;
  for (const l of listeners) l(current);
  setTimeout(() => {
    if (current?.id !== id) return;
    current = null;
    for (const l of listeners) l(null);
  }, 3500);
};

export function Toasts() {
  const [t, set] = useState(current);
  useEffect(() => {
    listeners.add(set);
    return () => void listeners.delete(set);
  }, []);
  return (
    <div class="mg-toast-host" role="status" aria-live="polite">
      {t && (
        <div class="mg-toast" key={t.id}>
          {t.text}
        </div>
      )}
    </div>
  );
}
