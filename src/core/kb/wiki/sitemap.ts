/**
 * The wiki's "Combat site" overview page → the enemy site map (EVE-74). Its tables list, per pirate faction, the
 * anomalies (tier, level, high/low/null, the DED complex they can escalate to), the unrated and the DED complexes
 * (high/low/null), and the expedition each unrated complex can start.
 */
import { SITEMAP_KINDS, SITEMAP_SCHEMA, type SecClass, type SiteMap, type SiteMapFaction } from '../../sitemap/types';
import type { SiteMapKind, SiteMapLink, SiteMapLinkKind, SiteMapSite } from '../../sitemap/types';
import { slug } from './convert';
import { pageUrl, type WikiPage } from './fetch';
import { parseTables, type TableRow, type WikiLink } from './tables';
import { cleanText } from './wikitext';

export const SITEMAP_PAGE = 'Combat site';

interface FactionDef extends SiteMapFaction {
  header: RegExp;
  /** Faction words in site names, longest first, for matching "<Faction> Hideout" rows. */
  tokens: string[];
}

const FACTIONS: FactionDef[] = [
  { id: 'angel', name: 'Angel Cartel', sdeFactionId: 500011, header: /angel/i, tokens: ['Angel Domination', 'Angel'] },
  {
    id: 'blood',
    name: 'Blood Raider Covenant',
    sdeFactionId: 500012,
    header: /blood/i,
    tokens: ['Dark Blood', 'Blood Raider', 'Blood'],
  },
  {
    id: 'guristas',
    name: 'Guristas Pirates',
    sdeFactionId: 500010,
    header: /gurist/i,
    tokens: ['Dread Guristas', 'Guristas', 'Gurista'],
  },
  { id: 'sansha', name: "Sansha's Nation", sdeFactionId: 500019, header: /sansha/i, tokens: ['True Sansha', 'Sansha'] },
  {
    id: 'serpentis',
    name: 'Serpentis',
    sdeFactionId: 500020,
    header: /serpentis/i,
    tokens: ['Shadow Serpentis', 'Serpentis'],
  },
  { id: 'drones', name: 'Rogue Drones', sdeFactionId: 500025, header: /rogue drone/i, tokens: [] },
];

const SEC_HEADERS: [SecClass, RegExp][] = [
  ['high', /^high$/i],
  ['low', /^low$/i],
  ['null', /^null$/i],
];

const CHECK = '✔';

/** The header row that names the factions, and which column belongs to which faction (first column first). */
function factionColumns(rows: TableRow[]): { headerRow: number; columns: Map<string, number[]> } | null {
  const headerRow = rows.findIndex((r) => r.filter((c) => FACTIONS.some((f) => f.header.test(c.text))).length >= 4);
  if (headerRow < 0) return null;
  const columns = new Map<string, number[]>();
  rows[headerRow]!.forEach((c, i) => {
    const f = FACTIONS.find((x) => x.header.test(c.text));
    if (f) columns.set(f.id, [...(columns.get(f.id) ?? []), i]);
  });
  return { headerRow, columns };
}

function columnOf(rows: TableRow[], headerRow: number, re: RegExp): number {
  return rows[headerRow]!.findIndex((c) => re.test(c.text));
}

function spaceOf(row: TableRow, secColumns: [SecClass, number][]): SecClass[] {
  return secColumns.filter(([, i]) => i >= 0 && row[i]?.text.includes(CHECK)).map(([s]) => s);
}

/** Footnotes on a row's security marks, e.g. "DED 5/10s cannot naturally spawn in high security systems, …". */
function spaceNotes(row: TableRow, secColumns: [SecClass, number][]): string[] {
  return secColumns.flatMap(([, i]) =>
    i < 0 || row[i]?.spanned
      ? []
      : [...(row[i]?.raw ?? '').matchAll(/<ref[^>/]*>([\s\S]*?)<\/ref>/g)].map((m) => cleanText(m[1]!)),
  );
}

const tableWith = (tables: TableRow[][], re: RegExp) =>
  tables.find((t) => t.slice(0, 3).some((r) => r.some((c) => c.header && re.test(c.text))));

const dedOf = (s: string) => {
  const m = /(\d+)\s*\/\s*10/.exec(s);
  return m ? Number(m[1]) : undefined;
};

