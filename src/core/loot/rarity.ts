/**
 * Rare-loot NPC classification from the SDE group name (task 023). Dependency-free.
 * The SDE has no loot tables; the group says what kind of spawn it is, which is what decides
 * whether faction/officer/deadspace loot is possible at all.
 */

export type RareKind = 'officer' | 'commander' | 'overseer' | 'overseerStructure';

export interface RareInfo {
  kind: RareKind;
  /** Short label for chips, e.g. "COMMANDER". */
  label: string;
  /** What it can drop, in general terms. */
  loot: string;
}

const RARE: { re: RegExp; info: RareInfo }[] = [
  {
    re: /\bOfficer\b/,
    info: { kind: 'officer', label: 'OFFICER', loot: 'officer modules (very valuable), faction modules/tags' },
  },
  {
    re: /\bCommander\b/,
    info: { kind: 'commander', label: 'FACTION', loot: 'faction modules, tags, faction ammo' },
  },
  {
    re: /Deadspace Overseer's (Structure|Belongings)/,
    info: { kind: 'overseerStructure', label: 'OVERSEER LOOT', loot: 'deadspace modules, BPCs, overseer effects' },
  },
  {
    re: /^Deadspace Overseer (Frigate|Destroyer|Cruiser|Battlecruiser|Battleship)$/,
    info: { kind: 'overseer', label: 'OVERSEER', loot: "overseer's personal effects, deadspace/faction modules" },
  },
];

export function classifyRare(groupName: string): RareInfo | null {
  return RARE.find((r) => r.re.test(groupName))?.info ?? null;
}

/** Loot notes worth flagging: faction/officer/deadspace items, tags, BPCs, implants, keys. */
export const NOTABLE_LOOT =
  /faction|dread|domination|shadow|dark blood|true sansha|officer|overseer|[abcx]-type|deadspace|\btags?\b|bpc|implant|keycard|key\b/i;

/**
 * Drops that are plainly common: T1 ammo and charges, trade goods, commodities, scrap, minerals, drone parts. The
 * brief greys their loot bag; anything else (mission items, unknown modules) keeps the gold one, so nothing that
 * matters looks worthless.
 */
const COMMON_LOOT =
  /^(drops?|ammo|loot)\.?$|\b(t1|tech 1|ammo|ammunition|charges?|missiles?|trade goods|commodit(y|ies)|metal scraps?|minerals?|drone (components|parts)|elite drone ai|meta modules?)\b/i;

export function isNotableDrop(text: string): boolean {
  if (NOTABLE_LOOT.test(text) || /valuable|rare|\bchips?\b|nexus|\bhalo\b/i.test(text)) return true;
  return !COMMON_LOOT.test(text);
}
