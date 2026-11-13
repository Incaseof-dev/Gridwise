import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { siteMapFromWiki } from '../kb/wiki/sitemap';
import { parseTables } from '../kb/wiki/tables';
import { factionSections, parseSiteMap } from './parse';

/** Excerpts of the real "Combat site" tables (EVE University wiki, CC BY-SA 4.0), fewer rows. */
const PAGE = `== Anomalies ==
{|class="wikitable anomalies"
|- style="background-color: x;"
! colspan="2" | Difficulty
! colspan="3" | Found In
! colspan="12" | Combat anomalies
|-
! Tier
! Level
! style="color: cyan" | High
! style="color: #F87609"| Low
! style="color: red"| Null
! colspan="2" | [[Angel Cartel]]
! colspan="2" | [[Blood Raiders]]
! colspan="2" | [[Guristas Pirates]]
! colspan="2" | [[Sansha's Nation]]
! colspan="2" | [[Serpentis Corporation]]
! colspan="2" | [[Rogue Drones]]
|-
| rowspan="2"| 1
| 1
! style="color: cyan;" | ✔
! style="color: #F87609;" | ✔
!
| [[Angel Hideaway]]
| None
| [[Blood Hideaway]]
| None
| [[Guristas Hideaway]]
| [[Guristas Scout Outpost|4/10]]
| [[Sansha Hideaway]]
| None
| [[Serpentis Hideaway]]
| None
| rowspan="2" | [[Drone Cluster]]
| rowspan="2" | None
|-
| 2
! style="color:cyan;"| ✔
!
!
| [[Angel Hidden Hideaway]]
| None
| [[Blood Hidden Hideaway]]
| None
| [[Guristas Hidden Hideaway]]
| ?
| [[Sansha Hidden Hideaway]]
| None
| [[Serpentis Hidden Hideaway]]
| None
|}

=== Unrated complexes ===
{|class="wikitable"
|-
!colspan="3" | Found In
!colspan="6" | Unrated complexes
|-
! High
! Low
! Null
! [[Angel Cartel]]
! [[Blood Raiders]]
! [[Guristas Pirates]]
! [[Sansha's Nation]]
! [[Serpentis Corporation]]
! [[Rogue Drones]]
|-
!style="color: cyan;"| ✔
!style="color: #F87609;"| ✔
!
|[[Angel Hideout]]
|[[Blood Hideout]]
|[[Gurista Hideout]]
|[[Sansha Hideout]]
|[[Serpentis Hideout]]
|[[Haunted Yard]]
|-
!
!
!style="color: red;"| ✔
|[[Angel Domination Fleet Staging Point]]
|[[Dark Blood Fleet Staging Point]]
|[[Dread Guristas Fleet Staging Point]]
|[[True Sansha Fleet Staging Point]]
|[[Shadow Serpentis Fleet Staging Point]]
| -
|}

=== DED rated complexes ===
{|class="wikitable"
|-
!rowspan="2" | DED Rating
!colspan="3" | Found In
!colspan="6" | DED complexes
|-
! High
! Low
! Null
! [[Angel Cartel]]
! [[Blood Raiders]]
! [[Guristas Pirates]]
! [[Sansha's Nation]]
! [[Serpentis Corporation]]
! [[Rogue Drones]]
|-
! 4/10
!style="color: cyan;"| ✔
!style="color: #F87609;"| ✔
!
|[[Angel Cartel Occupied Mining Colony]]
|[[Mul-Zatah Monastery]]
|[[Guristas Scout Outpost]]
|[[Sansha's Nation Occupied Mining Colony]]
|[[Serpentis Phi-Outpost]]
| [[Drone Infested Mine]]
|}

== Expeditions ==
{|class="wikitable"
|-
!rowspan="2" | Unrated Complex
!colspan="6" | Expeditions
|-
! [[Angel Cartel]]
! [[Blood Raiders]]
! [[Guristas Pirates]]
! [[Sansha's Nation]]
! [[Serpentis Corporation]]
! [[Rogue Drones]]
|-
|style="color: cyan;"|High Sec
|colspan="6"|Expeditions may appear in lower security systems.
|-
| <Faction> Hideout <br> Haunted Yard
|[[Blue Pill]]
|[[Frentex]]
|[[Sooth Sayer]]
|[[Drop]]
|[[Mindflood]]
|[[Pulverize The Pioneers]]
|-
|| <Faction> Fleet Staging Point
|[[Angel Domination Fleet Staging Point 2]] and [[Angel Domination Fleet Staging Point 3|3]]
|[[Dark Blood Fleet Staging Point 2]]
|[[Dread Guristas Fleet Staging Point 2]] and [[Dread Guristas Fleet Staging Point 3|3]]
|[[True Sansha Fleet Staging Point 2]]
|[[Shadow Serpentis Fleet Staging Point 2 and part 3]]
| -
|}
`;

const map = siteMapFromWiki({ title: 'Combat site', revision: 7, timestamp: '', content: PAGE }, '2026-10-23', (n) =>
  n === 'Guristas Hideaway' ? [42] : [],
);
const site = (name: string) => map.sites.find((s) => s.name === name)!;
const linksFrom = (name: string) => map.links.filter((l) => l.from === site(name).id).map((l) => [l.kind, l.to]);

