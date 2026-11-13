/**
 * The systems around the pilot as a layered graph (EVE-102): the pilot's system on top, one row per jump, gates as
 * lines. Each row is ordered by where its neighbours in the rows above and below sit (barycentre sweeps), which
 * keeps most lines from crossing; x runs 0…1 across the row.
 */
import type { JumpMap } from './jumpMap';

export interface IntelGraphNode {
  id: number;
  name: string;
  security: number | null;
  jumps: number;
  /** 0…1 across the row. */
  x: number;
}

export interface IntelGraph {
  origin: number;
  range: number;
  nodes: IntelGraphNode[];
  /** Gate links between shown systems, each once (lower id first). */
  edges: [number, number][];
}

const SWEEPS = 4;

export function buildIntelGraph(map: JumpMap, origin: number, range: number): IntelGraph {
  const dist = map.from(origin, range);
  const rows: number[][] = Array.from({ length: range + 1 }, () => []);
  for (const [id, d] of dist) rows[d]!.push(id);
  const name = (id: number) => map.system(id)?.name ?? String(id);
  for (const r of rows) r.sort((a, b) => name(a).localeCompare(name(b)));

  const pos = new Map<number, number>();
  const place = () => rows.forEach((r) => r.forEach((id, i) => pos.set(id, (i + 0.5) / r.length)));
  place();
  const order = (row: number[], towards: number) => {
    const key = new Map<number, number>();
    for (const id of row) {
      const ns = map.neighbours(id).filter((n) => dist.get(n) === towards);
      key.set(id, ns.length ? ns.reduce((a, n) => a + pos.get(n)!, 0) / ns.length : pos.get(id)!);
    }
    row.sort((a, b) => key.get(a)! - key.get(b)! || name(a).localeCompare(name(b)));
    row.forEach((id, i) => pos.set(id, (i + 0.5) / row.length));
  };
  for (let s = 0; s < SWEEPS; s++) {
    for (let d = 1; d <= range; d++) order(rows[d]!, d - 1);
    for (let d = range - 1; d >= 1; d--) order(rows[d]!, d + 1);
  }
  place();

  const nodes: IntelGraphNode[] = [];
  for (const r of rows)
    for (const id of r)
      nodes.push({
        id,
        name: name(id),
        security: map.system(id)?.security ?? null,
        jumps: dist.get(id)!,
        x: pos.get(id)!,
      });
  const edges: [number, number][] = [];
  for (const id of dist.keys()) for (const n of map.neighbours(id)) if (id < n && dist.has(n)) edges.push([id, n]);
  return { origin, range, nodes, edges };
}
