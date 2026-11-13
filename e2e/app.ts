/**
 * Starts the built app for a test (EVE-77): its own config, data and log folders under a temporary directory, so
 * the player's settings, logs and run log are never touched. Logs are fed from fixtures, moved to the current time.
 */
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { appendFileSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const FIXTURES = join(ROOT, 'test', 'fixtures');
/** Character id of the fixtures' pilot ("Docs Pilot"). */
const CHARACTER_ID = 90000001;

export interface AppHandle {
  app: ElectronApplication;
  overlay: Page;
  dirs: { root: string; gamelogs: string; chatlogs: string; data: string };
  /** Opens the settings window on a tab (by its label). */
  settings(tab?: string): Promise<Page>;
  close(): Promise<void>;
}

type Json = Record<string, unknown>;

function merge(a: Json, b: Json): Json {
  const out: Json = { ...a };
  for (const [k, v] of Object.entries(b))
    out[k] =
      v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object'
        ? merge(out[k] as Json, v as Json)
        : v;
  return out;
}

/**
 * A sample fit of the fixtures as the active fit (test/fixtures/hawk.eft: rockets; hawk-lml.eft: light missiles;
 * praxis.eft: armor and drones). The id stays `docs-hawk` whatever the hull, so tests can refer to it.
 */
export function sampleFit(file = 'hawk.eft'): Json {
  const eft = readFileSync(join(FIXTURES, file), 'utf8');
  const [, shipName, name] = /^\[([^,\]]+),\s*([^\]]+)\]/.exec(eft)!;
  return {
    saved: [{ id: 'docs-hawk', eft, shipName, name, source: 'paste', savedAt: '2026-10-24T12:00:00Z' }],
    activeId: 'docs-hawk',
  };
}

/**
 * `defaultKeys`: the default shortcuts, shown but not registered (EVE_ASSISTANT_NO_SHORTCUTS), for the docs
 * screenshots; tests use keys of their own, a running instance of the player's holds the defaults.
 */
export async function launchApp(settings: Json = {}, opts: { defaultKeys?: boolean } = {}): Promise<AppHandle> {
  const root = mkdtempSync(join(tmpdir(), 'eve-e2e-'));
  const gamelogs = join(root, 'EVE', 'logs', 'Gamelogs');
  const chatlogs = join(root, 'EVE', 'logs', 'Chatlogs');
  const config = join(root, 'config');
  const data = join(root, 'data');
  for (const d of [gamelogs, chatlogs, join(config, 'gridwise'), data]) mkdirSync(d, { recursive: true });
  const base: Json = {
    version: 2,
    logDir: gamelogs,
    overlay: {
      visible: true,
      bounds: { x: 40, y: 40, width: 440, height: 620 },
      clickThrough: false,
      minimized: false,
      aboveFullscreen: false,
    },
    updates: { auto: false },
    // Keys of their own: a running instance of the player's holds the defaults.
    shortcuts: opts.defaultKeys
      ? {}
      : Object.fromEntries(
          ['toggleClickThrough', 'toggleOverlay', 'search', 'minimize', 'prevPocket', 'nextPocket'].map((k, i) => [
            k,
            `CommandOrControl+Alt+Shift+F${i + 1}`,
          ]),
        ),
  };
  writeFileSync(join(config, 'gridwise', 'settings.json'), JSON.stringify(merge(base, settings), null, 1));

  const app = await electron.launch({
    cwd: ROOT,
    args: ['.', '--ozone-platform=x11'],
    env: {
      ...process.env,
      XDG_CONFIG_HOME: config,
      XDG_DATA_HOME: data,
      XDG_CACHE_HOME: join(root, 'cache'),
      ...(opts.defaultKeys ? { EVE_ASSISTANT_NO_SHORTCUTS: '1' } : {}),
    },
  });
  const overlay = await windowTitled(app, 'Overlay');
  await overlay.waitForSelector('.panel');

  return {
    app,
    overlay,
    dirs: { root, gamelogs, chatlogs, data },
    async settings(tab) {
      const existing = app.windows().find((w) => !w.isClosed() && w.url().includes('settings'));
      if (!existing) await overlay.evaluate(() => window.eve.openSettings());
      const page = existing ?? (await windowTitled(app, 'Settings'));
      await page.waitForSelector('nav.tabs');
      // Playwright emulates a light colour scheme by default; the docs show the dark one, like the overlay.
      await page.emulateMedia({ colorScheme: 'dark' });
      if (tab) await page.locator('nav.tabs button', { hasText: new RegExp(`^${tab}$`) }).click();
      return page;
    },
    async close() {
      await app.close().catch(() => {});
      rmSync(root, { recursive: true, force: true });
    },
  };
}

