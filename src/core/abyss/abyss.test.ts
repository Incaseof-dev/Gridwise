import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { abyssFromWiki } from '../kb/wiki/abyss';
import { parseLocalLine } from '../logs/localChannel';
import type { FitStats } from '../fit/types';
import { parseAbyssData } from './parse';
import { focusOrder, identifyNpc, tierFromNpcs, type FocusInput } from './priority';
import { addLogEntry, logEntry, pruneLog } from './log';
import { AbyssRuns } from './run';
import { buildAbyssView } from './view';

const data = parseAbyssData(JSON.parse(readFileSync(join(process.cwd(), 'kb', 'abyss.json'), 'utf8')));
const npc = (name: string, extra: Partial<FocusInput> = {}): FocusInput => ({
  name,
  observed: [],
  sde: [],
  ehp: null,
  lastSeenMs: 0,
  ...extra,
});
const T0 = Date.UTC(2026, 9, 24, 9, 37, 12);

describe('bundled kb/abyss.json', () => {
  it('has the seven tiers, five weathers and the factions', () => {
    expect(data.tiers.map((t) => t.name)).toEqual([
      'Tranquil',
      'Calm',
      'Agitated',
      'Fierce',
      'Raging',
      'Chaotic',
      'Cataclysmic',
    ]);
    expect(data.tiers[1]!.penalty).toEqual([30, 50]);
    expect(data.tiers[5]!.penalty).toEqual([50, 70]);
    expect(data.weathers.find((w) => w.id === 'exotic')!.penalty).toMatchObject({ kind: 'resist', damage: 'kinetic' });
    expect(data.weathers.find((w) => w.id === 'dark')!.penalty.kind).toBe('turretRange');
    expect(data.factions.map((f) => f.id)).toEqual([
      'drones',
      'drifters',
      'sleepers',
      'triglavian',
      'sansha',
      'concord',
      'angel',
    ]);
  });

  it('knows each tier’s Overmind and the T1 angel rooms', () => {
    expect(data.overminds.find((o) => o.tier === 1)).toMatchObject({
      name: 'Photic Abyssal Overmind',
      damage: ['explosive'],
    });
    const angelT1 = data.rooms.filter((r) => r.tier === 1 && r.faction === 'angel');
    expect(angelT1.some((r) => r.npcs.some((n) => n.names.includes('Lucifer Cynabal')))).toBe(true);
    // "Striking/Anchoring/Ghosting Damavik": the shared hull goes to every name.
    expect(data.rooms.flatMap((r) => r.npcs.flatMap((n) => n.names))).toContain('Anchoring Damavik');
  });

  it('fails loudly when the pages change', () => {
    const empty = { title: 'x', revision: 1, timestamp: '', content: 'nothing here' };
    expect(() => abyssFromWiki(empty, empty, '2026-10-24')).toThrow(/layout changed/);
  });
});

describe('abyssal names', () => {
  it('reads faction and role from the name parts', () => {
    expect(identifyNpc('Anchoring Damavik', data)).toMatchObject({ ewar: ['warpScramble'], hull: 'frigate' });
    expect(identifyNpc('Lucifer Echo', data).ewar.sort()).toEqual(['warpScramble', 'web']);
    expect(identifyNpc('Fieldweaver Tessella', data).tags).toContain('logi');
    // Rogue drone parts are glued together.
    expect(identifyNpc('Sparkneedle Tessella', data).roles.map((r) => r.token)).toEqual(['Spark', 'needle']);
    expect(identifyNpc('Triglavian Extraction SubNode', data)).toMatchObject({ structure: true, faction: null });
    expect(identifyNpc('Photic Abyssal Overmind', data).hull).toBe('battleship');
  });

  it('tells the tier from an Overmind', () => {
    expect(tierFromNpcs(['Striking Damavik', 'Photic Abyssal Overmind'], data)).toBe(1);
    expect(tierFromNpcs(['Striking Damavik'], data)).toBeNull();
  });
});

