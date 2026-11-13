import { beforeAll, describe, expect, it } from 'vitest';
import {
  fitForHull,
  MAX_SAVED_FITS,
  migrateSettings,
  quickFits,
  syncEsiFits,
  touchRecentFit,
  upsertFit,
  type SavedFit,
} from '../settings';
import type { BriefDamage } from '../viewmodel';
import { neutOutlook, peakRecharge, secondsToEmpty } from './capacitor';
import { checkFitAgainstSite } from './siteCheck';
import { ehpAgainst, FitEngine, type FitStats } from './stats';

// The user's Praxis, checked against the in-game fitting window on 2026-10-23.
const PRAXIS = `[Praxis, MWD]
Capacitor Flux Coil II
Drone Damage Amplifier II
Drone Damage Amplifier II
Co-Processor II
Gyrostabilizer II
Gyrostabilizer II
Damage Control II

500MN Microwarpdrive II
Large Shield Booster II
Large Cap Battery II
Target Painter II
Thermal Shield Amplifier II
Pithum C-Type EM Shield Amplifier
Multispectrum Shield Hardener II

Domination Dual 650mm Repeating Cannon, Republic Fleet EMP L
Domination Dual 650mm Repeating Cannon, Republic Fleet EMP L
Domination Dual 650mm Repeating Cannon, Republic Fleet EMP L
Domination Dual 650mm Repeating Cannon, Republic Fleet EMP L
Domination Dual 650mm Repeating Cannon, Republic Fleet EMP L
Domination Dual 650mm Repeating Cannon, Republic Fleet EMP L
Heavy Energy Nosferatu I

Large Capacitor Control Circuit I
Large Capacitor Control Circuit I
Large Capacitor Control Circuit I


Infiltrator II x5
Imperial Navy Praetor x6

Republic Fleet EMP L x960
Mobile Tractor Unit x1
`;

let engine: FitEngine;
beforeAll(async () => {
  engine = await FitEngine.load();
});

describe('FitEngine', () => {
  it('gives the in-game fitting window numbers, adjusted to All V', () => {
    const r = engine.compute(PRAXIS);
    if (!r.ok) throw new Error(r.error);
    const s = r.stats;
    expect(s.shipName).toBe('Praxis');
    expect(s.skills).toBe('all-v');
    // In game (AWU IV): 690.5 CPU and 13 137.5 PG used; All V saves 6 × 33 PG on the guns.
    expect(s.fitting.cpuUsed).toBeCloseTo(690.5, 1);
    expect(s.fitting.powerUsed).toBeCloseTo(13137.5 - 6 * 33, 1);
    expect(s.fitting.slots.high).toEqual({ used: 7, max: 7 });
    // In game with Shield Management / Hull Upgrades IV: 8 580 HP, i.e. ×1.25/1.20 at V.
    expect(s.layers.shield.hp).toBeCloseTo((8580 * 1.25) / 1.2, 0);
    expect(s.layers.hull.hp).toBeCloseTo(8937.5, 0);
    expect(s.layers.shield.resists.em).toBeCloseTo(0.774, 3);
    expect(s.layers.shield.resists.kinetic).toBeCloseTo(0.572, 3);
    expect(s.layers.armor.resists.thermal).toBeCloseTo(0.426, 3);
    expect(s.capacitor.rechargeSeconds).toBeCloseTo(354, 0);
  });

  it('launches the heaviest drones that fit the bandwidth', () => {
    const r = engine.compute(PRAXIS);
    if (!r.ok) throw new Error(r.error);
    expect(r.stats.offense.activeDrones).toEqual(['4 × Imperial Navy Praetor']);
    // In game: 429.3 drone DPS.
    expect(r.stats.offense.droneDps).toBeCloseTo(429.3, 0);
  });

  it('runs the active modules: MWD speed and signature', () => {
    const r = engine.compute(PRAXIS);
    if (!r.ok) throw new Error(r.error);
    // In game without the MWD: 465 m signature; the MWD blooms it by 475 %.
    expect(r.stats.navigation.signatureRadius).toBeCloseTo(465 * 5.75, 0);
  });

  it('ignores unknown cargo but reports unknown modules', () => {
    const r = engine.compute(PRAXIS.replace('Target Painter II', 'Target Painter III'));
    if (!r.ok) throw new Error(r.error);
    expect(r.unknownLines).toEqual(['Target Painter III']);
  });

  it('rejects a paste that is not an EFT fit', () => {
    expect(engine.compute('hello')).toMatchObject({ ok: false });
    expect(engine.compute('[Notaship, x]\n')).toMatchObject({ ok: false, error: expect.stringContaining('Notaship') });
  });
});