class Builder {
  readonly sites = new Map<string, SiteMapSite>();
  private readonly links = new Map<string, SiteMapLink>();
  private order = 0;

  constructor(private readonly dungeonIds: (name: string) => number[]) {}

  site(
    link: WikiLink,
    faction: string,
    kind: SiteMapKind,
    space: SecClass[],
    extra: Pick<SiteMapSite, 'tier' | 'level' | 'ded' | 'notes'> = {},
  ): SiteMapSite {
    const id = slug(link.page);
    // "[[Dark Blood Fleet Staging Point 3|3]]": a bare number is no name.
    const name = link.label && !/^[\d\s/]+$/.test(link.label) ? link.label : link.page;
    const known = this.sites.get(id);
    if (known) {
      known.space = [...new Set([...known.space, ...space])];
      // A row-spanning cell (Drone Gathering over levels 1–4) is one site without a single level.
      if (known.level !== extra.level) delete known.level;
      return known;
    }
    const site: SiteMapSite = {
      id,
      name,
      faction,
      kind,
      ...extra,
      space,
      page: link.page,
      sdeDungeonIds: this.dungeonIds(name),
      order: this.order++,
    };
    if (!site.sdeDungeonIds.length && name !== link.page) site.sdeDungeonIds = this.dungeonIds(link.page);
    this.sites.set(id, site);
    return site;
  }

  link(from: SiteMapSite, to: SiteMapSite, kind: SiteMapLinkKind): void {
    this.links.set(`${from.id}>${to.id}`, { from: from.id, to: to.id, kind });
  }

  result(): { sites: SiteMapSite[]; links: SiteMapLink[] } {
    const fi = (id: string) => FACTIONS.findIndex((f) => f.id === id);
    const sites = [...this.sites.values()].sort(
      (a, b) =>
        fi(a.faction) - fi(b.faction) ||
        SITEMAP_KINDS.indexOf(a.kind) - SITEMAP_KINDS.indexOf(b.kind) ||
        a.order - b.order,
    );
    return { sites, links: [...this.links.values()] };
  }
}

function readDed(rows: TableRow[], b: Builder): void {
  const fc = factionColumns(rows);
  if (!fc) throw new Error('DED complex table: no faction header row');
  const sec = SEC_HEADERS.map(([s, re]) => [s, columnOf(rows, fc.headerRow, re)] as [SecClass, number]);
  for (const row of rows.slice(fc.headerRow + 1)) {
    const ded = dedOf(row[0]?.text ?? '');
    if (!ded) continue;
    for (const [faction, [col]] of fc.columns) {
      const link = row[col!]?.links[0];
      const notes = spaceNotes(row, sec);
      if (link) b.site(link, faction, 'ded', spaceOf(row, sec), { ded, ...(notes.length ? { notes } : {}) });
    }
  }
}

function readUnrated(rows: TableRow[], b: Builder): void {
  const fc = factionColumns(rows);
  if (!fc) throw new Error('unrated complex table: no faction header row');
  const sec = SEC_HEADERS.map(([s, re]) => [s, columnOf(rows, fc.headerRow, re)] as [SecClass, number]);
  for (const row of rows.slice(fc.headerRow + 1))
    for (const [faction, [col]] of fc.columns) {
      const link = row[col!]?.links[0];
      const notes = spaceNotes(row, sec);
      if (link) b.site(link, faction, 'unrated', spaceOf(row, sec), notes.length ? { notes } : {});
    }
}

