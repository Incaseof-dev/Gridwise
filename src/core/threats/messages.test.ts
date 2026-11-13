import { describe, expect, it } from 'vitest';
import type { GameEvent } from '../logs/events';
import { CombatTracker } from '../session/combat';
import type { KnownCapability, ThreatContext } from './engine';
import { join } from 'node:path';
import { LONG_FIGHT_MS, QUIET_MS, SHOW_MS, SUSTAINED_MS, timedMessages, type RenderText } from './messages';
import { loadTextPool, TextPicker } from './texts';

const T0 = Date.UTC(2026, 9, 21, 20, 0, 0);
let line = 0;
function ev(sec: number, e: Record<string, unknown>): GameEvent {
  return {
    time: new Date(T0 + sec * 1000).toISOString(),
    timeMs: T0 + sec * 1000,
    category: 'combat',
    raw: '',
    source: { file: 'f.txt', offset: 0, line: ++line },
    ...e,
  } as GameEvent;
}
const at = (sec: number) => T0 + sec * 1000;

const hitUs = (sec: number, attacker: string) =>
  ev(sec, { kind: 'damageTaken', attacker, amount: 100, weapon: null, quality: 'Hits' });
const weHit = (sec: number, target: string) =>
  ev(sec, { kind: 'damageDealt', target, amount: 300, weapon: 'Scourge Heavy Missile', quality: 'Hits' });
const neut = (sec: number, attacker: string) =>
  ev(sec, { kind: 'energyNeutralized', attacker, amountGJ: 40, module: attacker });
const ewar = (sec: number, kind: string, attacker: string) =>
  ev(sec, { kind: 'ewar', ewar: kind, attacker, victim: null, victimShip: null });

function ctx(caps: Record<string, KnownCapability[]> = {}, triggers: Record<string, string> = {}): ThreatContext {
  return { capabilitiesOf: (n) => caps[n] ?? [], triggers: new Map(Object.entries(triggers)) };
}

function run(events: GameEvent[]): CombatTracker {
  const c = new CombatTracker();
  for (const e of events) c.apply(e);
  return c;
}

/** One event every `step` seconds from `from` to `to` (inclusive). */
function every(from: number, to: number, step: number, make: (sec: number) => GameEvent): GameEvent[] {
  const out: GameEvent[] = [];
  for (let s = from; s <= to; s += step) out.push(make(s));
  return out;
}

// The bundled texts at level 0 (one text per message, so the wording is predictable).
const picker = new TextPicker(loadTextPool([join(__dirname, '../../../messages/messages.yaml')]).pool);
const plain: RenderText = (key, id, vars) => picker.text(key, 0, id, vars);
const messagesAt = (c: CombatTracker, sec: number, cx = ctx()) =>
  timedMessages(c.engagement(at(sec)), at(sec), cx, plain);

describe('timedMessages', () => {
  const neutSec = SUSTAINED_MS.neut / 1000;

  it('stays silent while a neut is short, speaks once it is sustained, then goes quiet again', () => {
    const c = run(every(0, neutSec + 60, 10, (s) => neut(s, 'Dire Pithum Nullifier')));
    expect(messagesAt(c, 60)).toEqual([]);
    const m = messagesAt(c, neutSec + 5);
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ trigger: 'neut', phase: 'sustained', basis: 'observed' });
    expect(m[0]!.text).toContain('Dire Pithum Nullifier has been draining your capacitor for 3 min');
    // Shown for SHOW_MS only, even though the neut goes on.
    expect(messagesAt(c, neutSec + SHOW_MS / 1000 + 1)).toEqual([]);
  });

  it('says when a sustained neut has stopped', () => {
    const last = neutSec + 60;
    const c = run([
      ...every(0, last, 10, (s) => neut(s, 'Dire Pithum Nullifier')),
      ...every(last, last + 50, 5, (s) => hitUs(s, 'Pithum Killer')),
    ]);
    const quiet = last + QUIET_MS / 1000;
    expect(messagesAt(c, quiet - 1)).toEqual([]);
    expect(messagesAt(c, quiet + 1)).toMatchObject([{ trigger: 'neut', phase: 'ended' }]);
    expect(messagesAt(c, quiet + SHOW_MS / 1000 + 1)).toEqual([]);
  });

  it('does not say "ended" after a neut that never became sustained', () => {
    const c = run([...every(0, 60, 10, (s) => neut(s, 'N')), ...every(60, 120, 5, (s) => hitUs(s, 'X'))]);
    expect(messagesAt(c, 60 + QUIET_MS / 1000 + 1)).toEqual([]);
  });

  it('a pause longer than the streak gap starts the clock again', () => {
    const c = run([...every(0, 100, 10, (s) => neut(s, 'N')), ...every(140, 200, 10, (s) => neut(s, 'N'))]);
    expect(messagesAt(c, 200)).toEqual([]);
  });

  it('uses known capabilities for webs (not logged) and marks them as known', () => {
    const webSec = SUSTAINED_MS.web / 1000;
    const caps = { 'Pithi Arrogator': [{ kind: 'web', basis: 'sde' } as KnownCapability] };
    const c = run(every(0, webSec + 30, 5, (s) => hitUs(s, 'Pithi Arrogator')));
    const m = messagesAt(c, webSec + 2, ctx(caps));
    expect(m).toMatchObject([{ trigger: 'web', phase: 'sustained', basis: 'known' }]);
    expect(m[0]!.text).toContain('webs are not in the game log');
    // An NPC we only shoot at (it never attacked us) does not count.
    const passive = run(every(0, webSec + 30, 5, (s) => weHit(s, 'Pithi Arrogator')));
    expect(messagesAt(passive, webSec + 2, ctx(caps))).toEqual([]);
  });

  it('flags two triggers shot within a minute', () => {
    const cx = ctx({}, { 'Guristas Tower': 'wave 2', 'Pithi Battery': 'wave 3' });
    const c = run([weHit(0, 'Pithum Killer'), weHit(10, 'Guristas Tower'), weHit(40, 'Pithi Battery')]);
    expect(messagesAt(c, 39, cx)).toEqual([]);
    const m = messagesAt(c, 41, cx);
    expect(m).toMatchObject([{ trigger: 'multiTrigger', phase: 'event' }]);
    expect(m[0]!.text).toContain('Guristas Tower, Pithi Battery');
    const slow = run([
      weHit(0, 'Guristas Tower'),
      ...every(5, 95, 5, (s) => hitUs(s, 'X')),
      weHit(100, 'Pithi Battery'),
    ]);
    expect(messagesAt(slow, 101, cx)).toEqual([]);
  });

  it('mentions a long fight only with several kinds of threat', () => {
    const fight = LONG_FIGHT_MS / 1000;
    const plain = run(every(0, fight + 10, 10, (s) => hitUs(s, 'X')));
    expect(messagesAt(plain, fight + 1)).toEqual([]);
    const busy = run([
      hitUs(0, 'X'),
      ewar(5, 'ecm', 'J'),
      neut(6, 'N'),
      ...every(10, fight + 10, 10, (s) => hitUs(s, 'X')),
    ]);
    expect(messagesAt(busy, fight + 1)).toMatchObject([{ trigger: 'longFight', phase: 'event' }]);
  });

  it('is deterministic: same log and time, same messages', () => {
    const events = every(0, neutSec + 20, 10, (s) => neut(s, 'N'));
    expect(messagesAt(run(events), neutSec + 3)).toEqual(messagesAt(run(events), neutSec + 3));
  });
});
