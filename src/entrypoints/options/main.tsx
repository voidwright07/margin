import '../../ui/tokens.css';
import '../../ui/app.css';
import '../../ui/pages.css';
import { render } from 'preact';
import { loadState, subscribe, updateSettings, useStore } from '../../store/store';
import { applySettings } from '../../ui/apply';
import { Logo } from '../../ui/icons';
import { SettingsPanel } from '../../ui/SettingsPanel';
import { Backup } from '../../ui/Backup';
import { LibraryContent } from '../../ui/Library';

function Options() {
  const enabled = useStore((s) => s.settings.enabled);
  return (
    <div class="mg-app mg-options">
      <header class="mg-options-head">
        <Logo size={32} />
        <div>
          <h1>Margin for Hacker News</h1>
          <p>A calm, readable redesign of every Hacker News page. Everything here is stored in this browser only.</p>
        </div>
      </header>
      <main class="mg-options-grid">
        <section class="mg-options-card">
          <h2>Appearance</h2>
          <label class="mg-toggle mg-options-enable">
            <span>
              Use the Margin design
              <small>Turn off to see the original Hacker News pages.</small>
            </span>
            <input type="checkbox" role="switch" checked={enabled} onChange={(e) => void updateSettings({ enabled: (e.currentTarget as HTMLInputElement).checked })} />
          </label>
          <SettingsPanel showOriginalToggle={false} />
        </section>
        <section class="mg-options-card">
          <h2>Library</h2>
          <LibraryContent />
        </section>
        <section class="mg-options-card">
          <h2>Backup and restore</h2>
          <Backup />
        </section>
      </main>
    </div>
  );
}

const html = document.documentElement;
void loadState().then((s) => {
  applySettings(html, s.settings);
  subscribe((st) => applySettings(html, st.settings));
  render(<Options />, document.getElementById('app')!);
});
