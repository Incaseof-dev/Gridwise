/**
 * Ultra compact wave view (task EVE-58): the spawns of a wave grouped by hull size, with summed counts and the
 * markers that matter (warp prevention, other EWAR, trigger, loot). Dependency-free: used by the renderer.
 */
import type { NpcCapabilityKind } from '../sde/npcCapabilities';
import type { BriefSpawn } from '../viewmodel';
import type { ShipSize } from './shipSize';

export interface SizeBadge {
  size: ShipSize | null;
  elite: boolean;
  /** Summed counts, e.g. "7" or "5-8" when the source gives ranges; "?" when a count is unknown. */
  count: string;
  ewar: NpcCapabilityKind[];
  trigger: boolean;
  loot: boolean;
  /** One of its drops is worth a look (BriefSpawn.dropNotable). */
  lootNotable: boolean;
  spawns: BriefSpawn[];
}

const RANGE = /^(\d+)\s*-\s*(\d+)$/;

/** Adds source counts like "3", "2-4", "?" into one display count. */
export function sumCounts(counts: string[]): string {
  let lo = 0;
  let hi = 0;
  for (const c of counts) {
    const t = c.trim();
    const r = RANGE.exec(t);
    if (r) {
      lo += Number(r[1]);
      hi += Number(r[2]);
    } else if (/^\d+$/.test(t)) {
      lo += Number(t);
      hi += Number(t);
    } else return '?';
  }
  return lo === hi ? String(lo) : `${lo}-${hi}`;
}

/** Badges in order of first appearance; spawns of the same size and eliteness share one badge. */
export function summarizeWave(spawns: BriefSpawn[]): SizeBadge[] {
  const out: SizeBadge[] = [];
  for (const s of spawns) {
    let b = out.find((x) => x.size === s.size && x.elite === s.elite);
    if (!b) {
      b = {
        size: s.size,
        elite: s.elite,
        count: '',
        ewar: [],
        trigger: false,
        loot: false,
        lootNotable: false,
        spawns: [],
      };
      out.push(b);
    }
    b.spawns.push(s);
    for (const k of s.ewar) if (!b.ewar.includes(k)) b.ewar.push(k);
    b.trigger ||= s.triggers !== null;
    b.loot ||= s.drop !== null;
    b.lootNotable ||= s.dropNotable;
  }
  for (const b of out) b.count = sumCounts(b.spawns.map((s) => s.count));
  return out;
}
