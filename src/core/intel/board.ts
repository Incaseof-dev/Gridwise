/**
 * The live intel picture (EVE-97): one entry per system with hostiles reported, built from parsed messages.
 * Follow-ups ("Sabre", "clr", "+3") join the same sender's report of the last two minutes; ships or a count sent
 * before the system ("Loki*  Malediction*" then "SH1-6P*") wait for it. `clr` or the timeout removes an entry.
 *
 * Senders link follow-ups; the hostiles named are shown (decision EVE-D9). All of it lives in memory only.
 */
import type { IntelLine, IntelPilot, IntelSystem, IntelTag, ParsedIntel } from './parser';

export interface IntelReport {
  system: IntelSystem;
  /** EVE time (UTC) of the first and the latest message, epoch ms. */
  firstMs: number;
  lastMs: number;
  ships: string[];
  /** Latest explicit count. */
  count: number | null;
  /** Hostiles named in the reports about this system, with their ship when known. */
  pilots: IntelPilot[];
  noVisual: boolean;
  tags: IntelTag[];
  /** When each tag was first said about this system (EVE time, epoch ms): the ESS timer counts from it. */
  tagMs: Partial<Record<IntelTag, number>>;
  /**
   * When the ESS timer runs out (EVE time, epoch ms): from a time said in a report ("5m" → its time + 5 minutes),
   * else the full timer from the first ESS mention, and then only an estimate (`essExact` false).
   */
  essEndMs: number | null;
  essExact: boolean;
  /** The gate they were seen on, when reported as "<system> gate". */
  gate: IntelSystem | null;
  /** Messages merged into this entry. */
  messages: number;
  channel: string;
}

export interface IntelBoardOptions {
  followUpMs?: number;
  expireMs?: number;
}

interface Fragment {
  timeMs: number;
  ships: string[];
  pilots: IntelPilot[];
  count: number | null;
  tags: IntelTag[];
}

const DEDUPE_KEEP = 500;
/** The attacker's ESS timer starts at 6 minutes. */
export const ESS_TIMER_MS = 6 * 60_000;
/** Names kept per system; a big fleet is a number, not a list. */
const MAX_PILOTS = 30;

export class IntelBoard {
  private readonly reports = new Map<number, IntelReport>();
  private readonly lastBySender = new Map<string, { timeMs: number; systems: number[] }>();
  private readonly pending = new Map<string, Fragment>();
  private readonly seen: string[] = [];
  private readonly seenSet = new Set<string>();
  private readonly followUpMs: number;
  expireMs: number;
  /** EVE time of the last message on any intel channel (for the zKillboard fallback, EVE-100). */
  lastMessageMs: number | null = null;

  constructor(opts: IntelBoardOptions = {}) {
    this.followUpMs = opts.followUpMs ?? 120_000;
    this.expireMs = opts.expireMs ?? 10 * 60_000;
  }

  /** Adds one message. Returns true when the picture changed. */
  add(line: IntelLine, p: ParsedIntel, channel: string): boolean {
    // The same channel open on two characters writes every line twice.
    const key = `${channel}|${line.timeMs}|${line.sender}|${line.text}`;
    if (this.seenSet.has(key)) return false;
    this.seenSet.add(key);
    this.seen.push(key);
    if (this.seen.length > DEDUPE_KEEP) this.seenSet.delete(this.seen.shift()!);
    this.lastMessageMs = Math.max(this.lastMessageMs ?? 0, line.timeMs);

    // A kill line names the victim, which is not a hostile ship.
    const kill = p.tags.includes('kill');
    const ships = kill ? [] : p.ships;
    const pilots = kill ? [] : p.pilots;
    const hasInfo =
      ships.length > 0 || p.count !== null || p.clear || p.noVisual || p.tags.length > 0 || p.timerSec !== null;

    if (p.systems.length) {
      const ids = p.systems.map((s) => s.id);
      this.lastBySender.set(line.sender, { timeMs: line.timeMs, systems: ids });
      if (p.clear) {
        let changed = false;
        for (const id of ids) changed = this.reports.delete(id) || changed;
        return changed;
      }
      const frag = this.takePending(line.sender, line.timeMs);
      for (const s of p.systems)
        this.merge(s, line.timeMs, channel, {
          ships: [...ships, ...(ships.length ? [] : (frag?.ships ?? []))],
          count: p.count ?? frag?.count ?? null,
          pilots: [...pilots, ...(frag?.pilots ?? [])],
          noVisual: p.noVisual,
          tags: [...p.tags, ...(frag?.tags ?? [])],
          gate: p.gate,
          timerSec: p.timerSec,
        });
      return true;
    }

    if (!hasInfo) return false;
    const last = this.lastBySender.get(line.sender);
    if (last && line.timeMs - last.timeMs <= this.followUpMs) {
      if (p.clear) {
        let changed = false;
        for (const id of last.systems) changed = this.reports.delete(id) || changed;
        return changed;
      }
      let changed = false;
      for (const id of last.systems) {
        const r = this.reports.get(id);
        if (!r) continue;
        this.merge(r.system, line.timeMs, channel, {
          ships,
          count: p.count,
          pilots,
          noVisual: p.noVisual,
          tags: p.tags,
          gate: p.gate,
          timerSec: p.timerSec,
        });
        changed = true;
      }
      return changed;
    }
    if (ships.length || p.count !== null)
      this.pending.set(line.sender, { timeMs: line.timeMs, ships, pilots, count: p.count, tags: p.tags });
    return false;
  }

