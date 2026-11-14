/**
 * What the overlay shows of the intel board (EVE-98/99): the reports within range, closest first, each weighted
 * by distance (pale yellow at the edge of the range → red at one jump), and the sound alerts. A system sounds once
 * per level: a notice when it comes within the notice range, a warning when it comes within the warning range,
 * whether the report or the pilot moved.
 */
import type { IntelSettings } from '../settings';
import type { IntelReport } from './board';
import type { IntelGraph } from './graph';
import type { IntelTag } from './parser';

export interface IntelShipView {
  name: string;
  /** Ship class, e.g. Interdictor. */
  cls: string | null;
}

export interface IntelPilotView {
  name: string;
  ship: IntelShipView | null;
}

export type IntelLevel = 'notice' | 'warning';

export interface IntelRowView {
  systemId: number;
  system: string;
  security: number | null;
  /** Jumps from the pilot's system; 0 = in the same system. */
  jumps: number;
  count: number | null;
  pilots: IntelPilotView[];
  /** Every ship reported; those of named pilots too. */
  ships: IntelShipView[];
  noVisual: boolean;
  tags: IntelTag[];
  /** When each tag was first said (EVE time, epoch ms). */
  tagMs: Partial<Record<IntelTag, number>>;
  /** ESS timer end (EVE time, epoch ms); exact when a report said the time, else at most this. */
  essEndMs: number | null;
  essExact: boolean;
  gate: string | null;
  firstMs: number;
  lastMs: number;
  messages: number;
  /** 0 at the edge of the range … 1 at one jump or in the system. */
  weight: number;
  level: IntelLevel | null;
}

/** A zKillboard kill nearby (EVE-100). */
export interface IntelKillView {
  killmailId: number;
  systemId: number;
  system: string;
  security: number | null;
  jumps: number;
  timeMs: number;
  victim: IntelShipView | null;
  attackers: number;
  /** Attacker ships, unique, most flown first. */
  attackerShips: IntelShipView[];
  value: number;
  weight: number;
  level: IntelLevel | null;
  /** The pilot's side: one of ours died (loss), ours were among the attackers (kill), or neither (null). */
  side: KillSide;
}

export type KillSide = 'loss' | 'kill' | null;

/** The pilot's corporation and alliance, from the public ESI affiliation. */
export interface Affiliation {
  corporationId: number;
  allianceId: number | null;
}

/** Whose kill it is from the pilot's side; a loss wins when ours are on both sides (an awox, a fight among blues). */
export function killSide(
  k: Pick<KillInput, 'victimCorp' | 'victimAlliance' | 'attackerCorps' | 'attackerAlliances'>,
  us: Affiliation | null,
): KillSide {
  if (!us) return null;
  const ours = (corp: number | null, alliance: number | null) =>
    corp === us.corporationId || (us.allianceId !== null && alliance === us.allianceId);
  if (ours(k.victimCorp, k.victimAlliance)) return 'loss';
  if (
    k.attackerCorps.includes(us.corporationId) ||
    (us.allianceId !== null && k.attackerAlliances.includes(us.allianceId))
  )
    return 'kill';
  return null;
}

export interface IntelView {
  /** off = no channel and no zKillboard; noData = no SDE index; noSystem = the pilot's system is not known yet. */
  state: 'off' | 'noData' | 'noSystem' | 'watching';
  channels: string[];
  origin: string | null;
  range: number;
  rows: IntelRowView[];
  /** The closest report got closer within the last minutes: someone may be coming. */
  approaching: boolean;
  /** Changes (seq) when a sound should play. */
  alert: { seq: number; level: IntelLevel } | null;
  /** EVE time of the last message on the intel channels. */
  lastMessageMs: number | null;
  /** Is the reading alive: chat log files followed, wall clock of the last line read. */
  feed: { files: number; lastReadMs: number | null };
  /** A test report is on the board (Settings → Intel → Test). */
  testing: boolean;
  /**
   * EVE-103: the destination set from the graph and Gridwise's own shortest gate path to it (origin first). The game
   * may route differently with its own preferences. Gone on arrival.
   */
  destination: { systemId: number; name: string; jumps: number; route: number[] } | null;
  /** Chat channels seen in the chat logs lately, for picking one in Settings. */
  knownChannels: string[];
  /** List or graph (EVE-102). */
  view: 'list' | 'graph';
  /** The systems around the pilot, in graph view. */
  graph: IntelGraph | null;
  /** zKillboard kills within range, newest first; empty while they are not shown (mode, channels not quiet). */
  kills: IntelKillView[];
  zkill: {
    mode: 'off' | 'quiet' | 'always';
    /** The channels said nothing for quietMin (or there is none): the kills show. */
    quiet: boolean;
    state: 'starting' | 'running' | 'blocked' | 'error' | 'stopped';
    received: number;
    lastError: string | null;
  };
}

export function intelWeight(jumps: number, range: number): number {
  if (jumps <= 1 || range <= 1) return 1;
  return Math.max(0, Math.min(1, (range - jumps) / (range - 1)));
}

export function intelLevel(jumps: number, s: Pick<IntelSettings, 'notice' | 'warning'>): IntelLevel | null {
  if (s.warning.on && jumps <= s.warning.jumps) return 'warning';
  if (s.notice.on && jumps <= s.notice.jumps) return 'notice';
  return null;
}

const RANK: Record<IntelLevel, number> = { notice: 1, warning: 2 };
/** Kills are second-hand: their tint is lighter than a live report at the same distance. */
const KILL_WEIGHT = 0.7;