describe('ehpAgainst', () => {
  const layers = {
    shield: { hp: 1000, resists: { em: 0.5, thermal: 0.5, kinetic: 0, explosive: 0 } },
    armor: { hp: 0, resists: { em: 0, thermal: 0, kinetic: 0, explosive: 0 } },
    hull: { hp: 0, resists: { em: 0, thermal: 0, kinetic: 0, explosive: 0 } },
  };

  it('weights resists by the damage mix', () => {
    expect(ehpAgainst(layers, { em: 1, thermal: 1, kinetic: 0, explosive: 0 })).toBeCloseTo(2000);
    expect(ehpAgainst(layers, { em: 0, thermal: 0, kinetic: 3, explosive: 0 })).toBeCloseTo(1000);
    expect(ehpAgainst(layers, { em: 1, thermal: 0, kinetic: 1, explosive: 0 })).toBeCloseTo(1000 / 0.75);
  });

  it('matches the engine total for the Praxis', () => {
    const r = engine.compute(PRAXIS);
    if (!r.ok) throw new Error(r.error);
    // The engine's own ehpTotalAgainstProfile (omni) for this fit.
    expect(Math.round(r.stats.ehpOmni)).toBe(64812);
  });
});

describe('saved fits', () => {
  const fit = (id: string, shipName: string, name: string): SavedFit => ({
    id,
    eft: `[${shipName}, ${name}]`,
    shipName,
    name,
    source: 'paste',
    savedAt: '2026-10-23T08:00:00.000Z',
  });

  it('replaces a re-pasted ship + fit name and puts the newest first', () => {
    const saved = [fit('a', 'Praxis', 'PvE'), fit('b', 'Jackdaw', 'PvE')];
    expect(upsertFit(saved, fit('c', 'Praxis', 'PvE')).map((f) => f.id)).toEqual(['c', 'b']);
    expect(upsertFit(saved, fit('d', 'Praxis', 'AB')).map((f) => f.id)).toEqual(['d', 'a', 'b']);
  });

  it('quick ship select: the last 4 used fits, then the one pasted last', () => {
    let recent: string[] = [];
    for (const id of ['a', 'b', 'c', 'a', 'd', 'e']) recent = touchRecentFit(recent, id);
    expect(recent).toEqual(['e', 'd', 'a', 'c']);
    const saved = ['a', 'b', 'c', 'd', 'e', 'f'].map((id, i) => ({
      ...fit(id, 'Hawk', id),
      savedAt: `2026-10-2${i}T08:00:00.000Z`,
    }));
    expect(quickFits(saved, recent).map((f) => f.id)).toEqual(['e', 'd', 'a', 'c', 'f']);
    expect(quickFits(saved, ['f', 'gone']).map((f) => f.id)).toEqual(['f']);
  });

  it('keeps at most the limit', () => {
    const many = Array.from({ length: MAX_SAVED_FITS }, (_, i) => fit(String(i), 'Praxis', `fit ${i}`));
    const out = upsertFit(many, fit('new', 'Praxis', 'newest'));
    expect(out).toHaveLength(MAX_SAVED_FITS);
    expect(out[0]!.id).toBe('new');
  });

  it('drops broken entries and a dangling active id when loading settings', () => {
    const s = migrateSettings({ fits: { saved: [fit('a', 'Praxis', 'PvE'), { id: 1 }, 'x'], activeId: 'gone' } }, '/h');
    expect(s.fits.saved.map((f) => f.id)).toEqual(['a']);
    expect(s.fits.activeId).toBeNull();
    expect(migrateSettings({ fits: { saved: [fit('a', 'Praxis', 'PvE')], activeId: 'a' } }, '/h').fits.activeId).toBe(
      'a',
    );
    expect(migrateSettings({}, '/h').fits).toEqual({ saved: [], activeId: null, recent: [], loadout: {} });
    expect(
      migrateSettings({ fits: { saved: [fit('a', 'Praxis', 'PvE')], recent: ['gone', 'a'] } }, '/h').fits.recent,
    ).toEqual(['a']);
  });

  it('defaults and cleans the header mode, the minimized strips and the Abyss filament', () => {
    const d = migrateSettings({}, '/h');
    expect(d.overlay.headerMode).toBe('scroll');
    expect(d.overlay.minimizedShow).toEqual({ threats: false, messages: false, intel: true, loot: true, combat: false });
    expect(d.abyss).toEqual({ weather: null, tier: null, logKeep: 10 });
    const s = migrateSettings(
      {
        overlay: { headerMode: 'tiny', minimizedShow: { threats: true, messages: 'yes', combat: 1 } },
        abyss: { weather: 'fog', tier: 9, logKeep: 500 },
      },
      '/h',
    );
    expect(s.overlay.headerMode).toBe('scroll');
    expect(s.overlay.minimizedShow).toEqual({ threats: true, messages: false, intel: true, loot: true, combat: false });
    expect(s.abyss).toEqual({ weather: null, tier: null, logKeep: 100 });
  });
});

