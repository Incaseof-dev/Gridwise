import { describe, expect, it } from 'vitest';
import { parseLogText } from '../logs/parser';
import { CombatTracker, type ShotStats } from '../session/combat';
import { applicationHints, missileApplication, type NpcMotion } from './application';
import type { MissileProfile, WeaponProfile } from './types';

// The user's Hawk (All V) from the fit engine, 2026-10-26.
const FURY: MissileProfile = {
  charge: 'Scourge Fury Light Missile',
  damage: 262.2,
  explosionRadius: 51.75,
  explosionVelocity: 214.5,
  drf: 0.682,
  launchers: 4,
};
const PRECISION: MissileProfile = {
  ...FURY,
  charge: 'Scourge Precision Light Missile',
  damage: 187.6,
  explosionRadius: 18.75,
  explosionVelocity: 306,
  drf: 0.561,
};
const NAVY: MissileProfile = {
  ...FURY,
  charge: 'Caldari Navy Scourge Light Missile',
  damage: 214.7,
  explosionRadius: 30,
  explosionVelocity: 255,
  drf: 0.604,
};
const AUTO: MissileProfile = { ...PRECISION, charge: 'Scourge Auto-Targeting Light Missile I', damage: 999 };

const NPCS: Record<string, NpcMotion> = {
  'Sparkneedle Tessella': { signatureRadius: 50, maxVelocity: 1500, cruiseVelocity: 1000 },
  'Blastgrip Tessera': { signatureRadius: 300, maxVelocity: 900, cruiseVelocity: null },
  'Vila Swarmer': { signatureRadius: 25, maxVelocity: 3500, cruiseVelocity: null },
};
const npc = (n: string) => NPCS[n] ?? null;
const profile = (w: string): WeaponProfile =>
  w === FURY.charge
    ? { kind: 'missile', missile: FURY, alternatives: [NAVY, PRECISION, AUTO] }
    : w === 'Light Neutron Blaster II'
      ? { kind: 'turret', turret: { weapon: w, optimal: 1500, falloff: 2500, tracking: 0.4 } }
      : { kind: 'other' };
const shots = (weapon: string, target: string, hits: number, extra: Partial<ShotStats> = {}): ShotStats => ({
  weapon,
  target,
  hits,
  misses: 0,
  damage: hits * 100,
  maxHit: 100,
  lastMs: 0,
  qualities: {},
  ...extra,
});

describe('missile application', () => {
  it('follows the formula: full on a big slow target, cut by signature or speed', () => {
    expect(missileApplication(300, 900, 51.75, 214.5, 0.682)).toBe(1);
    // Signature limit: half the explosion radius lands half.
    expect(missileApplication(25, 0, 50, 200, 0.6)).toBeCloseTo(0.5);
    // Speed limit: (S/E × Ve / Vt)^drf.
    expect(missileApplication(50, 1000, 51.75, 214.5, 0.682)).toBeCloseTo(Math.pow((50 / 51.75) * 0.2145, 0.682));
  });

  it('hints at the cruise speed, names the full speed figure and the better charge (no FOF)', () => {
    const [h, ...rest] = applicationHints([shots(FURY.charge, 'Sparkneedle Tessella', 5)], profile, npc);
    expect(rest).toEqual([]);
    expect(h).toMatchObject({ kind: 'missile', limit: 'speed', experimental: false });
    expect(h!.applied).toBeCloseTo(0.34, 2);
    expect(h!.appliedTop).toBeCloseTo(0.26, 2);
    expect(h!.better?.charge).toBe('Scourge Precision Light Missile');
    expect(h!.better!.gain).toBeCloseTo(1.9, 1);
    expect(h!.text).toContain('~26% at full speed');
    expect(h!.advice).toContain('web');
  });

  it('prefers a charge the player already fires when it is nearly as good', () => {
    const s = [shots(FURY.charge, 'Sparkneedle Tessella', 5), shots(NAVY.charge, 'Blastgrip Tessera', 3)];
    const navy = profile(FURY.charge) as Extract<WeaponProfile, { kind: 'missile' }>;
    const near = { ...navy, alternatives: [{ ...NAVY, damage: 280 }, PRECISION] };
    const [h] = applicationHints(s, (w) => (w === FURY.charge ? near : profile(w)), npc);
    expect(h!.better?.charge).toBe(NAVY.charge);
  });

  it('stays quiet where the damage lands, on swarmers, non-NPCs and with too few hits', () => {
    expect(applicationHints([shots(FURY.charge, 'Blastgrip Tessera', 9)], profile, npc)).toEqual([]);
    expect(applicationHints([shots(FURY.charge, 'Vila Swarmer', 9)], profile, npc)).toEqual([]);
    expect(applicationHints([shots(FURY.charge, 'Some Pilot', 9)], profile, npc)).toEqual([]);
    expect(applicationHints([shots(FURY.charge, 'Sparkneedle Tessella', 2)], profile, npc)).toEqual([]);
  });
});

describe('turret hints (experimental)', () => {
  it('counts misses and grazes', () => {
    const s = shots('Light Neutron Blaster II', 'Sparkneedle Tessella', 6, {
      misses: 4,
      qualities: { Grazes: 3, Hits: 2, 'Glances Off': 1 },
    });
    const [h] = applicationHints([s], profile, npc);
    expect(h).toMatchObject({ kind: 'turret', experimental: true, poorShots: { poor: 8, of: 10 } });
    expect(applicationHints([{ ...s, misses: 0, qualities: { Hits: 6 } }], profile, npc)).toEqual([]);
  });
});

describe('combat tracker shots', () => {
  it('keeps hits, misses and qualities per weapon and target', () => {
    const c = new CombatTracker();
    // As the game writes them (markup included).
    const log = [
      '[ 2026.10.25 21:52:17 ] (combat) <color=0xff00ffff><b>301</b> <color=0x77ffffff><font size=10>to</font> <b><color=0xffffffff>Blastgrip Tessera</b><font size=10><color=0x77ffffff> - Scourge Fury Light Missile - Hits',
      '[ 2026.10.25 21:52:21 ] (combat) <color=0xff00ffff><b>301</b> <color=0x77ffffff><font size=10>to</font> <b><color=0xffffffff>Blastgrip Tessera</b><font size=10><color=0x77ffffff> - Scourge Fury Light Missile - Hits',
      '[ 2026.10.25 21:52:22 ] (combat) Your group of Light Neutron Blaster II misses Blastgrip Tessera completely - Light Neutron Blaster II',
    ].join('\n');
    for (const e of parseLogText('20261025_195835_1.txt', log).events) c.apply(e);
    const g = c.engagement()!;
    expect(g.shots.get('Scourge Fury Light Missile|Blastgrip Tessera')).toMatchObject({
      hits: 2,
      damage: 602,
      maxHit: 301,
      qualities: { Hits: 2 },
    });
    expect(g.shots.get('Light Neutron Blaster II|Blastgrip Tessera')).toMatchObject({ hits: 0, misses: 1 });
  });
});
