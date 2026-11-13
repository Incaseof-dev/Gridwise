/** Persists settings as JSON in the XDG config dir with atomic writes (task 007). */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { configDir } from '../core/paths';
import { mergeSettings, migrateSettings, type Settings, type SettingsPatch } from '../core/settings';

export class SettingsStore {
  private current: Settings;
  private saveTimer: NodeJS.Timeout | null = null;

  constructor(private readonly path = join(configDir(), 'settings.json')) {
    let stored: unknown = null;
    if (existsSync(path)) {
      try {
        stored = JSON.parse(readFileSync(path, 'utf8'));
      } catch (err) {
        // A corrupt file must not stop the app; keep a copy for inspection and start from defaults.
        console.error(`settings: cannot read ${path}: ${String(err)}`);
        renameSync(path, `${path}.broken-${Date.now()}`);
      }
    }
    this.current = migrateSettings(stored, homedir(), process.platform);
  }

  get(): Settings {
    return this.current;
  }

  update(patch: SettingsPatch): Settings {
    this.current = migrateSettings(mergeSettings(this.current, patch), homedir(), process.platform);
    this.scheduleSave();
    return this.current;
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flush(), 300);
  }

  flush(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.current, null, 2));
    renameSync(tmp, this.path);
  }
}
