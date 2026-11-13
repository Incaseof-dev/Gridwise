/**
 * Documentation screenshots (EVE-77): `npm run screenshots` writes docs/screenshots/*.png from fixture logs, so the
 * pictures follow the UI as it changes. Each test is one scene.
 */
import { expect, test } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  feedLogs,
  feedStaged,
  launchApp as launch,
  localChange,
  ROOT,
  sampleFit,
  shootOverlay,
  type AppHandle,
} from './app';

const OUT = join(ROOT, 'docs', 'screenshots');
mkdirSync(OUT, { recursive: true });
const shot = (name: string) => join(OUT, `${name}.png`);
const settle = (ms = 1500) => new Promise((r) => setTimeout(r, ms));

let h: AppHandle;
// The docs show the default shortcuts.
const launchApp = (settings: Parameters<typeof launch>[0] = {}) => launch(settings, { defaultKeys: true });
test.afterEach(async () => h?.close());

async function selectEncounter(query: string): Promise<void> {
  const hits = await h.overlay.evaluate((q) => window.eve.search(q), query);
  await h.overlay.evaluate((ref) => window.eve.selectEncounter(ref), hits[0]!.ref);
  await h.overlay.waitForSelector('.brief .name');
}

test('brief in a live fight (Crimson Gauntlet)', async () => {
  // A Praxis: the armor and drone ship a Blood Raider site is run with, not a frigate.
  h = await launchApp({
    fits: sampleFit('praxis.eft'),
    overlay: { bounds: { x: 40, y: 40, width: 460, height: 470 } },
  });
  await selectEncounter('crimson gauntlet');
  feedLogs(h, 'crimson-gauntlet.txt');
  await h.overlay.waitForSelector('.threats');
  await settle();
  await shootOverlay(h.overlay, shot('brief-live-fight'));
});

test('brief, compact header', async () => {
  h = await launchApp({ fits: sampleFit(), overlay: { headerMode: 'compact' } });
  await selectEncounter('guristas haven');
  await settle();
  await shootOverlay(h.overlay, shot('brief-compact'));
});

// The Abyss panel is shorter than a brief: a smaller panel, so the picture is not mostly empty.
const ABYSS_PANEL = { bounds: { x: 40, y: 40, width: 440, height: 400 } };

test('Abyss preview before the filament', async () => {
  h = await launchApp({ fits: sampleFit(), abyss: { weather: 'exotic', tier: 1 }, overlay: ABYSS_PANEL });
  await h.overlay.evaluate(() => window.eve.setAbyssPreview(true));
  await h.overlay.waitForSelector('.abyss-dangers');
  await settle(500);
  await shootOverlay(h.overlay, shot('abyss-preview'), 'abyss');
});

test('Abyss run: the Cynabal room', async () => {
  h = await launchApp({
    fits: sampleFit(),
    abyss: { weather: 'exotic', tier: 1 },
    overlay: { bounds: { x: 40, y: 40, width: 440, height: 300 } },
  });
  feedLogs(h, 'abyss-t1.txt', { until: '09:58:10', chat: 'abyss-t1.local.txt' });
  await h.overlay.waitForSelector('.abyss-focus li', { timeout: 20_000 });
  // The Local log is picked up on the next directory scan (5 s); until then the timer is an estimate (≈).
  await expect(h.overlay.locator('.abyss-timer')).toHaveText(/^\d+:\d\d$/, { timeout: 20_000 });
  await settle();
  await shootOverlay(h.overlay, shot('abyss-run'), 'abyss');
});

test('minimized with the EWAR strip', async () => {
  h = await launchApp({
    overlay: { minimizedShow: { threats: true, messages: true }, bounds: { x: 40, y: 40, width: 520, height: 400 } },
  });
  feedLogs(h, 'crimson-gauntlet.txt');
  await h.overlay.waitForSelector('.threats');
  await h.overlay.evaluate(() => window.eve.setMinimized(true));
  await settle();
  await shootOverlay(h.overlay, shot('minimized'));
});

test('Abyss: the run log, and the loot question after a run', async () => {
  h = await launchApp({ fits: sampleFit(), abyss: { weather: 'exotic', tier: 1 }, overlay: ABYSS_PANEL });
  // The run up to the last room, then Local leaves the Abyss: the run is logged with its rooms.
  // Room by room (Overmind, Cynabal, Triglavians), so the app sees each fight while it happens.
  const { chatlog } = await feedStaged(
    h,
    'abyss-t1.txt',
    'abyss-t1.local.txt',
    ['09:57:30', '09:59:30', '10:06:00'],
    7000,
  );
  localChange(chatlog!, 'Vaankalen');
  await expect(h.overlay.locator('.abyss')).toHaveCount(0, { timeout: 15_000 });
  await h.overlay.waitForSelector('.loot-prompt');
  await settle(800);
  await shootOverlay(h.overlay, shot('abyss-loot-prompt'));

  const id = await h.overlay.evaluate(() => window.eve.getState().then((v) => v.lootPrompt!.entryId));
  await h.overlay.evaluate(
    (id) =>
      window.eve.saveAbyssLoot(
        id,
        [
          'Triglavian Survey Database\t14\tAbyssal Materials',
          'Calm Exotic Filament\t1\tAbyssal Filaments',
          'Gravid Small Armor Repairer Mutaplasmid\t1\tMutaplasmids',
          'Imperial Navy Sergeant Insignia I\t2\tCommodities',
        ].join('\n'),
      ),
    id,
  );
  const page = await h.settings('Abyss log');
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForSelector('.run-detail h4');
  await page
    .locator('.run-detail details')
    .first()
    .evaluate((d) => ((d as HTMLDetailsElement).open = true));
  await settle(800);
  await page.screenshot({ path: shot('settings-abyss-log') });
  await page.locator('nav.tabs button', { hasText: /^Abyss$/ }).click();
  await settle(800);
  await page.screenshot({ path: shot('settings-abyss') });
});

