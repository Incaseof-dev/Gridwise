import { app } from 'electron';
import { spawn } from 'node:child_process';

/**
 * On a Wayland session the overlay must run as an XWayland client, otherwise always-on-top is not honoured
 * (docs/linux-overlay.md, task 001). The ozone switch only works on the real command line, so a packaged app
 * started without it relaunches itself once with the flag. In dev the flag comes from the npm script.
 */
export function ensureX11OnWayland(): boolean {
  if (process.platform !== 'linux' || process.env.XDG_SESSION_TYPE !== 'wayland') return false;
  if (app.commandLine.getSwitchValue('ozone-platform') === 'x11' || !app.isPackaged) return false;
  if (process.env.EVE_ASSISTANT_ALLOW_WAYLAND === '1') return false;
  // app.relaunch() does not survive this early (before "ready"); start a detached copy ourselves.
  // Inside an AppImage the executable is a temporary mount, so start the AppImage file itself.
  spawn(process.env.APPIMAGE ?? process.execPath, [...process.argv.slice(1), '--ozone-platform=x11'], {
    detached: true,
    stdio: 'ignore',
  }).unref();
  app.exit(0);
  return true;
}

export function platformInfo() {
  return {
    ozone: app.commandLine.getSwitchValue('ozone-platform') || 'default',
    sessionType: process.env.XDG_SESSION_TYPE ?? 'unknown',
    desktop: process.env.XDG_CURRENT_DESKTOP ?? 'unknown',
    electron: process.versions.electron,
  };
}