export interface KillInput {
  killmailId: number;
  timeMs: number;
  systemId: number;
  victimShipTypeId: number | null;
  attackerShipTypeIds: number[];
  attackers: number;
  value: number;
  victimCorp: number | null;
  victimAlliance: number | null;
  attackerCorps: number[];
  attackerAlliances: number[];
}
const TREND_MS = 5 * 60_000;

/** Turns board entries into rows, and decides when to sound. One per pilot origin; keeps what already sounded. */
export class IntelAlerts {
  private readonly fired = new Map<number, number>();
  private readonly firedKills = new Map<number, number>();
  private seq = 0;
  private last: { seq: number; level: IntelLevel } | null = null;
  /** Closest distance over time, for the approaching hint. */
  private closest: { timeMs: number; jumps: number }[] = [];

  rows(
    reports: readonly IntelReport[],
    distance: (systemId: number) => number | null,
    security: (systemId: number) => number | null,
    s: IntelSettings,
    nowMs: number,
    shipClass: (ship: string) => string | null = () => null,
  ): { rows: IntelRowView[]; alert: { seq: number; level: IntelLevel } | null; approaching: boolean } {
    const rows: IntelRowView[] = [];
    for (const r of reports) {
      const jumps = distance(r.system.id);
      if (jumps === null || jumps > s.range) continue;
      rows.push({
        systemId: r.system.id,
        system: r.system.name,
        security: security(r.system.id),
        jumps,
        count: r.count,
        pilots: r.pilots.map((p) => ({ name: p.name, ship: p.ship ? { name: p.ship, cls: shipClass(p.ship) } : null })),
        ships: r.ships.map((x) => ({ name: x, cls: shipClass(x) })),
        noVisual: r.noVisual,
        tags: r.tags,
        tagMs: r.tagMs,
        essEndMs: r.essEndMs,
        essExact: r.essExact,
        gate: r.gate?.name ?? null,
        firstMs: r.firstMs,
        lastMs: r.lastMs,
        messages: r.messages,
        weight: intelWeight(jumps, s.range),
        level: intelLevel(jumps, s),
      });
    }
    rows.sort((a, b) => a.jumps - b.jumps || b.lastMs - a.lastMs);

    // Sound: the highest new level among the rows; a system that left the board may sound again later.
    const present = new Set(rows.map((r) => r.systemId));
    for (const id of this.fired.keys()) if (!present.has(id)) this.fired.delete(id);
    let loudest: IntelLevel | null = null;
    for (const r of rows) {
      if (!r.level || (this.fired.get(r.systemId) ?? 0) >= RANK[r.level]) continue;
      this.fired.set(r.systemId, RANK[r.level]);
      if (!loudest || RANK[r.level] > RANK[loudest]) loudest = r.level;
    }
    if (loudest) this.sound(loudest);

    const near = rows[0]?.jumps;
    this.closest = this.closest.filter((c) => nowMs - c.timeMs <= TREND_MS);
    if (near !== undefined && this.closest.at(-1)?.jumps !== near) this.closest.push({ timeMs: nowMs, jumps: near });
    const approaching = near !== undefined && this.closest.some((c) => c.jumps > near);
    return { rows, alert: this.last, approaching };
  }

  private sound(level: IntelLevel): void {
    this.last = { seq: ++this.seq, level };
  }

  /**
   * zKillboard kills within range as rows; each kill sounds once, at its level (call after rows()). With the kill
   * sound off they are still marked as heard, so turning it back on does not replay them.
   */
  kills(
    kills: readonly KillInput[],
    distance: (systemId: number) => number | null,
    system: (systemId: number) => { name: string; security: number | null } | null,
    ship: (typeId: number) => IntelShipView | null,
    s: IntelSettings,
    us: Affiliation | null = null,
  ): { kills: IntelKillView[]; alert: { seq: number; level: IntelLevel } | null } {
    const out: IntelKillView[] = [];
    for (const k of kills) {
      const jumps = distance(k.systemId);
      const sys = system(k.systemId);
      if (jumps === null || jumps > s.range || !sys) continue;
      const counts = new Map<number, number>();
      for (const t of k.attackerShipTypeIds) counts.set(t, (counts.get(t) ?? 0) + 1);
      const attackerShips = [...counts]
        .sort((a, b) => b[1] - a[1])
        .map(([t]) => ship(t))
        .filter((x): x is IntelShipView => !!x);
      out.push({
        killmailId: k.killmailId,
        systemId: k.systemId,
        system: sys.name,
        security: sys.security,
        jumps,
        timeMs: k.timeMs,
        victim: k.victimShipTypeId !== null ? ship(k.victimShipTypeId) : null,
        attackers: k.attackers,
        attackerShips,
        value: k.value,
        weight: intelWeight(jumps, s.range) * KILL_WEIGHT,
        level: intelLevel(jumps, s),
        side: killSide(k, us),
      });
    }
    const present = new Set(out.map((k) => k.killmailId));
    for (const id of this.firedKills.keys()) if (!present.has(id)) this.firedKills.delete(id);
    let loudest: IntelLevel | null = null;
    for (const k of out) {
      if (!k.level || this.firedKills.has(k.killmailId)) continue;
      this.firedKills.set(k.killmailId, RANK[k.level]);
      if (!loudest || RANK[k.level] > RANK[loudest]) loudest = k.level;
    }
    if (loudest && s.zkill.sound) this.sound(loudest);
    out.sort((a, b) => b.timeMs - a.timeMs);
    return { kills: out, alert: this.last };
  }

  /**
   * The pilot moved: the trend starts over (flying towards a report is not "they are coming"). What already sounded
   * stays, so travelling does not beep at every gate; coming within the warning range still sounds the warning.
   */
  resetTrend(): void {
    this.closest = [];
  }
}
