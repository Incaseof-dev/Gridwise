/**
 * Game Log parsing (task 010): raw lines → log entries → GameEvents.
 * Format reference: docs/log-format.md. Names are taken from `<b>…</b>` markup where available,
 * so names containing " - " survive; the remaining markup is stripped.
 */
import {
  HIT_QUALITIES,
  type EventSource,
  type EwarType,
  type GameEvent,
  type HitQuality,
  type LogCategory,
  type LogSessionHeader,
} from './events';

/** One timestamped log entry, possibly spanning several physical lines. */
export interface LogEntry {
  time: string;
  timeMs: number;
  category: LogCategory;
  /** Body with markup, continuation lines joined with `\n`. */
  body: string;
  source: EventSource;
}

const ENTRY_RE = /^\[ (\d{4})\.(\d{2})\.(\d{2}) (\d{2}):(\d{2}):(\d{2}) \] \(([^)]*)\) ?(.*)$/;

export function parseEveTime(text: string): number | null {
  const m = /^(\d{4})\.(\d{2})\.(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(text.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m.map(Number) as number[];
  return Date.UTC(y!, mo! - 1, d!, h!, mi!, s!);
}

/**
 * Groups physical lines into entries. A line without a `[ timestamp ]` prefix continues the previous entry;
 * lines before the first entry (the file header) are ignored. The last entry is held back until the next one starts
 * or `flush()` is called, because a continuation line may still follow.
 */
export class EntryAssembler {
  private pending: LogEntry | null = null;

  constructor(private readonly file: string) {}

  push(line: string, offset: number, lineNo: number): LogEntry[] {
    // Some lines end in "\r\r\n". A carriage return never carries meaning, and `.` in the regexes does not match it.
    const text = line.replace(/\r/g, '');
    const m = ENTRY_RE.exec(text);
    if (!m) {
      if (this.pending && text.length > 0) this.pending.body += '\n' + text;
      return [];
    }
    const [, y, mo, d, h, mi, s, category, body] = m;
    const timeMs = Date.UTC(+y!, +mo! - 1, +d!, +h!, +mi!, +s!);
    const done = this.flush();
    this.pending = {
      time: new Date(timeMs).toISOString(),
      timeMs,
      category: category!,
      body: body!,
      source: { file: this.file, offset, line: lineNo },
    };
    return done;
  }

  flush(): LogEntry[] {
    const done = this.pending;
    this.pending = null;
    return done ? [done] : [];
  }
}

const FILE_NAME_RE = /^(\d{8})_(\d{6})(?:_(\d+))?\.txt$/;

/** Parses the header block at the top of a Gamelog file. `head` may contain more than the header. */
export function parseHeader(file: string, head: string): LogSessionHeader {
  const idMatch = FILE_NAME_RE.exec(file);
  const listener = /^\s*Listener:\s*(.+?)\s*$/m.exec(head);
  const started = /^\s*Session Started:\s*(.+?)\s*$/m.exec(head);
  const startedMs = started ? parseEveTime(started[1]!) : null;
  return {
    file,
    character: listener ? listener[1]! : null,
    characterId: idMatch?.[3] ? Number(idMatch[3]) : null,
    startedAt: startedMs === null ? null : new Date(startedMs).toISOString(),
  };
}

export function isGamelogFileName(file: string): boolean {
  return FILE_NAME_RE.test(file);
}

export function stripMarkup(s: string): string {
  return s.replace(/<[^>]*>/g, '');
}

function num(s: string): number {
  return Number(s.replace(/[,+\s]|GJ|ISK/g, ''));
}

/** Contents of all `<b>…</b>` segments, markup stripped and trimmed. */
function bolds(body: string): string[] {
  return [...body.matchAll(/<b>(.*?)<\/b>/g)].map((m) => stripMarkup(m[1]!).trim());
}

/** Text after the last `</b>`, markup stripped, split on " - ". */
function tailParts(body: string): string[] {
  const idx = body.lastIndexOf('</b>');
  const tail = stripMarkup(idx >= 0 ? body.slice(idx + 4) : body)
    .trim()
    .replace(/^-\s*/, '');
  return tail
    .split(' - ')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

function splitWeaponQuality(parts: string[]): { weapon: string | null; quality: HitQuality | null } {
  const last = parts.at(-1);
  const quality = last && (HIT_QUALITIES as readonly string[]).includes(last) ? (last as HitQuality) : null;
  const weaponParts = quality ? parts.slice(0, -1) : parts;
  return { weapon: weaponParts.length ? weaponParts.join(' - ') : null, quality };
}

type Payload = DistributiveOmit<GameEvent, 'time' | 'timeMs' | 'category' | 'raw' | 'source'>;
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

const EWAR_LABELS: Record<string, EwarType> = {
  'Warp scramble attempt': 'warpScramble',
  'Warp disruption attempt': 'warpDisruption',
};

/** "Name [CORP] Ship" → its parts; without a corp tag it is all name. */
function splitPilot(s: string): { other: string; corp: string | null; ship: string | null } {
  const m = /^(.*?)\s*\[([^\]]+)\]\s*(.*)$/.exec(s.trim());
  return m
    ? { other: m[1]!.trim(), corp: m[2]!, ship: m[3]!.trim() || null }
    : { other: s.trim(), corp: null, ship: null };
}

function parseCombat(body: string, text: string): Payload | null {
  const b = bolds(body);

  const dmg = /^([\d,.]+) (to|from) /.exec(text);
  if (dmg && b.length >= 2) {
    const amount = num(b[0]!);
    const name = b[1]!;
    const { weapon, quality } = splitWeaponQuality(tailParts(body));
    return dmg[2] === 'to'
      ? { kind: 'damageDealt', target: name, amount, weapon, quality }
      : { kind: 'damageTaken', attacker: name, amount, weapon, quality };
  }

  let m = /^(.+) misses you completely(?: - (.+))?$/.exec(text);
  if (m) return { kind: 'missTaken', attacker: m[1]!.trim(), weapon: m[2]?.trim() ?? null };

  m = /^Your (group of )?(.+?) misses (.+) completely(?: - (.+))?$/.exec(text);
  if (m) return { kind: 'missDealt', target: m[3]!.trim(), weapon: (m[4] ?? m[2]!).trim(), grouped: Boolean(m[1]) };

  const ewar = b[0] ? EWAR_LABELS[b[0]] : undefined;
  if (ewar && b[1]) {
    if (/ to\s*you!$/.test(text)) return { kind: 'ewar', ewar, attacker: b[1], victim: null, victimShip: null };
    if (b[2]) return { kind: 'ewar', ewar, attacker: b[1], victim: b[2], victimShip: b[3] ?? null };
  }

  if (/^You're jammed by /.test(text) && b[1]) {
    return { kind: 'ewar', ewar: 'ecm', attacker: b[1], victim: null, victimShip: null };
  }

  if (/ GJ energy neutralized /.test(text) && b.length >= 2) {
    const parts = tailParts(body);
    return { kind: 'energyNeutralized', attacker: b[1]!, amountGJ: num(b[0]!), module: parts.at(-1) ?? null };
  }

  // Between players (EVE-101); the pilot part is "Name [CORP] Ship", nested bold, so it is read from the text.
  m = /^([\d,.]+) remote (armor|shield|hull) (?:repaired|boosted) (to|by) (.+?)(?: - (.+))?$/.exec(text);
  if (m) {
    const who = splitPilot(m[4]!);
    return {
      kind: 'remoteRepair',
      layer: m[2] as 'armor' | 'shield' | 'hull',
      direction: m[3] as 'to' | 'by',
      ...who,
      amount: num(m[1]!),
      module: m[5]?.trim() ?? null,
    };
  }

  m = /^-([\d,.]+) GJ energy drained to (.+?)(?: - (.+))?$/.exec(text);
  if (m)
    return { kind: 'energyLeeched', by: splitPilot(m[2]!).other, amountGJ: num(m[1]!), module: m[3]?.trim() ?? null };

  // NPC against NPC (faction warfare): the victim's name has no closing bold, so it comes from the text.
  m = /^Warp (scramble|disruption) attempt from (.+?) to (.+)$/.exec(text);
  if (m && !/^you!?$/.test(m[3]!.trim()))
    return {
      kind: 'ewarBetween',
      ewar: m[1] === 'scramble' ? 'warpScramble' : 'warpDisruption',
      attacker: m[2]!.trim(),
      victim: m[3]!.trim(),
    };

  if (/ GJ energy drained from /.test(text) && b.length >= 2) {
    const parts = tailParts(body);
    return { kind: 'energyDrained', target: b[1]!, amountGJ: num(b[0]!), module: parts.at(-1) ?? null };
  }

  return null;
}

function parseNotify(text: string): Payload | null {
  let m = /^Loading the (.+) into the (.+?); this will take approximately (\d+) seconds\.$/.exec(text);
  if (m) return { kind: 'reload', charge: m[1]!, module: m[2]!, seconds: Number(m[3]) };

  m = /^(.+) has run out of charges$/.exec(text);
  if (m) return { kind: 'outOfCharges', module: m[1]! };

  m = /^(.+) has no suitable targets within range\.$/.exec(text);
  if (m) return { kind: 'noTargetInRange', module: m[1]! };

  m = /^(.+) deactivates as the item it was targeted at is no longer present\.$/.exec(text);
  if (m) return { kind: 'targetGone', item: m[1]! };

  if (text === 'Targeting attempt failed as the designated object is no longer present.') {
    return { kind: 'targetGone', item: null };
  }
  return null;
}

function parseMining(text: string): Payload | null {
  let m = /^You mined ([\d,]+) units of (.+)$/.exec(text);
  if (m) return { kind: 'mining', ore: m[2]!, units: num(m[1]!), variant: 'normal' };
  m = /^Critical mining success! You mined an additional ([\d,]+) units of (.+)$/.exec(text);
  if (m) return { kind: 'mining', ore: m[2]!, units: num(m[1]!), variant: 'critical' };
  m = /^Additional ([\d,]+) units depleted from asteroid as residue$/.exec(text);
  if (m) return { kind: 'mining', ore: null, units: num(m[1]!), variant: 'residue' };
  return null;
}

function parsePayload(category: LogCategory, body: string, text: string): Payload | null {
  switch (category) {
    case 'combat':
      return parseCombat(body, text);
    case 'notify':
      return parseNotify(text);
    case 'mining':
      return parseMining(text);
    case 'bounty': {
      const m = /^([\d,]+) ISK added to next bounty payout$/.exec(text);
      return m ? { kind: 'bounty', isk: num(m[1]!) } : null;
    }
    case 'info':
      return text.startsWith('This gate is locked!') ? { kind: 'gateLocked', message: text } : null;
    case 'None': {
      let m = /^Jumping from (.+) to (.+)$/.exec(text);
      if (m) return { kind: 'systemJump', from: m[1]!, to: m[2]! };
      m = /^Undocking from (.+) to (.+) solar system\.$/.exec(text);
      if (m) return { kind: 'undock', station: m[1]!, system: m[2]! };
      return null;
    }
    default:
      return null;
  }
}

export function parseEntry(entry: LogEntry): GameEvent {
  const text = stripMarkup(entry.body).trim();
  const base = {
    time: entry.time,
    timeMs: entry.timeMs,
    category: entry.category,
    raw: entry.body,
    source: entry.source,
  };
  const payload = parsePayload(entry.category, entry.body, text);
  return (payload ? { ...base, ...payload } : { ...base, kind: 'unknown', text }) as GameEvent;
}

/** Convenience for tests, replay and corpus checks: parses a whole file's text. */
export function parseLogText(file: string, content: string): { header: LogSessionHeader; events: GameEvent[] } {
  const assembler = new EntryAssembler(file);
  const entries: LogEntry[] = [];
  let offset = 0;
  const encoder = new TextEncoder();
  const lines = content.split('\n');
  lines.forEach((line, i) => {
    // A trailing empty string after the final "\n" is not a line.
    if (i === lines.length - 1 && line === '') return;
    entries.push(...assembler.push(line, offset, i + 1));
    offset += encoder.encode(line).length + 1;
  });
  entries.push(...assembler.flush());
  return { header: parseHeader(file, content.slice(0, 1024)), events: entries.map(parseEntry) };
}
