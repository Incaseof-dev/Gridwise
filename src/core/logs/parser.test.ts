import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EntryAssembler, parseHeader, parseLogText } from './parser';
import type { GameEvent } from './events';

const FIXTURE = '20261019_201242_90000001.txt';
const content = readFileSync(join(import.meta.dirname, '../../../test/fixtures/session-basic.txt'), 'utf8');
const { header, events } = parseLogText(FIXTURE, content);

/** Event at a fixture line, with base fields removed for compact assertions. */
function at(line: number): Record<string, unknown> {
  const e = events.find((ev) => ev.source.line === line);
  if (!e) throw new Error(`no event at line ${line}`);
  const { time: _t, timeMs: _m, category: _c, raw: _r, source: _s, ...rest } = e as GameEvent & Record<string, unknown>;
  return rest;
}

describe('parseHeader', () => {
  it('reads listener, start time and character id', () => {
    expect(header).toEqual({
      file: FIXTURE,
      character: 'Test Pilot',
      characterId: 90000001,
      startedAt: '2026-10-19T20:12:42.000Z',
    });
  });

  it('handles login-screen files without listener', () => {
    const h = parseHeader('20261019_114728.txt', '  Gamelog\r\n  Session Started: 2026.10.19 11:47:28\r\n');
    expect(h.character).toBeNull();
    expect(h.characterId).toBeNull();
  });
});

