/**
 * Normalized Game Log events (task 003). Shapes are derived from real logs, see docs/log-format.md.
 * Only facts present in the line are recorded; nothing is inferred at this level.
 */

/** Log category as written in parentheses, e.g. `(combat)`. `None` is a literal category used by the client. */
export type LogCategory =
  'combat' | 'notify' | 'bounty' | 'mining' | 'None' | 'question' | 'info' | 'hint' | 'warning' | (string & {});

export type HitQuality = 'Wrecks' | 'Smashes' | 'Penetrates' | 'Hits' | 'Glances Off' | 'Grazes';

export const HIT_QUALITIES: readonly HitQuality[] = [
  'Wrecks',
  'Smashes',
  'Penetrates',
  'Hits',
  'Glances Off',
  'Grazes',
];

/** Where an event came from, for diagnostics and replay. */
export interface EventSource {
  /** Log file name (not the full path). */
  file: string;
  /** Byte offset of the entry's first line in the file. */
  offset: number;
  /** 1-based line number of the entry's first line. */
  line: number;
}

interface EventBase {
  /** EVE time (UTC) as ISO string. */
  time: string;
  /** Same instant as epoch milliseconds. */
  timeMs: number;
  category: LogCategory;
  /** Original entry text without the timestamp prefix; continuation lines joined with `\n`. */
  raw: string;
  source: EventSource;
}

/** Our damage landing on something. `weapon` is the ammo, weapon or drone type the log names. */
export interface DamageDealtEvent extends EventBase {
  kind: 'damageDealt';
  target: string;
  amount: number;
  weapon: string | null;
  quality: HitQuality | null;
}

/** Damage we take. `weapon` is the NPC ammo/weapon when the log names it (e.g. `Scourge Rocket`). */
export interface DamageTakenEvent extends EventBase {
  kind: 'damageTaken';
  attacker: string;
  amount: number;
  weapon: string | null;
  quality: HitQuality | null;
}

/** `<Attacker> misses you completely[ - <weapon>]` (the weapon is named for some attackers, e.g. players) */
export interface MissTakenEvent extends EventBase {
  kind: 'missTaken';
  attacker: string;
  weapon: string | null;
}

/** `Your [group of] <weapon> misses <target> completely - <weapon>` */
export interface MissDealtEvent extends EventBase {
  kind: 'missDealt';
  target: string;
  weapon: string | null;
  grouped: boolean;
}

export type EwarType = 'warpScramble' | 'warpDisruption' | 'ecm';

/**
 * Electronic warfare the log reports explicitly. Usually aimed at us, but scram/point attempts against
 * our drones and nearby pilots are logged too (`… to <name> <ship>`).
 */
export interface EwarEvent extends EventBase {
  kind: 'ewar';
  ewar: EwarType;
  attacker: string;
  /** Null when the target is us. */
  victim: string | null;
  /** Ship or drone type of the victim when it is not us. */
  victimShip: string | null;
}

/** `N GJ energy neutralized <Source> - <Source>`: an NPC neutralizes our capacitor. */
export interface EnergyNeutralizedEvent extends EventBase {
  kind: 'energyNeutralized';
  attacker: string;
  amountGJ: number;
  module: string | null;
}

/** `+N GJ energy drained from <Target> - <Module>`: our nosferatu. */
export interface EnergyDrainedEvent extends EventBase {
  kind: 'energyDrained';
  target: string;
  amountGJ: number;
  module: string | null;
}

/**
 * `N remote armor repaired to|by <Pilot> [CORP] <Ship> - <Module>` and `… remote shield boosted …` (EVE-101):
 * repairs between players in a fleet. Read so the log is understood; no alerts come from them (product direction:
 * quiet around player combat).
 */
