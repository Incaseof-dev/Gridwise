# Encounter knowledge base

Task 005 (format), task 016 (loader + seed). The KB adds encounter mechanics on top of the SDE: pockets, waves,
triggers, which NPC does what, loot and warnings. The SDE already provides names, objective items, gate restrictions
and per-type NPC stats (docs/sde.md).

## Files and precedence

- Bundled: `kb/encounters/*.yaml`, licensed **CC BY-SA 4.0** (`kb/LICENSE`) because much of it derives from the
  EVE University wiki.
- User: `$XDG_DATA_HOME/gridwise/kb/*.yaml`. An entry with the same `id` replaces the bundled one completely.
- One encounter per file. File name = `id` + `.yaml`.
- Invalid files are skipped and reported (file, line, path, message). They never stop the app.

## Trust model

Every fact can carry `confidence` and `source`. Encounter-level `defaults` fill both in when an item does not set them.

| confidence | meaning                                                                      |
| ---------- | ---------------------------------------------------------------------------- |
| `verified` | documented by the cited source, or confirmed in game                         |
| `observed` | seen by the player / in the player's logs, not (yet) in a source             |
| `inferred` | derived or guessed, e.g. "the Communications Officer is probably the jammer" |
| `unknown`  | explicitly unknown; the UI shows "unknown" instead of hiding the topic       |

`review: unreviewed | reviewed` on the encounter says whether a human has checked the entry against the source or the
game. Machine-transcribed entries start as `unreviewed` and the overlay shows them as such.

Why per-encounter NPC knowledge is needed:

- Mission/site NPCs often appear under **display names that are not SDE type names** ("Supervisor's Guardian").
- The same display name can stand for different types in different sites. In Guristas Watch "Supervisor's Guardian"
  is one of Pithum Annihilator/Killer/Murderer/Nullifier.
- The SDE can be incomplete. Players report sensor damps from Guristas Silencers, but no Guristas type has a damp effect
  in the SDE. The KB can add such capabilities with `confidence: observed`.

## Format

```yaml
id: guristas-watch # stable slug, unique
kind: complex # mission | anomaly | complex | escalation | other
name: Guristas Watch
aliases: [] # other names it appears under
level: null # mission level 1–5 (missions only)
dedRating: null # 1–10, null = unrated
anomalyClass: 4 # combat anomalies: EVE University's class 1 (Hideaway) … 10 (Sanctum); omitted otherwise
enemyFaction: Guristas Pirates # mission variants are identified by name + level + enemyFaction
sde: { dungeonIds: [], missionIds: [] } # optional links into the SDE
review: unreviewed

sources:
  uni:
    title: EVE University Wiki – Guristas Watch
    url: https://wiki.eveuniversity.org/Guristas_Watch
    license: CC BY-SA 4.0
    retrieved: 2026-10-20
    revision: '222655'
defaults: { confidence: verified, source: uni }

damage:
  deal: [kinetic, thermal] # best damage to deal
  resist: [kinetic, thermal] # damage the NPCs deal

objectives:
  - text: Destroy the Pithum Militant Commander to unlock the gate
loot:
  - item: 7th Tier Overseer's Personal Effects
    from: Guristas Scout Officer
    note: 100% drop
warnings:
  - level: caution # info | caution | danger
    text: Many triggers. Keep drones on passive/off the trigger ships.
restrictions:
  - text: Max ship size T2 battlecruiser

npcs: # knowledge about display names used in this encounter
  Pithum Militant Commander:
    class: Cruiser
    sdeTypes: [Pithum Inferno, Pithum Mortifier]
    ewar:
      - { kind: ecm, confidence: inferred }

pockets:
  - name: Pocket 1
    onWarpIn: Gate is locked.
    gate: { text: Unlocks when the Pithum Militant Commander is destroyed }
    waves:
      - id: initial
        trigger: { on: warpIn }
        spawns:
          - { count: '2', class: Sentry, names: [Pith Missile Battery] }
          - { count: '1', class: Cruiser, names: [Pithum Communications Officer] }
      - id: wave-2
        trigger: { on: attacked, npc: Pithum Communications Officer }
        spawns: [...]
```

- `count` is a string so ranges ("4-6") stay readable.
- Triggers `on`: `warpIn`, `attacked`, `destroyed`, `structureAttacked`, `structureDestroyed`, `timer`, `approach`,
  `other`, with an optional `npc` (or structure name) and `text`.
- EWAR kinds are the same as the SDE capability kinds (`warpScramble`, `warpDisruption`, `web`, `neut`, `nos`, `ecm`,
  `sensorDamp`, `trackingDisruption`, `guidanceDisruption`, `targetPaint`, `remoteRepair`, …).
