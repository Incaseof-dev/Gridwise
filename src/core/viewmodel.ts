/**
 * What the main process sends to the windows. Dependency-free (types only from dependency-free modules),
 * because renderer code imports it.
 */
import type { IntelView } from './intel/view';
import type { AbyssView } from './abyss/view';
import type { ApplicationHint } from './fit/application';
import type { FitSiteCheck } from './fit/siteCheck';
import type { FitLoadoutView, FitStats } from './fit/types';
import type { DamageType } from './sde/damage';
import type { NpcCapabilityKind } from './sde/npcCapabilities';
import type { ShipSize } from './encounter/shipSize';
import type { EncounterRef, Settings } from './settings';

export type Severity = 'info' | 'caution' | 'danger';

export interface DamageShare {
  type: DamageType;
  /** 0–1 of the nominal damage of the resolved NPCs. */
  share: number;
}

export interface BriefDamage {
  /** Incoming damage computed from the SDE data of the listed NPC types; null when none resolved. */
  incomingSde: DamageShare[] | null;
  /** Incoming damage as documented in the KB source. */
  incomingDocumented: DamageType[];
  /** Damage to deal, best first, from SDE resists. `relEhp` = effective HP relative to the best type (1 = best). */
  dealSde: { type: DamageType; relEhp: number }[] | null;
  dealDocumented: DamageType[];
  /** NPC names in the encounter that could not be matched to SDE types (their stats are missing above). */
  unresolvedNpcs: string[];
  resolvedNpcs: number;
}

export interface BriefEwar {
  kind: NpcCapabilityKind;
  severity: Severity;
  /** NPC names that have it (display names where the KB uses them). Empty = source does not say who. */
  by: string[];
  /** Where it is known from: the KB source, SDE dogma effects, or observed by the player. */
  basis: ('kb' | 'sde' | 'observed')[];
}

export interface BriefLoot {
  /** Loot table rows from the KB source (wiki), with estimated value/chance in `note`. */
  items: { item: string; from: string | null; note: string | null }[];
  /** Drop notes of individual spawns. */
  drops: { npc: string; text: string }[];
  /** Encounter NPCs the SDE classifies as officer/commander/overseer (rare loot possible). */
  rareNpcs: { name: string; label: string; loot: string }[];
  /** Loot/salvage/bounty summaries with their date. */
  summary: string[];
}

export interface BriefSpawn {
  count: string;
  cls: string | null;
  names: string[];
  /** SDE type of the first resolvable name, for its image; null when none resolves. */
  typeId: number | null;
  /** Hull size for the overview-style icon. */
  size: ShipSize | null;
  elite: boolean;
  group: string | null;
  ewar: NpcCapabilityKind[];
  triggers: string | null;
  note: string | null;
  drop: string | null;
}

export interface BriefWave {
  title: string;
  /** Human-readable trigger, e.g. "on warp-in", "on a timer", or the source's heading. */
  trigger: string;
  spawns: BriefSpawn[];
}

export interface BriefPocket {
  name: string;
  onWarpIn: string | null;
  /** Notes worth seeing at a glance ("Tip: …", or text about triggers); shown above the waves. */
  tips: string[];
  notes: string[];
  waves: BriefWave[];
  /** "<NPC>: <what it triggers>" for quick "don't shoot yet" hints. */
  triggers: { npc: string; text: string }[];
}

export interface Brief {
  ref: EncounterRef;
  title: string;
  /** e.g. "Mission L4 · Guristas Pirates", "DED 4/10 · Guristas Pirates". */
  subtitle: string;
  hasKb: boolean;
  review: 'reviewed' | 'unreviewed' | 'none';
  damage: BriefDamage;
  ewar: BriefEwar[];
  restrictions: string[];
  objectives: string[];
  warnings: { level: Severity; text: string }[];
  /** Encounter-level tips (blitz route, "Tip: …"); shown expanded. */
  tips: string[];
  notes: string[];
  pockets: BriefPocket[];
  loot: BriefLoot;
  sources: { title: string; url: string | null; license: string | null }[];
}

export interface SearchResult {
  ref: EncounterRef;
  title: string;
  subtitle: string;
  hasKb: boolean;
}

