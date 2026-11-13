/**
 * The enemy site map (EVE-74): which combat sites each pirate faction has, in which security class they spawn, and
 * what escalates into what. Dependency-free; the data is kb/sitemap.json, made by `npm run kb -- import-sitemap`.
 */

export const SITEMAP_SCHEMA = 1;

export type SecClass = 'high' | 'low' | 'null';
export const SEC_CLASSES: readonly SecClass[] = ['high', 'low', 'null'];

export type SiteMapKind = 'anomaly' | 'unrated' | 'ded' | 'expedition';
export const SITEMAP_KINDS: readonly SiteMapKind[] = ['anomaly', 'unrated', 'ded', 'expedition'];

export interface SiteMapFaction {
  /** Short stable id: angel, blood, guristas, sansha, serpentis, drones. */
  id: string;
  /** Name as the SDE and the KB's enemyFaction use it, e.g. "Guristas Pirates". */
  name: string;
  sdeFactionId: number | null;
}

export interface SiteMapSite {
  /** Slug of the wiki page title. */
  id: string;
  name: string;
  faction: string;
  kind: SiteMapKind;
  /** Anomalies: difficulty tier 1–10 (the in-game anomaly class) and the variant level 1–4 within it. */
  tier?: number;
  level?: number;
  /** DED complexes: n of n/10. */
  ded?: number;
  /** Where it spawns. Expeditions: where they start; later parts can move to lower security. */
  space: SecClass[];
  /** The wiki's footnotes on where it spawns. */
  notes?: string[];
  /** Wiki page with the details, null when the overview names a site that has no page. */
  page: string | null;
  sdeDungeonIds: number[];
  /** Position in the wiki's overview, for a stable order within a kind. */
  order: number;
}

export type SiteMapLinkKind = 'escalation' | 'next-part';

export interface SiteMapLink {
  from: string;
  to: string;
  /** escalation: completing `from` can send you to `to`; next-part: `to` continues the expedition `from`. */
  kind: SiteMapLinkKind;
}

export interface SiteMap {
  schema: number;
  source: { title: string; url: string; revision: number; retrieved: string; license: string };
  factions: SiteMapFaction[];
  sites: SiteMapSite[];
  links: SiteMapLink[];
}

/** What the settings window gets: the map, and the KB entry id of each site that has one (null = load failed). */
export interface SiteMapView {
  map: SiteMap | null;
  error: string | null;
  kbIds: Record<string, string>;
}
