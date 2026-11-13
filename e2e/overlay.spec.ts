/** Front-end checks of the built app (EVE-77): the overlay and the settings window against fixture logs. */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { feedLogs, launchApp, localChange, sampleFit, type AppHandle } from './app';

let h: AppHandle;
test.afterEach(async () => h?.close());

test('the brief opens from the search, with the fit icon and the side strip', async () => {
  h = await launchApp({ fits: sampleFit() });
  const hits = await h.overlay.evaluate(() => window.eve.search('crimson gauntlet'));
  expect(hits.length).toBeGreaterThan(0);
  await h.overlay.evaluate((ref) => window.eve.selectEncounter(ref), hits[0]!.ref);
  await expect(h.overlay.locator('.brief .name')).toContainText('Crimson Gauntlet');
  await expect(h.overlay.locator('.side-strip .abyss-button')).toBeVisible();
});

test('live threats from the combat log: scram and point warn at once', async () => {
  h = await launchApp();
  feedLogs(h, 'crimson-gauntlet.txt');
  await expect(h.overlay.locator('.threats')).toContainText(/SCRAMMED|POINTED/);
  await expect(h.overlay.locator('.below')).toContainText('out');
});

test('the Abyss: Local "Unknown" starts the run, the scram frigate comes first', async () => {
  h = await launchApp({ abyss: { weather: 'exotic', tier: 1 } });
  feedLogs(h, 'abyss-t1.txt', { until: '09:58:10', chat: 'abyss-t1.local.txt' });
  const panel = h.overlay.locator('.abyss');
  await expect(panel).toBeVisible({ timeout: 20_000 });
  await expect(panel.locator('.abyss-timer')).toHaveText(/^1\d:\d\d$/);
  await expect(panel.locator('.abyss-focus li').first()).toContainText('Lucifer Echo');
  await expect(panel.locator('.abyss-focus li').nth(1)).toContainText('Lucifer Cynabal');
});

test('the Abyss preview and the picker', async () => {
  h = await launchApp({ abyss: { weather: 'exotic', tier: 1 } });
  await h.overlay.locator('.side-strip .abyss-button').click();
  await expect(h.overlay.locator('.abyss')).toContainText('ready');
  await expect(h.overlay.locator('.abyss-dangers')).toContainText('Lucifer Cynabal');
  await h.overlay.locator('.abyss .filament').click();
  await h.overlay.locator('.abyss-picker .pick', { hasText: 'Firestorm' }).click();
  await expect(h.overlay.locator('.abyss .filament')).toContainText('Firestorm');
});

test('every settings tab renders', async () => {
  h = await launchApp({ fits: sampleFit() });
  const page = await h.settings();
  for (const tab of [
    'Game logs',
    'Ship fit',
    'EVE login',
    'Overlay',
    'Enemy sites',
    'Abyss',
    'Abyss log',
    'Game data',
    'Diagnostics',
    'About',
  ]) {
    await page.locator('nav.tabs button', { hasText: new RegExp(`^${tab}$`) }).click();
    await expect(page.locator('section:visible').first()).toBeVisible();
    // An Electron started by Playwright gets no keyring (safeStorage: basic_text, unavailable), the real app does.
    await expect(page.locator('.error:visible:not(.storage-warning)')).toHaveCount(0);
  }
});

test('a run that leaves the Abyss into another system is logged as a lost ship', async () => {
  h = await launchApp({ abyss: { weather: 'exotic', tier: 1 } });
  const { chatlog } = feedLogs(h, 'abyss-t1.txt', { until: '09:58:10', chat: 'abyss-t1.local.txt' });
  await expect(h.overlay.locator('.abyss')).toBeVisible({ timeout: 20_000 });
  // The clone wakes up at home, not where the filament was used.
  localChange(chatlog!, 'Maurasi');
  await expect(h.overlay.locator('.abyss')).toHaveCount(0, { timeout: 15_000 });
  const page = await h.settings('Abyss log');
  await expect(page.locator('.run-tree .fit-row.on')).toContainText('lost');
  await expect(page.locator('.run-detail')).toContainText('Ship lost');
  await expect(page.locator('.run-detail')).toContainText('woke up in Maurasi');
  // No loot question after a lost ship.
  await expect(h.overlay.locator('.loot-prompt')).toHaveCount(0);
});

