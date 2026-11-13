/**
 * Jump distances over the stargate graph (EVE-96). Built once from the SDE; `from()` answers "how many jumps is X
 * from here" for the systems within a limit, cached for the last origin since the pilot's system changes rarely.
 */

export interface SystemRef {
  id: number;
  name: string;
  security: number | null;
}

export const MAX_INTEL_RANGE = 10;

export class JumpMap {
  private readonly byName = new Map<string, SystemRef>();
  private readonly byId = new Map<number, SystemRef>();
  private cache: { origin: number; limit: number; dist: Map<number, number> } | null = null;

  constructor(
    systems: readonly SystemRef[],
    private readonly graph: ReadonlyMap<number, readonly number[]>,
  ) {
    for (const s of systems) {
      this.byName.set(s.name.toUpperCase(), s);
      this.byId.set(s.id, s);
    }
  }

  system(nameOrId: string | number): SystemRef | null {
    return (typeof nameOrId === 'number' ? this.byId.get(nameOrId) : this.byName.get(nameOrId.toUpperCase())) ?? null;
  }

  neighbours(id: number): readonly number[] {
    return this.graph.get(id) ?? [];
  }

  /** Jumps from `origin` to every system within `limit` jumps (origin itself = 0). Breadth first. */
  from(origin: number, limit = MAX_INTEL_RANGE): ReadonlyMap<number, number> {
    const c = this.cache;
    if (c && c.origin === origin && c.limit >= limit) return limit === c.limit ? c.dist : trim(c.dist, limit);
    const dist = new Map<number, number>([[origin, 0]]);
    let frontier = [origin];
    for (let d = 1; d <= limit && frontier.length; d++) {
      const next: number[] = [];
      for (const s of frontier)
        for (const n of this.neighbours(s))
          if (!dist.has(n)) {
            dist.set(n, d);
            next.push(n);
          }
      frontier = next;
    }
    this.cache = { origin, limit, dist };
    return dist;
  }

  /** The shortest gate path, both ends included; null when not connected by gates. Breadth first, no limit. */
  path(from: number, to: number): number[] | null {
    if (from === to) return [from];
    const prev = new Map<number, number>([[from, from]]);
    let frontier = [from];
    while (frontier.length) {
      const next: number[] = [];
      for (const s of frontier)
        for (const n of this.neighbours(s)) {
          if (prev.has(n)) continue;
          prev.set(n, s);
          if (n === to) {
            const out = [to];
            for (let x = s; x !== from; x = prev.get(x)!) out.push(x);
            out.push(from);
            return out.reverse();
          }
          next.push(n);
        }
      frontier = next;
    }
    return null;
  }

  /** Jumps between two systems, or null when farther than `limit` (or not connected by gates). */
  distance(origin: number, target: number, limit = MAX_INTEL_RANGE): number | null {
    return this.from(origin, limit).get(target) ?? null;
  }
}

function trim(dist: ReadonlyMap<number, number>, limit: number): Map<number, number> {
  const out = new Map<number, number>();
  for (const [k, v] of dist) if (v <= limit) out.set(k, v);
  return out;
}
