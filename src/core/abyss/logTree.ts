/**
 * The Abyss log as a tree like the Ship fit tab's (EVE-86): tier → weather → runs, newest first. The app's own runs
 * and the player's EVE Workbench runs go in one tree; a run the app uploaded shows once, with the tracker's data
 * next to it. Dependency-free.
 */
import type { AbyssLogEntry, EwbAbyssRun, WeatherId } from './types';

export const TIER_NAMES = ['Tranquil', 'Calm', 'Agitated', 'Fierce', 'Raging', 'Chaotic', 'Cataclysmic'];

export interface RunLeaf {
  /** The log entry's id, or `ewb:<run id>` for a run only EVE Workbench has. */
  key: string;
  at: string;
  entry: AbyssLogEntry | null;
  ewb: EwbAbyssRun | null;
}

export interface WeatherNode {
  weather: WeatherId | null;
  runs: RunLeaf[];
}

export interface TierNode {
  tier: number | null;
  name: string;
  weathers: WeatherNode[];
}

const WEATHER_ORDER: (WeatherId | null)[] = ['dark', 'electrical', 'exotic', 'firestorm', 'gamma', null];

/** `keep`: at most this many runs per tier and weather (the log's retention, also for the tracker's runs). */
export function buildRunTree(
  entries: readonly AbyssLogEntry[],
  ewbRuns: readonly EwbAbyssRun[],
  keep = Infinity,
): TierNode[] {
  const byRunId = new Map(ewbRuns.map((r) => [r.id, r]));
  const uploaded = new Set<string>();
  const leaves: { tier: number | null; weather: WeatherId | null; leaf: RunLeaf }[] = [];
  for (const e of entries) {
    const ewb = e.upload?.runId ? (byRunId.get(e.upload.runId) ?? null) : null;
    if (ewb) uploaded.add(ewb.id);
    leaves.push({ tier: e.tier, weather: e.weather, leaf: { key: e.id, at: e.enteredAt, entry: e, ewb } });
  }
  for (const r of ewbRuns)
    if (!uploaded.has(r.id))
      leaves.push({
        tier: r.tier,
        weather: r.weather,
        leaf: { key: `ewb:${r.id}`, at: r.dateAdded, entry: null, ewb: r },
      });

  const tiers = new Map<number | null, Map<WeatherId | null, RunLeaf[]>>();
  for (const { tier, weather, leaf } of leaves) {
    let ws = tiers.get(tier);
    if (!ws) tiers.set(tier, (ws = new Map()));
    let runs = ws.get(weather);
    if (!runs) ws.set(weather, (runs = []));
    runs.push(leaf);
  }
  // Higher tiers first, like the filaments a player moves up to; unknown tier last.
  return [...tiers]
    .sort(([a], [b]) => (b ?? -1) - (a ?? -1))
    .map(([tier, ws]) => ({
      tier,
      name: tier === null ? 'Unknown tier' : `T${tier} ${TIER_NAMES[tier] ?? ''}`.trim(),
      weathers: [...ws]
        .sort(([a], [b]) => WEATHER_ORDER.indexOf(a) - WEATHER_ORDER.indexOf(b))
        .map(([weather, runs]) => ({ weather, runs: runs.sort((a, b) => b.at.localeCompare(a.at)).slice(0, keep) })),
    }));
}