describe('checkFitAgainstSite', () => {
  const damage = (
    incomingSde: BriefDamage['incomingSde'],
    incomingDocumented: BriefDamage['incomingDocumented'] = [],
  ) =>
    ({
      incomingSde,
      incomingDocumented,
      dealSde: null,
      dealDocumented: [],
      unresolvedNpcs: [],
      resolvedNpcs: 0,
    }) as BriefDamage;
  let praxis: FitStats;
  beforeAll(() => {
    const r = engine.compute(PRAXIS);
    if (!r.ok) throw new Error(r.error);
    praxis = r.stats;
  });

  it('flags the shield-tanked Praxis as weak against Guristas kinetic', () => {
    const c = checkFitAgainstSite(
      praxis,
      damage([
        { type: 'kinetic', share: 0.79 },
        { type: 'thermal', share: 0.21 },
      ]),
    )!;
    expect(c.layer).toBe('shield');
    expect(c.basis).toBe('sde');
    expect(c.siteResist).toBeCloseTo(0.21 * 0.758 + 0.79 * 0.572, 2);
    expect(c.damageFactor).toBeCloseTo(1.17, 1);
    expect(c.verdict).toBe('weak');
    expect(c.holes.map((h) => h.type)).toEqual(['kinetic']);
    expect(c.layerEhpSite).toBeLessThan(c.layerEhpOmni);
  });

  it('calls it good against Sansha EM / thermal', () => {
    const c = checkFitAgainstSite(
      praxis,
      damage([
        { type: 'em', share: 0.53 },
        { type: 'thermal', share: 0.47 },
      ]),
    )!;
    expect(c.verdict).toBe('good');
    expect(c.holes).toEqual([]);
  });

  it('falls back to the documented damage types', () => {
    const c = checkFitAgainstSite(praxis, damage(null, ['kinetic', 'thermal']))!;
    expect(c.basis).toBe('kb');
    expect(c.verdict).toBe('ok');
    expect(c.holes.map((h) => h.type)).toEqual(['kinetic']);
    expect(checkFitAgainstSite(praxis, damage(null, []))).toBeNull();
  });

  it('checks the repaired layer of an armor tank', () => {
    const resists = (em: number, thermal: number, kinetic: number, explosive: number) => ({
      em,
      thermal,
      kinetic,
      explosive,
    });
    const armorTank: FitStats = {
      ...praxis,
      layers: {
        shield: { hp: 9000, resists: resists(0, 0.2, 0.4, 0.5) },
        armor: { hp: 5000, resists: resists(0.8, 0.7, 0.7, 0.4) },
        hull: { hp: 5000, resists: resists(0.33, 0.33, 0.33, 0.33) },
      },
      tank: { shieldBoostPerSecond: 0, armorRepairPerSecond: 80, hullRepairPerSecond: 0, passiveShieldRegenPeak: 5 },
    };
    const c = checkFitAgainstSite(armorTank, damage([{ type: 'explosive', share: 1 }]))!;
    expect(c.layer).toBe('armor');
    expect(c.verdict).toBe('weak');
    expect(c.holes).toEqual([{ type: 'explosive', share: 1, resist: 0.4 }]);
  });
});

