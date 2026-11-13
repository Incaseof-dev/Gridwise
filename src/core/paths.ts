/**
 * Per-user locations (docs/architecture.md §6). Electron main and the CLIs use the same paths.
 * Linux: XDG directories. Windows: %APPDATA% (config) and %LOCALAPPDATA% (data, cache). macOS: Application Support.
 */
import { existsSync, mkdirSync, readdirSync, renameSync, rmdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const APP = 'gridwise';
/** The name before EVE-94; its folders move over on the first start. */
const LEGACY_APP = 'eve-assistant';

type Kind = 'config' | 'data' | 'cache';

function base(kind: Kind, app = APP): string {
  const home = homedir();
  if (process.platform === 'win32') {
    const roaming = process.env.APPDATA || join(home, 'AppData', 'Roaming');
    const local = process.env.LOCALAPPDATA || join(home, 'AppData', 'Local');
    return kind === 'config' ? join(roaming, app) : kind === 'data' ? join(local, app) : join(local, app, 'cache');
  }
  if (process.platform === 'darwin') {
    const support = join(home, 'Library', 'Application Support', app);
    return kind === 'cache' ? join(home, 'Library', 'Caches', app) : support;
  }
  const xdg = {
    config: process.env.XDG_CONFIG_HOME || join(home, '.config'),
    data: process.env.XDG_DATA_HOME || join(home, '.local', 'share'),
    cache: process.env.XDG_CACHE_HOME || join(home, '.cache'),
  };
  return join(xdg[kind], app);
}

export function configDir(): string {
  return base('config');
}

export function dataDir(): string {
  return base('data');
}

export function cacheDir(): string {
  return base('cache');
}

export function sdeDbPath(): string {
  return join(dataDir(), 'sde', 'sde.sqlite');
}

/**
 * Moves the folders of the old name (eve-assistant) to the new one, so settings, the EVE login and the Abyss log
 * stay. Runs before Electron touches the folders; an entry already in the new folder wins and the old one stays.
 */
export function migrateLegacyDirs(): void {
  // Windows keeps the cache inside the data folder: it moves with it.
  const kinds: Kind[] = process.platform === 'win32' ? ['config', 'data'] : ['config', 'data', 'cache'];
  for (const kind of kinds) {
    const from = base(kind, LEGACY_APP);
    const to = base(kind);
    if (from === to || !existsSync(from)) continue;
    try {
      if (!existsSync(to)) {
        mkdirSync(dirname(to), { recursive: true });
        renameSync(from, to);
        continue;
      }
      for (const name of readdirSync(from)) {
        if (!existsSync(join(to, name))) renameSync(join(from, name), join(to, name));
      }
      if (readdirSync(from).length === 0) rmdirSync(from);
    } catch {
      // A folder that cannot move stays where it was; the app starts with defaults for it.
    }
  }
}
