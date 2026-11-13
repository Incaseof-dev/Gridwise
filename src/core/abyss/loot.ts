/**
 * The loot of an Abyss run (EVE-86), from the cargo copied in game: select all in the cargo (Ctrl+A), Ctrl+C,
 * paste. Dependency-free; names become type ids through an injected lookup (the SDE in main).
 */

export interface LootItem {
  name: string;
  typeId: number;
  count: number;
}

export interface LootPaste {
  items: LootItem[];
  /** Lines that named no known item, kept to show the player. */
  skipped: string[];
}

/** "1,234", "1 234" (any space), "1.234": thousands separators of any locale; no decimals in item counts. */
function count(s: string | undefined): number | null {
  if (s === undefined) return null;
  const t = s.replace(/[\s\u00a0\u202f.,']/g, '');
  return /^\d+$/.test(t) ? Number(t) : null;
}

/** One line: the inventory's columns (name, quantity, group, …), or "Name x 3" / "3 x Name", or a bare name. */
function parseLine(line: string): { name: string; count: number } | null {
  const l = line.trim();
  if (!l) return null;
  if (l.includes('\t')) {
    const [name, qty] = l.split('\t').map((c) => c.trim());
    return name ? { name, count: count(qty) ?? 1 } : null;
  }
  const after = /^(.+?)\s+x\s*([\d\s.,]+)$/i.exec(l);
  if (after && count(after[2]) !== null) return { name: after[1]!.trim(), count: count(after[2])! };
  const before = /^([\d\s.,]+?)\s*x\s+(.+)$/i.exec(l);
  if (before && count(before[1]) !== null) return { name: before[2]!.trim(), count: count(before[1])! };
  return { name: l, count: 1 };
}

/** The paste as items, same names added up; `typeId` answers null for names the game data does not know. */
export function parseLootPaste(text: string, typeId: (name: string) => number | null): LootPaste {
  const byName = new Map<string, LootItem>();
  const skipped: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const p = parseLine(line);
    if (!p) continue;
    // Damaged or assembled copies are shown with a star in some views.
    const name = p.name.replace(/\*$/, '').trim();
    const id = typeId(name);
    if (id === null) {
      skipped.push(line.trim());
      continue;
    }
    const had = byName.get(name);
    if (had) had.count += p.count;
    else byName.set(name, { name, typeId: id, count: p.count });
  }
  return { items: [...byName.values()], skipped };
}

/** Value of the items at the given unit prices; null when no item has a price. */
export function lootValue(items: readonly LootItem[], price: (typeId: number) => number | null): number | null {
  let sum = 0;
  let any = false;
  for (const i of items) {
    const p = price(i.typeId);
    if (p === null) continue;
    sum += p * i.count;
    any = true;
  }
  return any ? Math.round(sum) : null;
}

/**
 * The run's loot from the cargo before and after it: what grew is loot, what shrank was used up (ammo, the filament,
 * drones left behind). Items are matched by type id.
 */
export function cargoDiff(
  before: readonly LootItem[],
  after: readonly LootItem[],
): { gained: LootItem[]; lost: LootItem[] } {
  const had = new Map(before.map((i) => [i.typeId, i]));
  const gained: LootItem[] = [];
  for (const i of after) {
    const n = i.count - (had.get(i.typeId)?.count ?? 0);
    if (n > 0) gained.push({ ...i, count: n });
  }
  const has = new Map(after.map((i) => [i.typeId, i.count]));
  const lost = before.flatMap((i) => {
    const n = i.count - (has.get(i.typeId) ?? 0);
    return n > 0 ? [{ ...i, count: n }] : [];
  });
  return { gained, lost };
}