describe('capacitor under a neut', () => {
  const ab = { shipName: 'Praxis', capacity: 8075, rechargeSeconds: 354, usagePerSecond: 52.67 };

  it('has the engine peak recharge', () => {
    // eve-fit-engine: 57.02 GJ/s for the AB Praxis.
    expect(peakRecharge(ab)).toBeCloseTo(57.02, 1);
  });

  it('runs dry about when the engine says, without a neut', () => {
    // eve-fit-engine (Pyfa capSim, module cycles): the MWD Praxis lasts 230 s with everything on.
    const mwd = { shipName: 'Praxis', capacity: 6460, rechargeSeconds: 354, usagePerSecond: 62.75 };
    const s = secondsToEmpty(mwd, mwd.usagePerSecond)!;
    expect(s).toBeGreaterThan(230 * 0.85);
    expect(s).toBeLessThan(230 * 1.15);
  });

  it('separates a neut the modules can live with from one that drains even with them off', () => {
    expect(neutOutlook(ab, 3)).toMatchObject({ neutOnlySeconds: null, withModulesSeconds: null });
    const mid = neutOutlook(ab, 32);
    expect(mid.neutOnlySeconds).toBeNull();
    expect(mid.withModulesSeconds).toBeGreaterThan(0);
    const heavy = neutOutlook(ab, 80);
    expect(heavy.neutOnlySeconds).toBeGreaterThan(mid.withModulesSeconds!);
  });
});

describe('a logged-in pilot (EVE-38)', () => {
  it("uses the character's skills and implants instead of All V, and says so", () => {
    const allV = engine.compute(PRAXIS);
    const green = { name: 'New Pilot', skills: new Map<number, number>(), implants: [] };
    // Zainou 'Gnome' Shield Management SM-706: +6% shield capacity.
    const plugged = { ...green, implants: [3084] };
    const a = engine.compute(PRAXIS, green);
    const b = engine.compute(PRAXIS, plugged);
    if (!allV.ok || !a.ok || !b.ok) throw new Error('fit did not compute');
    expect(allV.stats.skills).toBe('all-v');
    expect(a.stats.skills).toEqual({ character: 'New Pilot', implants: 0 });
    expect(b.stats.skills).toEqual({ character: 'New Pilot', implants: 1 });
    expect(a.stats.offense.totalDps).toBeLessThan(allV.stats.offense.totalDps);
    expect(a.stats.layers.shield.hp).toBeLessThan(allV.stats.layers.shield.hp);
    expect(b.stats.layers.shield.hp / a.stats.layers.shield.hp).toBeCloseTo(1.06, 2);
  });
});

