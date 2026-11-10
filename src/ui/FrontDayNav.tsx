import type { PageMeta } from '../hn/types';
import { IconChevronLeft, IconChevronRight } from './icons';

const iso = (d: Date) => d.toISOString().slice(0, 10);
const shift = (day: string, days: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return iso(d);
};

/** The day this past-front-page list shows: the ?day= HN was asked for, else the date in HN's own heading. */
export const frontDay = (meta: PageMeta, heading: string | null): string => {
  const asked = meta.url.searchParams.get('day');
  if (asked && /^\d{4}-\d\d-\d\d$/.test(asked)) return asked;
  const fromHeading = heading?.match(/(\w+ \d{1,2}, \d{4})/)?.[1];
  const parsed = fromHeading ? new Date(`${fromHeading} 12:00 UTC`) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? iso(parsed) : shift(iso(new Date()), -1);
};

export function FrontDayNav({ meta, heading }: { meta: PageMeta; heading: string | null }) {
  const day = frontDay(meta, heading);
  const today = iso(new Date());
  const go = (d: string) => {
    if (d && d <= today) globalThis.location.href = `front?day=${d}`;
  };
  const label = new Date(`${day}T12:00:00Z`).toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
  return (
    <div class="mg-dayhead">
      <div>
        <h1 class="mg-dayhead-title">{label}</h1>
        <p class="mg-dayhead-sub">Front page stories from this day</p>
      </div>
      <div class="mg-daynav">
        <a class="mg-icon-btn" href={`front?day=${shift(day, -1)}`} title="Previous day" aria-label="Previous day" data-mg-prev>
          <IconChevronLeft size={16} />
        </a>
        <input
          class="mg-input mg-date"
          type="date"
          value={day}
          max={today}
          min="2007-02-19"
          aria-label="Pick a day"
          onChange={(e) => go((e.currentTarget as HTMLInputElement).value)}
        />
        {shift(day, 1) <= today ? (
          <a class="mg-icon-btn" href={`front?day=${shift(day, 1)}`} title="Next day" aria-label="Next day" data-mg-nextday>
            <IconChevronRight size={16} />
          </a>
        ) : (
          <span class="mg-icon-btn is-disabled" aria-hidden="true">
            <IconChevronRight size={16} />
          </span>
        )}
      </div>
    </div>
  );
}