async function windowTitled(app: ElectronApplication, part: string): Promise<Page> {
  for (let i = 0; i < 100; i++) {
    for (const w of app.windows()) if ((await w.title().catch(() => '')).includes(part)) return w;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`no window titled "${part}"`);
}

const ENTRY = /^(\uFEFF?)\[ (\d{4})\.(\d{2})\.(\d{2}) (\d{2}):(\d{2}):(\d{2}) \]/;
const stamp = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ').replace(/-/g, '.');
const fileStamp = (ms: number) =>
  stamp(ms)
    .replace(/[.: ]/g, '')
    .replace(/^(\d{8})(\d{6})$/, '$1_$2');
const entryMs = (m: RegExpExecArray) => Date.UTC(+m[2]!, +m[3]! - 1, +m[4]!, +m[5]!, +m[6]!, +m[7]!);

/**
 * Writes a fixture's game log (and its Local chat log) as if it had just happened: entries up to `until`
 * (HH:MM:SS of the fixture, default: all) are moved so that the last one is a second ago. The app tails new files
 * from their start, so the fight shows up as live.
 */
export function feedLogs(
  h: AppHandle,
  fixture: string,
  opts: { until?: string; chat?: string } = {},
): { shiftMs: number; chatlog: string | null } {
  const lines = readFileSync(join(FIXTURES, fixture), 'utf8').split('\n');
  const inWindow = (l: string) => {
    const m = ENTRY.exec(l);
    return !m || !opts.until || l.slice(m[1]!.length + 13, m[1]!.length + 21) <= opts.until;
  };
  const kept = lines.filter(inWindow);
  const last = [...kept]
    .reverse()
    .map((l) => ENTRY.exec(l))
    .find(Boolean)!;
  const now = Date.now() - 1000;
  const shiftMs = now - entryMs(last);
  const retime = (l: string) => {
    const m = ENTRY.exec(l);
    return m ? l.replace(ENTRY, `$1[ ${stamp(entryMs(m) + shiftMs)} ]`) : l;
  };
  const gamelog = kept
    .map(retime)
    .join('\n')
    .replace(/Session Started: [\d.]+ [\d:]+/, `Session Started: ${stamp(now - 3600_000)}`);

  let chatlog: string | null = null;
  if (opts.chat) {
    const chat = readFileSync(join(FIXTURES, opts.chat)).toString('utf16le').split('\n').filter(inWindow).map(retime);
    chatlog = join(h.dirs.chatlogs, `Local_${fileStamp(now - 3600_000)}_${CHARACTER_ID}.txt`);
    writeFileSync(chatlog, Buffer.from(chat.join('\n') + '\n', 'utf16le'));
  }
  writeFileSync(join(h.dirs.gamelogs, `${fileStamp(now - 3600_000)}_${CHARACTER_ID}.txt`), gamelog + '\n');
  return { shiftMs, chatlog };
}

/** In-game scenery behind the overlay, cut from screenshots without any UI (names, chat, fleet). */
export type Backdrop = 'space' | 'abyss';

/** Room around the overlay in a screenshot; the panel sits at the window's top-left, so it is moved in by this. */
const MARGIN = 16;

/**
 * Screenshot of the overlay: the panel with the icon strip and the strips below it, on a piece of in-game scenery.
 */
