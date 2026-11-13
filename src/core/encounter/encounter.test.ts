import { describe, expect, it } from 'vitest';
import { parseKbFile } from '../kb/loader';
import type { Encounter } from '../kb/types';
import type { GameDataService, NpcProfile } from '../sde/gameData';
import { SessionTracker } from '../session/tracker';
import { defaultSettings, mergeSettings, migrateSettings } from '../settings';
import { EWAR_SEVERITY, buildKbBrief, countMidpoint, mergeTriggers, splitTips } from './brief';
import { EncounterCatalog, matchScore, parseLevelFilter } from './catalog';
import { shipSize } from './shipSize';
import type { GameEvent } from '../logs/events';

const KB = `id: test-assault
kind: mission
name: The Assault
level: 4
enemyFaction: Guristas Pirates
sources:
  uni: { title: EVE University Wiki – The Assault, url: https://example.org/a, license: CC BY-SA 4.0 }
damage: { deal: [kinetic, thermal], resist: [kinetic] }
ewar: [{ kind: ecm }]
npcs:
  Supervisor's Guardian: { sdeTypes: [Pithum Killer], ewar: [{ kind: sensorDamp, confidence: observed, source: null }] }
pockets:
  - name: Pocket 1
    waves:
      - id: initial
        trigger: { on: warpIn }
        spawns:
          - { count: "4-6", class: Cruiser, names: [Supervisor's Guardian] }
          - { count: "2", class: Elite Frigate, names: [Dire Pithi Invader], ewar: [{ kind: web }], triggers: Triggers wave 2 }
          - { count: "1", class: Cruiser, names: [Mystery Officer] }
          - { count: "1", class: Structure, names: [Habitation Module] }
`;

function encounter(text = KB): Encounter {
  const { encounter, issues } = parseKbFile('test-assault.yaml', text);
  expect(issues).toEqual([]);
  return encounter!;
}

/** Just enough of an NPC profile for the brief. */
function profile(
  dps: Partial<NpcProfile['nominalDps']>,
  ehp: Record<string, number>,
  caps: NpcProfile['capabilities'] = [],
) {
  const nominal = { em: 0, thermal: 0, kinetic: 0, explosive: 0, total: 0, ...dps };
  return {
    nominalDps: nominal,
    recommendedDamage: Object.entries(ehp).map(([type, v]) => ({ type, ehp: v })),
    capabilities: caps,
  } as unknown as NpcProfile;
}

const PROFILES: Record<string, NpcProfile> = {
  'Pithum Killer': profile({ kinetic: 30, thermal: 10 }, { kinetic: 1000, thermal: 1200, explosive: 1500, em: 2000 }),
  'Dire Pithi Invader': profile({ kinetic: 10 }, { kinetic: 500, thermal: 600, explosive: 700, em: 800 }, [
    { kind: 'warpScramble', effect: 'behaviorWarpScramble', chance: null, range: 10000, strength: 1 },
    { kind: 'web', effect: 'npcBehaviorWebifier', chance: null, range: 10000, strength: -50 },
    { kind: 'ecm', effect: 'entityECMFalloff', chance: 0, range: null, strength: null },
  ]),
};

const fakeSde = {
  buildNumber: 42,
  attributes: () => new Map(),
  groupName: () => null,
  typesByName: (name: string) => (PROFILES[name] ? [{ id: name }] : []),
  npcProfile: (id: string) => PROFILES[id] ?? null,
  missionVariants: () => [
    { objectiveTypeName: 'Guristas Data Chip', objectiveQuantity: 1, objectiveInContainer: true },
  ],
  dungeon: () => null,
  search: () => [{ kind: 'mission', name: 'The Assault Of Doom', refId: 9 }],
} as unknown as GameDataService;

