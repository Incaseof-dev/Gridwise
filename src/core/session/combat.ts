/**
 * Per-character combat state (task 014) and statistics (task 018), built only from log events.
 *
 * Time: all decisions use EVE time from the log, never the wall clock, so a replay behaves like live play.
 * Callers that need "now" (expiry while no new lines arrive) pass an EVE-time estimate.
 *
 * Observed vs inferred: everything here is observed in the log, except values explicitly named
 * `estimate` (time to kill) or derived from the SDE by the threat engine.
 */
import type { EwarType, GameEvent } from '../logs/events';
import type { CombatView } from '../viewmodel';

/** No combat line for this long ends an engagement. */
export const ENGAGEMENT_GAP_MS = 60_000;
/** Window for "current" DPS. */
export const RATE_WINDOW_MS = 10_000;
/** How much damage history is kept (current window + baseline for spike detection). */
export const HISTORY_MS = 70_000;
/**
 * A neut that takes at most this share of what the same NPC usually takes found our capacitor (nearly) empty.
 * Range falloff also gives smaller amounts (a Garmur orbiting in falloff: 3–20 GJ), so it is kept low and the threat
 * engine wants more than one such neut.
 */
export const CAP_DRY_SHARE = 0.1;
/** Only NPCs whose normal neut is at least this big count for the empty-capacitor check (rounding noise). */
export const CAP_DRY_MIN_GJ = 8;
/** The capacitor counts as empty while two neuts within this long found it empty (CAP_DRY_SHARE). */
export const CAP_DRY_MS = 15_000;
/**
 * What counts as heavy neut pressure depends on the ship (capacitor, recharge, fit, skills), which the log does not
 * show. It is learned instead: when the capacitor runs dry, this share of the average neut rate over the minute
 * before becomes the heavy rate.
 */
export const HEAVY_NEUT_SHARE = 0.75;
const DRAIN_WINDOW_MS = 60_000;
/**
 * Neuts must have been draining this long before the capacitor ran dry, and the result must be at least
 * MIN_HEAVY_NEUT_GJS, to learn from it: a capacitor that was already empty when the neuts started (own modules) says
 * nothing about neut pressure.
 */
const MIN_DRAIN_MS = 30_000;
const MIN_HEAVY_NEUT_GJS = 5;
/** Observed EWAR on us with no new line for this long breaks a streak (neut and jam cycles are shorter). */
export const STREAK_GAP_MS = 30_000;

export interface NpcObservation {
  name: string;
  firstSeenMs: number;
  lastSeenMs: number;
  /** Damage this NPC did to us / we did to it. */
  damageToUs: number;
  damageByUs: number;
  hitsOnUs: number;
  missesOnUs: number;
  /** EWAR this NPC was seen using on us, with the time of the last attempt. */
  ewarOnUs: Partial<Record<EwarType | 'neut', number>>;
  neutGJ: number;
  /** Weapons/ammo it used on us (from "from X - <weapon>" lines). */
  weapons: Set<string>;
}

/** Our shots of one weapon or ammo at one target (EVE-80 damage application). */
export interface ShotStats {
  weapon: string;
  target: string;
  hits: number;
  misses: number;
  damage: number;
  maxHit: number;
  lastMs: number;
  /** Hit quality words of the hits (Wrecks, Hits, Grazes …); turrets tell how well they track. */
  qualities: Partial<Record<string, number>>;
}

/** A stretch of the same observed EWAR on us without a longer pause than STREAK_GAP_MS. */
export interface Streak {
  startMs: number;
  lastMs: number;
  /** GJ for neuts, number of attempts otherwise. */
  amount: number;
}

interface TimedAmount {
  t: number;
  amount: number;
}

