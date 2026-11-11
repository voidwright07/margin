import type { PageMeta, Section, Viewer } from '../hn/types';
import { IconChevronDown, IconGear, IconLibrary, Logo } from './icons';
import { SearchField } from './Search';
import { SettingsPanel } from './SettingsPanel';
import { usePanel } from './panels';

type Tab = { label: string; href: string; sections: Section[] };

/** The sections most readers switch between stay in the bar; the rest sit behind More. */
const TABS: Tab[] = [
  { label: 'Top', href: 'news', sections: ['news'] },
  { label: 'New', href: 'newest', sections: ['newest'] },
  { label: 'Ask', href: 'ask', sections: ['ask'] },
  { label: 'Show', href: 'show', sections: ['show'] },
];
const MORE: Tab[] = [
  { label: 'Past', href: 'front', sections: ['front'] },
  { label: 'Best', href: 'best', sections: ['best', 'bestcomments'] },
  { label: 'Comments', href: 'newcomments', sections: ['newcomments'] },
  { label: 'Jobs', href: 'jobs', sections: ['jobs'] },
];

const isIn = (tab: Tab, section: Section | null) => section !== null && tab.sections.includes(section);

export function Header({ meta }: { meta: PageMeta }) {
  const [panel, setPanel] = usePanel();
  const toggle = (p: NonNullable<typeof panel>) => setPanel(panel === p ? null : p);
  const viewer = meta.viewer;
  const goto = encodeURIComponent(meta.url.pathname.slice(1) + meta.url.search);
  const inMore = MORE.find((t) => isIn(t, meta.section));

  return (
    <header class="mg-top">
      <div class="mg-top-inner">
        <a class="mg-brand" href="news" aria-label="Hacker News front page">
          <Logo size={24} />
          <span class="mg-brand-name">Hacker News</span>
        </a>
        <nav class="mg-tabs" aria-label="Sections">
          {TABS.map((t) => {
            const active = isIn(t, meta.section);
            return (
              <a href={t.href} class={`mg-tab${active ? ' is-active' : ''}`} aria-current={active ? 'page' : undefined}>
                {t.label}
              </a>
            );
          })}
          <div class="mg-menu-wrap">
            <button
              type="button"
              class={`mg-tab${inMore ? ' is-active' : ''}${panel === 'more' ? ' is-open' : ''}`}
              aria-expanded={panel === 'more'}
              aria-controls="mg-more-menu"
              onClick={() => toggle('more')}
            >
              {inMore?.label ?? 'More'}
              <IconChevronDown size={14} class="mg-tab-chev" />
            </button>
            {panel === 'more' && (
              <div id="mg-more-menu" class="mg-popover mg-menu">
                {MORE.map((t) => {
                  const active = t === inMore;
                  return (
                    <a href={t.href} class={`mg-menu-item${active ? ' is-active' : ''}`} aria-current={active ? 'page' : undefined}>
                      {t.label}
                    </a>
                  );
                })}
              </div>
            )}
          </div>
        </nav>
        <SearchField />
        <div class="mg-top-tools">
          {viewer ? (
            <AccountMenu viewer={viewer} meta={meta} open={panel === 'account'} onToggle={() => toggle('account')} />
          ) : (
            <a class="mg-btn mg-btn-ghost" href={`login?goto=${goto}`}>Log in</a>
          )}
          <button
            type="button"
            class={`mg-icon-btn${panel === 'library' ? ' is-on' : ''}`}
            title="Library: history, bookmarks, highlights (L)"
            aria-label="Library"
            onClick={() => toggle('library')}
          >
            <IconLibrary size={18} />
          </button>
          <button
            type="button"
            class={`mg-icon-btn${panel === 'settings' ? ' is-on' : ''}`}
            title="Theme, text and settings"
            aria-label="Settings"
            aria-expanded={panel === 'settings'}
            onClick={() => toggle('settings')}
          >
            <IconGear size={18} />
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

function AccountMenu({ viewer, meta, open, onToggle }: { viewer: NonNullable<Viewer>; meta: PageMeta; open: boolean; onToggle: () => void }) {
  const mine = meta.url.searchParams.get('id') === viewer.name;
  const items = [
    { label: 'Profile', href: `user?id=${viewer.name}`, active: mine && meta.url.pathname === '/user' },
    { label: 'Threads', href: `threads?id=${viewer.name}`, active: mine && meta.section === 'threads' },
    { label: 'Submit', href: 'submit', active: meta.url.pathname === '/submit' },
  ];
  return (
    <div class="mg-menu-wrap">
      <button
        type="button"
        class={`mg-account${open ? ' is-open' : ''}`}
        title="Your account"
        aria-expanded={open}
        aria-controls="mg-account-menu"
        onClick={onToggle}
      >
        <span class="mg-account-name">{viewer.name}</span>
        <span class="mg-account-karma" title="Karma">{viewer.karma.toLocaleString()}</span>
        <IconChevronDown size={14} class="mg-tab-chev" />
      </button>
      {open && (
        <div id="mg-account-menu" class="mg-popover mg-menu mg-menu-end">
          {items.map((i) => (
            <a href={i.href} class={`mg-menu-item${i.active ? ' is-active' : ''}`} aria-current={i.active ? 'page' : undefined}>
              {i.label}
            </a>
          ))}
          <hr class="mg-menu-rule" />
          <a href={viewer.logout} class="mg-menu-item">Log out</a>
        </div>
      )}
    </div>
  );
}
