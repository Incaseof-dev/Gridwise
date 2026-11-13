/**
 * Intel parser and board (EVE-97). The lines follow real intel channel messages (2026-11-11/12) with the pilot
 * names replaced; systems and ships are real names, ids are made up.
 */
import { mkdtempSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { migrateSettings } from '../settings';
import { ESS_TIMER_MS, IntelBoard, type IntelReport } from './board';
import { JumpMap } from './jumpMap';
import { IntelLexicon, parseIntelLine, parseIntelText } from './parser';
import { buildIntelGraph } from './graph';
import { IntelAlerts, intelWeight } from './view';
import { IntelWatcher } from './watcher';

// A chain 0MV-4W - T-GCGL - AZBR-2 - Z-8Q65 - 0J3L-V - WH-JCA, with MY-T2P, 4-HWWF and IPAY-2 off 0MV-4W,
// plus far-away Amarr, Motsu and Obe.
const names = [
  '0MV-4W',
  'T-GCGL',
  'AZBR-2',
  'Z-8Q65',
  '0J3L-V',
  'WH-JCA',
  'MY-T2P',
  '4-HWWF',
  'IPAY-2',
  'Amarr',
  'Motsu',
  'Obe',
  'Tash-Murkon Prime',
];
const systems = names.map((name, i) => ({ id: 100 + i, name, security: -0.3 }));
const id = (n: string) => systems.find((s) => s.name === n)!.id;
const graph = new Map<number, number[]>();
const link = (a: string, b: string) => {
  graph.set(id(a), [...(graph.get(id(a)) ?? []), id(b)]);
  graph.set(id(b), [...(graph.get(id(b)) ?? []), id(a)]);
};
link('0MV-4W', 'T-GCGL');
link('T-GCGL', 'AZBR-2');
link('AZBR-2', 'Z-8Q65');
link('Z-8Q65', '0J3L-V');
link('0J3L-V', 'WH-JCA');
link('0MV-4W', 'MY-T2P');
link('0MV-4W', '4-HWWF');
link('0MV-4W', 'IPAY-2');
const jumps = new JumpMap(systems, graph);
const ships = [
  { name: 'Sabre', en: 'Sabre' },
  { name: '剑齿虎级', en: 'Sabre' },
  { name: 'Scythe Fleet Issue', en: 'Scythe Fleet Issue' },
  { name: '镰刀级舰队型', en: 'Scythe Fleet Issue' },
  { name: 'Stiletto', en: 'Stiletto' },
  { name: '短剑级', en: 'Stiletto' },
  { name: 'Amarr Shuttle', en: 'Amarr Shuttle' },
  { name: 'Probe', en: 'Probe' },
  { name: 'Prospect', en: 'Prospect' },
  { name: '掘金者级', en: 'Prospect' },
  { name: 'Loki', en: 'Loki' },
  { name: 'Malediction', en: 'Malediction' },
  { name: 'Rorqual', en: 'Rorqual' },
  { name: 'Vedmak', en: 'Vedmak' },
  { name: 'Osprey Navy Issue', en: 'Osprey Navy Issue' },
  { name: 'Kikimora', en: 'Kikimora' },
];
const lex = new IntelLexicon(systems, ships);
const near = jumps.from(id('0MV-4W'));
const parse = (text: string) => parseIntelText(text, lex, near, (x) => jumps.system(x));
const sys = (p: { systems: { name: string }[] }) => p.systems.map((s) => s.name);

describe('parseIntelLine', () => {
  it('reads time, sender and text, and skips system messages', () => {
    expect(parseIntelLine('\uFEFF[ 2026.11.12 09:17:11 ] Pilot A > Z-8Q65*  Pilot B\r')).toEqual({
      timeMs: Date.UTC(2026, 10, 12, 9, 17, 11),
      sender: 'Pilot A',
      text: 'Z-8Q65*  Pilot B',
    });
    expect(parseIntelLine('[ 2026.11.12 09:05:31 ] EVE System > Channel MOTD: …')).toBeNull();
    expect(parseIntelLine('  Channel Name:    Region.Intel')).toBeNull();
  });
});

describe('parseIntelText', () => {
  it('reads a linked system, pilots and ships in brackets in any language', () => {
    const p = parse('Z-8Q65*  Pilot A (镰刀级舰队型)   Pilot B (剑齿虎级) ansi camp');
    expect(sys(p)).toEqual(['Z-8Q65']);
    expect(p.ships).toEqual(['Scythe Fleet Issue', 'Sabre']);
    expect(p.pilots).toEqual([
      { name: 'Pilot A', ship: 'Scythe Fleet Issue' },
      { name: 'Pilot B', ship: 'Sabre' },
    ]);
    expect(p.tags).toContain('camp');
  });

  it('keeps name-only segments as pilots, once each, and fills in a ship given later', () => {
    const p = parse('T-GCGL*  Pilot A  Pilot B  Pilot C');
    expect(p.pilots.map((x) => x.name)).toEqual(['Pilot A', 'Pilot B', 'Pilot C']);
    expect(parse('Pilot A (Sabre)  AZBR-2*  pilot a').pilots).toEqual([{ name: 'Pilot A', ship: 'Sabre' }]);
    expect(parse('Pilot A  AZBR-2*  Pilot A (Sabre)').pilots).toEqual([{ name: 'Pilot A', ship: 'Sabre' }]);
  });

  it('takes no system, ship or item for a pilot', () => {
    expect(parse('T-GCGL*  Stargate (Caldari Constellation)*  Sabre').pilots).toEqual([]);
    expect(parse('Kill: Pilot A (Prospect)').pilots).toEqual([{ name: 'Pilot A', ship: 'Prospect' }]);
  });

  it('reads clr, nv and explicit counts', () => {
    expect(parse('AZBR-2* clr').clear).toBe(true);
    expect(parse('Pilot A  0J3L-V nv').noVisual).toBe(true);
    expect(parse('IPAY-2 +7  Pilot A they want to play').count).toBe(7);
    expect(parse('4-HWWF* 62+').count).toBe(62);
    expect(parse('Z-8Q65  Pilot A 5 man gang').count).toBe(5);
    expect(parse('+2 Vedmak, +3 ONI, +1 kiki,  1 Sabre').count).toBe(7);
    expect(parse('+2 Vedmak, +3 ONI, +1 kiki').ships).toEqual(['Vedmak', 'Osprey Navy Issue', 'Kikimora']);
  });

  it('matches a linked item whole: a shuttle is not the Amarr system, a probe item is not the Probe', () => {
    const p = parse('WH-JCA*  Pilot A  Amarr Shuttle*');
    expect(sys(p)).toEqual(['WH-JCA']);
    expect(p.ships).toEqual(['Amarr Shuttle']);
    expect(parse('v Sisters Combat Scanner Probe*  Pilot A  T-GCGL*').ships).toEqual([]);
    expect(sys(parse('Pilot A 004 T-GCGL*'))).toEqual(['T-GCGL']);
  });

  it('reads short system names only among the systems nearby, and only when unique', () => {
    expect(sys(parse('4HWWF beacon rorq drop'))).toEqual(['4-HWWF']);
    expect(parse('4HWWF beacon rorq drop').ships).toEqual(['Rorqual']);
    expect(sys(parse('MY- clr'))).toEqual(['MY-T2P']);
    expect(sys(parse('IPAY gate camp'))).toEqual(['IPAY-2']);
    expect(sys(parseIntelText('MY- clr', lex))).toEqual([]);
    expect(sys(parse('ESS 2 ships'))).toEqual([]);
  });

  it('marks the ESS and a fleet, and reads a time said', () => {
    expect(parse('T-GCGL*  ess bank 5m').tags).toEqual(['ess']);
    expect(parse('T-GCGL*  ess bank 5m').timerSec).toBe(300);
    expect(parse('T-GCGL* heist 4:30').timerSec).toBe(270);
    expect(parse('T-GCGL* ESS 5 min').timerSec).toBe(300);
    expect(parse('T-GCGL* ESS 5 min').count).toBeNull();
    expect(parse('T-GCGL* 45s').timerSec).toBe(45);
    expect(parse('T-GCGL* 99m').timerSec).toBeNull();
    expect(parse('AZBR-2*  Pilot A fleet').tags).toEqual(['fleet']);
  });

  it('takes "<system> gate" as the gate, not the place', () => {
    const p = parse('T-GCGL*  Pilot A (Sabre) obe gate');
    expect(sys(p)).toEqual(['T-GCGL']);
    expect(p.gate?.name).toBe('Obe');
  });

  it('drops an unlinked far-away system that is really part of a name', () => {
    expect(sys(parse('Pilot Motsu  T-GCGL*'))).toEqual(['T-GCGL']);
    expect(sys(parse('Amarr'))).toEqual(['Amarr']);
  });

  it('reads multi-word system names', () => {
    expect(sys(parse('Tash-Murkon Prime  Pilot A'))).toEqual(['Tash-Murkon Prime']);
    expect(
      sys(parseIntelText('pilot seen in new caldari', new IntelLexicon([{ id: 1, name: 'New Caldari' }], []))),
    ).toEqual(['New Caldari']);
  });

  it('marks kill lines and bubbles', () => {
    expect(parse('Kill: Pilot A (Prospect)').tags).toContain('kill');
    expect(parse('击杀：Pilot A (Prospect)').tags).toContain('kill');
    expect(parse('T-GCGL*  Mobile Small Warp Disruptor I*  Pilot A').tags).toContain('bubble');
  });

  it('finds nothing in chatter', () => {
    for (const t of ['nice', 'ty', 'who get caught?', '如果你旗舰在太空的话尽快进站或挂靠'])
      expect(sys(parse(t))).toEqual([]);
  });
});

const T0 = Date.UTC(2026, 10, 12, 9, 17, 0);
const at = (sec: number, sender: string, text: string) => ({ timeMs: T0 + sec * 1000, sender, text });

describe('IntelBoard', () => {
  const feed = (b: IntelBoard, l: ReturnType<typeof at>) => b.add(l, parse(l.text), 'intel');

  it('keeps one entry per system and merges later reports', () => {
    const b = new IntelBoard();
    feed(b, at(0, 'R1', 'Z-8Q65*  Pilot A'));
    feed(b, at(30, 'R2', 'Z-8Q65*  Pilot A  Pilot B  Pilot C'));
    const [r] = b.active(T0 + 60_000);
    expect(r).toMatchObject({ system: { name: 'Z-8Q65' }, messages: 2, firstMs: T0, lastMs: T0 + 30_000 });
    expect(r!.pilots.map((p) => p.name)).toEqual(['Pilot A', 'Pilot B', 'Pilot C']);
  });

  it('joins follow-ups of the same sender: ships, a count, a bare clr', () => {
    const b = new IntelBoard();
    feed(b, at(0, 'R1', 'AZBR-2*  Pilot A'));
    feed(b, at(20, 'R1', 'Sabre*  Stiletto*'));
    feed(b, at(25, 'R1', '+3'));
    feed(b, at(30, 'R2', 'Malediction*'));
    expect(b.active(T0 + 40_000)[0]).toMatchObject({ ships: ['Sabre', 'Stiletto'], count: 3 });
    feed(b, at(60, 'R1', 'clr'));
    expect(b.active(T0 + 70_000)).toEqual([]);
  });

  it('runs the ESS timer: from a time said, a follow-up too, else 6 minutes from the first mention', () => {
    const b = new IntelBoard();
    feed(b, at(0, 'R1', 'T-GCGL*  ess'));
    expect(b.active(T0)[0]).toMatchObject({ essEndMs: T0 + ESS_TIMER_MS, essExact: false, tagMs: { ess: T0 } });
    feed(b, at(20, 'R1', '5m'));
    expect(b.active(T0 + 20_000)[0]).toMatchObject({ essEndMs: T0 + 20_000 + 300_000, essExact: true });
    feed(b, at(30, 'R2', 'AZBR-2*  4m'));
    expect(b.active(T0 + 30_000).find((r) => r.system.name === 'AZBR-2')!.essEndMs).toBeNull();
  });

  it('attaches ships sent just before the system', () => {
    const b = new IntelBoard();
    feed(b, at(0, 'R1', 'Pilot A  Pilot B  Loki*  Malediction*'));
    feed(b, at(5, 'R1', 'T-GCGL*'));
    expect(b.active(T0 + 10_000)[0]).toMatchObject({ system: { name: 'T-GCGL' }, ships: ['Loki', 'Malediction'] });
  });

  it('does not take the victim of a kill line as a hostile ship', () => {
    const b = new IntelBoard();
    feed(b, at(0, 'R1', 'T-GCGL*  Pilot A'));
    feed(b, at(10, 'R1', 'Kill: Pilot B (Prospect)'));
    expect(b.active(T0 + 20_000)[0]!.ships).toEqual([]);
    expect(b.active(T0 + 20_000)[0]!.pilots.map((p) => p.name)).toEqual(['Pilot A']);
  });

  it('clears a system and lets entries expire', () => {
    const b = new IntelBoard({ expireMs: 5 * 60_000 });
    feed(b, at(0, 'R1', 'AZBR-2*  Pilot A'));
    feed(b, at(10, 'R2', 'Z-8Q65*  Pilot B'));
    feed(b, at(70, 'R3', 'AZBR-2* clr'));
    expect(b.active(T0 + 80_000).map((r) => r.system.name)).toEqual(['Z-8Q65']);
    expect(b.active(T0 + 10_000 + 5 * 60_000 + 1)).toEqual([]);
  });

  it('forgets a system cleared by hand until it is reported again', () => {
    const b = new IntelBoard();
    feed(b, at(0, 'R1', 'AZBR-2*  Pilot A'));
    const id = b.active(T0)[0]!.system.id;
    expect(b.remove(id)).toBe(true);
    expect(b.active(T0 + 1000)).toEqual([]);
    feed(b, at(20, 'R2', 'AZBR-2*  Pilot B'));
    expect(b.active(T0 + 30_000)[0]!.pilots.map((p) => p.name)).toEqual(['Pilot B']);
  });

  it('skips a line seen twice (the channel open on two characters)', () => {
    const b = new IntelBoard();
    expect(feed(b, at(0, 'R1', 'T-GCGL*  Pilot A'))).toBe(true);
    expect(feed(b, at(0, 'R1', 'T-GCGL*  Pilot A'))).toBe(false);
    expect(b.active(T0)[0]!.messages).toBe(1);
  });

  it('follows the reported morning: a gang coming 3 → 2 → 0 jumps', () => {
    const b = new IntelBoard();
    const lines = [
      at(0, 'R1', 'Z-8Q65*  Pilot A'),
      at(60, 'R2', 'Z-8Q65*  Pilot A  Pilot B  Pilot C'),
      at(180, 'R3', 'AZBR-2*  Pilot A nv'),
      at(240, 'R3', 'AZBR-2* clr'),
      at(250, 'R4', '0MV-4W*  Pilot A'),
      at(270, 'R4', 'Pilot B (刺客级舰队型)  Pilot C (镰刀级舰队型)'),
    ];
    const seen: string[] = [];
    for (const l of lines) {
      feed(b, l);
      const closest = b
        .active(l.timeMs)
        .map((r) => near.get(r.system.id)!)
        .sort((x, y) => x - y)[0];
      seen.push(`${closest}`);
    }
    expect(seen).toEqual(['3', '3', '2', '3', '0', '0']);
    expect(b.active(T0 + 280_000)[0]).toMatchObject({ system: { name: '0MV-4W' }, ships: ['Scythe Fleet Issue'] });
  });
});

describe('IntelWatcher', () => {
  const dir = mkdtempSync(join(tmpdir(), 'eve-intel-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const utf16 = (s: string) => Buffer.from(`\uFEFF${s}`, 'utf16le');

  it('follows the configured channel only, case-insensitively, and tails new lines', async () => {
    const file = join(dir, 'Region.Intel_20261112_090530_90000042.txt');
    writeFileSync(file, utf16('[ 2026.11.12 09:17:00 ] R1 > T-GCGL*  Pilot A\r\n'));
    writeFileSync(join(dir, 'Corp_20261112_090530_90000042.txt'), utf16('[ 2026.11.12 09:17:00 ] R1 > AZBR-2*  x\r\n'));
    const w = new IntelWatcher(dir, ['region.INTEL'], lex, jumps, () => id('0MV-4W'));
    let changes = 0;
    w.on('change', () => changes++);
    await w.scan();
    expect(w.board.active(T0 + 1000).map((r) => r.system.name)).toEqual(['T-GCGL']);
    appendFileSync(file, utf16('[ 2026.11.12 09:17:30 ] R2 > MY- +4\r\n'));
    await w.poll();
    expect(w.board.active(T0 + 31_000).map((r) => r.system.name)).toEqual(['MY-T2P', 'T-GCGL']);
    expect(changes).toBe(2);
    w.stop();
  });
});

describe('buildIntelGraph', () => {
  it('puts the pilot on top, one row per jump, with the gates between shown systems', () => {
    const g = buildIntelGraph(jumps, id('0MV-4W'), 2);
    const row = (d: number) => g.nodes.filter((n) => n.jumps === d).map((n) => n.name);
    expect(row(0)).toEqual(['0MV-4W']);
    expect(row(1).sort()).toEqual(['4-HWWF', 'IPAY-2', 'MY-T2P', 'T-GCGL']);
    expect(row(2)).toEqual(['AZBR-2']);
    expect(g.edges).toHaveLength(5);
    expect(g.nodes.every((n) => n.x > 0 && n.x < 1)).toBe(true);
  });

  it('places a system under the neighbour it hangs off', () => {
    // Two branches: the child of the left one must sit left of the child of the right one.
    // Named so that sorting by name alone would put them the wrong way round.
    const sys = ['O', 'L', 'R', 'Z-under-L', 'A-under-R'].map((name, i) => ({ id: i + 1, name, security: 0 }));
    const g = new Map<number, number[]>([
      [1, [2, 3]],
      [2, [1, 4]],
      [3, [1, 5]],
      [4, [2]],
      [5, [3]],
    ]);
    const graph = buildIntelGraph(new JumpMap(sys, g), 1, 2);
    const x = (n: string) => graph.nodes.find((v) => v.name === n)!.x;
    expect(Math.sign(x('Z-under-L') - x('A-under-R'))).toBe(Math.sign(x('L') - x('R')));
  });
});

describe('IntelAlerts', () => {
  const settings = migrateSettings({}, '/h').intel;
  const report = (name: string, lastSec = 0): IntelReport => ({
    system: { id: id(name), name },
    firstMs: T0,
    lastMs: T0 + lastSec * 1000,
    ships: [],
    count: null,
    pilots: [{ name: 'Pilot A', ship: null }],
    noVisual: false,
    tags: [],
    tagMs: {},
    essEndMs: null,
    essExact: false,
    gate: null,
    messages: 1,
    channel: 'intel',
  });
  const dist = (x: number) => near.get(x) ?? null;
  const sec = () => -0.3;

  it('weights by distance: 1 at one jump or closer, 0 at the edge of the range', () => {
    expect([0, 1, 2, 3, 5, 6].map((j) => intelWeight(j, 5))).toEqual([1, 1, 0.75, 0.5, 0, 0]);
    expect(intelWeight(1, 1)).toBe(1);
  });

  it('keeps the rows within range, closest first', () => {
    const a = new IntelAlerts();
    const { rows } = a.rows([report('WH-JCA'), report('AZBR-2'), report('Z-8Q65')], dist, sec, settings, T0);
    expect(rows.map((r) => [r.system, r.jumps, r.level])).toEqual([
      ['AZBR-2', 2, 'warning'],
      ['Z-8Q65', 3, 'notice'],
      ['WH-JCA', 5, 'notice'],
    ]);
    expect(a.rows([report('WH-JCA')], dist, sec, { ...settings, range: 4 }, T0).rows).toEqual([]);
  });

  it('sounds once per system and level, the warning over the notice', () => {
    const a = new IntelAlerts();
    const r1 = a.rows([report('Z-8Q65')], dist, sec, settings, T0);
    expect(r1.alert).toEqual({ seq: 1, level: 'notice' });
    expect(a.rows([report('Z-8Q65', 30)], dist, sec, settings, T0).alert?.seq).toBe(1);
    const r3 = a.rows([report('Z-8Q65'), report('AZBR-2')], dist, sec, settings, T0);
    expect(r3.alert).toEqual({ seq: 2, level: 'warning' });
    // Cleared and reported again: it sounds again.
    a.rows([], dist, sec, settings, T0);
    expect(a.rows([report('Z-8Q65')], dist, sec, settings, T0).alert).toEqual({ seq: 3, level: 'notice' });
  });

  it('stays quiet with the sounds off', () => {
    const off = { ...settings, notice: { ...settings.notice, on: false }, warning: { ...settings.warning, on: false } };
    expect(new IntelAlerts().rows([report('T-GCGL')], dist, sec, off, T0).alert).toBeNull();
  });

  it('says approaching when the closest report got closer', () => {
    const a = new IntelAlerts();
    expect(a.rows([report('Z-8Q65')], dist, sec, settings, T0).approaching).toBe(false);
    expect(a.rows([report('AZBR-2')], dist, sec, settings, T0 + 60_000).approaching).toBe(true);
    a.resetTrend();
    expect(a.rows([report('AZBR-2')], dist, sec, settings, T0 + 70_000).approaching).toBe(false);
  });
});