export interface Engagement {
  startMs: number;
  lastCombatMs: number;
  system: string | null;
  npcs: Map<string, NpcObservation>;
  dealt: number;
  taken: number;
  dealtByWeapon: Map<string, number>;
  /** Per weapon and target, keyed `weapon|target`. */
  shots: Map<string, ShotStats>;
  qualityCounts: Map<string, number>;
  hits: number;
  misses: number;
  bounty: number;
  bountyCount: number;
  targetsGone: number;
  /** Recent damage samples for rolling rates. */
  recentDealt: TimedAmount[];
  recentTaken: TimedAmount[];
  /** Recent neuts on us (GJ). */
  recentNeut: TimedAmount[];
  /** Recent neuts that found our capacitor (nearly) empty, see CAP_DRY_SHARE. */
  capDryNeuts: number[];
  /** Neut rate (GJ/s) that is heavy for the current ship, learned from an empty capacitor; null until then. */
  heavyNeutGJs: number | null;
  /** Targets we hit, with time of last hit (for "shooting a trigger"). */
  ourTargets: Map<string, number>;
  /** Targets we hit, with time of the first hit. */
  ourFirstHits: Map<string, number>;
  /** Latest streak of each observed EWAR type on us (any attacker). */
  ewarStreaks: Partial<Record<EwarType | 'neut', Streak>>;
}

/** Same shape as the view model's CombatView. */
export type CombatStats = CombatView;

function newEngagement(t: number, system: string | null, heavyNeutGJs: number | null): Engagement {
  return {
    startMs: t,
    lastCombatMs: t,
    system,
    npcs: new Map(),
    dealt: 0,
    taken: 0,
    dealtByWeapon: new Map(),
    shots: new Map(),
    qualityCounts: new Map(),
    hits: 0,
    misses: 0,
    bounty: 0,
    bountyCount: 0,
    targetsGone: 0,
    recentDealt: [],
    recentTaken: [],
    recentNeut: [],
    capDryNeuts: [],
    heavyNeutGJs,
    ourTargets: new Map(),
    ourFirstHits: new Map(),
    ewarStreaks: {},
  };
}

const COMBAT_KINDS = new Set<GameEvent['kind']>([
  'damageDealt',
  'damageTaken',
  'missTaken',
  'missDealt',
  'ewar',
  'energyNeutralized',
  'energyDrained',
  'bounty',
]);

export class CombatTracker {
  private current: Engagement | null = null;
  private last: Engagement | null = null;
  private system: string | null = null;
  /** Latest log time seen (ms). */
  latestMs = 0;
  /** Largest single neut seen per NPC name in this session: what it takes from a capacitor that is not empty. */
  private neutMax = new Map<string, number>();
  /** Learned heavy neut rate (HEAVY_NEUT_SHARE); reset on undock, since the ship may have changed while docked. */
  private heavyNeutGJs: number | null = null;
  private lastCapDryMs = -Infinity;

  /** The ongoing engagement, or null when idle at `nowMs` (EVE time). */
  engagement(nowMs = this.latestMs): Engagement | null {
    if (this.current && nowMs - this.current.lastCombatMs > ENGAGEMENT_GAP_MS) {
      this.last = this.current;
      this.current = null;
    }
    return this.current;
  }

  /** The ongoing engagement or, when idle, the one that ended last. */
  latestEngagement(nowMs = this.latestMs): Engagement | null {
    return this.engagement(nowMs) ?? this.last;
  }