test('after a run that ends alive the overlay asks for the loot, which is kept with the run', async () => {
  h = await launchApp({ abyss: { weather: 'exotic', tier: 1 }, fits: sampleFit() });
  const { chatlog } = feedLogs(h, 'abyss-t1.txt', { until: '09:58:10', chat: 'abyss-t1.local.txt' });
  await expect(h.overlay.locator('.abyss')).toBeVisible({ timeout: 20_000 });
  localChange(chatlog!, 'Vaankalen');
  const prompt = h.overlay.locator('.loot-prompt');
  await expect(prompt).toContainText('Exotic T1', { timeout: 15_000 });
  await prompt.locator('button', { hasText: 'Paste it' }).click();
  const page = await h.settings();
  const dialog = page.locator('.modal[aria-label="Loot of the run"]');
  await expect(dialog).toBeVisible();
  await dialog
    .locator('textarea')
    .first()
    .fill('Triglavian Survey Database\t12\tAbyssal Materials\nCalm Exotic Filament\t1');
  await dialog.locator('textarea').nth(1).fill('Calm Exotic Filament\t2');
  await dialog.locator('button', { hasText: 'Save the loot' }).click();
  await expect(dialog).toHaveCount(0);
  const detail = page.locator('.run-detail');
  await expect(detail).toContainText('Triglavian Survey Database');
  await expect(detail).toContainText('Hawk');
  await expect(detail).toContainText('Used up');
  await expect(detail).toContainText('Add your EVE Workbench key');
  await expect(prompt).toHaveCount(0);
});

test('the cargo buttons read the clipboard: before the run, and the loot after it (EVE-93)', async () => {
  h = await launchApp({ abyss: { weather: 'exotic', tier: 1 }, fits: sampleFit() });
  // The test Electron shares the desktop's clipboard: put back what was there.
  const clip = (text?: string) =>
    h.app.evaluate(({ clipboard }, t) => (t === undefined ? clipboard.readText() : (clipboard.writeText(t), '')), text);
  const saved = await clip();
  try {
    await h.overlay.locator('.side-strip .abyss-button').click();
    const before = h.overlay.locator('.cargo-button', { hasText: 'before' });
    const after = h.overlay.locator('.cargo-button', { hasText: 'after' });
    await expect(after).toBeDisabled();
    await clip('Calm Exotic Filament\t3\nTriglavian Survey Database\t2');
    await before.click();
    await expect(before).toHaveClass(/done/);

    const { chatlog } = feedLogs(h, 'abyss-t1.txt', { until: '09:58:10', chat: 'abyss-t1.local.txt' });
    await expect(h.overlay.locator('.abyss-timer')).toBeVisible({ timeout: 20_000 });
    await h.overlay.evaluate(() => window.eve.setAbyssPreview(false));
    localChange(chatlog!, 'Vaankalen');
    await expect(h.overlay.locator('.loot-prompt')).toContainText('against the cargo before', { timeout: 15_000 });
    await clip('Calm Exotic Filament\t2\nTriglavian Survey Database\t14');
    await after.click();
    await expect(h.overlay.locator('.loot-prompt')).toHaveCount(0);
    await expect(after).toHaveClass(/done/);

    const detail = (await h.settings('Abyss log')).locator('.run-detail');
    await expect(detail.locator('.loot-table').first()).toContainText('12×');
    await expect(detail).toContainText('Used up');
    await expect(detail.locator('.loot-table').nth(1)).toContainText('Calm Exotic Filament');
  } finally {
    await clip(saved);
  }
});

test('a shortcut is rebound by clicking it and pressing the new keys', async () => {
  h = await launchApp();
  const page = await h.settings('Overlay');
  const row = page.locator('tr', { hasText: 'Minimize to the top' });
  await row.locator('button.shortcut-key').click();
  await expect(row).toContainText('press keys');
  await page.keyboard.press('Control+Shift+K');
  await expect(row.locator('button.shortcut-key')).toHaveText('Ctrl+Shift+K');
  await expect
    .poll(() => h.overlay.evaluate(() => window.eve.getState().then((v) => v.settings.shortcuts.minimize)))
    .toBe('CommandOrControl+Shift+K');
  await row.locator('button', { hasText: 'Reset' }).click();
  await expect(row.locator('button.shortcut-key')).toHaveText('Ctrl+Alt+M');
});

