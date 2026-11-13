/**
 * An Abyss log entry as EVE Workbench's Abyss Tracker telemetry (EVE-86, POST /v1/abyss-tracker/telemetry).
 * The swagger gives only the shape; what the fields mean comes from the tracker's earlier open source
 * (molbal/abyss-tracker, CreateRunHelper::storeFromTelemetry): Privacy PUBLIC or PRIVATE, Tier 0–6, Weather the
 * weather's name, RunStartTime in unix seconds, every can looted when CansSpawned = CansLooted, and a second upload
 * with the same recordUuid replaces the run. Dependency-free apart from node:crypto.
 */
import { createHash } from 'node:crypto';
import { isLootStructure } from '../abyss/log';
import type { AbyssLogEntry, AbyssPrivacy } from '../abyss/types';
import { ABYSS_DURATION_MS } from '../abyss/types';

/**
 * A stable UUID from text (name-based, SHA-1 like a v5 UUID), so an entry keeps its record id across uploads. The
 * prefix is the name before EVE-94 and stays: a new one would give every uploaded run a new id.
 */
export function uuidFrom(text: string): string {
  const h = createHash('sha1').update(`eve-assistant:${text}`).digest();
  h[6] = (h[6]! & 0x0f) | 0x50;
  h[8] = (h[8]! & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

/** The character of an entry: its own field, else the id's prefix (`<characterId>-<entered ms>`). */
export function entryCharacterId(e: AbyssLogEntry): number | null {
  if (typeof e.characterId === 'number') return e.characterId;
  const m = /^(\d+)-\d+$/.exec(e.id);
  return m ? Number(m[1]) : null;
}

export interface TelemetryShip {
  name: string;
  typeId: number | null;
  /** "Frigate", "Destroyer", "Cruiser": the tracker's hull type. */
  hullType: string;
  eft: string | null;
  fitName: string | null;
  /** The fit's EVE Workbench id, which links the run to it there. */
  ewbFitId: string | null;
}

export interface TelemetryInput {
  entry: AbyssLogEntry;
  characterId: number;
  privacy: AbyssPrivacy;
  ship: TelemetryShip;
  /** Unit prices for the loot value; null where unknown. */
  price: (typeId: number) => number | null;
}

const WEATHER_NAME: Record<string, string> = {
  dark: 'Dark',
  electrical: 'Electrical',
  exotic: 'Exotic',
  firestorm: 'Firestorm',
  gamma: 'Gamma',
};

/** Why an entry cannot go up yet, or null when it can. */
export function uploadBlocker(e: AbyssLogEntry): string | null {
  if (!e.weather) return 'The weather of this run is not known.';
  if (e.tier === null) return 'The tier of this run is not known.';
  if (!e.ship) return 'The ship of this run is not known (no active fit when it ended).';
  if (entryCharacterId(e) === null) return 'The character of this run is not known.';
  if (e.outcome !== 'lost' && !e.loot) return 'Add the loot first.';
  return null;
}

export function telemetryFor({ entry: e, characterId, privacy, ship, price }: TelemetryInput) {
  const items = e.outcome === 'lost' ? [] : (e.loot?.items ?? []);
  const lost = e.outcome === 'lost' ? [] : (e.loot?.lost ?? []);
  const value = (list: typeof items) => Math.round(list.reduce((a, i) => a + (price(i.typeId) ?? 0) * i.count, 0));
  const cans = e.rooms.flatMap((r) => r.npcs.filter((n) => isLootStructure(n.name)));
  const looted = cans.filter((n) => n.damageByUs > 0).length;
  const seconds =
    e.clearSeconds ??
    (e.exitedAt ? Math.round((Date.parse(e.exitedAt) - Date.parse(e.enteredAt)) / 1000) : ABYSS_DURATION_MS / 1000);
  return {
    recordUuid: uuidFrom(e.id),
    privacy: privacy === 'public' ? 'PUBLIC' : 'PRIVATE',
    shipType: ship.hullType,
    runStartTime: Math.floor(Date.parse(e.enteredAt) / 1000),
    testServer: false,
    runDurationSeconds: Math.min(seconds, ABYSS_DURATION_MS / 1000),
    weather: WEATHER_NAME[e.weather ?? ''] ?? '',
    tier: e.tier ?? 0,
    characterId,
    characterName: e.character,
    success: e.outcome === 'completed',
    lootGainedPrice: value(items),
    lootLostPrice: value(lost),
    // One cache per room; the log only shows the cans that were shot, and those are the ones looted.
    cansSpawned: Math.max(cans.length, Math.min(3, e.rooms.length)),
    cansLooted: looted,
    lootGained: items.map((i) => ({ name: i.name, count: i.count, typeId: i.typeId })),
    lootLost: lost.map((i) => ({ name: i.name, count: i.count, typeId: i.typeId })),
    rooms: e.rooms.map((r) => ({
      roomDurationSeconds: Math.max(0, r.endS - r.startS),
      spawn: r.npcs.map((n) => ({ name: n.name, count: 1, npc: !isLootStructure(n.name) })),
    })),
    ships: [
      {
        characterName: e.character,
        source: 'EVE Assistant',
        foreignId: ship.ewbFitId ?? uuidFrom(`fit:${ship.eft ?? ship.name}`),
        fittingName: ship.fitName,
        eft: ship.eft,
        shipName: ship.name,
        shipTypeId: ship.typeId,
      },
    ],
  };
}

export type Telemetry = ReturnType<typeof telemetryFor>;
