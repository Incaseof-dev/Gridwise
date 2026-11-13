/**
 * Damage application hints (EVE-80): how much of a missile's paper damage can land on the NPCs we shoot, and what
 * to try when it is little. Missiles follow CCP's formula, but the log does not say how fast the NPC flies: the
 * estimate assumes its cruise speed (top speed overstates the loss; an Ephialtes Lancer took the full Fury volley at
 * the user's run of 2026-10-25). Turrets need range and angular speed, which the log does not give either, so their
 * hints only read the hit quality words and are marked experimental.
 * Dependency-free: the controller injects the fit's weapon profiles and the NPCs' SDE numbers.
 */
import type { ShotStats } from '../session/combat';
import type { MissileProfile, WeaponProfile } from './types';

/** Below this share of the paper damage a missile hint is worth showing. */
export const POOR_APPLICATION = 0.7;
/** An alternative charge must land this much more to be offered. */
const BETTER_BY = 1.15;
/** An alternative already in use is offered when it lands at least this share of the best one. */
const NEAR_BEST = 0.9;
/** Shots of one weapon at one target before a hint is shown. */
const MIN_MISSILE_HITS = 3;
const MIN_TURRET_SHOTS = 8;
/** Share of turret shots that miss or only graze / glance before the tracking hint shows. */
const POOR_TURRET_SHARE = 0.5;
const POOR_QUALITIES = new Set(['Grazes', 'Glances Off', 'Barely Scratches']);
/** Swarmers die with the ship that launched them: no point fixing the damage on them. */
const IGNORED_TARGET = /\bSwarmer\b/;
/** Charges that are not offered as an alternative (FOF missiles pick their own target). */
const NOT_OFFERED = /Auto-Targeting/;

export interface NpcMotion {
  signatureRadius: number;
  maxVelocity: number;
  /** The SDE's cruise speed; NPCs in a fight seldom keep their top speed. */
  cruiseVelocity: number | null;
}

/** The speed the estimate assumes: cruising when the SDE says, else the top speed. */
const speedOf = (n: NpcMotion) => n.cruiseVelocity ?? n.maxVelocity;

/**
 * The missile damage formula: the share of the paper damage that lands on a target of signature `sig` (m) moving at
 * `velocity` (m/s), for an explosion of radius `er`, velocity `ev` and damage reduction factor `drf`.
 */
export function missileApplication(sig: number, velocity: number, er: number, ev: number, drf: number): number {
  if (er <= 0) return 1;
  const radius = sig / er;
  const speed = velocity > 0 && ev > 0 ? Math.pow((radius * ev) / velocity, drf) : Infinity;
  return Math.min(1, radius, speed);
}

export interface ApplicationHint {
  kind: 'missile' | 'turret';
  weapon: string;
  target: string;
  /** Missiles: the share of the paper damage that lands at the target's cruise speed (estimate). */
  applied: number | null;
  /** The same at its top speed. */
  appliedTop: number | null;
  /** What holds a missile back: the target is smaller than the explosion, or faster than it. */
  limit: 'signature' | 'speed' | null;
  /** A charge of the same damage type that lands more per missile, with how many times more. */
  better: { charge: string; gain: number } | null;
  /** Turrets: shots that missed or only grazed, of all shots. */
  poorShots: { poor: number; of: number } | null;
  experimental: boolean;
  text: string;
  /** What to do about it. */
  advice: string;
}

