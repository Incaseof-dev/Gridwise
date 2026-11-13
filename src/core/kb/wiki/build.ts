/**
 * Wiki pages → KB file objects, with the SDE-based enrichment (faction, linked SDE sites, NPC name expansion).
 * Shared by `npm run kb -- import-wiki` and the in-app updater.
 */
import type { GameDataService } from '../../sde/gameData';
import type { EncounterKind } from '../types';
import { convertEventPage, convertWikiPage, type ConvertResult } from './convert';
import { fetchPageMap, latestRevisions, type WikiPage } from './fetch';
import type { SourceItem } from './sources';

type Obj = Record<string, unknown>;

const GROUP_FACTIONS: [RegExp, string][] = [
  [/gurist/i, 'Guristas Pirates'],
  [/serpentis/i, 'Serpentis'],
  [/angel/i, 'Angel Cartel'],
  [/blood raider/i, 'Blood Raider Covenant'],
  [/sansha/i, "Sansha's Nation"],
  [/rogue drone/i, 'Rogue Drones'],
  [/sleeper/i, 'Sleepers'],
  [/drifter/i, 'Drifters'],
  [/triglavian/i, 'Triglavian Collective'],
  [/mordu/i, "Mordu's Legion Command"],
  [/tetrimon/i, 'Order of Tetrimon'],
  [/edencom/i, 'EDENCOM'],
];

/** Last resort for event/"Irregular" NPCs without faction or telling group: the well-known name prefixes. */
const NAME_FACTIONS: [RegExp, string][] = [
  [/^(dire |dread )?(pith|gurist)/i, 'Guristas Pirates'],
  [/^(shadow )?(core|serpentis)/i, 'Serpentis'],
  [/^(domination )?(gist|angel)/i, 'Angel Cartel'],
  [/^(dark blood )?(corp|blood raider|harvest)/i, 'Blood Raider Covenant'],
  [/^(true )?(cent|sansha)/i, "Sansha's Nation"],
  [/^tetrimon/i, 'Order of Tetrimon'],
];

/**
 * Enemy faction from the encounter's NPC types when the source page does not name one:
 * the SDE faction of the type, else a faction named in its group, else the name prefix.
 * Factions with at least 25% of the resolved NPCs are listed.
 */
export function factionFromNpcs(file: Obj, sde: GameDataService): string | null {
  const counts = new Map<string, number>();
  let total = 0;
  const npcs = (file.npcs as Record<string, { sdeTypes?: string[] }> | undefined) ?? {};
  for (const pocket of (file.pockets as { waves?: { spawns?: { names: string[] }[] }[] }[] | undefined) ?? [])
    for (const w of pocket.waves ?? [])
      for (const sp of w.spawns ?? [])
        for (const display of sp.names)
          for (const name of npcs[display]?.sdeTypes ?? [display]) {
            const t = sde.typesByName(name, 11)[0];
            if (!t) continue;
            const f =
              sde.factionName(t.factionId) ??
              GROUP_FACTIONS.find(([re]) => re.test(t.groupName))?.[1] ??
              NAME_FACTIONS.find(([re]) => re.test(name))?.[1];
            if (!f) continue;
            total++;
            counts.set(f, (counts.get(f) ?? 0) + 1);
          }
  const main = [...counts].filter(([, n]) => n / total >= 0.25).sort((a, b) => b[1] - a[1]);
  return main.length ? main.map(([f]) => f).join(' & ') : null;
}

/** Links a site to SDE dungeons: exactly by name, or loosely for event sections ("Hollow Outbreak"). */
function linkDungeons(file: Obj, sde: GameDataService, loose: boolean): void {
  const wanted = String(file.name).toLowerCase();
  const hits = sde
    .search(String(file.name), { kinds: ['dungeon'], limit: 20 })
    .filter((h) => (loose ? h.name.toLowerCase().includes(wanted) : h.name.toLowerCase() === wanted));
  if (!hits.length) return;
  file.sde = { dungeonIds: hits.map((h) => h.refId) };
  const extra = hits.map((h) => h.name).filter((n) => n.toLowerCase() !== wanted);
  if (extra.length) file.aliases = [...new Set([...((file.aliases as string[] | undefined) ?? []), ...extra])];
}

/** Kind of the sites in a wiki category, for pages without an infobox that says it. */
export function kindOfCategory(category: string | undefined): EncounterKind | undefined {
  if (!category) return undefined;
  if (/anomal/i.test(category)) return 'anomaly';
  if (/complex/i.test(category)) return 'complex';
  if (/expedition|escalation/i.test(category)) return 'escalation';
  return undefined;
}

/** Sub-pages a multi-part mission page shows by transclusion: {{:Customs Interdiction (1 of 2)}}. */
export function transcludedParts(content: string): string[] {
  return [...content.matchAll(/\{\{:([^}|]+)\}\}/g)].map((m) => m[1]!.trim());
}

/**
 * Multi-part missions (Recon, Angel Strike, Enemies Abound, …) have a page that only transcludes its parts; the
 * parts carry the Missiondetails box. Adds the parts as items of their own, with the parent's set and level, and
 * fetches them. A part that changes without its parent page is picked up at the next full import.
 */
export async function addTranscludedParts(
  items: SourceItem[],
  pages: Map<string, WikiPage>,
  cacheDir: string,
): Promise<SourceItem[]> {
  const known = new Set(items.map((i) => i.title));
  const parts: SourceItem[] = [];
  for (const item of items) {
    const page = pages.get(item.title);
    if (!page || item.set !== 'mission' || /\{\{\s*missiondetails/i.test(page.content)) continue;
    for (const title of transcludedParts(page.content)) {
      if (known.has(title)) continue;
      known.add(title);
      parts.push({ ...item, title });
    }
  }
  if (!parts.length) return [];
  const titles = parts.map((p) => p.title);
  for (const [t, p] of await fetchPageMap(titles, { cacheDir, knownRevisions: await latestRevisions(titles) }))
    pages.set(t, p);
  return parts.filter((p) => pages.has(p.title));
}

/** Converts one fetched page into zero or more KB file objects. */
export function convertItem(
  item: SourceItem,
  page: WikiPage,
  retrieved: string,
  sde: GameDataService | null,
): ConvertResult[] {
  const isNpc = sde ? (name: string) => sde.typesByName(name, 11).length > 0 : undefined;
  const results =
    item.set === 'event'
      ? convertEventPage(page, retrieved, isNpc)
      : [convertWikiPage(page, retrieved, isNpc, item.set === 'site' ? kindOfCategory(item.category) : undefined)];
  for (const r of results) {
    const file = r.file;
    if (!file) continue;
    if (item.set === 'mission' && file.kind === 'mission' && !file.level && item.level) file.level = item.level;
    if (sde && !file.enemyFaction) file.enemyFaction = factionFromNpcs(file, sde);
    if (sde && file.kind !== 'mission') linkDungeons(file, sde, item.set === 'event');
  }
  return results;
}
