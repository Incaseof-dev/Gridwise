/**
 * The active fit against the selected site's incoming damage (EVE-63). Dependency-free.
 *
 * Total EHP hides a resist hole when armor and hull add their HP to a shield tank, so the check looks at the layer
 * the fit actually tanks with: how much more (or less) damage it takes there from this site's mix than from even
 * damage, and which incoming type finds a weak resist.
 */
import { DAMAGE_TYPES, type DamageType, type DamageVector } from '../sde/damage';
import type { BriefDamage } from '../viewmodel';
import { LAYERS, type FitStats, type Layer } from './types';

/** Taking this much more damage than from even damage counts as a weak fit for the site. */
export const WEAK_FACTOR = 1.1;
/** This much less counts as a good one. */
export const GOOD_FACTOR = 0.9;
/** An incoming type with at least this share, on a resist this far below the layer's average, is a hole. */
const HOLE_SHARE = 0.2;
const HOLE_BELOW_AVERAGE = 0.05;

export interface FitSiteCheck {
  shipName: string;
  fitName: string;
  skills: FitStats['skills'];
  /** Where the damage mix comes from: SDE NPC data, or the damage types the KB source documents. */
  basis: 'sde' | 'kb';
  /** The layer the fit tanks with: the one it repairs, else the one with the most EHP. */
  layer: Layer;
  /** Resist of that layer weighted by this site's damage, and its plain average. */
  siteResist: number;
  averageResist: number;
  /** Damage taken on that layer from this site's mix relative to even damage: 1.18 = 18 % more. */
  damageFactor: number;
  verdict: 'good' | 'ok' | 'weak';
  /** Incoming types that meet a weak resist of the tank layer, biggest share first. */
  holes: { type: DamageType; share: number; resist: number }[];
  /** EHP of the tank layer against this site and against even damage. */
  layerEhpSite: number;
  layerEhpOmni: number;
}

/** The site's damage mix as shares, or null when neither the SDE nor the KB knows it. */
function siteMix(d: BriefDamage): { mix: DamageVector; basis: 'sde' | 'kb' } | null {
  const mix: DamageVector = { em: 0, thermal: 0, kinetic: 0, explosive: 0 };
  if (d.incomingSde?.length) {
    for (const x of d.incomingSde) mix[x.type] = x.share;
    return { mix, basis: 'sde' };
  }
  if (d.incomingDocumented.length) {
    for (const t of d.incomingDocumented) mix[t] = 1 / d.incomingDocumented.length;
    return { mix, basis: 'kb' };
  }
  return null;
}

/** The layer the fit tanks with: the one it repairs, else the one with the most EHP. */
export function tankLayer(s: FitStats): Layer {
  if (s.tank.shieldBoostPerSecond > 0) return 'shield';
  if (s.tank.armorRepairPerSecond > 0) return 'armor';
  if (s.tank.hullRepairPerSecond > 0) return 'hull';
  const omni = (l: Layer) => s.layers[l].hp / (1 - average(s.layers[l].resists));
  return LAYERS.reduce((best, l) => (omni(l) > omni(best) ? l : best));
}

const average = (r: DamageVector) => DAMAGE_TYPES.reduce((a, t) => a + r[t], 0) / DAMAGE_TYPES.length;

export function checkFitAgainstSite(stats: FitStats, damage: BriefDamage): FitSiteCheck | null {
  const site = siteMix(damage);
  if (!site) return null;
  const total = DAMAGE_TYPES.reduce((a, t) => a + site.mix[t], 0);
  if (total <= 0) return null;
  const share = (t: DamageType) => site.mix[t] / total;

  const layer = tankLayer(stats);
  const { hp, resists } = stats.layers[layer];
  const averageResist = average(resists);
  const siteResist = DAMAGE_TYPES.reduce((a, t) => a + share(t) * resists[t], 0);
  const damageFactor = (1 - siteResist) / (1 - averageResist);
  const holes = DAMAGE_TYPES.filter((t) => share(t) >= HOLE_SHARE && resists[t] < averageResist - HOLE_BELOW_AVERAGE)
    .map((type) => ({ type, share: share(type), resist: resists[type] }))
    .sort((a, b) => b.share - a.share);
  return {
    shipName: stats.shipName,
    fitName: stats.fitName,
    skills: stats.skills,
    basis: site.basis,
    layer,
    siteResist,
    averageResist,
    damageFactor,
    verdict: damageFactor >= WEAK_FACTOR ? 'weak' : damageFactor <= GOOD_FACTOR ? 'good' : 'ok',
    holes,
    layerEhpSite: hp / (1 - siteResist),
    layerEhpOmni: hp / (1 - averageResist),
  };
}
