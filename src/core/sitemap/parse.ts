/**
 * Reading kb/sitemap.json back (EVE-74). Dependency-free, so the renderer can use the tree helpers too.
 */
import { SEC_CLASSES, SITEMAP_KINDS, SITEMAP_SCHEMA, type SiteMap, type SiteMapLink, type SiteMapSite } from './types';

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Checks the shape and the references; throws with the first problem found. */
export function parseSiteMap(raw: unknown): SiteMap {
  if (!isObj(raw)) throw new Error('site map: not an object');
  if (raw.schema !== SITEMAP_SCHEMA)
    throw new Error(`site map: schema ${String(raw.schema)}, expected ${SITEMAP_SCHEMA}`);
  const { factions, sites, links, source } = raw;
  if (!isObj(source) || !Array.isArray(factions) || !Array.isArray(sites) || !Array.isArray(links))
    throw new Error('site map: source, factions, sites and links are required');
  const factionIds = new Set<string>();
  for (const f of factions) {
    if (!isObj(f) || typeof f.id !== 'string' || typeof f.name !== 'string') throw new Error('site map: bad faction');
    factionIds.add(f.id);
  }
  const siteIds = new Set<string>();
  for (const s of sites) {
    const ok =
      isObj(s) &&
      typeof s.id === 'string' &&
      typeof s.name === 'string' &&
      factionIds.has(s.faction as string) &&
      SITEMAP_KINDS.includes(s.kind as SiteMapSite['kind']) &&
      Array.isArray(s.space) &&
      s.space.every((x) => SEC_CLASSES.includes(x as never)) &&
      Array.isArray(s.sdeDungeonIds);
    if (!ok) throw new Error(`site map: bad site ${isObj(s) ? String(s.id) : ''}`);
    siteIds.add(s.id as string);
  }
  for (const l of links) {
    if (!isObj(l) || !siteIds.has(l.from as string) || !siteIds.has(l.to as string))
      throw new Error(`site map: link to an unknown site ${isObj(l) ? `${String(l.from)} > ${String(l.to)}` : ''}`);
  }
  return raw as unknown as SiteMap;
}

export interface SiteTreeNode {
  site: SiteMapSite;
  /** How it is reached from the parent; null for a section's own row. */
  via: SiteMapLink['kind'] | null;
  /** Expedition parts below; a site with a section of its own (a DED complex under an anomaly) has none here. */
  children: SiteTreeNode[];
  /** Has a row of its own in another section, so this one is a reference. */
  reference: boolean;
  /** Sites that escalate into this one (section rows only). */
  from: SiteMapSite[];
}

export interface SiteSection {
  kind: SiteMapSite['kind'];
  rows: SiteTreeNode[];
}

/**
 * One faction as sections per kind (anomalies, unrated complexes, DED complexes), each row with what it leads to:
 * an escalation target as a reference row (it has its own row in its section), expedition parts in full. Expeditions
 * only get a section of their own when nothing leads to them.
 */
export function factionSections(map: SiteMap, faction: string): SiteSection[] {
  const sites = map.sites.filter((s) => s.faction === faction);
  const byId = new Map(sites.map((s) => [s.id, s]));
  const outgoing = new Map<string, SiteMapLink[]>();
  const incoming = new Map<string, SiteMapSite[]>();
  for (const l of map.links) {
    const from = byId.get(l.from);
    if (!from || !byId.has(l.to)) continue;
    (outgoing.get(l.from) ?? outgoing.set(l.from, []).get(l.from)!).push(l);
    (incoming.get(l.to) ?? incoming.set(l.to, []).get(l.to)!).push(from);
  }
  const grow = (site: SiteMapSite, via: SiteTreeNode['via'], path: Set<string>): SiteTreeNode => {
    const reference = via !== null && site.kind !== 'expedition';
    const children =
      reference || path.has(site.id)
        ? []
        : (outgoing.get(site.id) ?? []).map((l) => grow(byId.get(l.to)!, l.kind, new Set([...path, site.id])));
    return { site, via, children, reference, from: via === null ? (incoming.get(site.id) ?? []) : [] };
  };
  const sections: SiteSection[] = [];
  for (const kind of SITEMAP_KINDS) {
    const own = sites.filter((s) => s.kind === kind && (kind !== 'expedition' || !(incoming.get(s.id)?.length ?? 0)));
    if (own.length) sections.push({ kind, rows: own.map((s) => grow(s, null, new Set())) });
  }
  return sections;
}
