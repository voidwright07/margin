import type { JSX } from 'preact';

type P = { size?: number; class?: string };

const svg = (path: JSX.Element, { size = 16, class: cls }: P, fill = false) => (
  <svg
    class={cls}
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill={fill ? 'currentColor' : 'none'}
    stroke={fill ? 'none' : 'currentColor'}
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    {path}
  </svg>
);

export const IconUp = (p: P) => svg(<path d="M12 5.5 19 15H5z" />, p, true);
export const IconDown = (p: P) => svg(<path d="M12 18.5 5 9h14z" />, p, true);
export const IconGear = (p: P) =>
  svg(
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </>,
    p,
  );
export const IconSun = (p: P) =>
  svg(
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>,
    p,
  );
export const IconMoon = (p: P) => svg(<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />, p);
export const IconBookmark = (p: P & { filled?: boolean }) =>
  svg(<path d="M6 3.5h12v17l-6-4-6 4z" />, p, p.filled ?? false);
export const IconLibrary = (p: P) =>
  svg(
    <>
      <path d="M4 4.5h4v15H4zM10 4.5h4v15h-4z" />
      <path d="m16.2 5.2 3.8-1 3.1 14.6-3.8 1z" transform="translate(-2 0)" />
    </>,
    p,
  );
export const IconClassic = (p: P) =>
  svg(
    <>
      <rect x="3.5" y="4" width="17" height="16" rx="2" />
      <path d="M3.5 8.5h17M7 12h10M7 15.5h6" />
    </>,
    p,
  );
export const IconSearch = (p: P) =>
  svg(
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4.2-4.2" />
    </>,
    p,
  );
export const IconClose = (p: P) => svg(<path d="M6 6l12 12M18 6 6 18" />, p);
export const IconChevronLeft = (p: P) => svg(<path d="m15 5-7 7 7 7" />, p);
export const IconChevronRight = (p: P) => svg(<path d="m9 5 7 7-7 7" />, p);
export const IconKeyboard = (p: P) =>
  svg(
    <>
      <rect x="2.5" y="6" width="19" height="12" rx="2" />
      <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" />
    </>,
    p,
  );
export const IconStar = (p: P & { filled?: boolean }) =>
  svg(<path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z" />, p, p.filled ?? false);

/** The Margin mark: a page with a wide left margin rule. Original artwork, also used for the toolbar icon. */
export const Logo = ({ size = 22 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
    <rect x="1" y="1" width="30" height="30" rx="8" fill="var(--accent)" />
    <path d="M11 7v18" stroke="var(--on-accent, #fff)" stroke-width="2.6" stroke-linecap="round" />
    <path d="M16 11h8M16 16h8M16 21h5" stroke="var(--on-accent, #fff)" stroke-width="2.6" stroke-linecap="round" opacity="0.9" />
  </svg>
);
