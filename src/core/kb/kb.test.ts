import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import { fillAnomalyClasses, loadKnowledgeBase, parseKbFile } from './loader';
import type { Encounter } from './types';
import { convertEventPage, convertWikiPage, expandNames, parseDamage, parseEwar, parseNpcCell } from './wiki/convert';
import { transcludedParts } from './wiki/build';
import { storylineTitles } from './wiki/sources';
import { cleanText, parseWikitext } from './wiki/wikitext';

/** Excerpt of the real "Guristas Watch" page (EVE University wiki, CC BY-SA 4.0), shortened. */
const WATCH = `{{NPCTableCSS}} {{CMBSiteInfo
|name = Guristas Watch
|type = unrated
|rating = Unrated
|ship limit= T2 Battlecruiser
|faction= Guristas
}}
'''Guristas Watch''' is an [[Unrated Complex]] found in high security space through exploration.

== Walkthrough ==
There are two pockets in this site.

=== First Pocket ===
{{MessageBox|On warp-in
|One of the gates requires a passkey.
|collapsed= yes}}
{{NPCTableHead|Initial defenders}}
{{NPCTableRow|Frigate|4-6|Pithi Wrecker/Plunderer/Destructor/Demolisher}}
{{NPCTableRow|Cruiser|1-2|Pithum Nullifier/Murderer|ewar= ECM}}
{{NPCTableRow|Cruiser|1|Pithum Communications Officer|trigger= Attacking triggers wave 2|}}
|}
{{MessageBox|In local:
|The Pithum Communications officer has called on reinforcements!
|collapsed= yes}}
{{NPCTableHead|Wave 2}}
{{NPCTableRow|Cruiser|2-3|Pithum Annihilator/Killer/Nullifier/...|ewar= ECM}}
|}

=== Second Pocket ===
Destroying the {{co|wheat|Starbase Control Tower}} stops reinforcements.
{{NPCTableHead|Wave 2 (on a timer)}}
{{NPCTableRow|Elite Frigate|2|Dire Pithi Invader/Infiltrator|ewar = Web|point = scram}}
{{NPCTableRow|Cruiser|4|Supervisor's Guardian (Pithum Annihilator/Killer)|ewar= ECM|ewar2={{icon|td|24|Tracking Disruption}}}}
|}

'''Tips:'''
* Kill the {{co|wheat|Scanner Post}} first.
* Loot the can.
Incoming Transmission: Return to me at once.

=== Loot & Salvage ===
{{NPCTableHead|Asteroids}}
{{NPCTableRow|Asteroid|60|Veldspar}}
|}

== Escalation ==
This site can escalate to [[Terrorist Plot!]]
`;

const MISSION = `{{Missiondetails
|Level= 4
|Type= Encounter
|Objective= Destroy the Guristas fleet.
|Faction1= Guristas
|WebPoint= Elite frigates
|EWAR= ECM
|DamageToDeal={{Damagetype|kin|th}}
|DamageToResist={{Damagetype|kin}}
|ShipSizeLimit= ?
}}
'''Blitz:''' Clear the second pocket.
{{NPCTableHead|Initial defenders}}
{{NPCTableRow|Battleship|4|Pith Dismantler/Exterminator|ewar = ECM|trigger = yes}}
|}
`;

/** Loose view of converter output for assertions. */
interface TestWave {
  trigger: Record<string, unknown>;
  spawns: Record<string, unknown>[];
}

const page = (title: string, content: string) => ({
  title,
  revision: 1234,
  timestamp: '2026-10-20T00:00:00Z',
  content,
});

