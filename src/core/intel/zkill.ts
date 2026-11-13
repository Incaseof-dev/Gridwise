/**
 * zKillboard's live killmail feed, R2Z2 (EVE-100): the second level of intel, for when the intel channel is quiet.
 * https://zkillboard.com/api/docs/ — start at `ephemeral/sequence.json`, then fetch `ephemeral/<n>.json` one by
 * one. A 404 means "not there yet": wait at least 6 s. At most 15 requests a second per IP (we stay near 10); a
 * 403 means we were blocked for about an hour. A descriptive User-Agent is required.
 *
 * NPC kills are dropped. Pilot names are not in the killmail (only ids), and none are looked up.
 */
import { EventEmitter } from 'node:events';

export const R2Z2_BASE = 'https://r2z2.zkillboard.com/ephemeral';
export const ZKILL_USER_AGENT =
  'gridwise/1.0 (passive EVE PvE companion, intel; https://github.com/Incaseof-dev/Gridwise)';

export interface ZkillKill {
  killmailId: number;
  /** killmail_time, epoch ms. */
  timeMs: number;
  systemId: number;
  victimShipTypeId: number | null;
  /** Ship type ids of the attacking pilots that flew one (NPCs left out), as listed. */
  attackerShipTypeIds: number[];
  /** Attacking pilots. */
  attackers: number;
  /** ISK, zKillboard's estimate. */
  value: number;
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | null => (typeof v === 'object' && v !== null ? (v as Json) : null);
const int = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** One R2Z2 package → a kill; null for NPC kills and anything malformed. */
export function parseR2z2(pkg: unknown): ZkillKill | null {
  const p = obj(pkg);
  const esi = obj(p?.esi);
  const zkb = obj(p?.zkb);
  if (!p || !esi || !zkb || zkb.npc === true) return null;
  const killmailId = int(p.killmail_id) ?? int(esi.killmail_id);
  const systemId = int(esi.solar_system_id);
  const timeMs = typeof esi.killmail_time === 'string' ? Date.parse(esi.killmail_time) : NaN;
  if (killmailId === null || systemId === null || !Number.isFinite(timeMs)) return null;
  const attackers = Array.isArray(esi.attackers) ? esi.attackers.map(obj).filter((a): a is Json => !!a) : [];
  // NPCs on the killmail (faction police, rats) have no character: only pilots count.
  const players = attackers.filter((a) => int(a.character_id) !== null);
  return {
    killmailId,
    timeMs,
    systemId,
    victimShipTypeId: int(obj(esi.victim)?.ship_type_id),
    attackerShipTypeIds: players.map((a) => int(a.ship_type_id)).filter((x): x is number => x !== null),
    attackers: players.length,
    value: int(zkb.totalValue) ?? 0,
  };
}

export type ZkillState = 'starting' | 'running' | 'blocked' | 'error' | 'stopped';

export interface ZkillStatus {
  state: ZkillState;
  /** Kills received (NPC kills not counted). */
  kills: number;
  lastError: string | null;
}

export interface ZkillFeedOptions {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** After a found killmail (keeps us near 10 requests a second). */
  stepMs?: number;
  /** After a 404: the next one is not out yet. */
  waitMs?: number;
  /** After an error other than 404. */
  errorMs?: number;
  /** After a 403: blocked for about an hour. */
  blockedMs?: number;
}

/** Consecutive 404s after which the sequence pointer is read again (in case numbers were skipped). */
const RESYNC_AFTER = 20;

export class ZkillFeed extends EventEmitter<{ kill: [ZkillKill]; status: [ZkillStatus] }> {
  private running = false;
  private seq: number | null = null;
  readonly status: ZkillStatus = { state: 'stopped', kills: 0, lastError: null };
  private readonly f: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private wake: (() => void) | null = null;

