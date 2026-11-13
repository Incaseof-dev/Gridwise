/**
 * Abyssal Deadspace data (EVE-75): filament tiers, weathers, the enemy factions with what their name parts mean, and
 * the rooms each tier can roll. Dependency-free; the data is kb/abyss.json, made by `npm run kb -- import-abyss`.
 */
import type { DamageType } from '../sde/damage';
import type { NpcCapabilityKind } from '../sde/npcCapabilities';

export const ABYSS_SCHEMA = 1;

/** The Abyss lasts this long; still inside after it, ship and pod are destroyed. */
export const ABYSS_DURATION_MS = 20 * 60_000;

export type WeatherId = 'dark' | 'electrical' | 'exotic' | 'firestorm' | 'gamma';
export const WEATHER_IDS: readonly WeatherId[] = ['dark', 'electrical', 'exotic', 'firestorm', 'gamma'];

export interface AbyssTier {
  /** 0–6. */
  tier: number;
  /** Tranquil, Calm, Agitated, Fierce, Raging, Chaotic, Cataclysmic. */
  name: string;
  /** Possible weather penalty strengths in percent, one rolled per site, e.g. [30, 50]. */
  penalty: number[];
}

export interface AbyssWeather {
  id: WeatherId;
  name: string;
  /** What the penalty lowers: a resist of one damage type, or turret optimal and falloff (Dark). */
  penalty: { kind: 'resist'; damage: DamageType; text: string } | { kind: 'turretRange'; text: string };
  bonus: string;
  /** The wiki's advice on this weather's penalty and bonus. */
  advice: string[];
}

/** A dedicated role beyond EWAR: logi repairs others, dps marks the damage dealers by how hard they hit. */
export type AbyssRoleTag = 'logi' | 'damage' | 'highDamage' | 'swarm';

/** What a name part means within a faction, e.g. Triglavian "Anchoring" = warp scrambler. */
export interface AbyssRole {
  /** The word as it appears in NPC names, e.g. "Anchoring", "needle", "Cynabal". */
  token: string;
  /** Hull class when the token names a hull: frigate, destroyer, cruiser, battlecruiser, battleship. */
  hull?: string;
  ewar: NpcCapabilityKind[];
  tags: AbyssRoleTag[];
  /** The wiki's words. */
  text: string;
}

export interface AbyssFaction {
  /** drones, drifters, sleepers, triglavian, sansha, concord, angel. */
  id: string;
  name: string;
  /** Name parts that tell the faction, e.g. "Lucifer", "Tessella". */
  markers: string[];
  roles: AbyssRole[];
  /** How to fight them and which damage to deal, from the wiki. */
  notes: string[];
  damageToDeal: string | null;
}

export interface AbyssOvermind {
  tier: number;
  name: string;
  /** Armor weakness to shoot. */
  damage: DamageType[];
  note?: string;
}

export interface AbyssRoomNpc {
  /** Frigate, Elite Frigate, Cruiser, Battleship, Structure … as the wiki writes it. */
  class: string;
  /** "1", "0-2", "3-6". */
  count: string;
  /** Expanded names, e.g. ["Lucid Escort", "Lucid Aegis"]; "[Name]needle Tessella" kept as written. */
  names: string[];
  ewar: NpcCapabilityKind[];
  note?: string;
}

export interface AbyssRoom {
  tier: number;
  faction: string;
  /** The wiki's text above the room's table. */
  note: string | null;
  /** "DPS check room": slow to kill, the risk is the timer. */
  dpsCheck: boolean;
  npcs: AbyssRoomNpc[];
}

export interface AbyssData {
  schema: number;
  sources: { title: string; url: string; revision: number; retrieved: string; license: string }[];
  tiers: AbyssTier[];
  weathers: AbyssWeather[];
  factions: AbyssFaction[];
  overminds: AbyssOvermind[];
  rooms: AbyssRoom[];
  /** General advice: target priority, loot structures, swarmers. */
  general: string[];
}

/** What the settings window gets (null map = load failed). */
export interface AbyssDataView {
  data: AbyssData | null;
  error: string | null;
}

/** One NPC of a logged run, with what it did to us and we did to it. */
export interface AbyssLogNpc {
  name: string;
  /** Seconds after the entry. */
  firstS: number;
  lastS: number;
  damageToUs: number;
  damageByUs: number;
  /** EWAR seen on us. */
  ewar: string[];
}

/** One finished Abyss run in the player's log (EVE-75); rooms are split where the NPCs change. */
export interface AbyssLogEntry {
  id: string;
  character: string | null;
  enteredAt: string;
  exitedAt: string | null;
  /** Entry to exit; null without a Local exit line. */
  clearSeconds: number | null;
  /**
   * completed = Local went back to the origin; lost = Local came back elsewhere (the ship died and the clone woke up
   * at home); noExit = no exit line within the 20 minutes (lost to the timer, or logs missing).
   */
  outcome: 'completed' | 'lost' | 'noExit';
  approximate: boolean;
  origin: string | null;
  /** Where Local came back (the clone's station for a lost run); missing in entries older than EVE-78. */
  exitSystem?: string | null;
  /** A lost run: the NPC of the last room that hit us hardest. */
  killedBy?: string | null;
  /** The player's choice at the end of the run; the tier from an Overmind when one was seen. */
  weather: WeatherId | null;
  tier: number | null;
  tierSource: 'npc' | 'setting' | null;
  ship: string | null;
  rooms: { startS: number; endS: number; npcs: AbyssLogNpc[] }[];
  dealt: number;
  taken: number;
  /** The character's id from the game log (EVE-86, for the upload); older entries have it only in `id`. */
  characterId?: number | null;
  /** The fit that was active when the run ended, for the upload's ship. */
  fitId?: string | null;
  /** The cargo copied before the run (EVE-93): the loot is then what grew, and what shrank was used up. */
  cargoBefore?: AbyssCargo | null;
  /** What the player pasted from the cargo after the run (EVE-86). */
  loot?: AbyssRunLoot | null;
  /** Sent to EVE Workbench's Abyss Tracker. */
  upload?: { runId: string | null; at: string; privacy: AbyssPrivacy } | null;
}

export type AbyssPrivacy = 'public' | 'private';

/** A copied cargo list. */
export interface AbyssCargo {
  items: { name: string; typeId: number; count: number }[];
  savedAt: string;
}

export interface AbyssRunLoot {
  /** The loot: the pasted cargo, less the cargo before the run when that is known. */
  items: { name: string; typeId: number; count: number }[];
  /** Used up in the run (EVE-93): in the cargo before, gone after; only with `cargoBefore`. */
  lost?: { name: string; typeId: number; count: number }[];
  /** Pasted lines that named no known item. */
  skipped: string[];
  savedAt: string;
  /** Jita average at saving time, when EVE Workbench gave prices. */
  value: number | null;
  lostValue?: number | null;
}

/** A run from the player's EVE Workbench Abyss Tracker (EVE-86), uploaded by this app or another tool. */
export interface EwbAbyssRun {
  id: string;
  dateAdded: string;
  weather: WeatherId | null;
  tier: number | null;
  hullType: string | null;
  survived: boolean;
  seconds: number | null;
  lootValue: number | null;
  loot: { name: string; typeId: number; count: number; value: number | null }[];
}

export interface AbyssLogView {
  entries: AbyssLogEntry[];
  /** The player's EVE Workbench runs; empty without a key. */
  ewbRuns: EwbAbyssRun[];
}
