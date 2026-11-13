/**
 * Minimal per-character session tracking (first part of task 014): who is logging, where they are,
 * and a diagnostic tail of recent events. Location comes only from jump/undock lines, so it is unknown
 * until the first one is seen after start.
 */
import { describeEvent } from '../logs/describe';
import type { GameEvent, LogSessionHeader } from '../logs/events';
import type { CharacterView, DiagnosticEvent } from '../viewmodel';
import { CombatTracker } from './combat';

const RECENT_LIMIT = 60;

interface CharacterState {
  header: LogSessionHeader;
  lastEventAt: string | null;
  system: string | null;
  combat: CombatTracker;
  /** Wall-clock time when the latest event arrived, to estimate the current EVE time between lines. */
  wallAtLatest: number;
}

const newState = (header: LogSessionHeader): CharacterState => ({
  header,
  lastEventAt: null,
  system: null,
  combat: new CombatTracker(),
  wallAtLatest: 0,
});

export class SessionTracker {
  private readonly byFile = new Map<string, CharacterState>();
  private readonly recent: DiagnosticEvent[] = [];
  private events = 0;
  private unknown = 0;

  private securityOf: (system: string) => number | null = () => null;

  /** Security status lookup for system names (needs the SDE, which can appear or change later). */
  setSecurityLookup(fn: (system: string) => number | null): void {
    this.securityOf = fn;
  }

  addSession(h: LogSessionHeader): void {
    if (!this.byFile.has(h.file)) this.byFile.set(h.file, newState(h));
  }

  removeSession(h: LogSessionHeader): void {
    this.byFile.delete(h.file);
  }

  resetSession(h: LogSessionHeader): void {
    this.byFile.set(h.file, newState(h));
  }

  apply(h: LogSessionHeader, events: GameEvent[]): void {
    const st = this.byFile.get(h.file) ?? newState(h);
    this.byFile.set(h.file, st);
    if (events.length) st.wallAtLatest = Date.now();
    for (const e of events) {
      st.combat.apply(e);
      this.events++;
      if (e.kind === 'unknown') this.unknown++;
      st.lastEventAt = e.time;
      if (e.kind === 'systemJump') st.system = e.to;
      else if (e.kind === 'undock') st.system = e.system;
      this.recent.push({ time: e.time, character: h.character ?? '?', kind: e.kind, text: describeEvent(e) });
    }
    if (this.recent.length > RECENT_LIMIT) this.recent.splice(0, this.recent.length - RECENT_LIMIT);
  }

  /** Characters, most recently active first. Several files of one character collapse into the newest. */
  characters(): CharacterView[] {
    const byName = new Map<string, CharacterView>();
    const sorted = [...this.byFile.values()].sort((a, b) => a.header.file.localeCompare(b.header.file));
    for (const st of sorted) {
      const name = st.header.character ?? '?';
      const prev = byName.get(name);
      byName.set(name, {
        name,
        characterId: st.header.characterId,
        file: st.header.file,
        lastEventAt: st.lastEventAt ?? prev?.lastEventAt ?? null,
        system: st.system ? { name: st.system, security: this.securityOf(st.system) } : (prev?.system ?? null),
      });
    }
    return [...byName.values()].sort((a, b) => (b.lastEventAt ?? '').localeCompare(a.lastEventAt ?? ''));
  }

  /**
   * Combat state of the most recently active character, with the current EVE time estimated as
   * "latest log time + wall-clock time since it arrived" (so a replay keeps its own time base).
   */
  active(
    wallNow = Date.now(),
  ): { character: string; characterId: number | null; combat: CombatTracker; nowMs: number } | null {
    let best: CharacterState | null = null;
    for (const st of this.byFile.values()) {
      if (!st.combat.latestMs) continue;
      if (!best || st.wallAtLatest > best.wallAtLatest) best = st;
    }
    if (!best) return null;
    return {
      character: best.header.character ?? '?',
      characterId: best.header.characterId,
      combat: best.combat,
      nowMs: best.combat.latestMs + Math.max(0, wallNow - best.wallAtLatest),
    };
  }

  diagnostics(): { recent: DiagnosticEvent[]; events: number; unknown: number } {
    return { recent: [...this.recent].reverse(), events: this.events, unknown: this.unknown };
  }
}