describe('splitTips', () => {
  it('highlights labelled tips and mechanics, keeps the rest as notes', () => {
    expect(
      splitTips([
        'Tip: Killing the Scanner Post will remove the 2nd wave.',
        'Blitz: Clear the second pocket.',
        'Every battleship triggers the next wave.',
        "Blow up the Storage Silo and the spawns won't appear.",
        'Acceleration gate is at 13km.',
      ]),
    ).toEqual({
      tips: [
        'Tip: Killing the Scanner Post will remove the 2nd wave.',
        'Blitz: Clear the second pocket.',
        'Every battleship triggers the next wave.',
        "Blow up the Storage Silo and the spawns won't appear.",
      ],
      notes: ['Acceleration gate is at 13km.'],
    });
  });
});

describe('mergeTriggers', () => {
  it('merges the same trigger NPC across waves', () => {
    expect(
      mergeTriggers([
        { npc: 'Officer', text: 'Attacking triggers wave 2' },
        { npc: 'Boss', text: 'Destroying unlocks the gate' },
        { npc: 'Officer', text: 'Attacking triggers wave 3' },
        { npc: 'Officer', text: 'Attacking triggers militant commander wave' },
      ]),
    ).toEqual([
      { npc: 'Officer', text: 'Attacking triggers wave 2 → wave 3 → militant commander wave' },
      { npc: 'Boss', text: 'Destroying unlocks the gate' },
    ]);
  });
});

describe('countMidpoint', () => {
  it('reads ranges and odd values', () => {
    expect(countMidpoint('4-6')).toBe(5);
    expect(countMidpoint('0-1')).toBe(0.5);
    expect(countMidpoint('3')).toBe(3);
    expect(countMidpoint('?')).toBe(1);
  });
});

describe('EWAR severity', () => {
  it('treats every kind of warp prevention as danger', () => {
    expect(EWAR_SEVERITY.warpScramble).toBe('danger');
    expect(EWAR_SEVERITY.warpDisruption).toBe('danger');
    expect(EWAR_SEVERITY.web).toBe('caution');
  });
});

describe('buildKbBrief', () => {
  it('works without an SDE: documented damage, KB EWAR, triggers', () => {
    const b = buildKbBrief(encounter(), null);
    expect(b.subtitle).toBe('Mission L4 · Guristas Pirates');
    expect(b.review).toBe('unreviewed');
    expect(b.damage).toMatchObject({ incomingSde: null, incomingDocumented: ['kinetic'], dealSde: null });
    expect(b.damage.unresolvedNpcs.sort()).toEqual(['Dire Pithi Invader', 'Mystery Officer', "Supervisor's Guardian"]);
    expect(b.ewar.map((e) => [e.kind, e.basis])).toEqual([
      ['web', ['kb']],
      ['ecm', ['kb']],
      ['sensorDamp', ['observed']],
    ]);
    expect(b.pockets[0]!.triggers).toEqual([{ npc: 'Dire Pithi Invader', text: 'Triggers wave 2' }]);
    expect(b.pockets[0]!.waves[0]!.trigger).toBe('on warp-in');
  });

  it('adds SDE damage shares, damage to deal and SDE EWAR (skipping chance 0)', () => {
    const b = buildKbBrief(encounter(), fakeSde);
    // Killer ×5 (40 dps: 30 kin/10 th) + Invader ×2 (10 kin) → kin 170, th 50.
    expect(b.damage.incomingSde).toEqual([
      { type: 'kinetic', share: 170 / 220 },
      { type: 'thermal', share: 50 / 220 },
    ]);
    expect(b.damage.dealSde!.map((d) => d.type)).toEqual(['kinetic', 'thermal', 'explosive', 'em']);
    expect(b.damage.dealSde![0]!.relEhp).toBe(1);
    expect(b.damage.unresolvedNpcs).toEqual(['Mystery Officer']); // structures are not reported
    const scram = b.ewar.find((e) => e.kind === 'warpScramble')!;
    expect(scram).toMatchObject({ severity: 'danger', by: ['Dire Pithi Invader'], basis: ['sde'] });
    expect(b.ewar[0]!.kind).toBe('warpScramble'); // warp prevention first
    expect(b.ewar.find((e) => e.kind === 'web')!.basis).toEqual(['kb', 'sde']);
    expect(b.ewar.find((e) => e.kind === 'ecm')!.basis).toEqual(['kb']); // SDE ECM has chance 0
    expect(b.objectives).toContain('Bring back (SDE): Guristas Data Chip (in a container)');
    expect(b.sources.map((s) => s.title)).toEqual(['EVE University Wiki – The Assault', 'EVE SDE build 42']);
  });
});