describe('wikitext', () => {
  it('cleans inline markup', () => {
    expect(cleanText("'''Blitz:''' see [[Terrorist Plot!]] and [[Foo|the foo]] {{co|wheat|Tower}}<br/>x")).toBe(
      'Blitz: see Terrorist Plot! and the foo Tower x',
    );
  });

  it('keeps templates inside a sentence as text', () => {
    const nodes = parseWikitext('Destroy the {{co|wheat|Tower}} first.\n{{NPCTableHead|X}}');
    expect(nodes.map((n) => n.kind)).toEqual(['text', 'template']);
  });

  it('reads tables written on one line: a closing mark does not swallow the next table (Guristas Hidden Rally Point)', () => {
    const nodes = parseWikitext(
      '{{NPCTableHead|Wave 1}}{{NPCTableRow|Destroyer|5|Pithior Guerilla}}\n|}{{NPCTableHead|Wave 2}}{{NPCTableRow|Cruiser|6|Pithum Inferno}}\n|}',
    );
    expect(nodes.map((n) => (n.kind === 'template' ? n.name : n.kind === 'text' ? n.text : n.kind))).toEqual([
      'NPCTableHead',
      'NPCTableRow',
      '|}',
      'NPCTableHead',
      'NPCTableRow',
      '|}',
    ]);
    const enc = convertWikiPage(
      page(
        'Guristas Hidden Rally Point',
        '{{CMBSiteInfo|name= Guristas Hidden Rally Point|type= anomaly|faction= Guristas}}\n' +
          '{{NPCTableHead|Wave 1}}{{NPCTableRow|Destroyer|5|Pithior Guerilla}}\n' +
          '|}{{NPCTableHead|Wave 2}}{{NPCTableRow|Cruiser|6|Pithum Inferno}}\n' +
          '|}{{NPCTableHead|Wave 3}}{{NPCTableRow|Battleship|8|Pith Massacrer}}\n|}',
      ),
      'd',
    ).file!;
    expect((enc.pockets as { waves: { id: string }[] }[])[0]!.waves.map((w) => w.id)).toEqual([
      'wave-1',
      'wave-2',
      'wave-3',
    ]);
  });

  it('takes an NPC table after a sentence on the same line as a table (Angel’s Red Light District)', () => {
    const nodes = parseWikitext(
      'The gate is 35 km away.{{NPCTableHead|}}{{NPCTableRow|Frigate|2|Gistii Hijacker}}\n|}',
    );
    expect(nodes.map((n) => (n.kind === 'template' ? n.name : n.kind === 'text' ? n.text : n.kind))).toEqual([
      'The gate is 35 km away.',
      'NPCTableHead',
      'NPCTableRow',
      '|}',
    ]);
  });

  it('parses nested template parameters', () => {
    const [t] = parseWikitext('{{Missiondetails|DamageToDeal={{Damagetype|kin|th}}|Level= 4}}');
    expect(t).toMatchObject({ name: 'Missiondetails', named: { DamageToDeal: '{{Damagetype|kin|th}}', Level: '4' } });
  });
});

describe('wiki value parsing', () => {
  it('parses damage templates', () => {
    expect(parseDamage('{{Damagetype|Kin|th}}')).toEqual(['kinetic', 'thermal']);
    expect(parseDamage('{{damagetype|omni}}')).toEqual(['em', 'thermal', 'kinetic', 'explosive']);
    expect(parseDamage('')).toEqual([]);
  });

  it('parses EWAR words and icons without confusing tracking and warp disruption', () => {
    expect(parseEwar('Web')).toEqual(['web']);
    expect(parseEwar('{{icon|td|24|Tracking Disruption}}')).toEqual(['trackingDisruption']);
    expect(parseEwar('Sensor dampening, neuting')).toEqual(['neut', 'sensorDamp']);
    expect(parseEwar('Elite Frigates (Web/Scram)')).toEqual(['web', 'warpScramble']);
  });

  it('expands compressed name lists, preferring real SDE names when available', () => {
    expect(expandNames('Pithi Wrecker/Plunderer/...')).toEqual({
      names: ['Pithi Wrecker', 'Pithi Plunderer'],
      incomplete: true,
    });
    const sde = new Set(['Core Rear Admiral', 'Core Vice Admiral']);
    expect(expandNames('Core Rear Admiral/Vice Admiral', (n) => sde.has(n)).names).toEqual([
      'Core Rear Admiral',
      'Core Vice Admiral',
    ]);
  });

  it('splits display names from the SDE types behind them', () => {
    expect(parseNpcCell("Supervisor's Guardian (Pithum Annihilator/Killer)")).toEqual({
      display: "Supervisor's Guardian",
      names: ['Pithum Annihilator', 'Pithum Killer'],
      incomplete: false,
    });
    expect(parseNpcCell('Pithum Nullifier/Murderer').display).toBeNull();
  });
});

