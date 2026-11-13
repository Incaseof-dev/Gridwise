/**
 * The overlay's Abyss panel (EVE-75): timer, filament, who to shoot first, what else the room can hold, and how the
 * weather hits the active fit. Dependency-free and deterministic.
 */
import { tankLayer } from '../fit/siteCheck';
import type { FitStats, Layer } from '../fit/types';
import type { DamageType } from '../sde/damage';
import { focusOrder, identifyNpc, tierFromNpcs, type FocusGroup, type FocusInput } from './priority';
import type { AbyssRun } from './run';
import { ABYSS_DURATION_MS, type AbyssData, type AbyssRoom, type WeatherId } from './types';

export interface AbyssFocusView {
  name: string;
  group: FocusGroup;
  reasons: string[];
  why: string;
  observed: boolean;
  ageSeconds: number;
}

export interface AbyssRoomHint {
  tier: number;
  faction: string;
  note: string | null;
  dpsCheck: boolean;
  /** Names this room can still bring that were not seen yet. */
  unseen: string[];
  /** Everything the room can hold, as the wiki lists it, with what each one does (no order of fire). */
  npcs: AbyssRoomNpcView[];
}

export interface AbyssRoomNpcView {
  /** "Lucid Escort", "…needle Tessella". */
  names: string[];
  count: string;
  cls: string;
  /** What it does, from the wiki and the SDE: NEUT, SCRAM, WEB, LOGI, HIGH DPS … */
  chips: string[];
  note: string | null;
  /** Seen in this room's combat log. */
  seen: boolean;
}

/** The NPCs of a tier worth knowing before going in: tackle, neuts, logi, heavy hitters. */
export interface AbyssDangerView {
  faction: string;
  factionName: string;
  npcs: { name: string; chips: string[] }[];
}

export interface AbyssView {
  /** run = in the Abyss now; preview = the filament picked before going in. */
  mode: 'run' | 'preview';
  enteredAt: string | null;
  remainingSeconds: number | null;
  /** The entry time is guessed from the first abyssal NPC (no chat logs). */
  approximate: boolean;
  origin: string | null;
  /** From the Overmind on grid when there was one, else from the player's choice. */
  tier: { tier: number; name: string; source: 'npc' | 'setting' } | null;
  weather: {
    id: WeatherId;
    name: string;
    penalty: string;
    /** The tier's possible penalty strengths, e.g. [30, 50]; all three when the tier is unknown. */
    penaltyPct: number[];
    bonus: string;
    /** The damage type whose resist the weather lowers (null for Dark). */
    damage: DamageType | null;
  } | null;
  /** Live order of fire; empty without the live combat cues (build switch, buildFlags.ts). */
  focus: AbyssFocusView[];
  /** The live order is shown (else the room's options). */
  live: boolean;
  rooms: AbyssRoomHint[];
  /** Damage to deal, Overmind weakness … */
  tips: string[];
  /** The active fit's resist on its tank layer against the weather's damage type, before and after the penalty. */
  fit: { shipName: string; layer: Layer; damage: DamageType; resist: number; after: number[] } | null;
  /** Preview, or a run whose room is not recognised yet without the live cues: the tier's dangerous NPCs. */
  dangers: AbyssDangerView[];
}

/** An NPC counts as on grid this long after its last log line (kills are not logged by name). */
export const ON_GRID_MS = 25_000;
/**
 * Abyssal NPCs all aggress at once: one not seen since a newer NPC showed up (beyond this slack) is dead or was in
 * the previous room.
 */
export const ROOM_SLACK_MS = 8_000;

/** "[Name]needle Tessella" stands for every damage type: Sparkneedle, Emberneedle … */
const roomPattern = (name: string) =>
  new RegExp(
    `^${name
      .split(/\[Name\]\s*/i)
      .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('\\w*')}$`,
    'i',
  );
const roomNames = (r: AbyssRoom) => r.npcs.flatMap((n) => n.names);
const matches = (pattern: string, name: string) => roomPattern(pattern).test(name);

export interface AbyssViewInput {
  data: AbyssData;
  /** Null: preview of the picked filament. */
  run: AbyssRun | null;
  nowMs: number;
  choice: { weather: WeatherId | null; tier: number | null };
  /** NPCs of the current fight. */
  npcs: FocusInput[];
  fit: FitStats | null;
  /** The live order of fire (build switch LIVE_COMBAT); off, the room's options instead. */
  live?: boolean;
}

