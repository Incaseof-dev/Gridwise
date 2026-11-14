/**
 * Reads player intel channel messages (EVE-97): which system, how many, which ships, clear / no visual, and a few
 * tags (gate camp, bubble, cyno, …), and the pilots named, with their ship when the report gives one (decision
 * EVE-D9; names stay in memory only).
 *
 * Shape of a report (the channels ask for it in their MOTD): links separated by two spaces, a `*` after every
 * linked system or item (character links get none), the ship in brackets after a pilot, e.g.
 * `P3EN-E*  Pilot A (Sabre)   Pilot B (剑齿虎级) ansi camp`. Ship names come in every client language.
 */

export interface IntelSystem {
  id: number;
  name: string;
}

export type IntelTag =
  | 'camp'
  | 'bubble'
  | 'cyno'
  | 'cloaky'
  | 'docked'
  | 'moving'
  | 'spike'
  | 'blops'
  | 'kill'
  /** The Encounter Surveillance System: its bank robbed, a heist, "on the ESS". */
  | 'ess'
  /** A fleet or gang, named as such. */
  | 'fleet';

export interface IntelPilot {
  /** As written in the channel. */
  name: string;
  /** English ship name, when the report says it ("Pilot A (Sabre)"). */
  ship: string | null;
}

export interface ParsedIntel {
  /** Systems where the hostiles are, first mentioned first. */
  systems: IntelSystem[];
  /** A system named as "<system> gate": the gate they sit on, not where they are. */
  gate: IntelSystem | null;
  /** English ship names, unique, in order. */
  ships: string[];
  /** Explicit count (+6, 60+, 5 man, "+2 Vedmak, +3 ONI"). */
  count: number | null;
  /** Pilots named: name-only segments and names before a bracketed ship. */
  pilots: IntelPilot[];
  clear: boolean;
  noVisual: boolean;
  tags: IntelTag[];
  /** A time said in the message ("5m", "4:30", "5 min"), in seconds: for the ESS, what is left of the timer. */
  timerSec: number | null;
}

export interface IntelLine {
  /** EVE time (UTC) of the line, epoch ms. */
  timeMs: number;
  sender: string;
  text: string;
}

const LINE = /^\[ (\d{4})\.(\d{2})\.(\d{2}) (\d{2}):(\d{2}):(\d{2}) \] (.+?) > (.*)$/;

/** One chat log line → time, sender and text. System messages (MOTD, channel changes) are null. */
export function parseIntelLine(line: string): IntelLine | null {
  const m = LINE.exec(line.replace(/^\uFEFF+/, '').replace(/\r$/, ''));
  if (!m || m[7] === 'EVE System') return null;
  const [y, mo, d, h, mi, s] = m.slice(1, 7).map(Number) as [number, number, number, number, number, number];
  return { timeMs: Date.UTC(y, mo - 1, d, h, mi, s), sender: m[7]!, text: m[8]!.trim() };
}

/** Common short forms in intel channels → the English ship name. */
const SHIP_ALIASES: Record<string, string> = {
  RORQ: 'Rorqual',
  HURI: 'Hurricane',
  CANE: 'Hurricane',
  HFI: 'Hurricane Fleet Issue',
  SFI: 'Stabber Fleet Issue',
  ONI: 'Osprey Navy Issue',
  CNI: 'Caracal Navy Issue',
  VNI: 'Vexor Navy Issue',
  KIKI: 'Kikimora',
  VEDDY: 'Vedmak',
  LOKI: 'Loki',
  SLEIP: 'Sleipnir',
};

const CLEAR = new Set(['CLR', 'CLEAR', 'CLEARED']);
const NO_VISUAL = new Set(['NV']);
const TAG_WORDS: Record<string, IntelTag> = {
  CAMP: 'camp',
  CAMPED: 'camp',
  CAMPING: 'camp',
  GATECAMP: 'camp',
  BUBBLE: 'bubble',
  BUBBLED: 'bubble',
  BUBBLES: 'bubble',
  DIC: 'bubble',
  CYNO: 'cyno',
  CLOAK: 'cloaky',
  CLOAKED: 'cloaky',
  CLOAKY: 'cloaky',
  DOCKED: 'docked',
  DOCK: 'docked',
  JUMPED: 'moving',
  JUMP: 'moving',
  WENT: 'moving',
  TOWARDS: 'moving',
  SPIKE: 'spike',
  BLOPS: 'blops',
  黑隐: 'blops',
  黑隐特勤舰: 'blops',
  ESS: 'ess',
  BANK: 'ess',
  HEIST: 'ess',
  ROBBING: 'ess',
  ROBBED: 'ess',
  FLEET: 'fleet',
  FLEETS: 'fleet',
  GANG: 'fleet',
  BLOB: 'fleet',
  舰队: 'fleet',
};
/** Linked items that mean a warp disruption bubble. */
const BUBBLE_ITEM = /warp disrupt(or|ion)|interdiction/i;
/** Words that never start a short system name, though they could look like one (ESS, MOTD, …). */
const NOT_SHORT_SYSTEM = new Set(['ESS', 'ETZ', 'USTZ', 'AUTZ', 'EUTZ', 'CTA', 'MOTD', 'GJ', 'TY', 'LOL', 'FC']);