  apply(e: GameEvent): void {
    this.latestMs = Math.max(this.latestMs, e.timeMs);
    if (e.kind === 'systemJump' || e.kind === 'undock') {
      // A new system always ends the engagement.
      if (this.current) this.last = this.current;
      this.current = null;
      this.system = e.kind === 'systemJump' ? e.to : e.system;
      if (e.kind === 'undock') this.heavyNeutGJs = null;
      return;
    }
    if (e.kind === 'targetGone') {
      if (this.current) this.current.targetsGone++;
      return;
    }
    if (!COMBAT_KINDS.has(e.kind)) return;

    let g = this.engagement(e.timeMs);
    if (!g) {
      g = newEngagement(e.timeMs, this.system, this.heavyNeutGJs);
      this.current = g;
    }
    g.lastCombatMs = e.timeMs;
    const npc = (name: string): NpcObservation => {
      let o = g.npcs.get(name);
      if (!o) {
        o = {
          name,
          firstSeenMs: e.timeMs,
          lastSeenMs: e.timeMs,
          damageToUs: 0,
          damageByUs: 0,
          hitsOnUs: 0,
          missesOnUs: 0,
          ewarOnUs: {},
          neutGJ: 0,
          weapons: new Set(),
        };
        g.npcs.set(name, o);
      }
      o.lastSeenMs = Math.max(o.lastSeenMs, e.timeMs);
      return o;
    };
    const hitTarget = (target: string) => {
      g.ourTargets.set(target, e.timeMs);
      if (!g.ourFirstHits.has(target)) g.ourFirstHits.set(target, e.timeMs);
    };
    const shot = (weapon: string | null, target: string): ShotStats | null => {
      if (!weapon) return null;
      const key = `${weapon}|${target}`;
      let x = g.shots.get(key);
      if (!x) {
        x = { weapon, target, hits: 0, misses: 0, damage: 0, maxHit: 0, lastMs: e.timeMs, qualities: {} };
        g.shots.set(key, x);
      }
      x.lastMs = Math.max(x.lastMs, e.timeMs);
      return x;
    };
    const streak = (kind: EwarType | 'neut', amount = 1) => {
      const s = g.ewarStreaks[kind];
      if (s && e.timeMs - s.lastMs <= STREAK_GAP_MS) {
        s.lastMs = Math.max(s.lastMs, e.timeMs);
        s.amount += amount;
      } else g.ewarStreaks[kind] = { startMs: e.timeMs, lastMs: e.timeMs, amount };
    };

    switch (e.kind) {
      case 'damageDealt': {
        g.dealt += e.amount;
        g.hits++;
        g.recentDealt.push({ t: e.timeMs, amount: e.amount });
        if (e.weapon) g.dealtByWeapon.set(e.weapon, (g.dealtByWeapon.get(e.weapon) ?? 0) + e.amount);
        if (e.quality) g.qualityCounts.set(e.quality, (g.qualityCounts.get(e.quality) ?? 0) + 1);
        npc(e.target).damageByUs += e.amount;
        hitTarget(e.target);
        const x = shot(e.weapon, e.target);
        if (x) {
          x.hits++;
          x.damage += e.amount;
          x.maxHit = Math.max(x.maxHit, e.amount);
          if (e.quality) x.qualities[e.quality] = (x.qualities[e.quality] ?? 0) + 1;
        }
        break;
      }
      case 'missDealt': {
        const x = shot(e.weapon, e.target);
        if (x) x.misses++;
        g.misses++;
        npc(e.target);
        hitTarget(e.target);
        break;
      }
      case 'damageTaken': {
        g.taken += e.amount;
        g.recentTaken.push({ t: e.timeMs, amount: e.amount });
        const o = npc(e.attacker);
        o.damageToUs += e.amount;
        o.hitsOnUs++;
        if (e.weapon) o.weapons.add(e.weapon);
        break;
      }
      case 'missTaken':
        npc(e.attacker).missesOnUs++;
        break;
      case 'ewar':
        // Attempts against drones or other pilots are not attacks on us.
        if (e.victim === null) {
          npc(e.attacker).ewarOnUs[e.ewar] = e.timeMs;
          streak(e.ewar);
        } else npc(e.attacker);
        break;
      case 'energyNeutralized': {
        const o = npc(e.attacker);
        o.ewarOnUs.neut = e.timeMs;
        o.neutGJ += e.amountGJ;
        streak('neut', e.amountGJ);
        g.recentNeut.push({ t: e.timeMs, amount: e.amountGJ });
        const max = this.neutMax.get(e.attacker) ?? 0;
        this.neutMax.set(e.attacker, Math.max(max, e.amountGJ));
        if (max >= CAP_DRY_MIN_GJ && e.amountGJ <= max * CAP_DRY_SHARE) {
          g.capDryNeuts.push(e.timeMs);
          if (g.capDryNeuts.filter((t) => t > e.timeMs - CAP_DRY_MS).length >= 2) {
            // Learn once per dry spell: while the capacitor stays empty the neuts take little, which says nothing.
            if (e.timeMs - this.lastCapDryMs > CAP_DRY_MS) this.learnHeavyNeut(g, e.timeMs);
            this.lastCapDryMs = e.timeMs;
          }
        }
        break;
      }
      case 'energyDrained':
        npc(e.target);
        break;
      case 'bounty':
        g.bounty += e.isk;
        g.bountyCount++;
        break;
    }
    const cutoff = e.timeMs - HISTORY_MS;
    while (g.recentDealt.length && g.recentDealt[0]!.t < cutoff) g.recentDealt.shift();
    while (g.recentTaken.length && g.recentTaken[0]!.t < cutoff) g.recentTaken.shift();
    while (g.recentNeut.length && g.recentNeut[0]!.t < cutoff) g.recentNeut.shift();
    while (g.capDryNeuts.length && g.capDryNeuts[0]! < cutoff) g.capDryNeuts.shift();
  }