export interface ThreatView {
  id: string;
  severity: Severity;
  /** Short chip text, e.g. "POINTED", "SCRAM", "TRIGGER". */
  label: string;
  text: string;
  npcs: string[];
  /** observed = seen in the log; known = capability from SDE/KB, not seen being used. */
  basis: 'observed' | 'known';
  /** Seconds since the last evidence; null for known capabilities. */
  ageSeconds: number | null;
}

/** A timed, explanatory message about a situation that lasts (task EVE-55); shown for a while, then gone. */
export interface MessageView {
  id: string;
  /** e.g. "neut", "web", "longFight". */
  trigger: string;
  phase: 'sustained' | 'ended' | 'event';
  text: string;
  /** observed = from log lines; known = from SDE/KB capabilities of the NPCs fighting us (webs are not logged). */
  basis: 'observed' | 'known';
  /** Seconds until it disappears. */
  remainingSeconds: number;
}

/** Combat statistics of the current (or last) engagement; all observed from the log unless named estimate. */
export interface CombatView {
  engaged: boolean;
  startMs: number;
  durationMs: number;
  dealt: number;
  taken: number;
  dpsOut: number;
  dpsIn: number;
  avgDpsOut: number;
  avgDpsIn: number;
  hitRate: number | null;
  bounty: number;
  bountyCount: number;
  secondsPerKillEstimate: number | null;
  topWeapons: { name: string; damage: number }[];
  topAttackers: { name: string; damage: number }[];
}

/** A rare-loot NPC seen in the current or just-finished fight. */
export interface LootAlertView {
  id: string;
  npc: string;
  /** e.g. "FACTION", "OFFICER", "OVERSEER". */
  label: string;
  /** What it can drop. */
  text: string;
  basis: 'sde' | 'kb';
  /** Seconds since it was last seen in the log. */
  lastSeenSeconds: number;
}

/** EVE login (EVE-38): the logged-in characters and what ESI told about them. */
export interface EsiView {
  clientId: string;
  callback: string;
  loggingIn: boolean;
  error: string | null;
  /** The manual sync waits until ESI's cache runs out (fittings are cached 5 min); null: can sync now. */
  nextSyncAt: string | null;
  syncing: boolean;
  /** How the login is kept: the OS keyring, Electron's fallback (obfuscated only), or not at all. */
  encryption: 'os' | 'basic' | 'none';
  characters: {
    characterId: number;
    name: string;
    /** Scopes of EVE-D7 the login did not grant (an older registration, or unticked at login). */
    missingScopes: string[];
    totalSp: number | null;
    skillCount: number | null;
    implants: number | null;
    /** Fittings saved in game. */
    fittings: number | null;
    /** The hull at the last ship poll. */
    shipTypeId: number | null;
    updatedAt: string | null;
    error: string | null;
  }[];
}

/** EVE Workbench (EVE-86): the player's key, its account and what was read with it. */
export interface EwbView {
  /** The API server in use (EVE-90); not the live one when trying e.g. a staging server. */
  apiBase: string;
  /** The last calls, newest first, with how long they took (EVE-91); status null = no answer. */
  calls: { at: string; method: string; path: string; status: number | null; ms: number; error: string | null }[];
  hasKey: boolean;
  /** The key is kept encrypted by the OS keyring; without one it cannot be kept. */
  canStore: boolean;
  checking: boolean;
  syncing: boolean;
  error: string | null;
  /** The account's characters (an upload is for one of them). */
  characters: { id: number; name: string }[];
  fits: number | null;
  runs: number | null;
  updatedAt: string | null;
}

/** The last run that ended alive and has no loot yet (EVE-86): the overlay asks for the cargo. */
export interface LootPromptView {
  entryId: string;
  weather: string | null;
  tier: number | null;
  clearSeconds: number | null;
}

/** The overlay's cargo buttons in the Abyss (EVE-93). */
export interface AbyssCargoView {
  /** The cargo copied before going in, kept for the next run. */
  before: { items: number; savedAt: string } | null;
  /** The run that just ended alive, whose loot the "after" button saves. */
  after: { entryId: string; saved: boolean; items: number; withBefore: boolean } | null;
}

/** Main asks the settings window to open a tab; `run`: the Abyss log run whose loot to ask for. */
export interface SettingsNav {
  tab: 'abyss-log';
  run?: string;
}

