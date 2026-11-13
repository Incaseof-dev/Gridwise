# SDE integration

Task 004 (decision), task 013 (implementation). Observations from build 3607705 (2026-10-12).

## Source and updates

- `GET https://developers.eveonline.com/static-data/tranquility/latest.jsonl` → `{"_key":"sde","buildNumber":…,"releaseDate":…}`
- `GET https://developers.eveonline.com/static-data/eve-online-static-data-latest-jsonl.zip` → 302 to the build-specific zip
  (99 MB, 102 JSONL files, 581 MB unpacked). The zip also contains `_sde.jsonl` with the build number.
- Update check = compare `buildNumber` with the one stored in the local index. Import builds a new
  `sde-<build>.sqlite` next to the old one and switches only when the import succeeded, so a failed import never
  breaks a working index.

## What is imported

English texts only. The zip is streamed (yauzl) and each JSONL file is read line by line; nothing is fully loaded into memory.

| SDE file                                  | Table                             | Why                                                                |
| ----------------------------------------- | --------------------------------- | ------------------------------------------------------------------ |
| categories, groups, types                 | `categories`, `groups`, `types`   | names ↔ IDs for everything (NPCs, ships, modules, charges, drones) |
| dogmaAttributes, dogmaEffects, dogmaUnits | `attributes`, `effects`           | attribute/effect names, effect chance/range attribute links        |
| typeDogma                                 | `type_attributes`, `type_effects` | NPC stats and EWAR, ship/module stats (~650k + 54k rows)           |
| factions                                  | `factions`                        | faction names                                                      |
| missions                                  | `missions`                        | agent mission names, kind, objective item, dungeon, briefing       |
| dungeons, typeLists                       | `dungeons`, `type_lists`          | site names, DED rating text, gate ship restrictions                |
| archetypes                                | `archetypes`                      | site category (Combat Sites, Escalation, FW Small Complex, …)      |
| mapSolarSystems, mapRegions               | `systems`, `regions`              | system name ↔ ID (logs use names, ESI uses IDs), security status   |
| mapStargates                              | `jumps`                           | stargate links both ways, jump distances for intel (schema 2)      |
| types (names in every language)           | `ship_names`                      | ship names in de/en/es/fr/ja/ko/ru/zh for intel channels (schema 2) |
| –                                         | `search` (FTS5, trigram)          | fuzzy search over missions, dungeons, NPC and ship names           |

Not imported (yet): map moons/planets/belts, blueprints, skins, industry, certificates and other files without a PvE combat use.

## NPCs ("Entity" category 11)

7,418 entity types, almost all `published: false`. 351 names are shared by several types, so a name can resolve to several
type IDs. The service returns all candidates and says when their relevant data differs. It does not pick one.

### Damage

- Turrets (effect `targetAttack`): `emDamage/thermalDamage/kineticDamage/explosiveDamage × damageMultiplier / (speed ms / 1000)`.
- Missiles (effect `missileLaunchingForEntity`): damage of the missile type `entityMissileTypeID` × `missileDamageMultiplier`
  / (`missileLaunchDuration` ms / 1000).
- These are **nominal** values. They ignore hit chance, application, AI behaviour and spawn size, so the UI shows them as an
  estimate of damage type and order of magnitude, not as real incoming DPS.

### Resistances and recommended damage

Shield/armor/hull HP and the 12 resonance attributes are imported. Recommended damage = damage type with the lowest
effective HP over all layers (`Σ HP_layer / resonance_layer,type`).

### EWAR and other capabilities

**Attributes alone are misleading.** For example, Pithum Silencer has `warpScrambleRange` and `warpScrambleStrength`, but
no scramble effect and `entityWarpScrambleChance = 0`. A capability exists only if the type has the **effect**. When the
effect has an activation chance attribute, the chance is reported too. A chance of 0 is shown as "listed, never activates
according to SDE".

There are two generations of NPC effects (legacy `entity…`/`…ForEntity` and the newer `behavior…`/`npcBehavior…`):

| capability                  | effects                                                                                                                                                                            |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| warp scramble               | `warpScrambleForEntity` (chance: `entityWarpScrambleChance`), `behaviorWarpScramble`, `warpScrambleTargetMWDBlockActivationForEntity`, `concordWarpScramble`                       |
| warp disruption             | `behaviorWarpDisrupt`, `warpDisrupt`                                                                                                                                               |
| stasis web                  | `npcBehaviorWebifier`, `modifyTargetSpeed2` (chance: `modifyTargetSpeedChance`), `concordModifyTargetSpeed`                                                                        |
| energy neutralizer          | `npcBehaviorEnergyNeutralizer`, `entityEnergyNeutralizerFalloff`, `energyNeutralizerFalloff`                                                                                       |
| energy nosferatu            | `npcBehaviorEnergyNosferatu`                                                                                                                                                       |
| ECM                         | `entityECMFalloff`, `behaviorECM`, `concordTargetJam`, `NPCRemoteECM`, `entityEwTestEffectJam`                                                                                     |
| sensor dampener             | `entitySensorDampen`, `behaviorSensorDampener`                                                                                                                                     |
| tracking disruptor          | `npcEntityTrackingDisruptor`, `npcBehaviorTrackingDisruptor`                                                                                                                       |
| guidance disruptor          | `npcBehaviorGuidanceDisruptor`                                                                                                                                                     |
| target painter              | `entityTargetPaint`, `behaviorTargetPainter`                                                                                                                                       |
| remote repair (logi)        | `npcBehaviorRemoteArmorRepairer`, `NPCRemoteArmorRepair`, `behaviorNpcRemoteArmorRepair`, `npcEntityRemoteArmorRepairer`, `npcBehaviorRemoteShieldBooster`, `NPCRemoteShieldBoost` |
| ramping damage (Triglavian) | `targetDisintegratorAttack`                                                                                                                                                        |
| smartbomb / AoE             | `npcBehaviorSmartBomb`, `EntityChainLightning`                                                                                                                                     |
| super weapon / doomsday     | `entitySuperWeapon`, `entitySuperWeaponLanceAllRaces`                                                                                                                              |

The mapping lives in `src/core/sde/npcCapabilities.ts`. It is code, not data, because it encodes knowledge of the dogma
system. It is matched by effect name, so new effects just show up as "unmapped" in the diagnostics.

## Missions and sites

- `missions`: 2,892 rows (1,662 kill, 1,155 courier). The same name has many variants and the SDE has **no level and no enemy
  faction** per variant, so mission search shows the name once and asks for level and enemy faction (task 017).
- `dungeons`: 1,416 rows, mostly anomalies, DEDs and other sites; only 3 of 1,460 mission dungeon IDs are present.
  There is no level or difficulty field: the DED rating and the anomaly class come from the wiki (KB). `archetypes`
  (34 rows) only gives the category. The table was added without a schema version bump, so older indexes have none
  and show no category.
  `allowedShipsList` → `type_lists` (ship group IDs allowed through the gates).
- No rooms, spawns, waves or triggers. These come from the knowledge base (task 005).
