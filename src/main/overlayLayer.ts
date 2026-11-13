import { execFileSync } from 'node:child_process';
import type { BrowserWindow } from 'electron';

/**
 * KWin stacks the *focused fullscreen* window (EVE in "Fixed window" mode, which Wine marks as fullscreen) above
 * "keep above" windows. Its on-screen-display window type lives in a layer above that, and such windows can still
 * take focus (needed for the search box). Electron cannot set this type, so it is set with xprop before the window
 * is first shown; KWin reads the type only when a window is mapped.
 *
 * Returns a diagnostic message, or null when applied.
 */
export function placeAboveFullscreen(win: BrowserWindow): string | null {
  if (process.platform !== 'linux') return 'not Linux';
  if (!/kde/i.test(process.env.XDG_CURRENT_DESKTOP ?? '')) return 'not a KDE session';
  if (!process.env.DISPLAY) return 'no X11 display';
  try {
    const xid = win.getNativeWindowHandle().readUInt32LE(0);
    execFileSync(
      'xprop',
      [
        '-id',
        String(xid),
        '-f',
        '_NET_WM_WINDOW_TYPE',
        '32a',
        '-set',
        '_NET_WM_WINDOW_TYPE',
        '_KDE_NET_WM_WINDOW_TYPE_ON_SCREEN_DISPLAY',
      ],
      { timeout: 3000, stdio: 'ignore' },
    );
    return null;
  } catch (err) {
    return `xprop failed (${(err as NodeJS.ErrnoException).code ?? String(err)}); install xprop or add a KWin window rule`;
  }
}