export interface RemoteRepairEvent extends EventBase {
  kind: 'remoteRepair';
  layer: 'armor' | 'shield' | 'hull';
  /** to = we repaired them, by = they repaired us. */
  direction: 'to' | 'by';
  other: string;
  corp: string | null;
  ship: string | null;
  amount: number;
  module: string | null;
}

/**
 * `Warp disruption attempt from <NPC> to <NPC>` (EVE-101): NPCs fighting each other, e.g. faction warfare. Not an
 * attack on us or our drones, so it starts no fight.
 */
export interface EwarBetweenEvent extends EventBase {
  kind: 'ewarBetween';
  ewar: 'warpScramble' | 'warpDisruption';
  attacker: string;
  victim: string;
}

/** `-N GJ energy drained to <Source> - <Module>` (EVE-101): a nosferatu on us takes capacitor. */
export interface EnergyLeechedEvent extends EventBase {
  kind: 'energyLeeched';
  by: string;
  amountGJ: number;
  module: string | null;
}

/** `N ISK added to next bounty payout`. The log does not say which NPC it was for. */
export interface BountyEvent extends EventBase {
  kind: 'bounty';
  isk: number;
}

/** `Loading the <charge> into the <module>; this will take approximately N seconds.` */
export interface ReloadEvent extends EventBase {
  kind: 'reload';
  charge: string;
  module: string;
  seconds: number | null;
}

/** `<module> has run out of charges` */
export interface OutOfChargesEvent extends EventBase {
  kind: 'outOfCharges';
  module: string;
}

/** `<module> has no suitable targets within range.` */
export interface NoTargetInRangeEvent extends EventBase {
  kind: 'noTargetInRange';
  module: string;
}

/**
 * Our module or charge stopped because its target disappeared. This is the closest thing to a kill event,
 * but it does not name the target and can also mean warp-out or despawn.
 */
export interface TargetGoneEvent extends EventBase {
  kind: 'targetGone';
  /** The module/charge that deactivated, or null for `Targeting attempt failed …`. */
  item: string | null;
}

/** `Jumping from <A> to <B>` */
export interface SystemJumpEvent extends EventBase {
  kind: 'systemJump';
  from: string;
  to: string;
}

/** `Undocking from <station> to <system> solar system.` */
export interface UndockEvent extends EventBase {
  kind: 'undock';
  station: string;
  system: string;
}

/** `This gate is locked! …` (acceleration gate requirement message). */
export interface GateLockedEvent extends EventBase {
  kind: 'gateLocked';
  message: string;
}

export interface MiningEvent extends EventBase {
  kind: 'mining';
  ore: string | null;
  units: number;
  /** `critical` = critical success bonus, `residue` = extra units depleted as residue. */
  variant: 'normal' | 'critical' | 'residue';
}

/** Any entry we do not (yet) understand. Kept so nothing is silently dropped. */
export interface UnknownEvent extends EventBase {
  kind: 'unknown';
  /** Markup-stripped text. */
  text: string;
}

export type GameEvent =
  | DamageDealtEvent
  | DamageTakenEvent
  | MissTakenEvent
  | MissDealtEvent
  | EwarEvent
  | EnergyNeutralizedEvent
  | EnergyDrainedEvent
  | RemoteRepairEvent
  | EwarBetweenEvent
  | EnergyLeechedEvent
  | BountyEvent
  | ReloadEvent
  | OutOfChargesEvent
  | NoTargetInRangeEvent
  | TargetGoneEvent
  | SystemJumpEvent
  | UndockEvent
  | GateLockedEvent
  | MiningEvent
  | UnknownEvent;

export type GameEventKind = GameEvent['kind'];

/** Parsed file header. One log file = one client session of one character. */
export interface LogSessionHeader {
  file: string;
  /** Null for login-screen sessions, which have no `Listener:` line. */
  character: string | null;
  /** From the file name suffix `_<characterId>.txt`, null if absent. */
  characterId: number | null;
  /** `Session Started:` as ISO (UTC). */
  startedAt: string | null;
}