  /** Active entries, newest first; expired ones are dropped. */
  active(nowMs: number): IntelReport[] {
    for (const [id, r] of this.reports) if (nowMs - r.lastMs > this.expireMs) this.reports.delete(id);
    return [...this.reports.values()].sort((a, b) => b.lastMs - a.lastMs);
  }

  /** The player cleared a system by hand: its report goes; a new message about it brings it back. */
  remove(systemId: number): boolean {
    return this.reports.delete(systemId);
  }

  clear(): void {
    this.reports.clear();
    this.lastBySender.clear();
    this.pending.clear();
  }

  private takePending(sender: string, timeMs: number): Fragment | null {
    const f = this.pending.get(sender);
    this.pending.delete(sender);
    return f && timeMs - f.timeMs <= this.followUpMs ? f : null;
  }

  private merge(
    system: IntelSystem,
    timeMs: number,
    channel: string,
    m: Pick<IntelReport, 'ships' | 'count' | 'pilots' | 'noVisual' | 'tags' | 'gate'> & { timerSec: number | null },
  ): void {
    const r = this.reports.get(system.id);
    if (!r) {
      this.reports.set(system.id, {
        system,
        firstMs: timeMs,
        lastMs: timeMs,
        ships: [...new Set(m.ships)],
        count: m.count,
        pilots: mergePilots([], m.pilots),
        noVisual: m.noVisual,
        tags: [...new Set(m.tags)],
        tagMs: Object.fromEntries(m.tags.map((t) => [t, timeMs])),
        essEndMs: null,
        essExact: false,
        gate: m.gate,
        messages: 1,
        channel,
      });
      this.essTimer(this.reports.get(system.id)!, timeMs, m.timerSec);
      return;
    }
    r.lastMs = Math.max(r.lastMs, timeMs);
    for (const s of m.ships) if (!r.ships.includes(s)) r.ships.push(s);
    if (m.count !== null) r.count = m.count;
    r.pilots = mergePilots(r.pilots, m.pilots);
    // A newer "nv" says nothing about ships already seen; a newer report with ships means a visual again.
    r.noVisual = m.ships.length ? false : m.noVisual || r.noVisual;
    for (const t of m.tags)
      if (!r.tags.includes(t)) {
        r.tags.push(t);
        r.tagMs[t] = timeMs;
      }
    if (m.gate) r.gate = m.gate;
    r.messages++;
    r.channel = channel;
    this.essTimer(r, timeMs, m.timerSec);
  }

  /** A time said about an ESS sets its timer; without one, the full timer runs from the first mention. */
  private essTimer(r: IntelReport, timeMs: number, timerSec: number | null): void {
    if (!r.tags.includes('ess')) return;
    if (timerSec !== null) {
      r.essEndMs = timeMs + timerSec * 1000;
      r.essExact = true;
    } else if (r.essEndMs === null) r.essEndMs = (r.tagMs.ess ?? timeMs) + ESS_TIMER_MS;
  }
}

/** Adds names not there yet (case aside); a ship given later fills in. Newest names first beyond the cap. */
function mergePilots(have: readonly IntelPilot[], add: readonly IntelPilot[]): IntelPilot[] {
  const out = have.map((p) => ({ ...p }));
  for (const p of add) {
    const known = out.find((x) => x.name.toUpperCase() === p.name.toUpperCase());
    if (known) known.ship = p.ship ?? known.ship;
    else out.push({ ...p });
  }
  return out.slice(-MAX_PILOTS);
}
