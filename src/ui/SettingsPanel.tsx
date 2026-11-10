import { FONTS, INDEX_VIEWS, RANGES, TABLE_COLUMNS, THEMES, THREAD_LINES, type Settings, type TableColumn, type Theme } from '../store/schema';
import { updateSettings, useStore } from '../store/store';

const THEME_LABEL: Record<Theme, string> = {
  system: 'System',
  light: 'Light',
  classic: 'Classic',
  slate: 'Slate',
  dark: 'Dark',
  black: 'Black',
};

const COLUMN_LABEL: Record<TableColumn, string> = {
  rank: 'Rank',
  vote: 'Vote',
  title: 'Title',
  site: 'Site',
  score: 'Points',
  by: 'Author',
  age: 'Age',
  comments: 'Comments',
};

function Segmented<T extends string>({ value, options, label, onChange, render }: {
  value: T;
  options: readonly T[];
  label: string;
  onChange: (v: T) => void;
  render?: (v: T) => string;
}) {
  return (
    <div class="mg-seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button type="button" role="radio" aria-checked={o === value} class={o === value ? 'is-on' : ''} onClick={() => onChange(o)}>
          {render ? render(o) : o[0]!.toUpperCase() + o.slice(1)}
        </button>
      ))}
    </div>
  );
}

function Slider({ label, value, range, unit, onInput }: {
  label: string;
  value: number;
  range: { min: number; max: number; step: number };
  unit: string;
  onInput: (v: number) => void;
}) {
  return (
    <label class="mg-field">
      <span class="mg-field-row">
        <span>{label}</span>
        <output>
          {Number.isInteger(range.step) ? value : value.toFixed(2)}
          {unit}
        </output>
      </span>
      <input
        type="range"
        min={range.min}
        max={range.max}
        step={range.step}
        value={value}
        onInput={(e) => onInput(Number((e.currentTarget as HTMLInputElement).value))}
      />
    </label>
  );
}

function Toggle({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label class="mg-toggle">
      <span>
        {label}
        {hint && <small>{hint}</small>}
      </span>
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange((e.currentTarget as HTMLInputElement).checked)} />
    </label>
  );
}

export function SettingsPanel({ showOriginalToggle = true }: { showOriginalToggle?: boolean }) {
  const s = useStore((st) => st.settings);
  const set = (patch: Partial<Settings>) => void updateSettings(patch);
  const toggleColumn = (c: TableColumn, on: boolean) =>
    set({ tableColumns: TABLE_COLUMNS.filter((x) => (x === c ? on : s.tableColumns.includes(x))) });

  return (
    <div class="mg-settings">
      <section>
        <h3>Theme</h3>
        <div class="mg-swatches" role="radiogroup" aria-label="Theme">
          {THEMES.map((t) => (
            <button type="button" role="radio" aria-checked={s.theme === t} class={`mg-swatch${s.theme === t ? ' is-on' : ''}`} data-swatch={t} onClick={() => set({ theme: t })}>
              <span class="mg-swatch-chip" />
              {THEME_LABEL[t]}
            </button>
          ))}
        </div>
      </section>
      <section>
        <h3>Text</h3>
        <Segmented label="Font" value={s.font} options={FONTS} onChange={(font) => set({ font })} />
        <Slider label="Size" value={s.fontSize} range={RANGES.fontSize} unit="px" onInput={(fontSize) => set({ fontSize })} />
        <Slider label="Line height" value={s.lineHeight} range={RANGES.lineHeight} unit="" onInput={(lineHeight) => set({ lineHeight })} />
        <Slider label="Column width" value={s.columnWidth} range={RANGES.columnWidth} unit="px" onInput={(columnWidth) => set({ columnWidth })} />
        <Toggle label="Justify comment text" checked={s.justify} onChange={(justify) => set({ justify })} />
      </section>
      <section>
        <h3>Thread lines</h3>
        <Segmented label="Thread lines" value={s.threadLines} options={THREAD_LINES} onChange={(threadLines) => set({ threadLines })} />
      </section>
      <section>
        <h3>Story lists</h3>
        <Segmented label="Index view" value={s.indexView} options={INDEX_VIEWS} onChange={(indexView) => set({ indexView })} />
        {s.indexView === 'table' && (
          <div class="mg-columns" role="group" aria-label="Table columns">
            {TABLE_COLUMNS.map((c) => (
              <label class="mg-check">
                <input type="checkbox" checked={s.tableColumns.includes(c)} disabled={c === 'title'} onChange={(e) => toggleColumn(c, (e.currentTarget as HTMLInputElement).checked)} />
                {COLUMN_LABEL[c]}
              </label>
            ))}
          </div>
        )}
        <Toggle label="Open story links in a new tab" checked={s.openLinksInNewTab} onChange={(openLinksInNewTab) => set({ openLinksInNewTab })} />
        <Toggle label="Load more as you scroll" hint="Off shows HN's More link" checked={s.infiniteScroll} onChange={(infiniteScroll) => set({ infiniteScroll })} />
        <Toggle label="Keyboard shortcuts" hint="Press ? for the list" checked={s.keyboard} onChange={(keyboard) => set({ keyboard })} />
      </section>
      {showOriginalToggle && (
        <section>
          <button type="button" class="mg-btn mg-btn-block" onClick={() => set({ enabled: false })}>
            Show the original Hacker News design
          </button>
        </section>
      )}
    </div>
  );
}

export { THEME_LABEL };