describe('convertWikiPage', () => {
  const site = convertWikiPage(page('Guristas Watch', WATCH), '2026-10-20').file!;
  const mission = convertWikiPage(page('The Assault (Guristas Pirates)', MISSION), '2026-10-20').file!;

  it('reads the site box', () => {
    expect(site).toMatchObject({
      id: 'guristas-watch',
      kind: 'complex',
      name: 'Guristas Watch',
      dedRating: null,
      enemyFaction: 'Guristas Pirates',
      review: 'unreviewed',
      restrictions: [{ text: 'Ship size limit: T2 Battlecruiser' }],
      defaults: { confidence: 'verified', source: 'uni' },
    });
    expect((site.sources as Record<string, { url: string; revision: string }>).uni).toMatchObject({
      url: 'https://wiki.eveuniversity.org/Guristas_Watch',
      revision: '1234',
      license: 'CC BY-SA 4.0',
    });
  });

  it('builds pockets, waves, triggers and EWAR, and skips loot/mining tables', () => {
    const pockets = site.pockets as {
      name: string;
      onWarpIn?: string;
      notes?: { text: string }[];
      waves: TestWave[];
    }[];
    expect(pockets.map((p) => p.name)).toEqual(['First Pocket', 'Second Pocket']);
    expect(pockets[0]!.onWarpIn).toBe('One of the gates requires a passkey.');
    const [initial, wave2] = pockets[0]!.waves;
    expect(initial!.trigger).toEqual({ on: 'warpIn', text: 'Initial defenders' });
    expect(initial!.spawns[0]!.names).toEqual([
      'Pithi Wrecker',
      'Pithi Plunderer',
      'Pithi Destructor',
      'Pithi Demolisher',
    ]);
    expect(initial!.spawns[1]!.ewar).toEqual([{ kind: 'ecm' }]);
    expect(initial!.spawns[2]!.triggers).toBe('Attacking triggers wave 2');
    expect(wave2!.trigger).toEqual({ on: 'other', text: 'Wave 2', confidence: 'inferred' });
    expect(wave2!.spawns[0]!.note).toBe('type list incomplete on the source page');

    const timer = pockets[1]!.waves[0];
    expect(timer!.trigger.on).toBe('timer');
    expect(timer!.spawns[0]!.ewar).toEqual([{ kind: 'web' }, { kind: 'warpScramble' }]);
    expect(timer!.spawns[1]!).toMatchObject({
      names: ["Supervisor's Guardian"],
      ewar: [{ kind: 'ecm' }, { kind: 'trackingDisruption' }],
    });
    expect(pockets[1]!.notes).toEqual([
      { text: 'Destroying the Starbase Control Tower stops reinforcements.' },
      { text: 'Tips: Kill the Scanner Post first.' },
      { text: 'Tips: Loot the can.' },
    ]);
    expect(pockets).toHaveLength(2);
  });

  it('records display names with their SDE types and keeps escalation notes', () => {
    expect(site.npcs).toEqual({
      "Supervisor's Guardian": { class: 'Cruiser', sdeTypes: ['Pithum Annihilator', 'Pithum Killer'] },
    });
    expect(site.notes).toContainEqual({ text: 'Escalation: This site can escalate to Terrorist Plot!' });
    expect(site.notes).not.toContainEqual(expect.objectContaining({ text: expect.stringContaining('is an Unrated') }));
  });

  it('reads the mission box', () => {
    expect(mission).toMatchObject({
      id: 'the-assault-guristas-pirates',
      kind: 'mission',
      name: 'The Assault',
      level: 4,
      enemyFaction: 'Guristas Pirates',
      damage: { deal: ['kinetic', 'thermal'], resist: ['kinetic'] },
      objectives: [{ text: 'Destroy the Guristas fleet.' }],
    });
    expect(mission.restrictions).toBeUndefined(); // "?" is not a restriction
    expect(mission.ewar).toEqual([{ kind: 'ecm' }, { kind: 'web' }, { kind: 'warpDisruption' }]);
    expect(mission.notes).toEqual([
      { text: 'Web/warp disruption: Elite frigates' },
      { text: 'Blitz: Clear the second pocket.' },
    ]);
    const wave = (mission.pockets as { name: string; waves: TestWave[] }[])[0]!;
    expect(wave.name).toBe('Pocket 1');
    expect(wave.waves[0]!.spawns[0]!.triggers).toBe('Trigger');
  });

  it('skips redirects, courier missions and pages without an info box', () => {
    expect(convertWikiPage(page('X', '#REDIRECT [[Y]]'), 'd').skipped).toBe('redirect');
    expect(convertWikiPage(page('X', '{{Missiondetails|Type= Courier}}'), 'd').skipped).toBe('courier mission');
    expect(convertWikiPage(page('X', 'just text'), 'd').skipped).toMatch(/no Missiondetails/);
  });

  it('produces files that pass KB validation', () => {
    for (const f of [site, mission]) {
      const { encounter, issues } = parseKbFile(`${String(f.id)}.yaml`, stringify(f));
      expect(issues).toEqual([]);
      expect(encounter).not.toBeNull();
    }
  });
});