describe('wiki tables', () => {
  it('expands rowspan and colspan to the column the reader sees', () => {
    const [t] = parseTables('{|\n|-\n! colspan="2" | A\n! B\n|-\n| rowspan="2" | x\n| y\n| z\n|-\n| y2\n| z2\n|}');
    expect(t!.map((r) => r.map((c) => c.text))).toEqual([
      ['A', 'A', 'B'],
      ['x', 'y', 'z'],
      ['x', 'y2', 'z2'],
    ]);
    expect(t![2]![0]!.spanned).toBe(true);
  });

  it('reads attributes, links and inline cells', () => {
    const [t] = parseTables('{|\n|-\n! style="color: red;" | ✔ !! [[Foo_bar|Baz]]\n| a || b\n|}');
    expect(t![0]!.map((c) => c.text)).toEqual(['✔', 'Baz', 'a', 'b']);
    expect(t![0]![1]!.links).toEqual([{ page: 'Foo bar', label: 'Baz' }]);
  });
});

describe('site map from the wiki', () => {
  it('has the six factions and every site under its faction', () => {
    expect(map.factions.map((f) => f.id)).toEqual(['angel', 'blood', 'guristas', 'sansha', 'serpentis', 'drones']);
    expect(site('Guristas Hideaway')).toMatchObject({
      faction: 'guristas',
      kind: 'anomaly',
      tier: 1,
      level: 1,
      space: ['high', 'low'],
      sdeDungeonIds: [42],
      page: 'Guristas Hideaway',
    });
    expect(site('Guristas Hidden Hideaway')).toMatchObject({ tier: 1, level: 2, space: ['high'] });
    expect(site('Guristas Scout Outpost')).toMatchObject({ kind: 'ded', ded: 4, space: ['high', 'low'] });
    expect(site('Dread Guristas Fleet Staging Point')).toMatchObject({ kind: 'unrated', space: ['null'] });
  });

  it('keeps a row-spanning drone anomaly as one site without a level', () => {
    const drone = site('Drone Cluster');
    expect(drone).toMatchObject({ faction: 'drones', tier: 1, space: ['high', 'low'] });
    expect(drone.level).toBeUndefined();
  });

  it('links escalations and expedition parts', () => {
    expect(linksFrom('Guristas Hideaway')).toEqual([['escalation', 'guristas-scout-outpost']]);
    expect(linksFrom('Guristas Hidden Hideaway')).toEqual([]);
    expect(linksFrom('Gurista Hideout')).toEqual([['escalation', 'sooth-sayer']]);
    expect(linksFrom('Haunted Yard')).toEqual([['escalation', 'pulverize-the-pioneers']]);
    expect(linksFrom('Dread Guristas Fleet Staging Point')).toEqual([
      ['escalation', 'dread-guristas-fleet-staging-point-2'],
    ]);
    expect(linksFrom('Dread Guristas Fleet Staging Point 2')).toEqual([
      ['next-part', 'dread-guristas-fleet-staging-point-3'],
    ]);
    // "[[… 3|3]]": a bare number is not a name.
    expect(site('Dread Guristas Fleet Staging Point 3').name).toBe('Dread Guristas Fleet Staging Point 3');
    expect(site('Sooth Sayer')).toMatchObject({ kind: 'expedition', space: ['high', 'low'] });
  });

  it('round-trips through the validator', () => {
    expect(parseSiteMap(JSON.parse(JSON.stringify(map)))).toEqual(map);
    expect(() => parseSiteMap({ ...map, links: [{ from: 'x', to: 'y', kind: 'escalation' }] })).toThrow(/unknown site/);
    expect(() => parseSiteMap({ ...map, schema: 99 })).toThrow(/schema/);
  });

  it('fails loudly when the page layout changes', () => {
    expect(() =>
      siteMapFromWiki({ title: 'Combat site', revision: 1, timestamp: '', content: 'no tables' }, 'x'),
    ).toThrow(/layout changed/);
  });
});

describe('faction sections', () => {
  const sections = factionSections(map, 'guristas');

  it('groups by kind; escalation targets are references, expedition parts hang below', () => {
    expect(sections.map((s) => s.kind)).toEqual(['anomaly', 'unrated', 'ded']);
    const hideaway = sections[0]!.rows.find((r) => r.site.name === 'Guristas Hideaway')!;
    expect(hideaway.children.map((c) => [c.site.name, c.via, c.reference])).toEqual([
      ['Guristas Scout Outpost', 'escalation', true],
    ]);
    const staging = sections[1]!.rows.find((r) => r.site.name === 'Dread Guristas Fleet Staging Point')!;
    expect(staging.children[0]!.site.name).toBe('Dread Guristas Fleet Staging Point 2');
    expect(staging.children[0]!.children[0]!.via).toBe('next-part');
  });

  it('tells a DED complex where it can come from', () => {
    const outpost = sections[2]!.rows[0]!;
    expect(outpost.from.map((s) => s.name)).toEqual(['Guristas Hideaway']);
  });
});

describe('bundled kb/sitemap.json', () => {
  const bundled = parseSiteMap(JSON.parse(readFileSync(join(process.cwd(), 'kb', 'sitemap.json'), 'utf8')));

  it('covers every faction with all four kinds', () => {
    for (const f of bundled.factions)
      for (const kind of ['anomaly', 'unrated', 'ded', 'expedition'])
        expect(
          bundled.sites.some((s) => s.faction === f.id && s.kind === kind),
          `${f.id} ${kind}`,
        ).toBe(true);
  });

  it('knows the classic chains', () => {
    const id = (name: string) => bundled.sites.find((s) => s.name === name)!.id;
    const has = (from: string, to: string) => bundled.links.some((l) => l.from === id(from) && l.to === id(to));
    expect(has('Guristas Hideaway', 'Guristas Scout Outpost')).toBe(true);
    expect(has('Guristas Haven', 'The Maze')).toBe(true);
    expect(has('Gurista Hideout', 'Sooth Sayer')).toBe(true);
  });
});
