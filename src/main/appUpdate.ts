/**
 * App updates from the GitHub releases (Incaseof-dev/Gridwise) through electron-updater. Looks at start and every few
 * hours; a new version downloads in the background and is installed when the player restarts it from Settings →
 * About, or at the next quit. Never restarts on its own: the overlay must not vanish mid-fight.
 *
 * Only the installed builds can replace themselves: the AppImage, and the Windows installer (NSIS). The Windows zip
 * and a dev run only say that a new version is out, with the link to the release.
 */
import { existsSync, readdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { app } from 'electron';
import { autoUpdater, type UpdateInfo } from 'electron-updater';

export const RELEASES_URL = 'https://github.com/Incaseof-dev/Gridwise/releases/latest';

export type AppUpdateState = 'idle' | 'checking' | 'none' | 'available' | 'downloading' | 'ready' | 'error';

export interface AppUpdateView {
  state: AppUpdateState;
  current: string;
  /** The newer version, once one is known. */
  version: string | null;
  /** Download progress, 0–100. */
  percent: number | null;
  /** This build can replace itself (AppImage, Windows installer). */
  canInstall: boolean;
  error: string | null;
  checkedAt: number | null;
  releaseUrl: string;
}

/** The NSIS installer leaves its uninstaller next to the exe; the zip does not. */
function installedWithNsis(): boolean {
  try {
    return readdirSync(dirname(process.execPath)).some((f) => /^Uninstall .*\.exe$/i.test(f));
  } catch {
    return false;
  }
}

export function canSelfUpdate(): boolean {
  if (!app.isPackaged) return false;
  if (process.platform === 'linux') return !!process.env.APPIMAGE && existsSync(process.env.APPIMAGE);
  if (process.platform === 'win32') return installedWithNsis();
  return false;
}

const CHECK_EVERY_MS = 4 * 3600_000;

export class AppUpdater {
  private readonly view: AppUpdateView;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly onChange: () => void,
    private readonly enabled: () => boolean,
  ) {
    const canInstall = canSelfUpdate();
    this.view = {
      state: 'idle',
      current: app.getVersion(),
      version: null,
      percent: null,
      canInstall,
      error: null,
      checkedAt: null,
      releaseUrl: RELEASES_URL,
    };
    autoUpdater.autoDownload = canInstall;
    autoUpdater.autoInstallOnAppQuit = canInstall;
    autoUpdater.allowPrerelease = false;
    // Its own console logging is enough; nothing else is sent anywhere.
    autoUpdater.logger = null;
    const set = (patch: Partial<AppUpdateView>) => {
      Object.assign(this.view, patch);
      this.onChange();
    };
    autoUpdater.on('checking-for-update', () => set({ state: 'checking', error: null }));
    autoUpdater.on('update-not-available', () => set({ state: 'none', checkedAt: Date.now() }));
    autoUpdater.on('update-available', (i: UpdateInfo) =>
      set({ state: canInstall ? 'downloading' : 'available', version: i.version, checkedAt: Date.now(), percent: 0 }),
    );
    autoUpdater.on('download-progress', (p) => set({ state: 'downloading', percent: Math.round(p.percent) }));
    autoUpdater.on('update-downloaded', (i: UpdateInfo) => set({ state: 'ready', version: i.version, percent: 100 }));
    autoUpdater.on('error', (e: Error) =>
      set({ state: 'error', error: e.message.split('\n')[0] ?? String(e), checkedAt: Date.now() }),
    );
  }

  get current(): AppUpdateView {
    return { ...this.view };
  }

  /** First look a little after start, then every few hours, while the setting is on. */
  start(): void {
    if (!app.isPackaged) return;
    setTimeout(() => void this.check(false), 30_000);
    this.timer = setInterval(() => void this.check(false), CHECK_EVERY_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async check(byHand: boolean): Promise<void> {
    if (!app.isPackaged) {
      this.view.state = 'error';
      this.view.error = 'Updates work in the packaged app only.';
      this.onChange();
      return;
    }
    if (!byHand && !this.enabled()) return;
    // A downloaded one waits for the restart; do not fetch it again.
    if (this.view.state === 'ready' || this.view.state === 'downloading') return;
    try {
      await autoUpdater.checkForUpdates();
    } catch {
      // Reported through the 'error' event.
    }
  }

  /** Quits and installs the downloaded version, then starts it again. */
  install(): boolean {
    if (this.view.state !== 'ready') return false;
    // isSilent false: the Windows installer shows its progress; isForceRunAfter true: the app comes back.
    setImmediate(() => autoUpdater.quitAndInstall(false, true));
    return true;
  }
}