function readAnomalies(rows: TableRow[], b: Builder): void {
  const fc = factionColumns(rows);
  if (!fc) throw new Error('anomaly table: no faction header row');
  const sec = SEC_HEADERS.map(([s, re]) => [s, columnOf(rows, fc.headerRow, re)] as [SecClass, number]);
  const tierCol = columnOf(rows, fc.headerRow, /^tier$/i);
  const levelCol = columnOf(rows, fc.headerRow, /^level$/i);
  for (const row of rows.slice(fc.headerRow + 1)) {
    const tier = Number.parseInt(row[tierCol]?.text ?? '', 10);
    if (!Number.isFinite(tier)) continue;
    const level = Number.parseInt(row[levelCol]?.text ?? '', 10);
    const space = spaceOf(row, sec);
    for (const [faction, [siteCol, escCol]] of fc.columns) {
      const link = row[siteCol!]?.links[0];
      if (!link) continue;
      const site = b.site(link, faction, 'anomaly', space, { tier, ...(Number.isFinite(level) ? { level } : {}) });
      const esc = escCol === undefined ? undefined : row[escCol]?.links[0];
      if (!esc) continue;
      const ded = dedOf(esc.label);
      // The target is normally already known from the DED table; it keeps that table's name and security.
      const target = b.site({ page: esc.page, label: esc.page }, faction, 'ded', [], ded ? { ded } : {});
      b.link(site, target, 'escalation');
    }
  }
}

/** "Provisional <Faction> Outpost" and "Provisional Blood Outpost" both become "provisional <f> outpost". */
function template(name: string, tokens: string[]): string {
  let t = name;
  for (const token of tokens) {
    const re = new RegExp(`\\b${token}\\b`, 'i');
    if (re.test(t)) {
      t = t.replace(re, '<f>');
      break;
    }
  }
  return t.replace(/\s+/g, ' ').trim().toLowerCase();
}

function readExpeditions(rows: TableRow[], b: Builder): void {
  const fc = factionColumns(rows);
  if (!fc) throw new Error('expedition table: no faction header row');
  const all = [...b.sites.values()];
  for (const row of rows.slice(fc.headerRow + 1)) {
    const label = row[0];
    if (!label || /\bsec\b/i.test(label.text)) continue;
    const [pirateLabel = '', droneLabel = ''] = label.raw
      .split(/<br\s*\/?>/i)
      .map((s) => cleanText(s.replace(/<faction>/gi, 'FACTIONWORD')).replace(/FACTIONWORD/g, '<f>'));
    const wanted = pirateLabel.replace(/\s+/g, ' ').trim().toLowerCase();
    for (const [faction, [col]] of fc.columns) {
      const cell = row[col!];
      if (!cell?.links.length) continue;
      const def = FACTIONS.find((f) => f.id === faction)!;
      const own = all.filter((s) => s.faction === faction);
      const ded = dedOf(wanted);
      const origin =
        faction === 'drones'
          ? own.find((s) => s.kind === 'unrated' && s.name.toLowerCase() === droneLabel.toLowerCase())
          : ded
            ? own.find((s) => s.kind === 'ded' && s.ded === ded)
            : own.find(
                (s) =>
                  s.kind === 'unrated' &&
                  (template(s.name, def.tokens) === wanted || template(s.page ?? '', def.tokens) === wanted),
              );
      if (!origin) continue;
      let prev = origin;
      for (const link of cell.links) {
        const part = b.site(link, faction, 'expedition', origin.space);
        b.link(prev, part, prev === origin && origin.kind === 'unrated' ? 'escalation' : 'next-part');
        prev = part;
      }
    }
  }
}

/** Builds the site map from the "Combat site" page. `dungeonIds` finds SDE dungeons by exact name. */
export function siteMapFromWiki(
  page: WikiPage,
  retrieved: string,
  dungeonIds: (name: string) => number[] = () => [],
): SiteMap {
  const tables = parseTables(page.content);
  const need = (re: RegExp, what: string) => {
    const t = tableWith(tables, re);
    if (!t) throw new Error(`"${page.title}": no ${what} table; the page layout changed`);
    return t;
  };
  const b = new Builder(dungeonIds);
  readDed(need(/^DED complexes$/i, 'DED complex'), b);
  readUnrated(need(/^Unrated complexes$/i, 'unrated complex'), b);
  readAnomalies(need(/^Combat anomalies$/i, 'combat anomaly'), b);
  readExpeditions(need(/^Expeditions$/i, 'expedition'), b);
  const { sites, links } = b.result();
  return {
    schema: SITEMAP_SCHEMA,
    source: {
      title: page.title,
      url: pageUrl(page.title),
      revision: page.revision,
      retrieved,
      license: 'CC BY-SA 4.0',
    },
    factions: FACTIONS.map(({ id, name, sdeFactionId }) => ({ id, name, sdeFactionId })),
    sites,
    links,
  };
}
