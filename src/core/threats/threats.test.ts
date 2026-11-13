import { describe, expect, it } from 'vitest';
import type { GameEvent } from '../logs/events';
import { CombatTracker, ENGAGEMENT_GAP_MS } from '../session/combat';
import { assessThreats, type KnownCapability, type ThreatContext } from './engine';

const T0 = Date.UTC(2026, 9, 20, 20, 0, 0);
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

const hitUs = (sec: number, attacker: string, amount = 100, weapon: string | null = null) =>
  ev(sec, { kind: 'damageTaken', attacker, amount, weapon, quality: 'Hits' });
const weHit = (sec: number, target: string, amount = 300, weapon = 'Scourge Heavy Missile') =>
  ev(sec, { kind: 'damageDealt', target, amount, weapon, quality: 'Hits' });
const neut = (sec: number, attacker: string, amountGJ: number) =>
  ev(sec, { kind: 'energyNeutralized', attacker, amountGJ, module: attacker });
const ewar = (sec: number, kind: string, attacker: string, victim: string | null = null) =>
  ev(sec, { kind: 'ewar', ewar: kind, attacker, victim, victimShip: victim ? 'Gila' : null });

function ctx(caps: Record<string, KnownCapability[]> = {}, triggers: Record<string, string> = {}): ThreatContext {
  return { capabilitiesOf: (n) => caps[n] ?? [], triggers: new Map(Object.entries(triggers)) };
}

function run(events: GameEvent[]): CombatTracker {
  const c = new CombatTracker();
  for (const e of events) c.apply(e);
  return c;
}

describe('CombatTracker', () => {
  it('starts an engagement on combat and ends it after the gap or a system change', () => {
    const c = run([hitUs(0, 'Pithum Killer'), weHit(1, 'Pithum Killer')]);
    expect(c.engagement(at(2))).not.toBeNull();
    expect(c.engagement(at(1) + ENGAGEMENT_GAP_MS + 1)).toBeNull();
    expect(c.latestEngagement(at(1) + ENGAGEMENT_GAP_MS + 1)?.dealt).toBe(300);

    c.apply(hitUs(200, 'Pithum Killer'));
    c.apply(ev(201, { kind: 'systemJump', category: 'None', from: 'A', to: 'B' }));
    expect(c.engagement(at(201))).toBeNull();
  });

  it('computes observed stats and the kill-time estimate', () => {
    const c = run([
      hitUs(0, 'A', 50),
      weHit(0, 'A', 400, 'Scourge Heavy Missile'),
      ev(4, { kind: 'missDealt', target: 'A', weapon: 'Hobgoblin II', grouped: false }),
      weHit(9, 'A', 200, 'Hobgoblin II'),
      ev(9, { kind: 'bounty', category: 'bounty', isk: 37500 }),
    ]);
    const s = c.stats(at(9))!;
    expect(s).toMatchObject({ engaged: true, dealt: 600, taken: 50, bounty: 37500, bountyCount: 1 });
    expect(s.durationMs).toBe(10_000);
    expect(s.dpsOut).toBe(60); // 600 in the last 10 s
    expect(s.hitRate).toBeCloseTo(2 / 3);
    expect(s.secondsPerKillEstimate).toBe(10);
    expect(s.topWeapons[0]).toEqual({ name: 'Scourge Heavy Missile', damage: 400 });
    expect(s.topAttackers).toEqual([{ name: 'A', damage: 50 }]);
  });

  it('ignores EWAR aimed at other pilots or drones when tracking attacks on us', () => {
    const c = run([ewar(0, 'warpDisruption', 'Harvest Prophet', 'Fleet Mate')]);
    expect(c.engagement(at(0))!.npcs.get('Harvest Prophet')!.ewarOnUs).toEqual({});
  });
});