describe('ESI fittings (EVE-65)', () => {
  const now = '2026-10-26T10:00:00.000Z';
  const fit = (id: string, shipName: string, name: string): SavedFit => ({
    id,
    eft: `[${shipName}, ${name}]`,
    shipName,
    name,
    source: 'paste',
    savedAt: '2026-10-23T08:00:00.000Z',
  });
  const esiFit = (fittingId: number, name: string, shipName = 'Hawk') => ({
    fittingId,
    name,
    shipName,
    eft: `[${shipName}, ${name}]`,
  });

  it('syncs a character’s fittings: adds, updates, drops deleted ones, keeps pastes and others', () => {
    const paste = fit('p', 'Praxis', 'PvE');
    let saved = syncEsiFits([paste], 1, [esiFit(10, 'A'), esiFit(11, 'B')], now);
    saved = syncEsiFits(saved, 2, [esiFit(20, 'Other')], now);
    expect(saved.map((f) => f.id)).toEqual(['p', 'esi-1-10', 'esi-1-11', 'esi-2-20']);
    const later = syncEsiFits(saved, 1, [esiFit(11, 'B renamed')], '2026-10-27T00:00:00.000Z');
    expect(later.map((f) => [f.id, f.name])).toEqual([
      ['p', 'PvE'],
      ['esi-2-20', 'Other'],
      ['esi-1-11', 'B renamed'],
    ]);
    // First seen time survives a sync.
    expect(later.find((f) => f.id === 'esi-1-11')!.savedAt).toBe(now);
    // ESI fittings do not count against the paste limit, and survive loading.
    expect(migrateSettings({ fits: { saved: later, activeId: 'esi-1-11' } }, '/h').fits.activeId).toBe('esi-1-11');
  });

  it('picks the fit for a boarded hull: the active one, else the last used, else the newest, else none', () => {
    const a = { ...fit('a', 'Hawk', 'A'), savedAt: '2026-10-20T00:00:00Z' };
    const b = { ...fit('b', 'Hawk', 'B'), savedAt: '2026-10-25T00:00:00Z' };
    const g = fit('g', 'Gila', 'G');
    expect(fitForHull([a, b, g], [], 'a', 'Hawk')).toBe('a');
    expect(fitForHull([a, b, g], ['g', 'a'], 'g', 'Hawk')).toBe('a');
    expect(fitForHull([a, b, g], [], 'g', 'Hawk')).toBe('b');
    expect(fitForHull([a, b, g], [], 'a', 'Jackdaw')).toBeNull();
  });

  it('turns an ESI fitting into EFT that computes like the paste', () => {
    const pasted = engine.compute(PRAXIS);
    if (!pasted.ok) throw new Error(pasted.error);
    // The paste's sections as ESI items: racks by flag, drones and cargo with quantities. ESI has no loaded charges;
    // the guns get theirs from the cargo, as in the paste.
    const [low, mid, high, rigs, drones, cargo] = PRAXIS.split('\n\n').map((b) => b.split('\n').filter(Boolean));
    const id = (name: string) => engine.typeIdByName(name)!;
    const rack = (lines: string[], flag: string) =>
      lines.map((l, i) => ({ type_id: id(l.split(',')[0]!.trim()), flag: `${flag}${i}`, quantity: 1 }));
    const bay = (lines: string[], flag: string) =>
      lines.map((l) => {
        const [, n, q] = /^(.*) x(\d+)$/.exec(l)!;
        return { type_id: id(n!), flag, quantity: Number(q) };
      });
    const items = [
      ...rack(low!.slice(1), 'LoSlot'),
      ...rack(mid!, 'MedSlot'),
      ...rack(high!, 'HiSlot'),
      ...rack(rigs!, 'RigSlot'),
      ...bay(drones!, 'DroneBay'),
      ...bay(cargo!, 'Cargo'),
    ];
    const e = engine.eftFromEsi({ name: 'From ESI', ship_type_id: id('Praxis'), items });
    expect(e?.shipName).toBe('Praxis');
    const r = engine.compute(e!.eft);
    if (!r.ok) throw new Error(r.error);
    expect(r.stats.fitName).toBe('From ESI');
    expect(r.unknownLines).toEqual([]);
    expect(r.stats.offense.totalDps).toBeCloseTo(pasted.stats.offense.totalDps, 1);
    expect(r.stats.ehpOmni).toBeCloseTo(pasted.stats.ehpOmni, 0);
  });
});

describe('loadout: ammo and drones (EVE-83)', () => {
  it('switches a weapon type’s charge and the drones in space, and lists the parts', () => {
    const base = engine.compute(PRAXIS);
    const emp = engine.compute(PRAXIS, null, {
      charges: {},
      drones: { 'Infiltrator II': 0, 'Imperial Navy Praetor': 2 },
    });
    // Proton: the long-range ammo, less damage (EMP, Fusion and Phased Plasma all deal 12, only the type differs).
    const proton = engine.compute(PRAXIS, null, {
      charges: { 'Domination Dual 650mm Repeating Cannon': 'Republic Fleet Proton L' },
      drones: {},
    });
    if (!base.ok || !emp.ok || !proton.ok) throw new Error('fit did not compute');
    expect(emp.stats.offense.activeDrones).toEqual(['2 × Imperial Navy Praetor']);
    expect(emp.stats.offense.droneDps).toBeLessThan(base.stats.offense.droneDps);
    expect(proton.stats.offense.weaponDps).toBeLessThan(base.stats.offense.weaponDps * 0.6);

    const parts = engine.loadoutView(PRAXIS, {
      charges: { 'Domination Dual 650mm Repeating Cannon': 'Republic Fleet Fusion L' },
      drones: { 'Imperial Navy Praetor': 3 },
    })!;
    expect(parts.racks.map((r) => r.rack)).toEqual(['high', 'mid', 'low', 'rig']);
    const gun = parts.racks[0]!.modules[0]!;
    expect(gun.charge).toBe('Republic Fleet Fusion L');
    expect(gun.chargeOptions![0]).toEqual({ name: 'Republic Fleet EMP L', inCargo: true });
    expect(gun.chargeOptions!.some((c) => c.name === 'Republic Fleet Fusion L' && !c.inCargo)).toBe(true);
    expect(parts.racks[0]!.modules.at(-1)!.chargeOptions).toBeNull();
    expect(parts.drones.map((d) => [d.name, d.active, d.total])).toEqual([
      ['Infiltrator II', 0, 5],
      ['Imperial Navy Praetor', 3, 6],
    ]);
    // Deployables (Mobile Tractor Unit) are not in the engine's data, so the cargo lists what it knows.
    expect(parts.cargo.map((c) => c.name)).toEqual(['Republic Fleet EMP L']);
  });
});

