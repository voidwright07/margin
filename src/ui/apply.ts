import type { Settings, Theme } from '../store/schema';

/** Project settings onto <html> as data attributes and CSS variables. Pure DOM writes, safe to repeat. */
export const applySettings = (html: HTMLElement, s: Settings): void => {
  html.dataset.mgTheme = s.theme;
  html.dataset.mgFont = s.font;
  html.style.setProperty('--mg-fs', `${s.fontSize}px`);
  html.style.setProperty('--mg-lh', String(s.lineHeight));
  html.style.setProperty('--mg-measure', `${s.columnWidth}px`);
  html.style.setProperty('--mg-align', s.justify ? 'justify' : 'left');
  html.style.setProperty('--mg-hyphens', s.justify ? 'auto' : 'manual');
};

export const isDarkTheme = (theme: Theme): boolean =>
  theme === 'system' ? globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches === true : theme === 'slate' || theme === 'dark' || theme === 'black';