function limitOf(m: MissileProfile, npc: NpcMotion): 'signature' | 'speed' {
  const radius = npc.signatureRadius / m.explosionRadius;
  const speed = Math.pow((radius * m.explosionVelocity) / Math.max(speedOf(npc), 1), m.drf);
  return radius <= speed ? 'signature' : 'speed';
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

function missileHint(
  s: ShotStats,
  p: Extract<WeaponProfile, { kind: 'missile' }>,
  npc: NpcMotion,
  inUse: ReadonlySet<string>,
) {
  const m = p.missile;
  const at = (x: MissileProfile, v: number) =>
    missileApplication(npc.signatureRadius, v, x.explosionRadius, x.explosionVelocity, x.drf);
  const applied = at(m, speedOf(npc));
  if (applied >= POOR_APPLICATION) return null;
  const appliedTop = at(m, npc.maxVelocity);
  const limit = limitOf(m, npc);
  const landed = (x: MissileProfile) => x.damage * at(x, speedOf(npc));
  const ranked = p.alternatives
    .filter((x) => !NOT_OFFERED.test(x.charge))
    .map((x) => ({ charge: x.charge, gain: landed(x) / landed(m) }))
    .sort((a, b) => b.gain - a.gain);
  // A charge the player already fires in this fight beats a slightly better one they would have to buy.
  const best = ranked[0];
  const owned = best && ranked.find((x) => inUse.has(x.charge) && x.gain >= best.gain * NEAR_BEST);
  const pick = owned ?? best;
  const better = pick && pick.gain >= BETTER_BY ? pick : null;
  const why =
    limit === 'signature'
      ? `its ${Math.round(npc.signatureRadius)} m signature is smaller than your ${Math.round(m.explosionRadius)} m explosion`
      : `at ${Math.round(speedOf(npc))} m/s it outruns your ${Math.round(m.explosionVelocity)} m/s explosion`;
  const top = npc.cruiseVelocity !== null && appliedTop < applied - 0.05 ? `, ~${pct(appliedTop)} at full speed` : '';
  const advice = [
    better && `${better.charge} lands ~${better.gain.toFixed(1)}× more per missile here.`,
    limit === 'signature'
      ? 'A target painter makes it bigger; Precision missiles have a smaller explosion.'
      : 'A web slows it; a target painter helps too.',
  ]
    .filter(Boolean)
    .join(' ');
  return {
    kind: 'missile' as const,
    weapon: s.weapon,
    target: s.target,
    applied,
    appliedTop,
    limit,
    better,
    poorShots: null,
    experimental: false,
    text: `${m.charge} on ${s.target}: ~${pct(applied)} of the damage lands${top} (${why}).`,
    advice,
  };
}

function turretHint(s: ShotStats): ApplicationHint | null {
  const of = s.hits + s.misses;
  if (of < MIN_TURRET_SHOTS) return null;
  const poor = s.misses + Object.entries(s.qualities).reduce((a, [q, n]) => a + (POOR_QUALITIES.has(q) ? n! : 0), 0);
  if (poor / of < POOR_TURRET_SHARE) return null;
  return {
    kind: 'turret',
    weapon: s.weapon,
    target: s.target,
    applied: null,
    appliedTop: null,
    limit: null,
    better: null,
    poorShots: { poor, of },
    experimental: true,
    text: `${s.weapon} on ${s.target}: ${poor} of ${of} shots missed or only grazed.`,
    advice:
      'It may turn faster than your guns track, or sit beyond optimal in falloff. Try a different range ' +
      '(close orbits make small ships hard to track), a web, or a tracking computer / short-range ammo.',
  };
}

/**
 * Hints for the shots of a fight, worst first. `profile` tells what a weapon name is for the active fit, `npc` the
 * NPC's SDE size and speed (null: not an NPC, e.g. a player, which gets no hints).
 */
export function applicationHints(
  shots: Iterable<ShotStats>,
  profile: (weapon: string) => WeaponProfile,
  npc: (name: string) => NpcMotion | null,
): ApplicationHint[] {
  const all = [...shots];
  const inUse = new Set(all.map((s) => s.weapon));
  const out: { hint: ApplicationHint; weight: number }[] = [];
  for (const s of all) {
    if (IGNORED_TARGET.test(s.target)) continue;
    const motion = npc(s.target);
    if (!motion) continue;
    const p = profile(s.weapon);
    if (p.kind === 'missile' && s.hits >= MIN_MISSILE_HITS) {
      const h = missileHint(s, p, motion, inUse);
      if (h) out.push({ hint: h, weight: (1 - h.applied) * s.hits });
    } else if (p.kind === 'turret') {
      const h = turretHint(s);
      if (h) out.push({ hint: h, weight: (h.poorShots!.poor / h.poorShots!.of) * s.hits * 0.5 });
    }
  }
  return out.sort((a, b) => b.weight - a.weight).map((x) => x.hint);
}