describe('focus order', () => {
  it('puts the scram frigate before the neuting cruiser that takes longer to kill', () => {
    const order = focusOrder(
      [
        npc('Lucifer Cynabal', { observed: ['neut'], ehp: 9625 }),
        npc('Lucifer Echo', { observed: ['warpScramble'], ehp: 2874 }),
      ],
      data,
    );
    expect(order.map((f) => f.name)).toEqual(['Lucifer Echo', 'Lucifer Cynabal']);
    expect(order[0]!.reasons).toContain('SCRAM on you');
    expect(order[1]!.reasons).toEqual(expect.arrayContaining(['NEUT on you', 'HIGH DPS']));
  });

  it('logi first, the Overmind and the loot last', () => {
    const order = focusOrder(
      [
        npc('Photic Abyssal Overmind'),
        npc('Triglavian Extraction SubNode'),
        npc('Sparkneedle Tessella'),
        npc('Fieldweaver Tessella'),
      ],
      data,
    );
    expect(order.map((f) => f.group)).toEqual(['logi', 'damage', 'tank', 'loot']);
    expect(order[2]!.why).toMatch(/explosive/);
  });

  it('known EWAR from the SDE counts too; swarmers wait for their controller', () => {
    const order = focusOrder(
      [npc('Vila Swarmer'), npc('Striking Damavik'), npc('Starving Vedmak', { sde: ['neut'] })],
      data,
    );
    expect(order.map((f) => f.name)).toEqual(['Starving Vedmak', 'Striking Damavik', 'Vila Swarmer']);
  });
});

describe('Local chat log', () => {
  it('reads system changes, with the BOM EVE puts before every line', () => {
    expect(parseLocalLine('\uFEFF[ 2026.10.24 09:37:12 ] EVE System > Channel changed to Local : Unknown', 7)).toEqual({
      characterId: 7,
      timeMs: T0,
      system: 'Unknown',
    });
    expect(parseLocalLine('[ 2026.10.24 09:24:59 ] Someone > Channel changed to Local : Jita', 7)).toBeNull();
  });
});

describe('abyss runs', () => {
  it('start on "Unknown", remember the origin and end when Local leaves the Abyss', () => {
    const runs = new AbyssRuns();
    runs.onLocal(1, T0 - 600_000, 'Vaankalen', false);
    runs.onLocal(1, T0, 'Unknown', true);
    expect(runs.current(1, T0 + 60_000)).toMatchObject({ enteredMs: T0, origin: 'Vaankalen', approximate: false });
    runs.onLocal(1, T0 + 14 * 60_000, 'Vaankalen', false);
    expect(runs.current(1, T0 + 15 * 60_000)).toBeNull();
  });

  it('expire after the 20 minutes', () => {
    const runs = new AbyssRuns();
    runs.onLocal(1, T0, 'Unknown', true);
    expect(runs.current(1, T0 + 22 * 60_000)).toBeNull();
  });

  it('without chat logs, the first abyssal NPC starts an estimated run', () => {
    const runs = new AbyssRuns();
    const run = runs.current(2, T0 + 30_000, [{ name: 'Striking Damavik', firstSeenMs: T0 }]);
    expect(run).toMatchObject({ enteredMs: T0, approximate: true });
    // Local showing up later replaces the estimate; it is not logged.
    runs.onLocal(2, T0 - 60_000, 'Vaankalen', false);
    expect(runs.current(2, T0 + 31_000)).toBeNull();
    expect(runs.takeFinished()).toEqual([]);
    // With Local known and not in the Abyss, abyssal names do not start a run (e.g. Triglavians elsewhere).
    runs.onLocal(3, T0, 'Jita', false);
    expect(runs.current(3, T0 + 1000, [{ name: 'Striking Damavik', firstSeenMs: T0 }])).toBeNull();
  });
});