export function buildAbyssView({ data, run, nowMs, choice, npcs, fit, live = false }: AbyssViewInput): AbyssView {
  const seen = [...(run?.seen ?? []), ...npcs.map((n) => n.name)];
  const npcTier = tierFromNpcs(seen, data);
  const tierNo = npcTier ?? choice.tier;
  const tierInfo = tierNo === null ? null : (data.tiers.find((t) => t.tier === tierNo) ?? null);
  const w = choice.weather ? (data.weathers.find((x) => x.id === choice.weather) ?? null) : null;
  const damage = w?.penalty.kind === 'resist' ? w.penalty.damage : null;
  const penaltyPct = tierInfo?.penalty ?? [30, 50, 70];

  const recent = npcs.filter((n) => nowMs - n.lastSeenMs <= ON_GRID_MS);
  const newest = Math.max(...recent.map((n) => n.firstSeenMs ?? 0));
  const onGrid = recent.filter((n) => n.lastSeenMs >= newest - ROOM_SLACK_MS);
  const focus = (live ? focusOrder(onGrid, data) : []).map((f) => ({
    name: f.name,
    group: f.group,
    reasons: f.reasons,
    why: f.why,
    observed: f.observed,
    ageSeconds: Math.max(0, Math.round((nowMs - f.lastSeenMs) / 1000)),
  }));

  // Rooms of this tier that hold most of what is on grid now (the wiki's lists are not complete), with what else
  // they can bring.
  const here = onGrid.map((n) => n.name).filter((n) => !identifyNpc(n, data).structure && !/swarmer/i.test(n));
  const scored = data.rooms
    .filter((r) => tierNo === null || r.tier === tierNo)
    .map((r) => ({ r, hits: here.filter((n) => roomNames(r).some((p) => matches(p, n))).length }));
  const best = Math.max(0, ...scored.map((x) => x.hits));
  const rooms = best
    ? scored
        .filter((x) => x.hits === best)
        .map(({ r }) => ({
          tier: r.tier,
          faction: r.faction,
          note: r.note,
          dpsCheck: r.dpsCheck,
          unseen: [...new Set(roomNames(r).filter((p) => !here.some((n) => matches(p, n))))],
          npcs: r.npcs.map((n) => ({
            names: n.names.map((x) => x.replace(/\[Name\]\s*/i, '…')),
            count: n.count,
            cls: n.class,
            chips: npcChips(data, n.names, n.ewar),
            note: n.note ?? null,
            seen: n.names.some((p) => here.some((x) => matches(p, x))),
          })),
        }))
        .slice(0, 3)
    : [];

  const tips: string[] = [];
  if (damage) tips.push(`${w!.name}: shoot ${damage}, the weather lowers every ship's ${damage} resist`);
  const factions = [...new Set(here.map((n) => identifyNpc(n, data).faction).filter((f) => f !== null))];
  for (const f of factions) if (f.damageToDeal) tips.push(f.damageToDeal);
  for (const n of here) {
    const o = identifyNpc(n, data).overmind;
    if (o?.damage.length) tips.push(`${o.name}: armor weak to ${o.damage.join('/')}${o.note ? `. ${o.note}` : ''}`);
  }

  let fitView: AbyssView['fit'] = null;
  if (fit && damage) {
    const layer = tankLayer(fit);
    const resist = fit.layers[layer].resists[damage];
    fitView = { shipName: fit.shipName, layer, damage, resist, after: penaltyPct.map((p) => resist * (1 - p / 100)) };
  }

  return {
    mode: run ? 'run' : 'preview',
    enteredAt: run ? new Date(run.enteredMs).toISOString() : null,
    remainingSeconds: run ? Math.max(0, Math.round((run.enteredMs + ABYSS_DURATION_MS - nowMs) / 1000)) : null,
    approximate: run?.approximate ?? false,
    origin: run?.origin ?? null,
    tier: tierInfo ? { tier: tierInfo.tier, name: tierInfo.name, source: npcTier !== null ? 'npc' : 'setting' } : null,
    weather: w ? { id: w.id, name: w.name, penalty: w.penalty.text, penaltyPct, bonus: w.bonus, damage } : null,
    focus,
    live,
    rooms,
    tips: [...new Set(tips)],
    fit: fitView,
    dangers: tierNo === null || (run && (live || rooms.length)) ? [] : dangers(data, tierNo),
  };
}

const DANGER_CHIPS: Partial<Record<string, string>> = {
  neut: 'NEUT',
  warpScramble: 'SCRAM',
  warpDisruption: 'POINT',
  web: 'WEB',
  ecm: 'JAM',
  trackingDisruption: 'TD',
  guidanceDisruption: 'GD',
  sensorDamp: 'DAMP',
};

/** What an NPC entry of a room does: its EWAR (wiki and faction roles), logi, heavy damage. */
function npcChips(data: AbyssData, rawNames: string[], ewar: readonly string[]): string[] {
  const out = new Set<string>();
  for (const raw of rawNames) {
    const a = identifyNpc(raw.replace(/\[Name\]\s*/i, ''), data);
    for (const k of [...a.ewar, ...ewar]) if (DANGER_CHIPS[k]) out.add(DANGER_CHIPS[k]!);
    if (a.tags.includes('logi')) out.add('LOGI');
    if (a.tags.includes('highDamage')) out.add('HIGH DPS');
  }
  return [...out];
}

/** Per faction, the tier's NPCs that change how a room goes: EWAR on you, logi, heavy hitters. */
export function dangers(data: AbyssData, tier: number): AbyssDangerView[] {
  const out: AbyssDangerView[] = [];
  for (const f of data.factions) {
    const names = [
      ...new Set(
        data.rooms
          .filter((r) => r.tier === tier && r.faction === f.id)
          .flatMap((r) => r.npcs.flatMap((n) => n.names.map((name) => ({ name, ewar: n.ewar })))),
      ),
    ];
    const npcs = new Map<string, string[]>();
    for (const { name: raw, ewar } of names) {
      // "[Name]lance Tessella": any damage type; shown as "…lance Tessella".
      const name = raw.replace(/\[Name\]\s*/i, '…');
      const chips = npcChips(data, [raw], ewar);
      if (chips.length) npcs.set(name, [...new Set([...(npcs.get(name) ?? []), ...chips])]);
    }
    if (npcs.size)
      out.push({ faction: f.id, factionName: f.name, npcs: [...npcs].map(([name, chips]) => ({ name, chips })) });
  }
  return out;
}
