/**
 * Live rare-loot alerts (task 023 A). The log shows which NPCs are on grid but never what dropped or
 * whether a wreck was looted, so an alert stays up for a while after the fight as a reminder.
 */
import type { Encounter } from '../kb/types';
import type { GameDataService } from '../sde/gameData';
import type { Engagement } from '../session/combat';
import type { LootAlertView } from '../viewmodel';
import { classifyRare, NOTABLE_LOOT } from './rarity';

/** Alerts stay this long after the NPC was last seen (time to loot after the fight). */
export const LOOT_REMINDER_MS = 10 * 60_000;

export interface LootHint {
  label: string;
  text: string;
  basis: 'sde' | 'kb';
}

export type LootLookup = (npcName: string) => LootHint | null;

/** SDE classification first (applies everywhere); KB drop notes of the selected encounter fill in mission NPCs. */
export function buildLootLookup(encounter: Encounter | null, gd: GameDataService | null): LootLookup {
  const kb = new Map<string, string>();
  if (encounter) {
    for (const p of encounter.pockets)
      for (const w of p.waves)
        for (const s of w.spawns) {
          if (!s.drop || !NOTABLE_LOOT.test(s.drop)) continue;
          for (const display of s.names)
            for (const n of [display, ...(encounter.npcs[display]?.sdeTypes ?? [])]) kb.set(n, s.drop);
        }
  }
  const cache = new Map<string, LootHint | null>();
  return (name) => {
    if (cache.has(name)) return cache.get(name)!;
    let hint: LootHint | null = null;
    for (const t of gd?.typesByName(name, 11) ?? []) {
      const rare = classifyRare(t.groupName);
      if (rare) {
        hint = { label: rare.label, text: rare.loot, basis: 'sde' };
        break;
      }
    }
    const note = kb.get(name);
    if (note) hint = { label: hint?.label ?? 'LOOT', text: note, basis: 'kb' };
    cache.set(name, hint);
    return hint;
  };
}

export function lootAlerts(g: Engagement | null, nowMs: number, lookup: LootLookup): LootAlertView[] {
  if (!g) return [];
  const out: LootAlertView[] = [];
  for (const n of g.npcs.values()) {
    if (nowMs - n.lastSeenMs > LOOT_REMINDER_MS) continue;
    const hint = lookup(n.name);
    if (!hint) continue;
    out.push({
      id: `loot-${n.name}`,
      npc: n.name,
      label: hint.label,
      text: hint.text,
      basis: hint.basis,
      lastSeenSeconds: Math.max(0, Math.round((nowMs - n.lastSeenMs) / 1000)),
    });
  }
  const rank = (a: LootAlertView) => ['OFFICER', 'FACTION', 'OVERSEER', 'OVERSEER LOOT', 'LOOT'].indexOf(a.label);
  return out.sort((a, b) => rank(a) - rank(b) || a.npc.localeCompare(b.npc));
}