describe('KB loader', () => {
  const dir = mkdtempSync(join(tmpdir(), 'eve-kb-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const minimal = (id: string, extra = '') => `id: ${id}
kind: mission
name: Test Mission
level: 4
enemyFaction: Guristas Pirates
sources:
  uni: { title: Uni page, url: https://example.org }
${extra}`;

  it('applies defaults and derives trigger NPCs', () => {
    const { encounter, issues } = parseKbFile(
      't.yaml',
      minimal(
        't',
        `defaults: { confidence: inferred }
pockets:
  - name: P1
    waves:
      - id: w1
        trigger: { on: warpIn }
        spawns:
          - { count: 2, names: [Pithum Silencer], ewar: [{ kind: sensorDamp, confidence: observed, source: null }] }
          - { count: "1", names: [Officer], triggers: Attacking spawns wave 2 }
      - id: w2
        trigger: { on: destroyed, npc: Gate Guard }
        spawns: []`,
      ),
    );
    expect(issues).toEqual([]);
    const p = encounter!.pockets[0]!;
    expect(p.waves[0]!.spawns[0]).toMatchObject({
      count: '2',
      confidence: 'inferred',
      source: 'uni',
      ewar: [{ kind: 'sensorDamp', confidence: 'observed', source: null }],
    });
    expect(p.triggerNpcs.sort()).toEqual(['Gate Guard', 'Officer']);
    expect(encounter!.review).toBe('unreviewed');
  });

  it('reports schema errors with line numbers', () => {
    const { encounter, issues } = parseKbFile('t.yaml', minimal('t', 'damage: { deal: [lasers] }'));
    expect(encounter).toBeNull();
    expect(issues[0]).toMatchObject({ severity: 'error', path: '/damage/deal/0', line: 8 });
  });

  it('reports unknown source references', () => {
    const { encounter, issues } = parseKbFile('t.yaml', minimal('t', 'objectives: [{ text: x, source: nope }]'));
    expect(encounter).toBeNull();
    expect(issues[0]!.message).toBe('unknown source "nope"');
  });

  it('lets user files replace bundled ones and skips broken files', () => {
    mkdirSync(join(dir, 'bundled'));
    mkdirSync(join(dir, 'user'));
    writeFileSync(join(dir, 'bundled', 'a.yaml'), minimal('a'));
    writeFileSync(join(dir, 'bundled', 'b.yaml'), 'id: [broken');
    writeFileSync(join(dir, 'user', 'a.yaml'), minimal('a').replace('Test Mission', 'My Version'));
    const { encounters, issues } = loadKnowledgeBase(join(dir, 'bundled'), join(dir, 'user'));
    expect(encounters.map((e) => [e.id, e.name, e.origin.layer])).toEqual([['a', 'My Version', 'user']]);
    expect(issues.some((i) => i.file.endsWith('b.yaml') && i.severity === 'error')).toBe(true);
  });
});

const EVENT = `Intro text.
== Activities ==
=== Combat ===
==== Crimson Gauntlet ====
Shoot the relay last.
{{NPCTableHead|Warp-in}}
{{NPCTableRow|Frigate|3|Harvest Follower|point=scram}}
|}
===== 2nd Room =====
{{NPCTableHead|Initial defenders}}
{{NPCTableRow|Battleship|1|Harvest Overseer|ewar=Neut}}
|}
==== Escalation ====
Some text only.
===== Crimson Harvest Sanctuary =====
{{NPCTableHead|Only Room}}
{{NPCTableRow|Cruiser|2|Harvest Prophet|point=yes}}
|}
=== Hacking ===
{{NPCTableHead|Not combat}}
{{NPCTableRow|Frigate|1|Ignored}}
|}
`;

describe('convertEventPage', () => {
  const results = convertEventPage(
    { title: 'Crimson Harvest (2026)', revision: 7, timestamp: '', content: EVENT },
    'd',
  );
  const files = results.filter((r) => r.file).map((r) => r.file!);

  it('turns each combat section with NPC tables into an encounter', () => {
    expect(files.map((f) => [f.id, f.name, f.kind])).toEqual([
      ['crimson-harvest-crimson-gauntlet', 'Crimson Gauntlet', 'anomaly'],
      ['crimson-harvest-crimson-harvest-sanctuary', 'Crimson Harvest Sanctuary', 'escalation'],
    ]);
    expect(results.find((r) => !r.file)?.skipped).toBe('event section without NPC tables (Escalation)');
  });

  it('keeps sub-headings as pockets, links the section and validates', () => {
    const g = files[0]!;
    expect((g.pockets as { name: string }[]).map((p) => p.name)).toEqual(['Pocket 1', '2nd Room']);
    expect((g.sources as Record<string, { url: string }>).uni!.url).toBe(
      'https://wiki.eveuniversity.org/Crimson_Harvest_(2026)#Crimson_Gauntlet',
    );
    expect(g.aliases).toEqual(['Crimson Harvest: Crimson Gauntlet']);
    for (const f of files) expect(parseKbFile(`${String(f.id)}.yaml`, stringify(f)).issues).toEqual([]);
  });
});

describe('room-titled NPC tables', () => {
  it('start a new pocket', () => {
    const page = `{{CMBSiteInfo
|name = Base
|type = anomaly
}}
{{NPCTableHead|Structures}}
{{NPCTableRow|Structure|1|Tower}}
|}
{{NPCTableHead|Initial defenders}}
{{NPCTableRow|Frigate|2|Tetrimon Crucifier}}
|}
{{NPCTableHead|2nd Room}}
{{NPCTableRow|Frigate|2|Tetrimon Crusader}}
|}
{{NPCTableHead|Final Wave}}
{{NPCTableRow|Battleship|1|Tetrimon Commander}}
|}
`;
    const f = convertWikiPage({ title: 'Base', revision: 1, timestamp: '', content: page }, 'd').file!;
    const pockets = f.pockets as { name: string; waves: { id: string }[] }[];
    expect(pockets.map((p) => [p.name, p.waves.map((w) => w.id)])).toEqual([
      ['Pocket 1', ['structures', 'initial-defenders']],
      ['2nd Room', ['2nd-room', 'final-wave']],
    ]);
  });
});

describe('anomaly class', () => {
  const site = (extra: string) => `id: den
