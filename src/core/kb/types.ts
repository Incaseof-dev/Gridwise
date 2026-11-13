/** Encounter knowledge base types (docs/knowledge-base.md). */
import type { DamageType } from '../sde/damage';
import type { NpcCapabilityKind } from '../sde/npcCapabilities';

export type Confidence = 'verified' | 'observed' | 'inferred' | 'unknown';
export const CONFIDENCES: readonly Confidence[] = ['verified', 'observed', 'inferred', 'unknown'];

export type EncounterKind = 'mission' | 'anomaly' | 'complex' | 'escalation' | 'other';
export type WarningLevel = 'info' | 'caution' | 'danger';
export type TriggerOn =
  'warpIn' | 'attacked' | 'destroyed' | 'structureAttacked' | 'structureDestroyed' | 'timer' | 'approach' | 'other';

export interface Source {
  title: string;
  url?: string;
  license?: string;
  retrieved?: string;
  revision?: string;
}

/** Fields every fact can carry. After normalization both are always set. */
export interface Provenance {
  confidence: Confidence;
  /** Key into `sources`, or null when the fact has no source (e.g. own observation). */
  source: string | null;
  note?: string;
}

export interface TextFact extends Provenance {
  text: string;
}

export interface WarningFact extends TextFact {
  level: WarningLevel;
}

export interface LootFact extends Provenance {
  item: string;
  from?: string;
}

export interface EwarFact extends Provenance {
  kind: NpcCapabilityKind;
}

export interface NpcKnowledge {
  class?: string;
  /** SDE type names this display name can stand for. */
  sdeTypes: string[];
  ewar: EwarFact[];
  notes: TextFact[];
}

export interface Trigger extends Provenance {
  on: TriggerOn;
  npc?: string;
  text?: string;
}

export interface Spawn extends Provenance {
  count: string;
  class?: string;
  names: string[];
  /** Sub-group within the wave, e.g. "Group 1 (15-30 km) (auto-aggro)". */
  group?: string;
  ewar: EwarFact[];
  /** What attacking/destroying this spawn triggers, as the source words it. */
  triggers?: string;
  /** Loot dropped by this spawn/structure. */
  drop?: string;
}

export interface Wave {
  id: string;
  trigger: Trigger;
  spawns: Spawn[];
  notes: TextFact[];
}

export interface Pocket {
  name: string;
  onWarpIn?: string;
  notes: TextFact[];
  gate?: TextFact & { key?: string };
  waves: Wave[];
  objectives: TextFact[];
  loot: LootFact[];
  warnings: WarningFact[];
  /** Derived: NPC/structure names whose attack or destruction triggers something in this pocket. */
  triggerNpcs: string[];
}

export interface DamageProfile extends Provenance {
  deal: DamageType[];
  resist: DamageType[];
}

export interface Encounter {
  id: string;
  kind: EncounterKind;
  name: string;
  aliases: string[];
  level: number | null;
  dedRating: number | null;
  /** EVE University's 1–10 difficulty class of a combat anomaly (Hideaway 1 … Sanctum 10). */
  anomalyClass: number | null;
  enemyFaction: string | null;
  sde: { dungeonIds: number[]; missionIds: number[] };
  review: 'reviewed' | 'unreviewed';
  sources: Record<string, Source>;
  damage: DamageProfile | null;
  objectives: TextFact[];
  loot: LootFact[];
  warnings: WarningFact[];
  restrictions: TextFact[];
  /** Free-form advice, e.g. blitz route, aggro behaviour, damage notes. */
  notes: TextFact[];
  /** Loot summaries, e.g. "Loot ≈ 5 M ISK, salvage ≈ 4 M ISK (2025-04-20)". */
  lootNotes: TextFact[];
  /** Encounter-wide EWAR summary (source lists EWAR without saying which NPC). */
  ewar: EwarFact[];
  npcs: Record<string, NpcKnowledge>;
  pockets: Pocket[];
  /** Where it was loaded from. */
  origin: { file: string; layer: KbLayer };
}

/** bundled = shipped with the app; update = refreshed from the wiki by the app; user = the player's own files. */
export type KbLayer = 'bundled' | 'update' | 'user';

export interface KbIssue {
  file: string;
  line: number | null;
  path: string;
  message: string;
  severity: 'error' | 'warning';
}
