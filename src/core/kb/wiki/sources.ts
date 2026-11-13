/**
 * Which wiki pages make up the knowledge base (kb/sources.json). The maintainer edits this file, e.g. to add the
 * page of a new event; the importer and the in-app updater both read it.
 */
import { readFileSync } from 'node:fs';
import { categoryMembers, fetchPages, latestRevisions } from './fetch';

export interface KbSources {
  missionLevels: number[];
  /** Also the combat missions of "Storyline mission reports" (EVE-70). */
  storylineMissions: boolean;
  /**
   * Wiki categories of mission pages, e.g. "Epic_Arcs" (EVE-71). Chapter pages only transclude their missions,
   * which the import then reads as multi-part parts.
   */
  missionCategories: string[];
  siteCategories: string[];
  eventPages: string[];
}

export interface SourceItem {
  title: string;
  set: 'mission' | 'site' | 'event';
  /** Mission level from the "Mission reports" tab it is listed on. */
  level?: number;
  /** Wiki category a site page was listed in, e.g. "Combat_Anomalies". */
  category?: string;
}

export function loadSources(path: string): KbSources {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<KbSources>;
  return {
    missionLevels: raw.missionLevels ?? [1, 2, 3, 4, 5],
    storylineMissions: raw.storylineMissions ?? false,
    missionCategories: raw.missionCategories ?? [],
    siteCategories: raw.siteCategories ?? [],
    eventPages: raw.eventPages ?? [],
  };
}

/** Mission page titles per level from the "Mission reports" page's "Level N Missions" tabs. */
export function missionTitles(reportsContent: string, levels: number[]): SourceItem[] {
  const out: SourceItem[] = [];
  for (const level of levels) {
    const start = reportsContent.indexOf(`<tab name="Level ${level} Missions">`);
    if (start < 0) continue;
    const end = reportsContent.indexOf('</tab>', start);
    for (const m of reportsContent
      .slice(start, end < 0 ? undefined : end)
      .matchAll(/\|\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)) {
      out.push({ title: m[1]!.trim(), set: 'mission', level });
    }
  }
  return out;
}

/**
 * Combat missions of the "Storyline mission reports" table: a row per mission (rowspan rows for more levels) with
 * level and type. Couriers and trade missions are left out; the level is kept when the mission has only one.
 */
export function storylineTitles(content: string): SourceItem[] {
  const missions = new Map<string, { levels: Set<number>; combat: boolean }>();
  let current: { levels: Set<number>; combat: boolean } | null = null;
  // Rows start with "|-"; a row's cells sit on one or more lines, split by "||".
  for (const row of content.split(/\n\|-[^\n]*/).slice(1)) {
    const cells = row
      .split('\n')
      .filter((l) => l.startsWith('|') && !l.startsWith('|}'))
      .flatMap((l) => l.slice(1).split('||'))
      .map((c) => c.trim());
    const link = /\[\[([^\]|#]+)/.exec(cells[0] ?? '');
    if (link) {
      const title = link[1]!.trim();
      current = missions.get(title) ?? { levels: new Set(), combat: false };
      missions.set(title, current);
      cells.shift();
    }
    if (!current || !cells.length) continue;
    const [level, type] = cells;
    if (/^\d+$/.test(level ?? '')) current.levels.add(Number(level));
    if (/encounter|chain/i.test(type ?? '')) current.combat = true;
  }
  return [...missions]
    .filter(([, m]) => m.combat)
    .map(([title, m]) => ({
      title,
      set: 'mission' as const,
      ...(m.levels.size === 1 ? { level: [...m.levels][0]! } : {}),
    }));
}

/** Lists every page of the configured sources (a handful of API requests). */
export async function listSourceItems(
  src: KbSources,
  opts: { cacheDir: string; sets?: SourceItem['set'][] },
): Promise<SourceItem[]> {
  const want = (s: SourceItem['set']) => !opts.sets || opts.sets.includes(s);
  const items: SourceItem[] = [];
  if (want('mission') && src.missionLevels.length) {
    const reportsTitle = 'Mission reports';
    const [reports] = await fetchPages([reportsTitle], {
      cacheDir: opts.cacheDir,
      knownRevisions: await latestRevisions([reportsTitle]),
    });
    if (!reports) throw new Error('could not fetch "Mission reports"');
    items.push(...missionTitles(reports.content, src.missionLevels));
  }
  if (want('mission'))
    for (const c of src.missionCategories)
      for (const t of await categoryMembers(c)) if (!/^User:/.test(t)) items.push({ title: t, set: 'mission' });
  if (want('mission') && src.storylineMissions) {
    const title = 'Storyline mission reports';
    const [page] = await fetchPages([title], {
      cacheDir: opts.cacheDir,
      knownRevisions: await latestRevisions([title]),
    });
    if (!page) throw new Error(`could not fetch "${title}"`);
    items.push(...storylineTitles(page.content));
  }
  if (want('site')) {
    const seen = new Set<string>();
    for (const c of src.siteCategories)
      for (const t of await categoryMembers(c)) {
        // Drafts in user space are listed in categories too.
        if (seen.has(t) || /^User:/.test(t)) continue;
        seen.add(t);
        items.push({ title: t, set: 'site', category: c });
      }
  }
  if (want('event')) for (const t of src.eventPages) items.push({ title: t, set: 'event' });
  // A page listed under several levels (e.g. a shared disambiguation) is imported once, at its first level.
  const unique = new Map<string, SourceItem>();
  for (const i of items) if (!unique.has(`${i.set}|${i.title}`)) unique.set(`${i.set}|${i.title}`, i);
  return [...unique.values()];
}
