/**
 * Who to shoot first in an Abyss room (EVE-75). Deterministic and dependency-free.
 *
 * The wiki's rule: kill the EWAR that threatens your ship first (neuts, webs, scrams; disruptors; painters when
 * battleships are on grid), then dedicated logi, then the damage dealers. Battleships tank for minutes and are left
 * for last unless they are the main damage (CONCORD Marshals); swarmers die with their controller, and the loot
 * structures do not lock the gate.
 */
import type { NpcCapabilityKind } from '../sde/npcCapabilities';
import type { AbyssData, AbyssFaction, AbyssOvermind, AbyssRole, AbyssRoleTag } from './types';

export interface AbyssNpc {
  name: string;
  faction: AbyssFaction | null;
  roles: AbyssRole[];
  ewar: NpcCapabilityKind[];
  tags: AbyssRoleTag[];
  hull: string | null;
  /** Loot cache or extraction node: optional, shoot it after the room. */
  structure: boolean;
  overmind: AbyssOvermind | null;
}

const words = (s: string) =>
  s
    .toLowerCase()
    .split(/[\s-]+/)
    .filter(Boolean);

/** Faction, role and known EWAR of an NPC name as the combat log shows it. */
export function identifyNpc(name: string, data: AbyssData): AbyssNpc {
  const lower = name.toLowerCase();
  const w = words(name);
  const structure = /\b(cache|extraction (sub)?node)\b/i.test(name);
  const faction = structure
    ? null
    : (data.factions.find((f) => f.markers.some((m) => lower.includes(m.toLowerCase()))) ?? null);
  // Rogue drone names glue their parts together: "Sparkneedle Tessella" = Spark (EM) + needle (light frigate).
  const glued = faction?.id === 'drones';
  const roles =
    faction?.roles.filter((r) => {
      const t = r.token.toLowerCase();
      return t.includes(' ') ? lower.includes(t) : w.some((x) => x === t || (glued && x.includes(t)));
    }) ?? [];
  const overmind = data.overminds.find((o) => o.name.toLowerCase() === lower) ?? null;
  return {
    name,
    faction,
    roles,
    ewar: [...new Set(roles.flatMap((r) => r.ewar))],
    tags: [...new Set(roles.flatMap((r) => r.tags))],
    hull: overmind ? 'battleship' : (roles.find((r) => r.hull)?.hull ?? null),
    structure,
    overmind,
  };
}

/** One NPC on grid, as the log and the SDE know it. */
export interface FocusInput {
  name: string;
  /** EWAR this NPC was seen using on us. */
  observed: NpcCapabilityKind[];
  /** EWAR the SDE gives its type. */
  sde: NpcCapabilityKind[];
  /** EHP against its weakest damage type (SDE); smaller dies sooner. */
  ehp: number | null;
  /** First and last log line of this NPC (log time base of the caller). */
  firstSeenMs?: number;
  lastSeenMs: number;
}

export type FocusGroup = 'tackle' | 'logi' | 'disrupt' | 'damage' | 'other' | 'tank' | 'swarm' | 'loot';
const GROUP_ORDER: FocusGroup[] = ['tackle', 'logi', 'disrupt', 'damage', 'other', 'tank', 'swarm', 'loot'];

export interface FocusItem {
  name: string;
  group: FocusGroup;
  /** Short chips: "SCRAM", "NEUT", "LOGI", "HIGH DPS" …; observed ones say "on you". */
  reasons: string[];
  /** One line on why it is where it is. */
  why: string;
  observed: boolean;
  lastSeenMs: number;
  faction: string | null;
}

const TACKLE: NpcCapabilityKind[] = ['neut', 'warpScramble', 'web', 'warpDisruption'];
const DISRUPT: NpcCapabilityKind[] = ['trackingDisruption', 'guidanceDisruption', 'sensorDamp', 'ecm'];
const CHIP: Partial<Record<NpcCapabilityKind, string>> = {
  neut: 'NEUT',
  warpScramble: 'SCRAM',
  warpDisruption: 'POINT',
  web: 'WEB',
  trackingDisruption: 'TD',
  guidanceDisruption: 'GD',
  sensorDamp: 'DAMP',
  ecm: 'JAM',
  targetPaint: 'PAINT',
};