kind: anomaly
name: Guristas Den
sources:
  uni: { title: Uni page, url: https://example.org }
${extra}`;

  it('reads the field', () => {
    expect(parseKbFile('den.yaml', site('anomalyClass: 4')).encounter!.anomalyClass).toBe(4);
  });

  it('falls back to the wiki note of files imported before the field existed', () => {
    const { encounter, issues } = parseKbFile(
      'den.yaml',
      site('notes:\n  - text: "Rating: Class 8 Level 3"\n  - text: Something else'),
    );
    expect(issues).toEqual([]);
    expect(encounter!.anomalyClass).toBe(8);
    expect(parseKbFile('den.yaml', site('')).encounter!.anomalyClass).toBeNull();
  });
});

describe('escalations (EVE-68)', () => {
  it('reads an expedition page as an escalation', () => {
    const file = convertWikiPage(
      page(
        'Angel Powergrid',
        WATCH.replace('|type = unrated', '|type = expedition').replace('Guristas Watch', 'Angel Powergrid'),
      ),
      '2026-10-23',
    ).file!;
    expect(file).toMatchObject({ id: 'angel-powergrid', kind: 'escalation', name: 'Angel Powergrid' });
  });
});

describe('site pages without an infobox (EVE-69)', () => {
  const YARD = `{{CMBSite|Guristas Yard}}
{{NPCTableCSS}}'''Guristas Yard''' is a [[combat anomaly]] found in Caldari low and null security systems.
==Walkthrough==
The next wave is triggered when the last rat from the previous wave is destroyed.
=== Dark Shipyard type ===
{{NPCTableHead|Initial defenders}}
{{NPCTableRow|Cruiser|2|Pithum Ascriber/Silencer|trigger=Triggers next wave when destroyed}}
|}
=== Silo type ===
{{NPCTableHead|Initial defenders}}
{{NPCTableRow|Destroyer|1-2|Pithior Guerilla/Terrorist}}
|}
{{Combat Anomalies|Guristas}}`;

  it('reads them with the kind of their wiki category', () => {
    const file = convertWikiPage(page('Guristas Yard', YARD), '2026-10-23', undefined, 'anomaly').file!;
    expect(file).toMatchObject({
      id: 'guristas-yard',
      kind: 'anomaly',
      name: 'Guristas Yard',
      enemyFaction: 'Guristas Pirates',
    });
    expect((file.pockets as { name: string }[]).map((p) => p.name)).toEqual(['Dark Shipyard type', 'Silo type']);
  });

  it('still skips them without a category kind or without NPC tables', () => {
    expect(convertWikiPage(page('Guristas Yard', YARD), '2026-10-23').file).toBeNull();
    expect(convertWikiPage(page('Some Guide', 'Just text.'), '2026-10-23', undefined, 'anomaly').file).toBeNull();
  });
});

describe('storyline missions (EVE-70)', () => {
  const TABLE = `{|class="wikitable reports sortable"
! Name
! Level !! Type !! Volume
|-
| [[A Cargo With Attitude]]
| 1
| Courier
| 320
|
|-
| [[A Case of Kidnapping (Level 1)]]
| 1
| Encounter
| 30
|
|-
| [[A Case of Kidnapping (Level 4)]]
| 4 || Encounter || ?
|
|-
| rowspan=2 | [[A Different Drone]]
| 1 || Courier || 320
|
|-
| 3 || Courier || 4,500
|
|-
| rowspan=2 | [[Mixed Bag]]
| 2 || Courier || 320
|-
| 3 || Encounter || -
|-
| [[The Numon Claim]]
| 4 || Mission chain || 0.1
| 4x Encounter, 1x Courier.
|}`;

  it('keeps the combat missions with their level', () => {
    expect(storylineTitles(TABLE)).toEqual([
      { title: 'A Case of Kidnapping (Level 1)', set: 'mission', level: 1 },
      { title: 'A Case of Kidnapping (Level 4)', set: 'mission', level: 4 },
      { title: 'Mixed Bag', set: 'mission' },
      { title: 'The Numon Claim', set: 'mission', level: 4 },
    ]);
  });
});

describe('multi-part missions (EVE-70)', () => {
  it('lists the transcluded parts and skips the parent page', () => {
    const parent =
      "{{MissionLinks}}\n'''Labors of War''' is a Level 2 mission.\n== Part 1 ==\n{{:Labors of War (1 of 3)}}\n== Part 2 ==\n{{:Labors of War (2 of 3)}}";
    expect(transcludedParts(parent)).toEqual(['Labors of War (1 of 3)', 'Labors of War (2 of 3)']);
    expect(convertWikiPage(page('Labors of War', parent), '2026-10-23').skipped).toMatch(/multi-part/);
  });

  it('keeps the part number in the name', () => {
    const file = convertWikiPage(page('The Assault (Guristas Pirates) (2 of 3)', MISSION), '2026-10-23').file!;
    expect(file.name).toBe('The Assault (2 of 3)');
  });
});

describe('epic arc steps (EVE-71)', () => {
  it('skips steps without a fight', () => {
    for (const type of ['Talk to Agent', 'Branch', 'Travel', 'Agent interaction'])
      expect(
        convertWikiPage(page('Step', MISSION.replace('|Type= Encounter', `|Type= ${type}`)), '2026-10-23').skipped,
      ).toBe('non-combat mission step');
    expect(
      convertWikiPage(page('Fight', MISSION.replace('|Type= Encounter', '|Type= Security')), '2026-10-23').file,
    ).not.toBeNull();
  });
});

describe('prose-only site pages (EVE-72)', () => {
  const FIELD_BASE = `{{stub}}
