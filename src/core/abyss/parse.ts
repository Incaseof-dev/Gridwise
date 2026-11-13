/** Validates kb/abyss.json (EVE-75); throws with the first problem found. Dependency-free. */
import { ABYSS_SCHEMA, WEATHER_IDS, type AbyssData } from './types';

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function list(v: unknown, what: string): Record<string, unknown>[] {
  if (!Array.isArray(v) || !v.every(isObj)) throw new Error(`abyss data: ${what} must be a list of objects`);
  return v;
}

export function parseAbyssData(raw: unknown): AbyssData {
  if (!isObj(raw)) throw new Error('abyss data: not an object');
  if (raw.schema !== ABYSS_SCHEMA)
    throw new Error(`abyss data: schema ${String(raw.schema)}, expected ${ABYSS_SCHEMA}`);
  const tiers = list(raw.tiers, 'tiers');
  if (tiers.length !== 7 || tiers.some((t, i) => t.tier !== i || !Array.isArray(t.penalty)))
    throw new Error('abyss data: tiers must be 0–6 with penalties');
  const weathers = list(raw.weathers, 'weathers');
  if (WEATHER_IDS.some((id) => !weathers.some((w) => w.id === id))) throw new Error('abyss data: a weather is missing');
  const factions = list(raw.factions, 'factions');
  const ids = new Set(factions.map((f) => f.id));
  for (const f of factions) {
    if (typeof f.id !== 'string' || !Array.isArray(f.markers)) throw new Error('abyss data: bad faction');
    list(f.roles, `roles of ${String(f.id)}`);
  }
  list(raw.overminds, 'overminds');
  for (const r of list(raw.rooms, 'rooms')) {
    if (!ids.has(r.faction as string)) throw new Error(`abyss data: room of unknown faction ${String(r.faction)}`);
    list(r.npcs, 'room npcs');
  }
  if (!Array.isArray(raw.sources) || !Array.isArray(raw.general))
    throw new Error('abyss data: sources/general missing');
  return raw as unknown as AbyssData;
}