describe('assessThreats', () => {
  it('returns nothing when idle', () => {
    expect(assessThreats(null, at(0), ctx())).toEqual([]);
  });

  it('puts an observed point first as danger, then fades it to caution', () => {
    const c = run([
      hitUs(0, 'Harvest Prophet'),
      ewar(1, 'warpDisruption', 'Harvest Prophet'),
      ewar(2, 'ecm', 'Pithi Saboteur'),
    ]);
    const now = assessThreats(c.engagement(at(3)), at(3), ctx());
    expect(now.map((t) => [t.label, t.severity, t.basis])).toEqual([
      ['POINTED', 'danger', 'observed'],
      ['JAMMED', 'caution', 'observed'],
    ]);
    expect(now[0]!.text).toBe('by Harvest Prophet');

    const later = assessThreats(c.engagement(at(40)), at(40), ctx());
    expect(later.map((t) => [t.label, t.severity])).toEqual([['POINTED', 'caution']]); // stale jam dropped
    expect(later[0]!.text).toBe('39 s ago by Harvest Prophet (no longer attacking)');
    // Keep the fight going with another NPC: after a minute the old point is dropped.
    c.apply(hitUs(70, 'Someone Else'));
    expect(assessThreats(c.engagement(at(70)), at(70), ctx())).toEqual([]);
  });

  it('keeps a point as danger while the NPC that pointed us keeps attacking', () => {
    const c = run([
      hitUs(0, 'Harvest Prophet'),
      ewar(1, 'warpDisruption', 'Harvest Prophet'),
      hitUs(35, 'Harvest Prophet'),
    ]);
    const t = assessThreats(c.engagement(at(36)), at(36), ctx());
    expect(t[0]).toMatchObject({
      severity: 'danger',
      text: 'by Harvest Prophet (last attempt 35 s ago; still attacking)',
    });
  });

  it('names only the NPCs that currently matter', () => {
    const c = run([
      hitUs(0, 'Old Scrammer'),
      ewar(0, 'warpScramble', 'Old Scrammer'),
      hitUs(30, 'Filler'),
      hitUs(60, 'Filler'),
      hitUs(90, 'Filler'),
      hitUs(100, 'New Scrammer'),
      ewar(100, 'warpScramble', 'New Scrammer'),
    ]);
    const g = c.engagement(at(101))!;
    expect(g.npcs.has('Old Scrammer')).toBe(true); // same engagement
    expect(assessThreats(g, at(101), ctx())[0]!.text).toBe('by New Scrammer');
  });

  it('warns about known warp prevention of NPCs we fight, without claiming it is used', () => {
    const caps = {
      'Dire Pithi Invader': [
        { kind: 'warpScramble', basis: 'sde' },
        { kind: 'web', basis: 'kb' },
      ] as KnownCapability[],
      'Harvest Follower': [{ kind: 'warpScramble', basis: 'sde' }] as KnownCapability[],
    };
    const c = run([
      weHit(0, 'Dire Pithi Invader'),
      hitUs(1, 'Harvest Follower'),
      ewar(2, 'warpScramble', 'Harvest Follower'),
    ]);
    const t = assessThreats(c.engagement(at(3)), at(3), ctx(caps));
    expect(t.map((x) => [x.id, x.severity])).toEqual([
      ['observed-warpScramble', 'danger'],
      ['known-warpScramble', 'caution'],
      ['known-web', 'info'],
    ]);
    // The NPC that actually scrammed is not repeated as "can scram".
    expect(t[1]!.npcs).toEqual(['Dire Pithi Invader']);
    expect(t[1]!.text).toBe('Dire Pithi Invader can SCRAM (SDE; not seen in log yet)');
  });

  it('forgets NPCs that have not interacted for a minute', () => {
    const caps = { Old: [{ kind: 'warpDisruption', basis: 'sde' }] as KnownCapability[] };
    const c = run([hitUs(0, 'Old'), hitUs(50, 'New')]);
    expect(assessThreats(c.engagement(at(59)), at(59), ctx(caps)).map((t) => t.id)).toEqual(['known-warpDisruption']);
    expect(assessThreats(c.engagement(at(61)), at(61), ctx(caps))).toEqual([]);
  });

  it('warns when we shoot a trigger of the selected encounter', () => {
    const c = run([hitUs(0, 'Pith Destroyer'), weHit(5, 'Pith Destroyer')]);
    const t = assessThreats(c.engagement(at(6)), at(6), ctx({}, { 'Pith Destroyer': 'Triggers reinforcements' }));
    expect(t).toEqual([
      expect.objectContaining({ label: 'TRIGGER', text: 'You are shooting Pith Destroyer: Triggers reinforcements' }),
    ]);
    expect(assessThreats(c.engagement(at(30)), at(30), ctx({}, { 'Pith Destroyer': 'x' }))).toEqual([]);
  });

  it('flags an incoming damage spike relative to the fight average', () => {
    const events = [];
    for (let s = 0; s < 40; s++) events.push(hitUs(s, 'A', 20));
    for (let s = 40; s < 50; s++) events.push(hitUs(s, 'A', 200));
    const c = run(events);
    const t = assessThreats(c.engagement(at(49)), at(49), ctx());
    expect(t.map((x) => x.label)).toEqual(['DPS SPIKE']);
  });

  // Rates and amounts from a real Blood Raider pocket (2026-10-22): three neuters at 13–14 GJ/s were fine,
  // a pile of Harvest Sages at 40–50 GJ/s drained the capacitor.
  it('keeps a usual neut fight as NEUTED', () => {
    const events = [];
    for (let s = 0; s < 40; s += 5) events.push(neut(s, 'Harvest Sage', 40), neut(s + 1, 'Harvest Savior', 9));
    for (let s = 0; s < 40; s += 3) events.push(neut(s, 'Harvest Shepherd', 8));
    const c = run(events);
    const t = assessThreats(c.engagement(at(39)), at(39), ctx());
    expect(t.map((x) => x.label)).toEqual(['NEUTED']);
  });

  it('learns the heavy neut rate from an empty capacitor, and forgets it on undock', () => {
    // 40 GJ/s for a minute, then the Sages land for nothing: the capacitor is dry.
    const drain = [];
    for (let s = 0; s < 60; s++) drain.push(neut(s, 'Harvest Sage', 40));
    drain.push(neut(60, 'Harvest Sage', 1), neut(62, 'Harvest Sage', 0));
    // A fresh fight later at 32 GJ/s: no rate warning without a learned rate, a warning after the dry spell (29).
    const fight = (from: number) => {
      const out = [];
      for (let s = from; s < from + 20; s++) out.push(neut(s, 'Harvest Sage', 32));
      return out;
    };
    const fresh = run(fight(0));
    expect(assessThreats(fresh.engagement(at(19)), at(19), ctx()).map((x) => x.label)).toEqual(['NEUTED']);
    const learned = run([...drain, ...fight(200)]);
    expect(assessThreats(learned.engagement(at(219)), at(219), ctx())).toEqual([
      expect.objectContaining({
        label: 'HEAVY NEUT',
        text: 'by Harvest Sage · 32 GJ/s, heavy for this ship (from 29)',
      }),
    ]);
    const undocked = run([
      ...drain,
      ev(150, { kind: 'undock', station: 'Maurasi IX', system: 'Maurasi' }),
      ...fight(200),
    ]);
    expect(assessThreats(undocked.engagement(at(219)), at(219), ctx()).map((x) => x.label)).toEqual(['NEUTED']);
  });

  it('reports an empty capacitor when neuts land for almost nothing', () => {
    const events = [neut(0, 'Harvest Sage', 40), neut(5, 'Harvest Sage', 40), neut(10, 'Harvest Sage', 1)];
    // One neut for almost nothing can be range falloff.
    const one = run(events);
    expect(assessThreats(one.engagement(at(11)), at(11), ctx()).map((x) => x.label)).toEqual(['NEUTED']);
    const c = run([...events, neut(13, 'Harvest Sage', 0)]);
    const t = assessThreats(c.engagement(at(14)), at(14), ctx());
    expect(t[0]).toMatchObject({ label: 'HEAVY NEUT' });
    expect(t[0]!.text).toContain('capacitor empty');
    // A falloff-sized neut is not an empty capacitor, and the report fades.
    const later = run([...events, neut(13, 'Harvest Sage', 0), neut(40, 'Harvest Sage', 20)]);
    expect(assessThreats(later.engagement(at(40)), at(40), ctx()).map((x) => x.label)).toEqual(['NEUTED']);
  });

  it('remembers what an NPC usually neuts across fights', () => {
    const first = [neut(0, 'Harvest Sage', 40)];
    const c = run([
      ...first,
      neut(ENGAGEMENT_GAP_MS / 1000 + 115, 'Harvest Sage', 0),
      neut(ENGAGEMENT_GAP_MS / 1000 + 120, 'Harvest Sage', 0),
    ]);
    const now = at(ENGAGEMENT_GAP_MS / 1000 + 120);
    expect(assessThreats(c.engagement(now), now, ctx())[0]!.text).toContain('capacitor empty');
  });

  it('does not call steady heavy damage a spike', () => {
    const events = [];
    for (let s = 0; s < 60; s++) events.push(hitUs(s, 'A', 150));
    const c = run(events);
    expect(assessThreats(c.engagement(at(59)), at(59), ctx())).toEqual([]);
  });
});

