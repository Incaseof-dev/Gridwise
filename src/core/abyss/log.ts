/** A finished run → an entry of the player's Abyss log (EVE-75). Dependency-free. */
import type { FinishedRun } from './run';
import type { AbyssLogEntry, AbyssLogNpc, WeatherId } from './types';

/** A new room starts when an NPC shows up this long after everything before it went quiet. */
export const ROOM_GAP_MS = 5_000;
/** Loot structures keep their name from room to room and are shot whenever: they do not mark rooms. */
const STRUCTURE = /\b(cache|extraction (sub)?node)\b/i;

/** Bioadaptive caches and extraction nodes: the loot cans of the Abyss. */
export const isLootStructure = (name: string): boolean => STRUCTURE.test(name);

export interface LogContext {
  character: string | null;
  weather: WeatherId | null;
  tier: number | null;
  tierSource: 'npc' | 'setting' | null;
  ship: string | null;
  fitId?: string | null;
}

export function logEntry(f: FinishedRun, ctx: LogContext): AbyssLogEntry {
  const t0 = f.run.enteredMs;
  const s = (ms: number) => Math.max(0, Math.round((ms - t0) / 1000));
  const npcs = [...f.run.npcs.values()].sort((a, b) => a.firstSeenMs - b.firstSeenMs);
  const rooms: AbyssLogEntry['rooms'] = [];
  let quietFrom = -Infinity;
  for (const n of npcs) {
    const structure = STRUCTURE.test(n.name);
    if (!rooms.length || (!structure && n.firstSeenMs > quietFrom + ROOM_GAP_MS))
      rooms.push({ startS: s(n.firstSeenMs), endS: s(n.lastSeenMs), npcs: [] });
    const room = rooms.at(-1)!;
    const entry: AbyssLogNpc = {
      name: n.name,
      firstS: s(n.firstSeenMs),
      lastS: s(n.lastSeenMs),
      damageToUs: Math.round(n.damageToUs),
      damageByUs: Math.round(n.damageByUs),
      ewar: [...n.ewar],
    };
    // The same NPC in two fights of one room (a pause over a minute): one line.
    const same = room.npcs.find((x) => x.name === n.name && x.lastS >= entry.firstS - 60);
    if (same) {
      same.lastS = Math.max(same.lastS, entry.lastS);
      same.damageToUs += entry.damageToUs;
      same.damageByUs += entry.damageByUs;
      same.ewar = [...new Set([...same.ewar, ...entry.ewar])];
    } else room.npcs.push(entry);
    if (!structure) {
      room.endS = Math.max(room.endS, entry.lastS);
      quietFrom = Math.max(quietFrom, n.lastSeenMs);
    }
  }
  const last = rooms.at(-1)?.npcs.filter((n) => n.damageToUs > 0) ?? [];
  const killedBy =
    f.outcome === 'lost' && last.length ? last.reduce((a, b) => (b.damageToUs > a.damageToUs ? b : a)).name : null;
  const sum = (k: 'damageToUs' | 'damageByUs') => rooms.reduce((a, r) => a + r.npcs.reduce((b, n) => b + n[k], 0), 0);
  return {
    id: `${f.characterId ?? 'x'}-${t0}`,
    character: ctx.character,
    enteredAt: new Date(t0).toISOString(),
    exitedAt: f.exitedMs === null ? null : new Date(f.exitedMs).toISOString(),
    clearSeconds: f.exitedMs === null || f.run.approximate || f.outcome === 'lost' ? null : s(f.exitedMs),
    outcome: f.outcome,
    approximate: f.run.approximate,
    origin: f.run.origin,
    exitSystem: f.exitSystem,
    killedBy,
    weather: ctx.weather,
    tier: ctx.tier,
    tierSource: ctx.tierSource,
    ship: ctx.ship,
    characterId: f.characterId,
    fitId: ctx.fitId ?? null,
    rooms,
    dealt: sum('damageByUs'),
    taken: sum('damageToUs'),
  };
}

/** Adds an entry (newest first), replacing one with the same id. */
export function addLogEntry(entries: readonly AbyssLogEntry[], e: AbyssLogEntry): AbyssLogEntry[] {
  return [e, ...entries.filter((x) => x.id !== e.id)];
}

/**
 * The retention policy (EVE-89): the newest `keep` runs of each tier and weather, so a filament run a hundred times
 * does not push out the rare ones. Runs whose tier or weather is unknown form a group of their own.
 */
export function pruneLog(entries: readonly AbyssLogEntry[], keep: number): AbyssLogEntry[] {
  const seen = new Map<string, number>();
  return [...entries]
    .sort((a, b) => b.enteredAt.localeCompare(a.enteredAt))
    .filter((e) => {
      const k = `${e.tier}|${e.weather}`;
      const n = (seen.get(k) ?? 0) + 1;
      seen.set(k, n);
      return n <= keep;
    });
}