describe('EncounterCatalog', () => {
  it('scores matches', () => {
    expect(matchScore('The Assault', 'the assault')).toBe(100);
    expect(matchScore('The Assault', 'the ass')).toBe(80);
    expect(matchScore('Guristas Scout Outpost', 'scout')).toBe(60);
    expect(matchScore('Guristas Scout Outpost', 'cout')).toBe(40);
    expect(matchScore('Guristas Scout Outpost', 'guristas outpost')).toBe(30);
    expect(matchScore('The Assault', 'blockade')).toBe(0);
  });

  it('lists KB entries before SDE-only hits and caches briefs', () => {
    const c = new EncounterCatalog([encounter()], fakeSde);
    const r = c.search('assault');
    expect(r.map((x) => [x.title, x.hasKb])).toEqual([
      ['The Assault', true],
      ['The Assault Of Doom', false],
    ]);
    expect(c.brief({ source: 'kb', id: 'test-assault' })).toBe(c.brief({ source: 'kb', id: 'test-assault' }));
    expect(c.brief({ source: 'kb', id: 'nope' })).toBeNull();
  });

  it('splits level filters off the query', () => {
    expect(parseLevelFilter('guristas class 6')).toEqual({ text: 'guristas', filter: { anomalyClass: 6 } });
    expect(parseLevelFilter('DED 4/10')).toEqual({ text: '', filter: { ded: 4 } });
    expect(parseLevelFilter('l4 assault')).toEqual({ text: 'assault', filter: { missionLevel: 4 } });
    expect(parseLevelFilter('level 3')).toEqual({ text: '', filter: { missionLevel: 3 } });
    expect(parseLevelFilter('blood raider')).toEqual({ text: 'blood raider', filter: null });
  });

  it('filters by level and shows the anomaly class', () => {
    const base = encounter();
    const site = (id: string, name: string, extra: Partial<Encounter>): Encounter => ({ ...base, id, name, ...extra });
    const c = new EncounterCatalog(
      [
        { ...base, level: 4 },
        site('den', 'Guristas Den', { kind: 'anomaly', anomalyClass: 4, dedRating: null }),
        site('rally', 'Guristas Rally Point', { kind: 'anomaly', anomalyClass: 6, dedRating: null }),
        site('watch', 'Guristas Watch', { kind: 'complex', anomalyClass: null, dedRating: 4 }),
      ],
      fakeSde,
    );
    expect(c.search('guristas class 6').map((r) => [r.title, r.subtitle])).toEqual([
      ['Guristas Rally Point', `Combat anomaly · Class 6 · ${base.enemyFaction}`],
    ]);
    expect(c.search('ded 4').map((r) => r.title)).toEqual(['Guristas Watch']);
    expect(c.search('l4').map((r) => r.title)).toEqual([base.name]);
    expect(c.search('assault l3')).toEqual([]);
  });
});

