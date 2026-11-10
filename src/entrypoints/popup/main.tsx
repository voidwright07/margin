import '../../ui/tokens.css';
import '../../ui/app.css';
import '../../ui/thread.css';
import '../../ui/pages.css';
import { render } from 'preact';
import { browser } from 'wxt/browser';
import { THEMES } from '../../store/schema';
import { loadState, subscribe, updateSettings, useStore } from '../../store/store';
import { applySettings } from '../../ui/apply';
import { Logo } from '../../ui/icons';
import { THEME_LABEL } from '../../ui/SettingsPanel';

function Popup() {
  const s = useStore((st) => st.settings);
  return (
    <div class="mg-app mg-popup">
      <div class="mg-popup-head">
        <Logo size={22} />
        Margin for Hacker News
      </div>
      <div class="mg-settings">
        <label class="mg-toggle">
          <span>Use the Margin design</span>
          <input type="checkbox" role="switch" checked={s.enabled} onChange={(e) => void updateSettings({ enabled: (e.currentTarget as HTMLInputElement).checked })} />
        </label>
        <section>
          <div class="mg-swatches" role="radiogroup" aria-label="Theme">
            {THEMES.map((t) => (
              <button type="button" role="radio" aria-checked={s.theme === t} class={`mg-swatch${s.theme === t ? ' is-on' : ''}`} data-swatch={t} onClick={() => void updateSettings({ theme: t })}>
                <span class="mg-swatch-chip" />
                {THEME_LABEL[t]}
              </button>
            ))}
          </div>
        </section>
      </div>
      <div class="mg-popup-links">
        <a class="mg-btn" href="https://news.ycombinator.com/news" target="_blank" rel="noopener">
          Open Hacker News
        </a>
        <button type="button" class="mg-btn" onClick={() => void browser.runtime.openOptionsPage()}>
          All settings
        </button>
      </div>
    </div>
  );
}

const html = document.documentElement;
void loadState().then((s) => {
  applySettings(html, s.settings);
  subscribe((st) => applySettings(html, st.settings));
  render(<Popup />, document.getElementById('app')!);
});
