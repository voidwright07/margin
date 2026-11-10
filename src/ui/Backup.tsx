import { useState } from 'preact/hooks';
import { BackupError, parseBackup } from '../store/schema';
import { getState, replaceState } from '../store/store';
import { plural } from './common';

export function Backup() {
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(getState(), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `margin-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    setMessage({ ok: true, text: 'Backup downloaded.' });
  };

  const importJson = async (file: File) => {
    try {
      const next = parseBackup(await file.text());
      await replaceState(next);
      setMessage({
        ok: true,
        text: `Restored ${plural(Object.keys(next.history).length, 'history entry', 'history entries')}, ${plural(next.bookmarks.length, 'bookmark')} and ${plural(next.highlights.length, 'highlight')}.`,
      });
    } catch (e) {
      setMessage({ ok: false, text: e instanceof BackupError ? e.message : 'Could not read that file.' });
    }
  };

  return (
    <div class="mg-backup">
      <p class="mg-backup-note">
        A backup is one JSON file with your settings, history, bookmarks and highlights. Restoring replaces what is stored now.
      </p>
      <div class="mg-backup-row">
        <button type="button" class="mg-btn mg-btn-primary" onClick={exportJson}>
          Download backup
        </button>
        <label class="mg-btn">
          Restore from file
          <input
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const f = (e.currentTarget as HTMLInputElement).files?.[0];
              if (f) void importJson(f);
              (e.currentTarget as HTMLInputElement).value = '';
            }}
          />
        </label>
      </div>
      {message && <p class={message.ok ? 'mg-ok' : 'mg-error'}>{message.text}</p>}
    </div>
  );
}