interface Entry {
  kind: 'system' | 'ship';
  system?: IntelSystem;
  ship?: string;
}

/** System and ship names for the parser. Built once from the SDE. */
export class IntelLexicon {
  private readonly names = new Map<string, Entry>();
  /** Name of each system without dashes, for short forms (4HWWF, MY-, IPAY). */
  private readonly compact = new Map<number, string>();
  /** English ship name → ship class (SDE group, e.g. Interdictor). */
  private readonly classes = new Map<string, string>();
  readonly maxWords: number;

  constructor(systems: readonly IntelSystem[], ships: readonly { name: string; en: string; group?: string }[]) {
    let maxWords = 1;
    for (const s of ships) {
      const add = (n: string) => {
        if (!this.names.has(n)) this.names.set(n, { kind: 'ship', ship: s.en });
      };
      if (s.group) this.classes.set(s.en, s.group);
      const up = s.name.toUpperCase();
      add(up);
      // Chinese ship names end in 级 ("class"); players often leave it off.
      if (up.length > 2 && up.endsWith('级')) add(up.slice(0, -1));
      maxWords = Math.max(maxWords, up.split(' ').length);
    }
    for (const [alias, en] of Object.entries(SHIP_ALIASES)) this.names.set(alias, { kind: 'ship', ship: en });
    // Systems win over ships of the same name.
    for (const s of systems) {
      const up = s.name.toUpperCase();
      this.names.set(up, { kind: 'system', system: s });
      this.compact.set(s.id, up.replace(/-/g, ''));
      maxWords = Math.max(maxWords, up.split(' ').length);
    }
    this.maxWords = Math.min(maxWords, 6);
  }

  lookup(upper: string): Entry | undefined {
    return this.names.get(upper);
  }

  shipClass(en: string): string | null {
    return this.classes.get(en) ?? null;
  }

  /**
   * A short form among the systems in `near` (ids): "4HWWF" = 4-HWWF, "MY-" = MY-T2P, "IPAY" = IPAY-2. Only a
   * unique match counts.
   */
  shortSystem(
    token: string,
    near: Iterable<number> | null,
    byId: (id: number) => IntelSystem | null,
  ): IntelSystem | null {
    if (!near) return null;
    const up = token.toUpperCase();
    if (NOT_SHORT_SYSTEM.has(up)) return null;
    const hasDash = up.includes('-');
    const looksLikeSystem = /\d/.test(up) || hasDash || (token === up && /^[A-Z]{3,}$/.test(up));
    const key = up.replace(/-/g, '');
    if (!looksLikeSystem || key.length < (hasDash ? 2 : 3) || !/^[0-9A-Z]+$/.test(key)) return null;
    let found: number | null = null;
    for (const id of near) {
      const c = this.compact.get(id);
      if (c?.startsWith(key)) {
        if (found !== null) return null;
        found = id;
      }
    }
    return found === null ? null : byId(found);
  }
}

const MINUTES = /^(M|MIN|MINS|MINUTE|MINUTES|分钟?)$/;
/** At most this much: the ESS timers are minutes, a bigger number is something else. */
const MAX_TIMER_SEC = 20 * 60;