describe('parseLogText', () => {
  it('produces one event per entry, with provenance', () => {
    expect(events).toHaveLength(25);
    expect(events[0]!.source).toEqual({ file: FIXTURE, offset: 199, line: 6 });
    expect(events[0]!.time).toBe('2026-10-19T20:13:35.000Z');
  });

  it('parses navigation', () => {
    expect(at(6)).toEqual({
      kind: 'undock',
      station: 'Maurasi IX - Moon 12 - Caldari Navy Assembly Plant',
      system: 'Maurasi',
    });
    expect(at(7)).toEqual({ kind: 'systemJump', from: 'Maurasi', to: 'Perimeter' });
  });

  it('parses damage in both directions', () => {
    expect(at(9)).toEqual({
      kind: 'damageTaken',
      attacker: 'Devastator Alvum',
      amount: 13,
      weapon: null,
      quality: 'Hits',
    });
    expect(at(10)).toEqual({
      kind: 'damageDealt',
      target: 'Delainen-Solar Cinder entity',
      amount: 285,
      weapon: 'Mjolnir Javelin Heavy Assault Missile',
      quality: 'Hits',
    });
    expect(at(11)).toEqual({
      kind: 'damageTaken',
      attacker: 'Pithum Silencer',
      amount: 1204,
      weapon: 'Scourge Heavy Missile',
      quality: 'Smashes',
    });
  });

  it('keeps names that contain " - "', () => {
    expect(at(12)).toMatchObject({ target: 'Maurasi IX - Moon 12 - Fake Structure', weapon: 'Hobgoblin II' });
  });

  it('parses misses', () => {
    expect(at(13)).toEqual({ kind: 'missTaken', attacker: 'Devastator Alvum', weapon: null });
    expect(at(14)).toEqual({ kind: 'missTaken', attacker: 'Some Pilot', weapon: 'Light Neutron Blaster II' });
    expect(at(15)).toEqual({
      kind: 'missDealt',
      target: 'Pithior Supremacist',
      weapon: 'Imperial Navy Praetor',
      grouped: false,
    });
    expect(at(16)).toEqual({ kind: 'missDealt', target: 'Pithi Imputor', weapon: '200mm Railgun II', grouped: true });
  });

  it('trims surrounding whitespace in names', () => {
    const { events: evs } = parseLogText(
      'x.txt',
      '[ 2026.10.19 20:00:00 ] (combat) Pleasure Hub Guardian  misses you completely\r\n',
    );
    expect(evs[0]).toMatchObject({ kind: 'missTaken', attacker: 'Pleasure Hub Guardian' });
  });

  it('parses ewar against us and against others', () => {
    expect(at(17)).toEqual({
      kind: 'ewar',
      ewar: 'warpScramble',
      attacker: 'Hypnosian Watcher',
      victim: null,
      victimShip: null,
    });
    expect(at(18)).toEqual({
      kind: 'ewar',
      ewar: 'warpDisruption',
      attacker: 'Harvest Prophet',
      victim: 'Fleet Mate',
      victimShip: 'Gila',
    });
    expect(at(19)).toEqual({ kind: 'ewar', ewar: 'ecm', attacker: 'Pithi Saboteur', victim: null, victimShip: null });
  });

  it('parses capacitor warfare', () => {
    expect(at(20)).toEqual({
      kind: 'energyNeutralized',
      attacker: 'Hypnosian Watcher',
      amountGJ: 18,
      module: 'Hypnosian Watcher',
    });
    expect(at(21)).toEqual({
      kind: 'energyDrained',
      target: 'Pithi Saboteur',
      amountGJ: 12,
      module: 'Small Ghoul Compact Energy Nosferatu',
    });
  });

  it('parses repairs and nos between players, and NPCs scrambling each other (EVE-101)', () => {
    const line = (body: string) => `[ 2026.11.05 17:18:03 ] (combat) ${body}`;
    const pilot = (name: string, ship: string) =>
      `<b><color=0xffffffff><font size=12><color=0xFFFFFFFF><b>${name}</b> </color></font><font size=12>[CORP]</font> <font size=12><color=0xFFFFFFFF><b>${ship}</b></color></font></b>`;
    const text = [
      line(
        `<color=0xffccff66><b>75</b><color=0x77ffffff><font size=10> remote armor repaired to </font>${pilot('Fleet Mate', 'Damavik')}<color=0x77ffffff><font size=10> - Small Solace Scoped Remote Armor Repairer</font>`,
      ),
      line(
        `<color=0xffccff66><b>0</b><color=0x77ffffff><font size=10> remote shield boosted by </font>${pilot('Fleet Mate', 'Heron')}<color=0x77ffffff><font size=10> - Small SNa Scoped Remote Shield Booster</font>`,
      ),
      line(
        `<color=0xffe57f7f><b>-6 GJ</b><color=0x77ffffff><font size=10> energy drained to </font>${pilot('Fleet Mate', 'Heron')}<color=0x77ffffff><font size=10> - Small Knave Scoped Energy Nosferatu</font>`,
      ),
      line(
        `<color=0xffffffff><b>Warp disruption attempt</b> <color=0x77ffffff><font size=10>from</font> <color=0xffffffff><b>Detainer Harpy</b> <color=0x77ffffff><font size=10>to <b><color=0xffffffff></font>Inspector Enyo`,
      ),
      line(
        `<color=0xffffffff><b>Warp disruption attempt</b> <color=0x77ffffff><font size=10>from</font> <color=0xffffffff><b>Inspector Incursus</b> <color=0x77ffffff><font size=10>to <b><color=0xffffffff></font>you!`,
      ),
    ].join('\r\n');
    const evs = parseLogText(FIXTURE, `${text}\r\n`).events.map((e) => {
      const {
        time: _t,
        timeMs: _m,
        category: _c,
        raw: _r,
        source: _s,
        ...rest
      } = e as GameEvent & Record<string, unknown>;
      return rest;
    });
    expect(evs).toEqual([
      {
        kind: 'remoteRepair',
        layer: 'armor',
        direction: 'to',
        other: 'Fleet Mate',
        corp: 'CORP',
        ship: 'Damavik',
        amount: 75,
        module: 'Small Solace Scoped Remote Armor Repairer',
      },
      {
        kind: 'remoteRepair',
        layer: 'shield',
        direction: 'by',
        other: 'Fleet Mate',
        corp: 'CORP',
        ship: 'Heron',
        amount: 0,
        module: 'Small SNa Scoped Remote Shield Booster',
      },
      { kind: 'energyLeeched', by: 'Fleet Mate', amountGJ: 6, module: 'Small Knave Scoped Energy Nosferatu' },
      { kind: 'ewarBetween', ewar: 'warpDisruption', attacker: 'Detainer Harpy', victim: 'Inspector Enyo' },
      { kind: 'ewar', ewar: 'warpDisruption', attacker: 'Inspector Incursus', victim: null, victimShip: null },
    ]);
  });

  it('parses module notifications and bounty', () => {
    expect(at(8)).toEqual({
      kind: 'reload',
      charge: 'Advanced Heavy Assault Missile',
      module: 'Missile Launcher Heavy Assault',
      seconds: 10,
    });
    expect(at(22)).toEqual({ kind: 'targetGone', item: 'Mjolnir Javelin Heavy Assault Missile' });
    expect(at(23)).toEqual({ kind: 'targetGone', item: null });
    expect(at(24)).toEqual({ kind: 'bounty', isk: 3750 });
    expect(at(25)).toEqual({ kind: 'outOfCharges', module: 'Heavy Missile Launcher II' });
    expect(at(26)).toEqual({ kind: 'noTargetInRange', module: 'Light Missile Launcher II' });
    expect(at(27)).toMatchObject({ kind: 'gateLocked' });
    expect(at(30)).toEqual({ kind: 'mining', ore: 'Veldspar', units: 1250, variant: 'normal' });
  });

  it('merges continuation lines (including stray \\r) into the previous entry', () => {
    expect(at(28)).toEqual({ kind: 'unknown', text: 'Calibrating sensor equipment.\nPlease try again in 58s' });
  });

  it('keeps unknown entries instead of dropping them', () => {
    expect(at(31)).toEqual({ kind: 'unknown', text: 'Cargo is too far away. Ship is on automatic approach to cargo.' });
  });
});

describe('EntryAssembler', () => {
  it('holds the last entry until the next one starts or flush', () => {
    const a = new EntryAssembler('f.txt');
    expect(a.push('[ 2026.10.19 20:00:00 ] (notify) first', 0, 1)).toEqual([]);
    expect(a.push('more', 40, 2)).toEqual([]);
    const out = a.push('[ 2026.10.19 20:00:01 ] (notify) second', 45, 3);
    expect(out).toHaveLength(1);
    expect(out[0]!.body).toBe('first\nmore');
    expect(a.flush()[0]!.body).toBe('second');
    expect(a.flush()).toEqual([]);
  });
});