describe('settings', () => {
  it('fills missing fields, clamps values and keeps user values', () => {
    const s = migrateSettings({ logDir: '/x', overlay: { opacity: 5, sections: { combat: false } } }, '/home/p');
    expect(s.logDir).toBe('/x');
    expect(s.overlay.opacity).toBe(1);
    expect(s.overlay.sections).toEqual({ header: true, encounter: true, threats: true, loot: true, combat: false });
    expect(s.shortcuts.search).toBe('CommandOrControl+Alt+F');
    expect(s.shortcuts.nextPocket).toBe('CommandOrControl+Alt+C');
    expect(s.overlay).toMatchObject({ minimized: false, minimizedX: null });
  });

  it('keeps only a valid minimized state', () => {
    expect(migrateSettings({ overlay: { minimized: true, minimizedX: 120 } }, '/h').overlay).toMatchObject({
      minimized: true,
      minimizedX: 120,
    });
    expect(migrateSettings({ overlay: { minimized: 'yes', minimizedX: 'left' } }, '/h').overlay).toMatchObject({
      minimized: false,
      minimizedX: null,
    });
  });

  it('uses the EVE log folder of the platform by default', () => {
    expect(defaultSettings('C:\\Users\\p', 'win32').logDir).toBe('C:\\Users\\p\\Documents\\EVE\\logs\\Gamelogs');
    expect(defaultSettings('/home/p').logDir).toContain('/compatdata/8500/');
  });

  it('migrates the v1 compactWaves toggle to waveView', () => {
    expect(migrateSettings({ version: 1, overlay: { compactWaves: true } }, '/h').overlay).toMatchObject({
      waveView: 'tiles',
    });
    const s = migrateSettings({ version: 1, overlay: { compactWaves: false, opacity: 0.5 } }, '/h');
    expect(s.overlay.waveView).toBe('names');
    expect(s.overlay.opacity).toBe(0.5);
    expect('compactWaves' in s.overlay).toBe(false);
    expect(migrateSettings({ overlay: { waveView: 'huge' } }, '/h').overlay.waveView).toBe('names');
  });

  it('falls back to defaults for garbage', () => {
    expect(migrateSettings('nope', '/h')).toEqual(defaultSettings('/h'));
  });

  it('merges patches deeply, null replaces', () => {
    const base = defaultSettings('/h');
    const withRef = mergeSettings(base, { encounter: { ref: { source: 'kb', id: 'a' } } });
    expect(withRef.encounter).toEqual({ ref: { source: 'kb', id: 'a' }, pocket: 0 });
    expect(mergeSettings(withRef, { encounter: { ref: null } }).encounter.ref).toBeNull();
  });
});

describe('SessionTracker', () => {
  const h = { file: '20261020_100000_1.txt', character: 'Test Pilot', characterId: 1, startedAt: null };
  const ev = (kind: string, extra: object, time = '2026-10-20T10:00:01.000Z') =>
    ({
      kind,
      time,
      timeMs: 0,
      category: 'None',
      raw: '',
      source: { file: h.file, offset: 0, line: 1 },
      ...extra,
    }) as GameEvent;

  it('tracks location from jumps and undocks, with SDE security', () => {
    const t = new SessionTracker();
    t.setSecurityLookup((s) => (s === 'Perimeter' ? 0.95 : null));
    t.addSession(h);
    expect(t.characters()[0]).toMatchObject({ name: 'Test Pilot', system: null, lastEventAt: null });
    t.apply(h, [
      ev('undock', { station: 'X', system: 'Maurasi' }),
      ev('systemJump', { from: 'Maurasi', to: 'Perimeter' }),
    ]);
    expect(t.characters()[0]!.system).toEqual({ name: 'Perimeter', security: 0.95 });
    expect(t.diagnostics()).toMatchObject({ events: 2, unknown: 0 });
    expect(t.diagnostics().recent[0]!.text).toBe('jump Maurasi → Perimeter');
  });
});

describe('shipSize', () => {
  it('prefers the source class text and falls back to the SDE overview group', () => {
    expect(shipSize('Elite Cruiser', 'Frigate')).toEqual({ size: 'cruiser', elite: true });
    expect(shipSize('Battlecruiser', 'Cruiser')).toEqual({ size: 'battlecruiser', elite: false });
    expect(shipSize('Destroyer', null)).toEqual({ size: 'destroyer', elite: false });
    expect(shipSize(null, 'Battleship')).toEqual({ size: 'battleship', elite: false });
    expect(shipSize('Hangar Array', null).size).toBe('structure');
    expect(shipSize('Sentry', null).size).toBe('sentry');
    expect(shipSize('Something odd', null).size).toBeNull();
  });
});