test('settings: Enemy sites', async () => {
  h = await launchApp();
  const page = await h.settings('Enemy sites');
  await page.locator('.factions button', { hasText: 'Guristas' }).click();
  await settle(500);
  await page.screenshot({ path: shot('settings-enemy-sites') });
});

test('settings: Overlay switches', async () => {
  h = await launchApp();
  const page = await h.settings('Overlay');
  await settle(500);
  await page.screenshot({ path: shot('settings-overlay'), fullPage: true });
});

test('settings: Ship fit with the tree, the parts and the stats', async () => {
  const fit = (id: string, eft: string, shipName: string, name: string, extra = {}) => ({
    id,
    eft,
    shipName,
    name,
    source: 'paste',
    savedAt: '2026-10-25T12:00:00Z',
    ...extra,
  });
  const jackdaw = readFileSync(join(ROOT, 'test', 'fixtures', 'jackdaw.eft'), 'utf8');
  const hawk = readFileSync(join(ROOT, 'test', 'fixtures', 'hawk-lml.eft'), 'utf8');
  h = await launchApp({
    fits: {
      saved: [
        fit('hawk', hawk, 'Hawk', 'Light Missile Hawk'),
        fit('jackdaw', jackdaw, 'Jackdaw', 'Docs Jackdaw'),
        fit('jackdaw-l3', '[Jackdaw, L3 missions]', 'Jackdaw', 'L3 missions'),
        fit('gila', '[Gila, Drone ratting]', 'Gila', 'Drone ratting', {
          source: 'esi',
          esi: { characterId: 1, fittingId: 7 },
        }),
        fit('worm', '[Worm, Exploration]', 'Worm', 'Exploration', {
          source: 'ewb',
          ewb: { fitId: '00000000-0000-0000-0000-000000000001', hash: 'x' },
        }),
      ],
      activeId: 'jackdaw',
      recent: ['jackdaw', 'hawk'],
    },
  });
  const page = await h.settings('Ship fit');
  await page.setViewportSize({ width: 1280, height: 900 });
  // Every branch open, so the picture shows the whole tree (the app remembers branches opened by hand).
  await page.locator('.fit-tree').evaluate((t) => t.querySelectorAll('details').forEach((d) => (d.open = true)));
  await page.waitForSelector('.t3d-modes');
  await settle(1500);
  await page.screenshot({ path: shot('settings-ship-fit') });
});

test('settings: EVE login and EVE Workbench', async () => {
  h = await launchApp();
  const page = await h.settings('EVE login');
  await page.setViewportSize({ width: 1280, height: 900 });
  // Playwright's Electron has no keyring; the real app has one, so its warning is not in the picture.
  await page.addStyleTag({ content: '.storage-warning { display: none }' });
  await settle(500);
  // Only as tall as the tab's content.
  const bottom = await page.locator('.tab-panel').evaluate((e) => e.getBoundingClientRect().bottom);
  await page.screenshot({ path: shot('settings-eve-login'), clip: { x: 0, y: 0, width: 1280, height: bottom + 24 } });
});

test('quick ship select in the side strip', async () => {
  const hawk = sampleFit('hawk-lml.eft') as { saved: Record<string, string>[] };
  const jackdaw = readFileSync(join(ROOT, 'test', 'fixtures', 'jackdaw.eft'), 'utf8');
  h = await launchApp({
    fits: {
      saved: [
        hawk.saved[0],
        {
          id: 'jd',
          eft: jackdaw,
          shipName: 'Jackdaw',
          name: 'Docs Jackdaw',
          source: 'paste',
          savedAt: '2026-10-25T12:00:00Z',
        },
        {
          id: 'gila',
          eft: '[Gila, Drone ratting]',
          shipName: 'Gila',
          name: 'Drone ratting',
          source: 'paste',
          savedAt: '2026-10-26T12:00:00Z',
        },
      ],
      activeId: 'docs-hawk',
      recent: ['docs-hawk', 'jd'],
    },
    overlay: { bounds: { x: 300, y: 40, width: 440, height: 360 } },
  });
  await selectEncounter('guristas haven');
  await h.overlay.locator('.side-strip .ship-button').click();
  await h.overlay.waitForSelector('.ship-pick img');
  await settle(1500);
  await shootOverlay(h.overlay, shot('quick-ship-select'));
});

test('damage application below the DPS strip', async () => {
  h = await launchApp({
    fits: sampleFit('hawk-lml.eft'),
    abyss: { weather: 'exotic', tier: 1 },
    overlay: { bounds: { x: 40, y: 40, width: 440, height: 300 } },
  });
  feedLogs(h, 'abyss-t1.txt', { until: '10:03:40', chat: 'abyss-t1.local.txt' });
  await expect(h.overlay.locator('.below .application-hint').first()).toContainText('Damavik', { timeout: 20_000 });
  await settle();
  await shootOverlay(h.overlay, shot('damage-application'), 'abyss');
});