'''EDENCOM Field Base''' is a combat anomaly that can be found in [[EDENCOM systems|EDENCOM Fortress]] systems. It is the hardest of the three EDENCOM combat anomalies.

The site consists of single ungated normal space pocket. [[Triglavian Collective]] rats spawn in waves at the center of the site.
[[Category:Combat Anomalies]]`;

  it('become text-only entries', () => {
    const file = convertWikiPage(page('EDENCOM Field Base', FIELD_BASE), '2026-10-23', undefined, 'anomaly').file!;
    expect(file).toMatchObject({ kind: 'anomaly', name: 'EDENCOM Field Base', enemyFaction: 'Triglavian Collective' });
    expect((file.notes as { text: string }[])[0]!.text).toMatch(/^EDENCOM Field Base is a combat anomaly/);
  });

  it('but not when the content is gone', () => {
    const gone = `{{Past content}}\n${FIELD_BASE}`;
    expect(convertWikiPage(page('Major Conduit', gone), '2026-10-23', undefined, 'anomaly').file).toBeNull();
  });
});

describe('anomaly class from the tier word', () => {
  it('fills a missing class from siblings with the same tier', () => {
    const e = (name: string, anomalyClass: number | null, kind: Encounter['kind'] = 'anomaly') =>
      ({ name, kind, anomalyClass }) as Encounter;
    const list = [
      e('Angel Forsaken Hub', 8),
      e('Guristas Hub', 8),
      e('Blood Hub', 7),
      e('Angel Hub', null),
      e('Odd Place', null),
      e('Hub Mission', null, 'mission'),
    ];
    fillAnomalyClasses(list);
    expect(list.map((x) => x.anomalyClass)).toEqual([8, 8, 7, 8, null, null]);
  });
});
