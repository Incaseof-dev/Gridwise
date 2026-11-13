/**
 * How long the active fit's capacitor lasts under an NPC neut (EVE-64). Dependency-free.
 *
 * The log gives the neut rate (GJ/s); the fit gives capacity, recharge time and the modules' own drain. EVE's
 * recharge is fastest at 25 % cap: rate(f) = 10 · C / τ · (√f − f) for the fill f, so a drain above that peak
 * empties the capacitor, and a lower one settles somewhere above 25 %.
 */

export interface CapacitorFacts {
  shipName: string;
  /** GJ. */
  capacity: number;
  /** τ in seconds (what the fitting window calls the recharge time). */
  rechargeSeconds: number;
  /** Drain of every module that can be activated, GJ/s. */
  usagePerSecond: number;
}

export interface NeutOutlook {
  shipName: string;
  neutGJs: number;
  /** Seconds from full to empty with the neut alone (modules off); null = the capacitor holds. */
  neutOnlySeconds: number | null;
  /** The same with every module running as well. */
  withModulesSeconds: number | null;
}

/** Longer than this counts as holding: no PvE neut pressure lasts an hour unbroken. */
const HORIZON_S = 3600;

/** Recharge in GJ/s at fill f (0..1). */
export function rechargeAt(c: CapacitorFacts, fill: number): number {
  if (c.rechargeSeconds <= 0 || fill <= 0) return 0;
  return ((10 * c.capacity) / c.rechargeSeconds) * (Math.sqrt(fill) - fill);
}

export function peakRecharge(c: CapacitorFacts): number {
  return rechargeAt(c, 0.25);
}

/** Seconds from a full capacitor to empty under a steady drain; null when it never empties. */
export function secondsToEmpty(c: CapacitorFacts, drainGJs: number): number | null {
  if (c.capacity <= 0) return 0;
  if (drainGJs <= peakRecharge(c)) return null;
  let gj = c.capacity;
  const dt = 0.5;
  for (let t = 0; t < HORIZON_S; t += dt) {
    gj += (rechargeAt(c, gj / c.capacity) - drainGJs) * dt;
    if (gj <= 0) return t + dt;
  }
  return null;
}

export function neutOutlook(c: CapacitorFacts, neutGJs: number): NeutOutlook {
  return {
    shipName: c.shipName,
    neutGJs,
    neutOnlySeconds: secondsToEmpty(c, neutGJs),
    withModulesSeconds: secondsToEmpty(c, neutGJs + c.usagePerSecond),
  };
}