  /** The lowest drain that emptied the capacitor so far is the one to warn about. */
  private learnHeavyNeut(g: Engagement, nowMs: number): void {
    const drain = g.recentNeut.filter((x) => x.t > nowMs - DRAIN_WINDOW_MS);
    const span = nowMs - (drain[0]?.t ?? nowMs);
    if (span < MIN_DRAIN_MS) return;
    const gj = drain.reduce((a, x) => a + x.amount, 0);
    const heavy = Math.round((gj / (span / 1000)) * HEAVY_NEUT_SHARE);
    if (heavy < MIN_HEAVY_NEUT_GJS) return;
    this.heavyNeutGJs = Math.min(this.heavyNeutGJs ?? Infinity, heavy);
    g.heavyNeutGJs = this.heavyNeutGJs;
  }

  stats(nowMs = this.latestMs): CombatStats | null {
    const g = this.latestEngagement(nowMs);
    if (!g) return null;
    const engaged = this.current === g;
    const end = engaged ? Math.max(nowMs, g.lastCombatMs) : g.lastCombatMs;
    const durationMs = Math.max(1000, end - g.startMs + 1000);
    const windowSum = (xs: TimedAmount[]) =>
      engaged ? xs.filter((x) => x.t >= nowMs - RATE_WINDOW_MS).reduce((a, x) => a + x.amount, 0) : 0;
    const top = (m: Map<string, number>) =>
      [...m]
        .map(([name, damage]) => ({ name, damage }))
        .sort((a, b) => b.damage - a.damage)
        .slice(0, 3);
    return {
      engaged,
      startMs: g.startMs,
      durationMs,
      dealt: g.dealt,
      taken: g.taken,
      dpsOut: windowSum(g.recentDealt) / (RATE_WINDOW_MS / 1000),
      dpsIn: windowSum(g.recentTaken) / (RATE_WINDOW_MS / 1000),
      avgDpsOut: g.dealt / (durationMs / 1000),
      avgDpsIn: g.taken / (durationMs / 1000),
      hitRate: g.hits + g.misses > 0 ? g.hits / (g.hits + g.misses) : null,
      bounty: g.bounty,
      bountyCount: g.bountyCount,
      secondsPerKillEstimate: g.bountyCount > 0 ? durationMs / 1000 / g.bountyCount : null,
      topWeapons: top(g.dealtByWeapon),
      topAttackers: top(new Map([...g.npcs.values()].map((n) => [n.name, n.damageToUs]))).filter((a) => a.damage > 0),
    };
  }
}
