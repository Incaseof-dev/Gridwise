/**
 * Abyss runs per character (EVE-75): entered when Local switches to "Unknown", over when it switches back. Without
 * chat logs, abyssal NPCs in the fight stand in for the entry, and the timer is only an estimate.
 */
import { ABYSS_DURATION_MS } from './types';

export interface AbyssRun {
  enteredMs: number;
  /** Where the filament was activated (and where the last gate returns to). */
  origin: string | null;
  /** True when the entry time is guessed from the first abyssal NPC, not read from Local. */
  approximate: boolean;
  /** NPC names seen since the entry, for the tier (each Overmind belongs to one tier) and the room. */
  seen: Set<string>;
  /** What each NPC did during the run, for the run log; keyed by fight start and name. */
  npcs: Map<string, RunNpc>;
}

/** An NPC of the run as the combat log saw it (wall-clock times). */
export interface RunNpc {
  name: string;
  firstSeenMs: number;
  lastSeenMs: number;
  damageToUs: number;
  damageByUs: number;
  ewar: string[];
}

/**
 * A run that is over: Local left the Abyss, or the 20 minutes ran out without an exit line. Local coming back in
 * another system than the origin means the ship and pod died: the clone woke up at its home station.
 */
export interface FinishedRun {
  characterId: number | null;
  run: AbyssRun;
  exitedMs: number | null;
  /** The system Local switched to on the exit. */
  exitSystem: string | null;
  outcome: 'completed' | 'lost' | 'noExit';
}

/** After the 20 minutes the ship is gone; a little slack for late log lines. */
const OVER_MS = ABYSS_DURATION_MS + 60_000;

interface CharacterLocal {
  system: string;
  timeMs: number;
  previous: string | null;
}

export class AbyssRuns {
  private readonly local = new Map<number | null, CharacterLocal>();
  private readonly runs = new Map<number | null, AbyssRun>();
  private finished: FinishedRun[] = [];

  private finish(characterId: number | null, exitedMs: number | null, exitSystem: string | null = null): void {
    const run = this.runs.get(characterId);
    if (!run) return;
    this.runs.delete(characterId);
    const outcome =
      exitedMs === null ? 'noExit' : run.origin && exitSystem && exitSystem !== run.origin ? 'lost' : 'completed';
    this.finished.push({ characterId, run, exitedMs, exitSystem, outcome });
  }

  /** Runs that ended since the last call, oldest first. */
  takeFinished(): FinishedRun[] {
    const out = this.finished;
    this.finished = [];
    return out;
  }

  /** Records the run's NPCs of one fight (`fightKey` tells fights apart: the same name can come back later). */
  record(characterId: number | null, fightKey: number, npcs: RunNpc[]): void {
    const run = this.runs.get(characterId);
    if (!run) return;
    for (const n of npcs) if (n.lastSeenMs >= run.enteredMs - 5000) run.npcs.set(`${fightKey}|${n.name}`, n);
  }

  /** A Local channel change; `abyss` = the new system is the Abyss. */
  onLocal(characterId: number | null, timeMs: number, system: string, abyss: boolean): void {
    const prev = this.local.get(characterId);
    if (prev && prev.timeMs > timeMs) return;
    // An estimated run (no Local yet) gives way once Local speaks: it tells entry and exit itself.
    if (!prev && this.runs.get(characterId)?.approximate) this.runs.delete(characterId);
    this.local.set(characterId, { system, timeMs, previous: prev?.system ?? null });
    if (abyss) {
      const run = this.runs.get(characterId);
      // A second "Unknown" line within the same run (reconnect) keeps the first entry.
      if (!run || run.approximate || timeMs - run.enteredMs > OVER_MS)
        this.runs.set(characterId, {
          enteredMs: timeMs,
          origin: prev?.system ?? null,
          approximate: false,
          seen: new Set(run && timeMs - run.enteredMs <= OVER_MS ? run.seen : []),
          npcs: new Map(run && timeMs - run.enteredMs <= OVER_MS ? run.npcs : []),
        });
    } else this.finish(characterId, timeMs, system);
  }

  /** Whether any character is in a run now (the overlay then ticks every second for the timer). */
  any(nowMs: number): boolean {
    for (const [id, r] of [...this.runs]) if (nowMs - r.enteredMs > OVER_MS) this.finish(id, null);
    return this.runs.size > 0;
  }

  /** The character whose run started last, for when no character has logged combat yet. */
  latestCharacter(nowMs: number): number | null {
    let best: [number | null, number] | null = null;
    for (const [id, r] of this.runs)
      if (nowMs - r.enteredMs <= OVER_MS && (!best || r.enteredMs > best[1])) best = [id, r.enteredMs];
    return best?.[0] ?? null;
  }

  /** Whether Local has told anything about this character, i.e. chat logs are there to rely on. */
  hasLocal(characterId: number | null): boolean {
    return this.local.has(characterId);
  }

  /**
   * The current run of a character at `nowMs`. `abyssalNpcs` are the abyssal NPCs of the current fight (name and
   * first sighting); they start an estimated run when there is no Local log.
   */
  current(
    characterId: number | null,
    nowMs: number,
    abyssalNpcs: { name: string; firstSeenMs: number }[] = [],
  ): AbyssRun | null {
    let run = this.runs.get(characterId) ?? null;
    if (!run && !this.hasLocal(characterId) && abyssalNpcs.length) {
      run = {
        enteredMs: Math.min(...abyssalNpcs.map((n) => n.firstSeenMs)),
        origin: null,
        approximate: true,
        seen: new Set(),
        npcs: new Map(),
      };
      this.runs.set(characterId, run);
    }
    if (!run) return null;
    if (nowMs - run.enteredMs > OVER_MS) {
      this.finish(characterId, null);
      return null;
    }
    for (const n of abyssalNpcs) if (n.firstSeenMs >= run.enteredMs - 5000) run.seen.add(n.name);
    return run;
  }
}
