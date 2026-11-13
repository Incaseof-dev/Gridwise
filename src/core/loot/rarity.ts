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