/** The pasted fits and the stats of the active one (EVE-39, EVE-62). */
export interface FitPanelView {
  /** The fit engine loads its data once after start. */
  engine: 'loading' | 'ready' | 'error';
  engineError: string | null;
  /** With the hull's SDE type, group and faction for the Ship fit tree (EVE-82); null without the SDE. */
  saved: {
    id: string;
    name: string;
    shipName: string;
    savedAt: string;
    shipTypeId: number | null;
    shipGroup: string | null;
    shipFaction: string | null;
    source: 'paste' | 'esi' | 'ewb';
    /** ESI fittings: the character whose in-game fitting it is; EVE Workbench fits: "EVE Workbench". */
    owner: string | null;
  }[];
  /** The hull ESI reports the pilot in (EVE-65); `hasFit` false: no saved fit for it, so the checks are off. */
  flying: { shipName: string; shipTypeId: number; hasFit: boolean } | null;
  /** The overlay's quick ship select (EVE-81): the last used fits and the last pasted one. */
  quick: { id: string; name: string; shipName: string; shipTypeId: number | null }[];
  active: {
    id: string;
    source: 'paste' | 'esi' | 'ewb';
    savedAt: string;
    /** Null while the engine loads or when the stored text no longer parses (then `error`). */
    stats: FitStats | null;
    error: string | null;
    /** Lines of the paste that are not in the engine's data (modules the stats are missing). */
    unknownLines: string[];
    /** The fit's parts with the charges and drones in use (EVE-83). */
    parts: FitLoadoutView | null;
    /** The player changed charges or drones on this fit. */
    loadoutChanged: boolean;
  } | null;
}

export type WatcherStateView = 'starting' | 'watching' | 'dirMissing' | 'error' | 'stopped';

export interface CharacterView {
  name: string;
  characterId: number | null;
  file: string;
  /** EVE time of the last log entry (ISO), null if nothing since start. */
  lastEventAt: string | null;
  system: { name: string; security: number | null } | null;
}

export interface DiagnosticEvent {
  time: string;
  character: string;
  kind: string;
  text: string;
}

export interface AppViewModel {
  log: { state: WatcherStateView; dir: string; error: string | null; files: number };
  characters: CharacterView[];
  sde: {
    state: 'missing' | 'ready' | 'updating' | 'error';
    build: number | null;
    message: string | null;
  };
  kb: { encounters: number; issues: number };
  /** New app versions (GitHub releases, electron-updater). */
  appUpdate: {
    state: 'idle' | 'checking' | 'none' | 'available' | 'downloading' | 'ready' | 'error';
    current: string;
    version: string | null;
    percent: number | null;
    canInstall: boolean;
    error: string | null;
    checkedAt: number | null;
    releaseUrl: string;
  };
  updates: {
    auto: boolean;
    /** Look for new app versions. */
    app: boolean;
    running: boolean;
    sdeCheckedAt: string | null;
    wikiCheckedAt: string | null;
    lastMessage: string | null;
  };
  brief: Brief | null;
  pocket: number;
  /** Character the threats and combat stats belong to (most recently active). */
  activeCharacter: string | null;
  threats: ThreatView[];
  /** Built with the live combat cues (EWAR rows, Abyss order of fire); see core/buildFlags.ts. */
  liveCombat: boolean;
  messages: MessageView[];
  loot: LootAlertView[];
  combat: CombatView | null;
  /** Damage application hints for the targets of the ongoing fight, worst first (EVE-80). */
  application: ApplicationHint[];
  overlay: { clickThrough: boolean; searchOpen: boolean; minimized: boolean };
  fit: FitPanelView;
  /** The active fit against the selected encounter's damage; null without a fit, encounter or known damage. */
  fitCheck: FitSiteCheck | null;
  /** The Abyss panel while the active character is in Abyssal Deadspace (EVE-75). */
  abyss: AbyssView | null;
  /** Changes when a run is added to the Abyss log; the settings window then reloads it. */
  abyssLogVersion: number;
  esi: EsiView;
  ewb: EwbView;
  lootPrompt: LootPromptView | null;
  abyssCargo: AbyssCargoView;
  /** Player intel channels (EVE-98). */
  intel: IntelView;
  settings: Settings;
  diagnostics: {
    recent: DiagnosticEvent[];
    events: number;
    unknown: number;
    platform: { ozone: string; sessionType: string; desktop: string; electron: string; version: string };
    shortcutErrors: string[];
    /** How the overlay is layered (or why it could not be placed above fullscreen windows). */
    overlayLayer: string;
  };
}
