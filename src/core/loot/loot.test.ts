import { describe, expect, it } from 'vitest';
import { buildKbBrief } from '../encounter/brief';
import { parseKbFile } from '../kb/loader';
import { convertWikiPage } from '../kb/wiki/convert';
import type { GameEvent } from '../logs/events';
import type { GameDataService } from '../sde/gameData';
import { CombatTracker } from '../session/combat';
import { buildLootLookup, LOOT_REMINDER_MS, lootAlerts } from './alerts';
import { classifyRare } from './rarity';

describe('classifyRare', () => {
  it('classifies by SDE group name', () => {
    expect(classifyRare('Asteroid Guristas Commander Frigate')?.label).toBe('FACTION');
    expect(classifyRare('Asteroid Guristas Officer')?.label).toBe('OFFICER');
    expect(classifyRare('Deadspace Overseer Cruiser')?.label).toBe('OVERSEER');
    expect(classifyRare("Deadspace Overseer's Structure")?.label).toBe('OVERSEER LOOT');
    expect(classifyRare("Deadspace Overseer's Sentry")).toBeNull();
    expect(classifyRare('Deadspace Guristas Cruiser')).toBeNull();
  });
});

const LOOT_PAGE = `{{CMBSiteInfo
|name = Test Outpost
|type = ded
|rating = 4/10
|faction= Guristas
}}
=== First Pocket ===
{{NPCTableHead|Initial}}
{{NPCTableRow|Cruiser|1|Guristas Scout Officer|drop= Wreck may contain Dread Guristas modules}}
{{NPCTableRow|Frigate|5|Pithi Wrecker|drop= Metal scraps}}
|}
== Loot ==
{| class="wikitable"
|-
! Item Name
! Est. Value
! Drops from
! Note
|-
| 7th Tier Overseer's Personal Effects
| 600k ISK
| Guristas Scout Officer
| 100% drop rate
|-
|{{sh|Gila}} BPC
|
| Radiating Telescope
| Rare
|}
Possible deadspace modules:
{| class="wikitable"
! Item Name !! Est. Value
|-
| Pithum C-Type Multispectrum Shield Hardener || About 400M ISK
|}
'''Loot:''' ≈ 5.14 Mil ISK (2025-04-20)
`;

describe('wiki loot import', () => {
  const file = convertWikiPage({ title: 'Test Outpost', revision: 1, timestamp: '', content: LOOT_PAGE }, 'd').file!;

  it('reads loot tables by their headers, including the label above a table', () => {
    expect(file.loot).toEqual([
      {
        item: "7th Tier Overseer's Personal Effects",
        from: 'Guristas Scout Officer',
        note: 'est. 600k ISK (wiki) · 100% drop rate',
      },
      { item: 'Gila BPC', from: 'Radiating Telescope', note: 'Rare' },
      {
        item: 'Pithum C-Type Multispectrum Shield Hardener',
        note: 'est. About 400M ISK (wiki) · possible deadspace modules',
      },
    ]);
    expect(file.lootNotes).toEqual([{ text: 'Loot: ≈ 5.14 Mil ISK (2025-04-20)' }]);
  });

  it('builds the brief loot block with SDE rare NPCs and spawn drops', () => {
    const { encounter } = parseKbFile('test-outpost.yaml', JSON.stringify(file));
    const gd = {
      buildNumber: 1,
      attributes: () => new Map(),
      groupName: () => null,
      typesByName: (n: string) =>
        n === 'Guristas Scout Officer' ? [{ id: 1, groupName: 'Deadspace Overseer Cruiser' }] : [],
      npcProfile: () => null,
      dungeon: () => null,
      missionVariants: () => [],
    } as unknown as GameDataService;
    const loot = buildKbBrief(encounter!, gd).loot;
    expect(loot.rareNpcs).toEqual([
      {
        name: 'Guristas Scout Officer',
        label: 'OVERSEER',
        loot: "overseer's personal effects, deadspace/faction modules",
      },
    ]);
    expect(loot.drops).toEqual([
      { npc: 'Guristas Scout Officer', text: 'Wreck may contain Dread Guristas modules' },
      { npc: 'Pithi Wrecker', text: 'Metal scraps' },
    ]);
    expect(loot.items).toHaveLength(3);
    expect(loot.summary).toEqual(['Loot: ≈ 5.14 Mil ISK (2025-04-20)']);
  });
});

describe('lootAlerts', () => {
  const T0 = Date.UTC(2026, 9, 20, 20, 0, 0);
  const hit = (sec: number, attacker: string) =>
    ({
      kind: 'damageTaken',
      attacker,
      amount: 10,
      weapon: null,
      quality: 'Hits',
      time: '',
      timeMs: T0 + sec * 1000,
      category: 'combat',
      raw: '',
      source: { file: 'f', offset: 0, line: 1 },
    }) as GameEvent;
  const gd = {
    typesByName: (n: string) =>
      n === 'Dread Guristas Wrecker' ? [{ id: 1, groupName: 'Asteroid Guristas Commander Frigate' }] : [],
  } as unknown as GameDataService;

  it('flags rare NPCs from the SDE and notable KB drops, and keeps them as a reminder after the fight', () => {
    const { encounter } = parseKbFile(
      'm.yaml',
      `id: m
kind: mission
name: M
sources: { uni: { title: x } }
pockets:
  - name: P
    waves:
      - id: w
        spawns:
          - { count: 1, names: [Kruul], drop: Possible faction modules or tags }
          - { count: 3, names: [Kruul's Henchman], drop: Metal scraps }
`,
    );
    const lookup = buildLootLookup(encounter, gd);
    const c = new CombatTracker();
    for (const e of [
      hit(0, 'Pithi Wrecker'),
      hit(1, 'Dread Guristas Wrecker'),
      hit(2, 'Kruul'),
      hit(3, "Kruul's Henchman"),
    ])
      c.apply(e);
    const now = T0 + 3000;
    expect(lootAlerts(c.latestEngagement(now), now, lookup).map((a) => [a.npc, a.label, a.basis])).toEqual([
      ['Dread Guristas Wrecker', 'FACTION', 'sde'],
      ['Kruul', 'LOOT', 'kb'],
    ]);
    // Fight over (no lines for 5 min): still reminded; after the reminder time: gone.
    const later = T0 + 5 * 60_000;
    expect(lootAlerts(c.latestEngagement(later), later, lookup)).toHaveLength(2);
    const muchLater = T0 + 3000 + LOOT_REMINDER_MS + 1;
    expect(lootAlerts(c.latestEngagement(muchLater), muchLater, lookup)).toEqual([]);
  });
});