export async function shootOverlay(page: Page, path: string, backdrop: Backdrop = 'space'): Promise<void> {
  // The renderer's CSP allows images from the app itself only: the backdrop goes next to the built pages.
  const image = `e2e-backdrop-${backdrop}.jpg`;
  copyFileSync(join(ROOT, 'e2e', 'backdrops', `${backdrop}.jpg`), join(ROOT, 'out', 'renderer', image));
  const box = await page.evaluate(
    ({ image, margin }) => {
      document.body.style.transform = `translate(${margin}px, ${margin}px)`;
      const rects = ['.panel', '.side-strip', '.below > *']
        .flatMap((s) => [...document.querySelectorAll(s)])
        .map((e) => e.getBoundingClientRect())
        .filter((r) => r.width > 0 && r.height > 0);
      const x = Math.min(...rects.map((r) => r.left)) - margin;
      const y = Math.min(...rects.map((r) => r.top)) - margin;
      const box = {
        x: Math.max(0, x),
        y: Math.max(0, y),
        width: Math.max(...rects.map((r) => r.right)) - x + margin,
        height: Math.max(...rects.map((r) => r.bottom)) - y + margin,
      };
      const bg = document.createElement('div');
      bg.style.cssText = `position:fixed;left:${box.x}px;top:${box.y}px;width:${box.width}px;height:${box.height}px;z-index:-1;background:url(../${image}) center/cover`;
      document.documentElement.appendChild(bg);
      return box;
    },
    { image, margin: MARGIN },
  );
  await page.waitForFunction(
    (src) => new Promise((ok) => Object.assign(new Image(), { onload: () => ok(true), onerror: () => ok(true), src })),
    `../${image}`,
  );
  await page.waitForTimeout(300);
  await page.screenshot({ path, clip: box });
}

/** Appends a Local channel change to a fed chat log, as happening now (e.g. leaving the Abyss). */
export function localChange(chatlog: string, system: string): void {
  const line = `\uFEFF[ ${stamp(Date.now())} ] EVE System > Channel changed to Local : ${system}\r\n`;
  appendFileSync(chatlog, Buffer.from(line, 'utf16le'));
}

/**
 * Feeds a fixture room by room: one time shift for the whole run (so clear times stay real), the game log written
 * up to each `until` in turn with `waitMs` between, as the app would see a run that is played now.
 */
export async function feedStaged(
  h: AppHandle,
  fixture: string,
  chat: string,
  untils: string[],
  waitMs: number,
): Promise<{ chatlog: string }> {
  const timeOf = (l: string) => {
    const m = ENTRY.exec(l);
    return m ? l.slice(m[1]!.length + 13, m[1]!.length + 21) : null;
  };
  const lines = readFileSync(join(FIXTURES, fixture), 'utf8').split('\n');
  const final = untils.at(-1)!;
  const last = [...lines].reverse().find((l) => (timeOf(l) ?? '99') <= final)!;
  const start = Date.now();
  const shiftMs = start + untils.length * waitMs - entryMs(ENTRY.exec(last)!);
  const retime = (l: string) => {
    const m = ENTRY.exec(l);
    return m ? l.replace(ENTRY, `$1[ ${stamp(entryMs(m) + shiftMs)} ]`) : l;
  };
  const chatLines = readFileSync(join(FIXTURES, chat))
    .toString('utf16le')
    .split('\n')
    .filter((l) => (timeOf(l) ?? '') <= final)
    .map(retime);
  const chatlog = join(h.dirs.chatlogs, `Local_${fileStamp(start - 3600_000)}_${CHARACTER_ID}.txt`);
  writeFileSync(chatlog, Buffer.from(chatLines.join('\n') + '\n', 'utf16le'));
  const gamelog = join(h.dirs.gamelogs, `${fileStamp(start - 3600_000)}_${CHARACTER_ID}.txt`);
  writeFileSync(gamelog, lines.filter((l) => timeOf(l) === null).join('\n') + '\n');
  let from = '';
  for (const until of untils) {
    const part = lines.filter((l) => {
      const t = timeOf(l);
      return t !== null && t > from && t <= until;
    });
    appendFileSync(gamelog, part.map(retime).join('\n') + '\n');
    from = until;
    await new Promise((r) => setTimeout(r, waitMs));
  }
  return { chatlog };
}