  constructor(private readonly opts: ZkillFeedOptions = {}) {
    super();
    this.f = opts.fetch ?? fetch;
    this.sleep =
      opts.sleep ??
      ((ms) =>
        new Promise((r) => {
          const t = setTimeout(r, ms);
          this.wake = () => {
            clearTimeout(t);
            r();
          };
        }));
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.setState('starting');
    void this.loop();
  }

  stop(): void {
    this.running = false;
    this.wake?.();
    this.setState('stopped');
  }

  private setState(state: ZkillState, error: string | null = null): void {
    this.status.state = state;
    if (error !== null) this.status.lastError = error;
    this.emit('status', { ...this.status });
  }

  private async get(url: string): Promise<{ status: number; body: unknown }> {
    const res = await this.f(url, { headers: { 'User-Agent': ZKILL_USER_AGENT, 'Accept-Encoding': 'gzip' } });
    return { status: res.status, body: res.status === 200 ? await res.json() : null };
  }

  private async pointer(): Promise<number | null> {
    const r = await this.get(`${R2Z2_BASE}/sequence.json`);
    return r.status === 200 ? int(obj(r.body)?.sequence) : null;
  }

  /** Runs until stop(). Exposed for tests through start(); one iteration per request. */
  private async loop(): Promise<void> {
    let misses = 0;
    while (this.running) {
      try {
        if (this.seq === null) {
          this.seq = await this.pointer();
          if (this.seq === null) throw new Error('no sequence pointer');
          this.setState('running');
        }
        const r = await this.get(`${R2Z2_BASE}/${this.seq}.json`);
        if (!this.running) break;
        if (r.status === 200) {
          misses = 0;
          this.seq++;
          const kill = parseR2z2(r.body);
          if (kill) {
            this.status.kills++;
            this.emit('kill', kill);
          }
          if (this.status.state !== 'running') this.setState('running');
          await this.sleep(this.opts.stepMs ?? 100);
        } else if (r.status === 404) {
          if (++misses >= RESYNC_AFTER) {
            misses = 0;
            const p = await this.pointer();
            // Numbers can be skipped; the pointer trails the newest by up to ~51.
            if (p !== null && p > this.seq + 60) this.seq = p;
          }
          await this.sleep(this.opts.waitMs ?? 6000);
        } else if (r.status === 403) {
          this.setState('blocked', 'zKillboard answered 403 (rate limit): waiting an hour');
          await this.sleep(this.opts.blockedMs ?? 3600_000);
        } else {
          this.setState('error', `zKillboard answered ${r.status}`);
          await this.sleep(this.opts.errorMs ?? 30_000);
        }
      } catch (err) {
        if (!this.running) break;
        this.setState('error', String(err instanceof Error ? err.message : err));
        await this.sleep(this.opts.errorMs ?? 30_000);
      }
    }
  }
}

/** Kills of the last minutes, for the intel view. */
export class KillBoard {
  private kills: ZkillKill[] = [];
  private readonly ids = new Set<number>();

  constructor(public keepMs = 15 * 60_000) {}

  add(k: ZkillKill, nowMs: number): boolean {
    if (this.ids.has(k.killmailId) || nowMs - k.timeMs > this.keepMs) return false;
    this.ids.add(k.killmailId);
    this.kills.push(k);
    return true;
  }

  /** The player cleared the system: its kills so far are not shown again (the ids stay, so they do not return). */
  removeSystem(systemId: number): boolean {
    const before = this.kills.length;
    this.kills = this.kills.filter((k) => k.systemId !== systemId);
    return this.kills.length !== before;
  }

  active(nowMs: number): ZkillKill[] {
    this.kills = this.kills.filter((k) => nowMs - k.timeMs <= this.keepMs);
    if (this.ids.size > this.kills.length * 2 + 1000) {
      this.ids.clear();
      for (const k of this.kills) this.ids.add(k.killmailId);
    }
    return [...this.kills].sort((a, b) => b.timeMs - a.timeMs);
  }
}