describe('ammo from the cargo', () => {
  it('loads no FOF missile when another charge fits, and the biggest stack of the rest', () => {
    const eft = (cargo: string) =>
      `[Jackdaw, T]\n\n\nLight Missile Launcher II\nLight Missile Launcher II\n\n\n${cargo}\n`;
    const parts = engine.loadoutView(
      eft('Mjolnir Auto-Targeting Light Missile I x2000\nScourge Light Missile x100\nInferno Light Missile x500'),
    )!;
    expect(parts.racks[0]!.modules[0]!.charge).toBe('Inferno Light Missile');
    expect(engine.loadoutView(eft('Mjolnir Auto-Targeting Light Missile I x2000'))!.racks[0]!.modules[0]!.charge).toBe(
      'Mjolnir Auto-Targeting Light Missile I',
    );
  });
});

describe('tactical destroyer modes (EVE-85)', () => {
  const JACKDAW = `[Jackdaw, T]\nBallistic Control System II\n\n5MN Microwarpdrive II\n\nLight Missile Launcher II, Scourge Light Missile\nLight Missile Launcher II, Scourge Light Missile\n`;
  const run = (eft: string, mode?: string) => {
    const r = engine.compute(eft, null, mode ? { charges: {}, drones: {}, mode } : null);
    if (!r.ok) throw new Error(r.error);
    return r;
  };

  it('defaults to Defense, and a picked mode changes the numbers', () => {
    const def = run(JACKDAW);
    const sharp = run(JACKDAW, 'Jackdaw Sharpshooter Mode');
    const prop = run(JACKDAW, 'Jackdaw Propulsion Mode');
    expect(def.stats.mode).toBe('Defense');
    expect(sharp.stats.mode).toBe('Sharpshooter');
    expect(sharp.stats.lockRange).toBeCloseTo(def.stats.lockRange * 2, 0);
    expect(sharp.stats.offense.totalDps).toBeGreaterThan(def.stats.offense.totalDps);
    expect(prop.stats.navigation.maxVelocity).toBeGreaterThan(def.stats.navigation.maxVelocity);
    expect(def.stats.layers.shield.resists.em).toBeGreaterThan(prop.stats.layers.shield.resists.em);
  });

  it('reads a mode line of the paste instead of calling it unknown, and lists the modes', () => {
    const r = run(`${JACKDAW}\n\nJackdaw Propulsion Mode\n`);
    expect(r.stats.mode).toBe('Propulsion');
    expect(r.unknownLines).toEqual([]);
    const parts = engine.loadoutView(JACKDAW, { charges: {}, drones: {}, mode: 'Jackdaw Sharpshooter Mode' })!;
    expect(parts.modes!.map((m) => [m.label, m.active])).toEqual([
      ['Defense', false],
      ['Propulsion', false],
      ['Sharpshooter', true],
    ]);
    expect(engine.loadoutView(PRAXIS)!.modes).toBeNull();
    expect(engine.compute(PRAXIS).ok && (engine.compute(PRAXIS) as { stats: { mode: unknown } }).stats.mode).toBeNull();
  });
});