describe('abyss view', () => {
  const runs = new AbyssRuns();
  runs.onLocal(1, T0 - 1000, 'Vaankalen', false);
  runs.onLocal(1, T0, 'Unknown', true);
  const fit = {
    shipName: 'Jackdaw',
    fitName: 'abyss',
    layers: {
      shield: { hp: 3000, resists: { em: 0.5, thermal: 0.5, kinetic: 0.6, explosive: 0.5 } },
      armor: { hp: 500, resists: { em: 0.5, thermal: 0.35, kinetic: 0.25, explosive: 0.1 } },
      hull: { hp: 500, resists: { em: 0.33, thermal: 0.33, kinetic: 0.33, explosive: 0.33 } },
    },
    tank: { shieldBoostPerSecond: 20, armorRepairPerSecond: 0, hullRepairPerSecond: 0, passiveShieldRegenPeak: 5 },
  } as unknown as FitStats;
  const now = T0 + 5 * 60_000;
  const input: Parameters<typeof buildAbyssView>[0] = {
    data,
    run: runs.current(1, now)!,
    nowMs: now,
    choice: { weather: 'exotic', tier: null },
    npcs: [
      npc('Lucifer Cynabal', { firstSeenMs: now - 9000, lastSeenMs: now - 2000 }),
      npc('Lucifer Echo', { firstSeenMs: now - 10_000, lastSeenMs: now - 1000, observed: ['warpScramble'] }),
      npc('Photic Abyssal Overmind', { lastSeenMs: now - 300_000 }),
      // The previous room's battleship, last seen before the angels showed up.
      npc('Photic Abyssal Overmind', { firstSeenMs: now - 60_000, lastSeenMs: now - 20_000 }),
    ],
    fit,
  };
  const view = buildAbyssView(input);

  it('counts down from the entry and takes the tier from the Overmind seen earlier', () => {
    expect(view.remainingSeconds).toBe(15 * 60);
    expect(view.origin).toBe('Vaankalen');
    expect(view.tier).toMatchObject({ tier: 1, source: 'npc' });
    expect(view.weather).toMatchObject({ id: 'exotic', damage: 'kinetic', penaltyPct: [30, 50] });
  });

  it('with the live cues (build switch): only what is on grid, in focus order, with the room it can be', () => {
    const live = buildAbyssView({ ...input, live: true });
    expect(live.focus.map((f) => f.name)).toEqual(['Lucifer Echo', 'Lucifer Cynabal']);
    expect(live.rooms.length).toBeGreaterThan(0);
    expect(live.rooms[0]).toMatchObject({ tier: 1, faction: 'angel' });
  });

  it('without them: no order of fire, but everything the recognised room can hold, the seen ones marked', () => {
    expect(view.live).toBe(false);
    expect(view.focus).toEqual([]);
    expect(view.dangers).toEqual([]);
    const room = view.rooms[0]!;
    expect(room).toMatchObject({ tier: 1, faction: 'angel' });
    const seen = room.npcs.filter((n) => n.seen).flatMap((n) => n.names);
    expect(seen).toEqual(expect.arrayContaining(['Lucifer Cynabal']));
    expect(room.npcs.map((n) => n.count)).toEqual(['1', '1']);
    // What they do comes from the wiki and the faction roles, never "on you".
    expect(room.npcs.flatMap((n) => n.chips).some((c) => c.includes('on you'))).toBe(false);
  });

  it('without them and no room recognised yet: the tier can bring', () => {
    const v = buildAbyssView({ ...input, npcs: [], choice: { weather: 'exotic', tier: 1 } });
    expect(v.rooms).toEqual([]);
    expect(v.dangers.length).toBeGreaterThan(0);
  });

  it('matches the wiki\'s "[Name]needle Tessella" to any damage type', () => {
    const drones = buildAbyssView({
      data,
      run: runs.current(1, now)!,
      nowMs: now,
      choice: { weather: null, tier: 1 },
      npcs: [npc('Sparkneedle Tessella', { lastSeenMs: now }), npc('Photic Abyssal Overmind', { lastSeenMs: now })],
      fit: null,
    });
    expect(drones.rooms.map((r) => r.faction)).toEqual(['drones']);
  });

  it('shows the weather on the fit’s tank layer', () => {
    expect(view.fit).toMatchObject({ layer: 'shield', damage: 'kinetic', resist: 0.6 });
    expect(view.fit!.after.map((x) => Math.round(x * 100))).toEqual([42, 30]);
    expect(view.tips[0]).toMatch(/shoot kinetic/);
  });
});

describe('abyss preview', () => {
  it("shows the picked filament and the tier's dangerous NPCs without a run", () => {
    const v = buildAbyssView({
      data,
      run: null,
      nowMs: T0,
      choice: { weather: 'exotic', tier: 1 },
      npcs: [],
      fit: null,
    });
    expect(v).toMatchObject({ mode: 'preview', remainingSeconds: null, tier: { tier: 1, source: 'setting' } });
    const angel = v.dangers.find((d) => d.faction === 'angel')!;
    expect(angel.npcs.find((n) => n.name === 'Lucifer Cynabal')!.chips).toEqual(
      expect.arrayContaining(['NEUT', 'WEB', 'HIGH DPS']),
    );
    expect(angel.npcs.find((n) => n.name === 'Lucifer Echo')!.chips).toEqual(expect.arrayContaining(['SCRAM', 'WEB']));
  });
});