/** "5m", "5min", "4:30", "45s", or "5" followed by "min": seconds, and how many words it took. */
export function timerSeconds(up: string, next: string): { sec: number; words: number } | null {
  let sec: number | null = null;
  let words = 1;
  let m: RegExpExecArray | null;
  if ((m = /^(\d{1,2}):([0-5]\d)$/.exec(up))) sec = Number(m[1]) * 60 + Number(m[2]);
  else if ((m = /^(\d{1,2})(M|MIN|MINS|分钟?)$/.exec(up))) sec = Number(m[1]) * 60;
  else if ((m = /^(\d{1,3})(S|SEC|SECS)$/.exec(up))) sec = Number(m[1]);
  else if (/^\d{1,2}$/.test(up) && MINUTES.test(next)) {
    sec = Number(up) * 60;
    words = 2;
  }
  return sec !== null && sec > 0 && sec <= MAX_TIMER_SEC ? { sec, words } : null;
}

const clean = (w: string) => w.replace(/^[,.;:!?"']+|[,.;:!?"']+$/g, '');

/**
 * Parses one message. `near` = system ids around the pilot (from the jump map) for short system names; without it
 * only full names count.
 */
export function parseIntelText(
  text: string,
  lex: IntelLexicon,
  near: ReadonlyMap<number, number> | null = null,
  byId: (id: number) => IntelSystem | null = () => null,
): ParsedIntel {
  const out: ParsedIntel = {
    systems: [],
    gate: null,
    ships: [],
    count: null,
    pilots: [],
    clear: false,
    noVisual: false,
    tags: [],
    timerSec: null,
  };
  const tags = new Set<IntelTag>();
  const ships: string[] = [];
  const addShip = (s: string) => {
    if (!ships.includes(s)) ships.push(s);
  };
  const addSystem = (s: IntelSystem) => {
    if (!out.systems.some((x) => x.id === s.id)) out.systems.push(s);
  };
  let count = 0;
  let counted = false;
  const pilots: IntelPilot[] = [];
  const addPilot = (raw: string, ship: string | null) => {
    const name = raw.replace(/\*+$/, '').replace(/^[,.;:!?"'\s]+|[,.;:!?"'\s]+$/g, '');
    if (!name || name.length > 40 || lex.lookup(name.toUpperCase())) return;
    const known = pilots.find((p) => p.name.toUpperCase() === name.toUpperCase());
    if (known) known.ship ??= ship;
    else pilots.push({ name, ship });
  };
  /** Systems named without a link: a pilot may be called "Motsu" too, so far-away ones go when others are known. */
  const freeSystems: IntelSystem[] = [];

  let body = text;
  if (/^(kill:|击杀[:：])/i.test(body)) {
    tags.add('kill');
    body = body.replace(/(kill:|击杀[:：])/gi, '  ');
  }
  if (/\bno vis(ual)?\b/i.test(body)) out.noVisual = true;
  if (/\bblack ops\b/i.test(body)) tags.add('blops');
  // The ESS window copied in Chinese: "主赏金池：426 百万 星币" (main bounty pool: 426 million ISK), the reserve too.
  if (/赏金池/.test(body)) {
    tags.add('ess');
    body = body.replace(/[主储备]*赏金池[:：]?\s*[\d.,]+\s*(百万|十亿|亿|万)?\s*(星币)?/g, '  ');
  }
  // A full-width colon in a timer ("5：30"), and a count stuck to the tag ("ess+5").
  body = body.replace(/(\d)：(\d)/g, '$1:$2').replace(/\b([A-Za-z]{2,})\+(\d)/g, '$1 +$2');

  for (const rawSeg of body.split(/\s{2,}/)) {
    let seg = rawSeg.trim();
    if (!seg) continue;
    let hadShipInBrackets = false;
    // "Pilot A (Sabre)": the pilot is one of the hostiles, in that ship. The name is the text before the bracket.
    seg = seg.replace(/([^()]*?)\s*\(([^)]*)\)\*?/g, (_m, before: string, inner: string) => {
      const e = lex.lookup(inner.replace(/\*$/, '').trim().toUpperCase());
      if (e?.kind !== 'ship') return ` ${before} `;
      addShip(e.ship!);
      addPilot(before, e.ship!);
      hadShipInBrackets = true;
      return ' ';
    });
    const words = seg.split(/\s+/).filter(Boolean);
    let matched = false;
    const leftover: string[] = [];
    let linkedFrom = 0;
    let gateNext = false;

    const takeSystem = (s: IntelSystem, i: number, linked = false) => {
      matched = true;
      if (clean(words[i + 1] ?? '').toUpperCase() === 'GATE') {
        out.gate = s;
        gateNext = true;
      } else if (linked) addSystem(s);
      else freeSystems.push(s);
    };

    for (let i = 0; i < words.length; i++) {
      const w = words[i]!;
      if (gateNext) {
        gateNext = false;
        continue;
      }
      if (w.endsWith('*')) {
        // A linked item: the words since the last link (or the segment start) up to this one. Try it whole, then
        // shorter tails ("Pilot A 004 NCGR-Q*"); a one-word tail only as a system ("… Scanner Probe*" is no Probe).
        const span = words.slice(linkedFrom, i + 1).map((x) => clean(x.replace(/\*+$/, '')));
        linkedFrom = i + 1;
        let done = false;
        for (let k = 0; k < span.length && !done; k++) {
          const e = lex.lookup(span.slice(k).join(' ').toUpperCase());
          if (!e || (k === span.length - 1 && k > 0 && e.kind === 'ship')) continue;
          if (e.kind === 'ship') addShip(e.ship!);
          else takeSystem(e.system!, i, true);
          done = true;
        }
        if (!done && BUBBLE_ITEM.test(span.join(' '))) tags.add('bubble');
        matched = true;
        leftover.length = 0;
        continue;
      }
      const inLink = words.slice(i + 1).some((x) => x.endsWith('*'));
      if (inLink) {
        // Part of a link further on: only keywords count here.
        const up = clean(w).toUpperCase();
        if (CLEAR.has(up)) out.clear = true;
        else if (NO_VISUAL.has(up)) out.noVisual = true;
        continue;
      }
      // Free text: the longest system or ship name starting here.
      let hit: { e: Entry; n: number } | null = null;
      for (let n = Math.min(lex.maxWords, words.length - i); n >= 1; n--) {
        const phrase = words
          .slice(i, i + n)
          .map(clean)
          .join(' ')
          .toUpperCase();
        const e = lex.lookup(phrase);
        if (e) {
          hit = { e, n };
          break;
        }
      }
      const up = clean(w).toUpperCase();
      if (hit) {
        const prev = clean(words[i - 1] ?? '');
        if (hit.e.kind === 'ship') {
          addShip(hit.e.ship!);
          // "1 Scythe": a count in front of a ship.
          if (/^\d{1,2}$/.test(prev)) {
            count += Number(prev);
            counted = true;
          }
        } else takeSystem(hit.e.system!, i + hit.n - 1);
        matched = true;
        i += hit.n - 1;
        continue;
      }
      const timer = timerSeconds(up, clean(words[i + 1] ?? '').toUpperCase());
      if (timer) {
        out.timerSec = timer.sec;
        matched = true;
        i += timer.words - 1;
      } else if (CLEAR.has(up)) {
        out.clear = true;
        matched = true;
      } else if (NO_VISUAL.has(up)) {
        out.noVisual = true;
        matched = true;
      } else if (TAG_WORDS[up]) {
        tags.add(TAG_WORDS[up]);
        matched = true;
      } else if (/^\+\d{1,3}$/.test(up) || /^\d{1,3}\+$/.test(up)) {
        count += Number(up.replace('+', ''));
        counted = true;
        matched = true;
      } else if (/^\d{1,3}$/.test(up) && /^(MAN|SHIPS?|PILOTS?)$/i.test(clean(words[i + 1] ?? ''))) {
        count += Number(up);
        counted = true;
        matched = true;
        i++;
      } else if (/^\d{1,3}$/.test(up) && words.length === 1 && body.trim() === w) {
        // A message that is only a number: the local count of the last report.
        count += Number(up);
        counted = true;
        matched = true;
      } else {
        const short = lex.shortSystem(clean(w), near ? near.keys() : null, byId);
        if (short) takeSystem(short, i);
        else leftover.push(w);
        if (short) matched = true;
      }
    }
    // A segment of only unknown words is a pilot name (or chatter; the caller drops reports without a place).
    if (!hadShipInBrackets && !matched && leftover.length && !rawSeg.trim().endsWith('*')) addPilot(seg.trim(), null);
  }

  const nearFree = near ? freeSystems.filter((x) => near.has(x.id)) : freeSystems;
  for (const x of out.systems.length || nearFree.length ? nearFree : freeSystems) addSystem(x);
  // "IPAY gate camp" with no other place: they sit next to that system, the best guess there is.
  if (!out.systems.length && out.gate) addSystem(out.gate);

  out.ships = ships;
  out.count = counted ? count : null;
  out.pilots = pilots;
  out.tags = [...tags];
  return out;
}
