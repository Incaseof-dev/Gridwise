/** Everything the encounter search can find: KB entries first, then SDE missions/sites the KB lacks (task 017). */
import type { Encounter } from '../kb/types';
import type { GameDataService } from '../sde/gameData';
import type { EncounterRef } from '../settings';
import type { Brief, SearchResult } from '../viewmodel';
import { buildKbBrief, buildSdeDungeonBrief, buildSdeMissionBrief, encounterSubtitle } from './brief';

/** Higher is better; 0 = no match. */
export function matchScore(name: string, query: string): number {
  const n = name.toLowerCase();
  const q = query.toLowerCase().trim();
  if (!q) return 0;
  if (n === q) return 100;
  if (n.startsWith(q)) return 80;
  if (n.split(/[\s(),'-]+/).some((w) => w.startsWith(q))) return 60;
  if (n.includes(q)) return 40;
  // All query words appear somewhere (e.g. "guristas outpost").
  const words = q.split(/\s+/).filter(Boolean);
  if (words.length > 1 && words.every((w) => n.includes(w))) return 30;
  return 0;
}

/** Level filters typed into the search: "ded 4", "class 6", "l4" / "level 4". */
export interface LevelFilter {
  ded?: number;
  anomalyClass?: number;
  missionLevel?: number;
}

/** Splits the level filters off a search query; the rest is matched against names. */
export function parseLevelFilter(query: string): { text: string; filter: LevelFilter | null } {
  const filter: LevelFilter = {};
  const text = query
    .replace(/\bded\s*(\d{1,2})(?:\s*\/\s*10)?\b/i, (_m, n: string) => ((filter.ded = Number(n)), ' '))
    .replace(/\b(?:class|tier)\s*(\d{1,2})\b/i, (_m, n: string) => ((filter.anomalyClass = Number(n)), ' '))
    .replace(/\b(?:l|level\s*)([1-5])\b/i, (_m, n: string) => ((filter.missionLevel = Number(n)), ' '))
    .replace(/\s+/g, ' ')
    .trim();
  return { text, filter: Object.keys(filter).length ? filter : null };
}

function passes(e: Encounter, f: LevelFilter): boolean {
  if (f.ded !== undefined && e.dedRating !== f.ded) return false;
  if (f.anomalyClass !== undefined && e.anomalyClass !== f.anomalyClass) return false;
  if (f.missionLevel !== undefined && (e.kind !== 'mission' || e.level !== f.missionLevel)) return false;
  return true;
}

export class EncounterCatalog {
  private readonly byId = new Map<string, Encounter>();
  private readonly briefCache = new Map<string, Brief>();

  constructor(
    encounters: Encounter[],
    private readonly gd: GameDataService | null,
  ) {
    for (const e of encounters) this.byId.set(e.id, e);
  }

  encounter(id: string): Encounter | null {
    return this.byId.get(id) ?? null;
  }

  get size(): number {
    return this.byId.size;
  }

  search(rawQuery: string, limit = 25): SearchResult[] {
    const scored: (SearchResult & { score: number })[] = [];
    const kbNames = new Set<string>();
    const kbDungeons = new Set<number>();
    // With a level filter only KB entries can match (the SDE has no levels); without other text, all of them do.
    const { text: query, filter } = parseLevelFilter(rawQuery);
    for (const e of this.byId.values()) {
      kbNames.add(e.name.toLowerCase());
      e.sde.dungeonIds.forEach((id) => kbDungeons.add(id));
      if (filter && !passes(e, filter)) continue;
      const score =
        filter && !query ? 1 : Math.max(matchScore(e.name, query), ...e.aliases.map((a) => matchScore(a, query)));
      if (score > 0) {
        scored.push({
          ref: { source: 'kb', id: e.id },
          title: e.name,
          subtitle: encounterSubtitle(e),
          hasKb: true,
          score,
        });
      }
    }
    if (this.gd && !filter && query.trim().length >= 2) {
      for (const h of this.gd.search(query, { kinds: ['mission', 'dungeon'], limit: 30 })) {
        // Covered by a KB entry (same name, or a linked SDE site).
        if (kbNames.has(h.name.toLowerCase()) || (h.kind === 'dungeon' && kbDungeons.has(h.refId))) continue;
        const score = matchScore(h.name, query) - 5; // KB entries rank above SDE-only ones
        if (score <= 0) continue;
        scored.push(
          h.kind === 'mission'
            ? {
                ref: { source: 'sdeMission', name: h.name },
                title: h.name,
                subtitle: 'Mission · SDE only',
                hasKb: false,
                score,
              }
            : {
                ref: { source: 'sdeDungeon', id: h.refId },
                title: h.name,
                subtitle: `${this.gd.dungeon(h.refId)?.category ?? 'Site'} · SDE only`,
                hasKb: false,
                score,
              },
        );
      }
    }
    // Same name and subtitle (e.g. this year's event site and an older page): tell them apart by source page.
    const seen = new Map<string, number>();
    for (const r of scored) seen.set(`${r.title}|${r.subtitle}`, (seen.get(`${r.title}|${r.subtitle}`) ?? 0) + 1);
    for (const r of scored) {
      if (r.ref.source !== 'kb' || (seen.get(`${r.title}|${r.subtitle}`) ?? 0) < 2) continue;
      const src = Object.values(this.byId.get(r.ref.id)!.sources)[0]?.title;
      if (src) r.subtitle += ` · ${src.replace(/^EVE University Wiki – /, '').replace(/, section .*$/, '')}`;
    }
    return scored
      .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title) || b.subtitle.localeCompare(a.subtitle))
      .slice(0, limit)
      .map(({ score: _s, ...r }) => r);
  }

  brief(ref: EncounterRef): Brief | null {
    const key = JSON.stringify(ref);
    const cached = this.briefCache.get(key);
    if (cached) return cached;
    let brief: Brief | null = null;
    if (ref.source === 'kb') {
      const e = this.byId.get(ref.id);
      brief = e ? buildKbBrief(e, this.gd) : null;
    } else if (this.gd && ref.source === 'sdeMission') {
      brief = buildSdeMissionBrief(ref.name, this.gd);
    } else if (this.gd && ref.source === 'sdeDungeon') {
      brief = buildSdeDungeonBrief(ref.id, this.gd);
    }
    if (brief) this.briefCache.set(key, brief);
    return brief;
  }
}