describe('abyss log', () => {
  const runNpc = (name: string, first: number, last: number, toUs = 100, byUs = 1000) => ({
    name,
    firstSeenMs: T0 + first * 1000,
    lastSeenMs: T0 + last * 1000,
    damageToUs: toUs,
    damageByUs: byUs,
    ewar: [] as string[],
  });

  it('logs a completed run with its clear time and rooms split where the NPCs change', () => {
    const runs = new AbyssRuns();
    runs.onLocal(1, T0 - 1000, 'Vaankalen', false);
    runs.onLocal(1, T0, 'Unknown', true);
    runs.record(1, T0 + 20_000, [runNpc('Photic Abyssal Overmind', 20, 200), runNpc('Sparkneedle Tessella', 22, 60)]);
    // The same fight seen again later: replaces, does not add up.
    runs.record(1, T0 + 20_000, [runNpc('Photic Abyssal Overmind', 20, 200), runNpc('Sparkneedle Tessella', 22, 60)]);
    // Loot structures are shot across rooms under one name: they do not hold a room open.
    runs.record(1, T0 + 20_000, [runNpc('Triglavian Biocombinative Cache', 60, 600, 0, 900)]);
    runs.record(1, T0 + 260_000, [runNpc('Lucifer Echo', 260, 280), runNpc('Lucifer Cynabal', 261, 330)]);
    runs.onLocal(1, T0 + 760_000, 'Vaankalen', false);
    const [f] = runs.takeFinished();
    expect(runs.takeFinished()).toEqual([]);
    const e = logEntry(f!, { character: 'X', weather: 'exotic', tier: 1, tierSource: 'npc', ship: 'Hawk' });
    expect(e).toMatchObject({ clearSeconds: 760, outcome: 'completed', origin: 'Vaankalen', dealt: 4900, taken: 400 });
    expect(e.rooms.map((r) => r.npcs.map((n) => n.name))).toEqual([
      ['Photic Abyssal Overmind', 'Sparkneedle Tessella', 'Triglavian Biocombinative Cache'],
      ['Lucifer Echo', 'Lucifer Cynabal'],
    ]);
    expect(e.rooms[0]).toMatchObject({ startS: 20, endS: 200 });
    expect(e.rooms[1]).toMatchObject({ startS: 260, endS: 330 });
  });

  it('a run that comes back in another system is lost, with the NPC of the last room that hit hardest', () => {
    const runs = new AbyssRuns();
    runs.onLocal(1, T0 - 1000, 'Vaankalen', false);
    runs.onLocal(1, T0, 'Unknown', true);
    runs.record(1, T0 + 20_000, [runNpc('Lucid Watchman', 20, 200, 900)]);
    runs.record(1, T0 + 350_000, [
      runNpc('Blastgrip Tessera', 350, 385, 2500),
      runNpc('Lucid Upholder', 351, 380, 300),
    ]);
    // The clone wakes up at its home station a second after the last hit.
    runs.onLocal(1, T0 + 386_000, 'Maurasi', false);
    const [f] = runs.takeFinished();
    expect(logEntry(f!, { character: null, weather: null, tier: null, tierSource: null, ship: null })).toMatchObject({
      outcome: 'lost',
      clearSeconds: null,
      exitSystem: 'Maurasi',
      killedBy: 'Blastgrip Tessera',
    });
  });

  it('a run without an exit line ends as "no exit" after the 20 minutes', () => {
    const runs = new AbyssRuns();
    runs.onLocal(1, T0, 'Unknown', true);
    expect(runs.any(T0 + 22 * 60_000)).toBe(false);
    const [f] = runs.takeFinished();
    expect(logEntry(f!, { character: null, weather: null, tier: null, tierSource: null, ship: null })).toMatchObject({
      outcome: 'noExit',
      clearSeconds: null,
    });
  });

  it('keeps the newest entries first, one per run', () => {
    const a = { id: 'a' } as never;
    const b = { id: 'b' } as never;
    expect(addLogEntry(addLogEntry([a], b), a).map((x: { id: string }) => x.id)).toEqual(['a', 'b']);
  });

  it('keeps the newest runs of each tier and weather (retention)', () => {
    const run = (id: string, tier: number | null, weather: string | null, day: number) =>
      ({ id, tier, weather, enteredAt: `2026-10-${String(day).padStart(2, '0')}T10:00:00.000Z` }) as never;
    const log = [
      run('dark3-old', 3, 'dark', 1),
      run('dark3-new', 3, 'dark', 3),
      run('dark3-mid', 3, 'dark', 2),
      run('exotic1', 1, 'exotic', 1),
      run('unknown', null, null, 1),
    ];
    expect(pruneLog(log, 2).map((x: { id: string }) => x.id)).toEqual(['dark3-new', 'dark3-mid', 'exotic1', 'unknown']);
  });
});