/**
 * The NPCs in shooting order. Within a category: EWAR seen on us before known; EWAR ships by how soon they die, then
 * neut before scram before web; damage dealers hard hitters first, then by how soon they die.
 */
export function focusOrder(npcs: FocusInput[], data: AbyssData): FocusItem[] {
  const ided = npcs.map((n) => ({ n, a: identifyNpc(n.name, data) }));
  const battleshipOnGrid = ided.some(({ a }) => a.hull === 'battleship');
  const items = ided.map(({ n, a }) => {
    const known = [...new Set([...a.ewar, ...n.sde])];
    const all = [...new Set([...n.observed, ...known])];
    const chips = (kinds: NpcCapabilityKind[]) =>
      kinds.filter((k) => CHIP[k]).map((k) => (n.observed.includes(k) ? `${CHIP[k]} on you` : CHIP[k]!));
    const tackle = TACKLE.filter((k) => all.includes(k));
    const disrupt = [...DISRUPT, ...(battleshipOnGrid ? (['targetPaint'] as const) : [])].filter((k) =>
      all.includes(k),
    );
    const big = a.tags.includes('highDamage');
    let group: FocusGroup;
    let why: string;
    const reasons: string[] = [];
    if (a.structure) {
      group = 'loot';
      why = 'loot: not needed for the gate, shoot it when the room is clear';
    } else if (/swarmer/i.test(n.name)) {
      group = 'swarm';
      why = 'dies with the ship that launched it';
    } else if (tackle.length) {
      group = 'tackle';
      reasons.push(...chips(tackle));
      why = tackle.includes('neut')
        ? 'drains your capacitor: tank and guns stop'
        : 'slows or scrams you: no speed tank, no getting away from its friends';
    } else if (a.tags.includes('logi')) {
      group = 'logi';
      reasons.push('LOGI');
      why = 'repairs the others; kill it first if they heal faster than you kill';
    } else if (a.hull === 'battleship' && a.faction?.id !== 'concord') {
      group = 'tank';
      why = a.overmind
        ? `huge tank, kill it last${a.overmind.damage.length ? `; shoot ${a.overmind.damage.join('/')}` : ''}`
        : 'huge tank, kill it last';
    } else if (disrupt.length) {
      group = 'disrupt';
      reasons.push(...chips(disrupt));
      why = 'lowers your damage or lock range';
    } else if (big || a.tags.includes('damage')) {
      group = 'damage';
      why = big ? 'hits hard' : 'damage dealer';
    } else {
      group = 'other';
      why = a.faction ? 'no EWAR known' : 'unknown NPC';
    }
    if (big && group !== 'loot') reasons.push('HIGH DPS');
    if (group !== 'disrupt' && group !== 'tackle') reasons.push(...chips(all.filter((k) => !TACKLE.includes(k))));
    const tackleRank = tackle.length ? Math.min(...tackle.map((k) => TACKLE.indexOf(k))) : 9;
    return {
      item: {
        name: n.name,
        group,
        reasons: [...new Set(reasons)],
        why,
        observed: n.observed.length > 0,
        lastSeenMs: n.lastSeenMs,
        faction: a.faction?.id ?? null,
      },
      // EWAR: the one that dies sooner removes its effect sooner (an Echo before a Cynabal); damage: hard hitters first.
      sort:
        group === 'tackle' || group === 'disrupt'
          ? [GROUP_ORDER.indexOf(group), n.observed.length ? 0 : 1, n.ehp ?? Number.MAX_SAFE_INTEGER, tackleRank]
          : [GROUP_ORDER.indexOf(group), n.observed.length ? 0 : 1, big ? 0 : 1, n.ehp ?? Number.MAX_SAFE_INTEGER],
    };
  });
  items.sort((x, y) => {
    for (let i = 0; i < x.sort.length; i++) if (x.sort[i] !== y.sort[i]) return x.sort[i]! - y.sort[i]!;
    return x.item.name.localeCompare(y.item.name);
  });
  return items.map((x) => x.item);
}

/** The tier an Overmind on grid gives away (each tier has its own), or null. */
export function tierFromNpcs(names: string[], data: AbyssData): number | null {
  for (const n of names) {
    const o = data.overminds.find((x) => x.name.toLowerCase() === n.toLowerCase());
    if (o) return o.tier;
  }
  return null;
}