describe('neut against the active fit capacitor (EVE-64)', () => {
  // The user's AB Praxis (All V): 8 075 GJ, 354 s, 52.7 GJ/s with every module on; peak recharge 57 GJ/s.
  const praxis = { shipName: 'Praxis', capacity: 8075, rechargeSeconds: 354, usagePerSecond: 52.67 };
  const fitCtx = (): ThreatContext => ({ ...ctx(), capacitor: praxis });
  const steady = (gjs: number) => {
    const out = [];
    for (let s = 0; s < 20; s++) out.push(neut(s, 'Harvest Sage', gjs));
    return run(out);
  };

  it('says the capacitor holds against a light neut', () => {
    const t = assessThreats(steady(3).engagement(at(19)), at(19), fitCtx());
    expect(t).toEqual([
      expect.objectContaining({ label: 'NEUTED', text: 'by Harvest Sage · 3 GJ/s · Praxis cap holds' }),
    ]);
  });

  it('is heavy when the modules can no longer run, with the time to empty', () => {
    const [t] = assessThreats(steady(32).engagement(at(19)), at(19), fitCtx());
    expect(t!.label).toBe('HEAVY NEUT');
    expect(t!.text).toMatch(
      /^by Harvest Sage · 32 GJ\/s · Praxis cap empties in ~\d:\d\d with all modules on, holds with them off$/,
    );
  });

  it('names a slow drain without calling it heavy', () => {
    const [t] = assessThreats(steady(10).engagement(at(19)), at(19), fitCtx());
    expect(t).toMatchObject({
      label: 'NEUTED',
      text: 'by Harvest Sage · 10 GJ/s · Praxis cap empties in ~9:30 with all modules on, holds with them off',
    });
  });

  it('says when even switching modules off does not help', () => {
    const [t] = assessThreats(steady(80).engagement(at(19)), at(19), fitCtx());
    expect(t!.label).toBe('HEAVY NEUT');
    expect(t!.text).toMatch(/Praxis cap empties in ~\d:\d\d even with modules off$/);
  });
});