test('quick ship select in the side strip switches the active fit', async () => {
  const one = sampleFit() as { saved: Record<string, string>[]; activeId: string };
  const other = { ...one.saved[0]!, id: 'second', name: 'Second Hawk', savedAt: '2026-10-25T12:00:00Z' };
  h = await launchApp({ fits: { saved: [one.saved[0], other], activeId: 'docs-hawk', recent: ['docs-hawk'] } });
  const strip = h.overlay.locator('.side-strip');
  await strip.locator('.ship-button').click();
  await expect(strip.locator('.ship-pick')).toHaveCount(2);
  // The render comes through the local image cache (eveimg://) and is kept on disk.
  await expect
    .poll(() => strip.locator('.ship-button img').evaluate((i) => (i as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);
  expect(readdirSync(join(h.dirs.root, 'cache', 'gridwise', 'images', 'types'))).toContain('11379-render-64');
  await strip.locator('.ship-pick', { hasText: 'Second Hawk' }).click();
  await expect.poll(() => h.overlay.evaluate(() => window.eve.getState().then((v) => v.fit.active?.id))).toBe('second');
  await expect
    .poll(() => h.overlay.evaluate(() => window.eve.getState().then((v) => v.fit.quick.map((f) => f.id))))
    .toEqual(['second', 'docs-hawk']);
});

test('damage application: the Fury on a fast Damavik, with a better charge', async () => {
  h = await launchApp({ fits: sampleFit('hawk-lml.eft'), abyss: { weather: 'exotic', tier: 1 } });
  feedLogs(h, 'abyss-t1.txt', { until: '10:03:40', chat: 'abyss-t1.local.txt' });
  const hint = h.overlay.locator('.below .application-hint').first();
  await expect(hint).toContainText('Fury → Striking Damavik', { timeout: 20_000 });
  await expect(hint).toContainText('~66%');
  await expect(hint).toHaveAttribute('title', /web/);
});

test('Ship fit tab: the fits as a tree of ship class, faction and ship', async () => {
  const hawk = sampleFit() as { saved: Record<string, string>[] };
  const fit = (id: string, eft: string, shipName: string, name: string) => ({
    id,
    eft,
    shipName,
    name,
    source: 'paste',
    savedAt: '2026-10-25T12:00:00Z',
  });
  h = await launchApp({
    fits: {
      saved: [
        hawk.saved[0],
        fit('gila', '[Gila, Drone ratting]', 'Gila', 'Drone ratting'),
        fit('jackdaw', '[Jackdaw, L3 missions]', 'Jackdaw', 'L3 missions'),
        fit('worm', '[Worm, Exploration]', 'Worm', 'Exploration'),
        {
          ...fit('esi-1-7', '[Gila, In game fit]', 'Gila', 'In game fit'),
          source: 'esi',
          esi: { characterId: 1, fittingId: 7 },
        },
      ],
      activeId: 'docs-hawk',
    },
  });
  const page = await h.settings('Ship fit');
  const tree = page.locator('.fit-tree');
  await expect(tree.locator(':scope > details > summary')).toHaveText(['Frigates', 'Destroyers', 'Cruisers']);
  const frigates = tree.locator(':scope > details').first();
  await expect(frigates.locator('.tree-faction > summary')).toHaveText(['Caldari State', 'Guristas Pirates']);
  await expect(tree.locator('.fit-row.on')).toContainText('Docs Hawk');
  // A fitting saved in game: marked, and not removable here.
  const inGame = tree.locator('.fit-row', { hasText: 'In game fit' });
  // Branches start closed like in game, except the one with the active fit; opened by hand they stay open.
  const branch = (name: string) =>
    tree.locator(':scope > details', { has: page.locator(`:scope > summary:text-is("${name}")`) });
  await expect(branch('Cruisers')).not.toHaveAttribute('open');
  for (const name of ['Destroyers', 'Cruisers']) await branch(name).locator(':scope > summary').click();
  await branch('Cruisers').locator('.tree-ship > summary').click();
  await expect(inGame).toContainText('in game');
  await expect(inGame.locator('button', { hasText: '×' })).toHaveCount(0);
  await tree.locator('.fit-pick', { hasText: 'L3 missions' }).click();
  await expect(tree.locator('.fit-row.on')).toContainText('L3 missions');
  await expect
    .poll(() => h.overlay.evaluate(() => window.eve.getState().then((v) => v.fit.active?.id)))
    .toBe('jackdaw');
});

test('Ship fit tab: add a fit in a dialog, switch ammo in the fit parts', async () => {
  h = await launchApp({ fits: sampleFit('hawk-lml.eft') });
  const page = await h.settings('Ship fit');
  await page.locator('.tree-actions button', { hasText: 'Add a fit' }).click();
  await expect(page.locator('.modal')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.modal')).toHaveCount(0);

  const offense = page.locator('.gs-section', { hasText: 'Offense' }).locator('.gs-head-value');
  await expect(offense).toHaveText('218.5 dps');
  const launchers = page.locator('.fit-parts .part', { hasText: 'Light Missile Launcher II' });
  await expect(launchers).toHaveCount(1);
  await expect(launchers).toContainText('4×');
  await launchers.locator('select').selectOption('Scourge Precision Light Missile');
  await expect(offense).not.toHaveText('218.5 dps');
  await page.locator('.fit-parts button', { hasText: 'Back to the ammo' }).click();
  await expect(offense).toHaveText('218.5 dps');
});

test('Ship fit tab: a tactical destroyer switches modes', async () => {
  const eft = `[Jackdaw, Modes]\nBallistic Control System II\n\n5MN Microwarpdrive II\n\nLight Missile Launcher II, Scourge Light Missile\n`;
  h = await launchApp({
    fits: {
      saved: [{ id: 'jd', eft, shipName: 'Jackdaw', name: 'Modes', source: 'paste', savedAt: '2026-10-26T10:00:00Z' }],
      activeId: 'jd',
    },
  });
  const page = await h.settings('Ship fit');
  const modes = page.locator('.t3d-modes button');
  await expect(modes).toHaveText(['Defense', 'Propulsion', 'Sharpshooter']);
  await expect(modes.first()).toHaveClass(/on/);
  const range = page.locator('.gs-section', { hasText: 'Targeting' }).locator('.gs-head-value');
  const before = await range.innerText();
  await modes.nth(2).click();
  await expect(modes.nth(2)).toHaveClass(/on/);
  await expect(range).not.toHaveText(before);
});
