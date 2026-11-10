import type { PageMeta, Section } from '../hn/types';
import { updateSettings, useStore } from '../store/store';
import { isDarkTheme } from './apply';
import { IconClassic, IconGear, IconLibrary, IconMoon, IconSun, Logo } from './icons';
import { SettingsPanel } from './SettingsPanel';
import { usePanel } from './panels';

const TABS: Array<{ label: string; href: string; sections: Section[] }> = [
  { label: 'Top', href: 'news', sections: ['news'] },
  { label: 'New', href: 'newest', sections: ['newest'] },
  { label: 'Past', href: 'front', sections: ['front'] },
  { label: 'Comments', href: 'newcomments', sections: ['newcomments'] },
  { label: 'Ask', href: 'ask', sections: ['ask'] },
  { label: 'Show', href: 'show', sections: ['show'] },
  { label: 'Jobs', href: 'jobs', sections: ['jobs'] },
  { label: 'Best', href: 'best', sections: ['best', 'bestcomments'] },
];

export function Header({ meta }: { meta: PageMeta }) {
  const theme = useStore((s) => s.settings.theme);
  const [panel, setPanel] = usePanel();
  const viewer = meta.viewer;
  const goto = encodeURIComponent(meta.url.pathname.slice(1) + meta.url.search);
  const dark = isDarkTheme(theme);

  return (
    <header class="mg-top">
      <div class="mg-top-inner">
        <a class="mg-brand" href="news" aria-label="Hacker News front page">
          <Logo size={24} />
          <span class="mg-brand-name">Hacker News</span>
        </a>
        <nav class="mg-tabs" aria-label="Sections">
          {TABS.map((t) => {
            const active = meta.section !== null && t.sections.includes(meta.section);
            return (
              <a href={t.href} class={`mg-tab${active ? ' is-active' : ''}`} aria-current={active ? 'page' : undefined}>
                {t.label}
              </a>
            );
          })}
          {viewer && (
            <a href={`threads?id=${viewer.name}`} class={`mg-tab${meta.section === 'threads' && meta.url.searchParams.get('id') === viewer.name ? ' is-active' : ''}`}>
              Threads
            </a>
          )}
          <a href="submit" class="mg-tab mg-tab-submit">Submit</a>
        </nav>
        <div class="mg-top-tools">
          {viewer ? (
            <a class="mg-account" href={`user?id=${viewer.name}`} title="Your profile">
              <span class="mg-account-name">{viewer.name}</span>
              <span class="mg-account-karma">{viewer.karma.toLocaleString()}</span>
            </a>
          ) : (
            <a class="mg-btn mg-btn-ghost" href={`login?goto=${goto}`}>Log in</a>
          )}
          <button
            type="button"
            class={`mg-icon-btn${panel === 'library' ? ' is-on' : ''}`}
            title="Library: history, bookmarks, highlights (L)"
            aria-label="Library"
            onClick={() => setPanel(panel === 'library' ? null : 'library')}
          >
            <IconLibrary size={18} />
          </button>
          <button
            type="button"
            class="mg-icon-btn"
            title={dark ? 'Switch to light theme' : 'Switch to dark theme'}
            aria-label="Toggle dark theme"
            onClick={() => updateSettings({ theme: dark ? 'light' : 'dark' })}
          >
            {dark ? <IconSun size={18} /> : <IconMoon size={18} />}
          </button>
          <button
            type="button"
            class={`mg-icon-btn${panel === 'settings' ? ' is-on' : ''}`}
            title="Appearance and settings"
            aria-label="Settings"
            aria-expanded={panel === 'settings'}
            onClick={() => setPanel(panel === 'settings' ? null : 'settings')}
          >
            <IconGear size={18} />
          </button>
          <button
            type="button"
            class="mg-icon-btn"
            title="Show the original Hacker News design"
            aria-label="Show original design"
            onClick={() => updateSettings({ enabled: false })}
          >
            <IconClassic size={18} />
          </button>
        </div>
        {panel === 'settings' && (
          <div class="mg-popover mg-settings-pop" role="dialog" aria-label="Settings">
            <SettingsPanel />
          </div>
        )}
      </div>
    </header>
  );
}