- The loader derives `triggerNpcs` per pocket: NPCs whose attack/destruction spawns the next wave. The overlay uses
  this for "don't shoot X until you are ready" hints.

## Tooling

- `npm run kb -- check` validates all files and cross-checks them against the local SDE: are the `sdeTypes` real NPC
  types, do `missionIds`/`dungeonIds` exist, does the name match an SDE mission/dungeon?
- `npm run kb -- show <name>` prints the normalized entry.
- `npm run kb -- import-sitemap` writes the enemy site map, `kb/sitemap.json` (EVE-74), from the overview tables of
  the wiki page "Combat site". It lists, per pirate faction (Angel, Blood Raiders, Guristas, Sansha, Serpentis, Rogue
  Drones), the combat anomalies (tier 1–10 and level), unrated complexes, DED complexes (n/10) and expeditions, each
  with the security classes it spawns in (high/low/null), its wiki page, its SDE dungeon ids and the wiki's footnotes.
  `links` are the escalations (anomaly → DED complex, unrated complex → expedition) and the next parts of
  expeditions. The command also lists sites without a KB entry. The wiki marks security only as high, low or null;
  finer true-sec bands are documented nowhere. If the page layout changes, the import fails instead of writing a
  partial map. Settings → Enemy sites shows it per faction.
- `npm run kb -- import-abyss` writes the Abyssal Deadspace data, `kb/abyss.json` (EVE-75), from the wiki pages
  "Abyssal Deadspace" and "Possible rooms in Abyssal Deadspace": the filament tiers 0–6 with their penalty strengths,
  the five weathers (penalty, bonus, the wiki's advice), per enemy faction the name parts and what they mean
  (Anchoring = scram, Fieldweaver = shield logi, needle/lance = light/heavy damage …), the Overmind of each tier with
  its armor weakness, and the rooms each tier can roll, per faction tab. Room names are checked against the SDE. The
  overlay's Abyss panel builds its focus order from these name parts plus the SDE's EWAR; Settings → Abyss shows the
  data by weather and tier. The logs do not say which filament was used: entering and leaving the Abyss come from the
  Local chat log (Local switches to "Unknown"), weather and tier from the player's pick (the tier also from an
  Overmind on grid). The ABYSS button in the icon strip right of the panel shows the panel before going in (the
  picked filament, how it hits the fit, the tier's dangerous NPCs). Finished runs go to `abyss-log.json` in the data
  directory (filament, clear time, per room the NPCs with damage dealt and taken), shown under Settings → Abyss.

## Bundled content and sources (2026-10-20)

- `npm run kb -- import-wiki --set l4` → all 150 level 4 missions listed on the wiki's "Mission reports" page
  (141 converted; 10 pages have no mission box, e.g. disambiguation pages).
- `npm run kb -- import-wiki --set sites [--faction "<SDE faction name>"]` → all DED complexes, unrated complexes and
  combat anomalies (236 pages convert; 42 category pages have no site box).
- `npm run kb -- import-wiki --set event --page "Crimson Harvest (2026)"` → each section under the event page's
  "Combat" heading that has NPC tables becomes its own encounter (5 for Crimson Harvest 2026). Event sites change
  every year, so re-import with the new page when an event returns.
- When a page names no faction, it is derived from the NPC types: SDE faction, else a faction in the NPC group name,
  else the well-known pirate name prefixes (Pith → Guristas, Core → Serpentis, Gist → Angel, Corp/Harvest → Blood
  Raiders, Cent → Sansha, Tetrimon). 4 of 382 entries remain without a faction.
- Pages are read through the MediaWiki API as **wikitext** (templates `Missiondetails`, `CMBSiteInfo`,
  `NPCTableHead/Separator/Row`, `MessageBox`) and converted deterministically. The converter
  (`src/core/kb/wiki/convert.ts`) needs no AI step. Raw pages are cached in `~/.cache/gridwise/wiki/`.
- Compressed NPC lists ("Core Rear Admiral/Vice Admiral") are expanded by checking candidates against the SDE.
- Re-running an import overwrites generated files unless they are marked `review: reviewed`.

**Damage data.** On the wiki the damage fields are mostly empty (the rendered "Damage to resist" comes from faction
defaults in the template). Only 21 of 181 entries document incoming damage. For 152 more, the listed NPC types resolve in
the SDE, so the brief computes incoming damage from their SDE damage (`npm run kb -- audit-damage`). Where both exist they
agree in 20 of 21 cases. The brief therefore shows SDE-derived damage (labelled as such) next to any documented value.

**Other sources.** eve-survival.org has detailed mission reports but states no licence. Its content is therefore not
copied into the KB. A URL to it may be added as a reference link.
