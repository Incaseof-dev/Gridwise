/**
 * Builds the overlay brief for an encounter (task 017): KB mechanics + SDE NPC data.
 * SDE-derived numbers are labelled as such in the view model; nothing here claims an encounter is safe.
 */
import type { Encounter } from '../kb/types';
import { DAMAGE_TYPES, type DamageType } from '../sde/damage';
import type { GameDataService, NpcProfile } from '../sde/gameData';
import type { NpcCapabilityKind } from '../sde/npcCapabilities';
import type { EncounterRef } from '../settings';
import { classifyRare, isNotableDrop } from '../loot/rarity';
import { shipSize } from './shipSize';
import type { Brief, BriefDamage, BriefEwar, BriefLoot, BriefPocket, Severity } from '../viewmodel';

/**
 * Warp scramblers and disruptors are the top priority: as long as the ship can warp out, almost any
 * situation can be escaped; a point turns a bad fight into a lost ship.
 */
export const EWAR_SEVERITY: Record<NpcCapabilityKind, Severity> = {
  warpScramble: 'danger',
  warpDisruption: 'danger',
  superWeapon: 'danger',
  web: 'caution',
  neut: 'caution',
  ecm: 'caution',
  sensorDamp: 'caution',
  trackingDisruption: 'caution',
  guidanceDisruption: 'caution',
  rampingDamage: 'caution',
  smartbomb: 'caution',
  nos: 'info',
  targetPaint: 'info',
  remoteRepair: 'info',
};

const SEVERITY_ORDER: Record<Severity, number> = { danger: 0, caution: 1, info: 2 };
/** Display order within a severity: warp prevention first. */
const KIND_ORDER: NpcCapabilityKind[] = [
  'warpScramble',
  'warpDisruption',
  'superWeapon',
  'web',
  'neut',
  'ecm',
  'sensorDamp',
  'trackingDisruption',
  'guidanceDisruption',
  'rampingDamage',
  'smartbomb',
  'nos',
  'targetPaint',
  'remoteRepair',
];

/** Classes that are scenery, not combatants: never reported as unresolved NPCs. */
const NON_COMBATANT =
  /\b(structures?|gate|accl|container|bunker|pylon|wall|habitation|beacon|cargo|wreck|asteroid|object)\b/i;

/** "4-6" → 5, "0-1" → 0.5, "3" → 3, "?" → 1. */
export function countMidpoint(count: string): number {
  const m = /^(\d+)\s*-\s*(\d+)/.exec(count);
  if (m) return (Number(m[1]) + Number(m[2])) / 2;
  const n = Number.parseInt(count, 10);
  return Number.isFinite(n) ? n : 1;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

function profileFor(gd: GameDataService | null, name: string): NpcProfile | null {
  if (!gd) return null;
  const t = gd.typesByName(name, 11)[0];
  return t ? gd.npcProfile(t.id) : null;
}

function emptyDamage(): BriefDamage {
  return {
    incomingSde: null,
    incomingDocumented: [],
    dealSde: null,
    dealDocumented: [],
    unresolvedNpcs: [],
    resolvedNpcs: 0,
  };
}

interface Collected {
  damage: BriefDamage;
  sdeEwar: Map<NpcCapabilityKind, Set<string>>;
}

/** Walks every spawn, resolves names to SDE profiles and accumulates damage and SDE EWAR. */
function collectFromSpawns(e: Encounter, gd: GameDataService | null): Collected {
  const damage = emptyDamage();
  const incoming: Record<DamageType, number> = { em: 0, thermal: 0, kinetic: 0, explosive: 0 };
  const ehp: Record<DamageType, number> = { em: 0, thermal: 0, kinetic: 0, explosive: 0 };
  const sdeEwar = new Map<NpcCapabilityKind, Set<string>>();
  const unresolved = new Set<string>();

  for (const p of e.pockets)
    for (const w of p.waves)
      for (const s of w.spawns) {
        const count = countMidpoint(s.count);
        for (const display of s.names) {
          const typeNames = e.npcs[display]?.sdeTypes.length ? e.npcs[display]!.sdeTypes : [display];
          const profiles = typeNames.map((n) => profileFor(gd, n)).filter((x): x is NpcProfile => x !== null);
          if (!profiles.length) {
            if (!NON_COMBATANT.test(s.class ?? '')) unresolved.add(display);
            continue;
          }
          damage.resolvedNpcs++;
          // The spawn row lists alternatives; spread its count over them.
          const weight = count / s.names.length;
          for (const d of DAMAGE_TYPES) {
            incoming[d] += weight * mean(profiles.map((pr) => pr.nominalDps[d]));
            ehp[d] += weight * mean(profiles.map((pr) => pr.recommendedDamage.find((r) => r.type === d)!.ehp));
          }
          for (const pr of profiles)
            for (const c of pr.capabilities) {
              if (c.chance === 0) continue;
              const set = sdeEwar.get(c.kind) ?? new Set<string>();
              set.add(display);
              sdeEwar.set(c.kind, set);
            }
        }
      }

  const total = DAMAGE_TYPES.reduce((a, d) => a + incoming[d], 0);
  if (total > 0) {
    damage.incomingSde = DAMAGE_TYPES.map((type) => ({ type, share: incoming[type] / total }))
      .filter((x) => x.share >= 0.05)
      .sort((a, b) => b.share - a.share);
  }
  const best = Math.min(...DAMAGE_TYPES.map((d) => ehp[d]));
  if (best > 0) {
    damage.dealSde = DAMAGE_TYPES.map((type) => ({ type, relEhp: ehp[type] / best })).sort(
      (a, b) => a.relEhp - b.relEhp,
    );
  }
  damage.unresolvedNpcs = [...unresolved];
  damage.incomingDocumented = e.damage?.resist ?? [];
  damage.dealDocumented = e.damage?.deal ?? [];
  return { damage, sdeEwar };
}

function mergeEwar(e: Encounter, sdeEwar: Map<NpcCapabilityKind, Set<string>>): BriefEwar[] {
  const byKind = new Map<NpcCapabilityKind, { by: Set<string>; basis: Set<BriefEwar['basis'][number]> }>();
  const add = (kind: NpcCapabilityKind, who: string[], basis: BriefEwar['basis'][number]) => {
    const entry = byKind.get(kind) ?? { by: new Set<string>(), basis: new Set<BriefEwar['basis'][number]>() };
    who.forEach((w) => entry.by.add(w));
    entry.basis.add(basis);
    byKind.set(kind, entry);
  };
  for (const f of e.ewar) add(f.kind, [], f.confidence === 'observed' ? 'observed' : 'kb');
  for (const [name, k] of Object.entries(e.npcs))
    for (const f of k.ewar) add(f.kind, [name], f.confidence === 'observed' ? 'observed' : 'kb');
  for (const p of e.pockets)
    for (const w of p.waves)
      for (const s of w.spawns)
        for (const f of s.ewar) add(f.kind, s.names, f.confidence === 'observed' ? 'observed' : 'kb');
  for (const [kind, who] of sdeEwar) add(kind, [...who], 'sde');

  return [...byKind]
    .map(([kind, v]) => ({ kind, severity: EWAR_SEVERITY[kind], by: [...v.by], basis: [...v.basis] }))
    .sort(
      (a, b) =>
        SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
        KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind),
    );
}

const TIP_PREFIX = /^(tips?|note|notes|warning|important|caution|blitz)\s*:\s*/i;
const MECHANIC =
  /\btrigger|\bprevent|\bremoves?\b|\bwill (not )?spawn|\b(won'?t|will not|doesn'?t|does not) (appear|spawn)|\bdo(n't| not) (shoot|attack|kill)/i;

/** Splits free-text notes into highlighted tips (labelled or describing mechanics) and the rest. */
export function splitTips(notes: string[]): { tips: string[]; notes: string[] } {
  const tips: string[] = [];
  const rest: string[] = [];
  for (const n of notes) (TIP_PREFIX.test(n) || MECHANIC.test(n) ? tips : rest).push(n);
  return { tips, notes: rest };
}

/** One line per trigger NPC: "Officer: Attacking triggers wave 2 → wave 3" instead of repeating it per wave. */
export function mergeTriggers(list: { npc: string; text: string }[]): { npc: string; text: string }[] {
  const byNpc = new Map<string, string[]>();
  for (const t of list) {
    const texts = byNpc.get(t.npc) ?? [];
    if (!texts.includes(t.text)) texts.push(t.text);
    byNpc.set(t.npc, texts);
  }
  return [...byNpc].map(([npc, texts]) => {
    // Shorten repeats that only differ at the end ("Attacking triggers wave 2", "Attacking triggers wave 3").
    const first = texts[0]!;
    const words = first.split(' ');
    let common = 0;
    while (common < words.length - 1 && texts.every((t) => t.split(' ')[common] === words[common])) common++;
    const text =
      texts.length > 1 && common > 0
        ? `${words.slice(0, common).join(' ')} ${texts.map((t) => t.split(' ').slice(common).join(' ')).join(' → ')}`
        : texts.join(' → ');
    return { npc, text };
  });
}

function waveTrigger(on: string, text: string | undefined): string {
  if (on === 'warpIn') return 'on warp-in';
  if (on === 'timer') return 'on a timer';
  return text ?? 'triggered';
}

/** First SDE type id among a spawn's names (display names resolve through the KB's sdeTypes). */
function spawnTypeId(e: Encounter, names: string[], gd: GameDataService | null): number | null {
  if (!gd) return null;
  for (const display of names)
    for (const n of e.npcs[display]?.sdeTypes.length ? e.npcs[display]!.sdeTypes : [display]) {
      const t = gd.typesByName(n, 11)[0];
      if (t) return t.id;
    }
  return null;
}

/** Image type id and overview-style size of a spawn. */
function spawnLook(e: Encounter, names: string[], cls: string | null, gd: GameDataService | null) {
  const typeId = spawnTypeId(e, names, gd);
  const overviewGroupId = typeId !== null ? (gd?.attributes(typeId).get('entityOverviewShipGroupId') ?? null) : null;
  return { typeId, ...shipSize(cls, overviewGroupId !== null ? (gd?.groupName(overviewGroupId) ?? null) : null) };
}

function pocketsOf(e: Encounter, gd: GameDataService | null): BriefPocket[] {
  return e.pockets.map((p) => ({
    name: p.name,
    onWarpIn: p.onWarpIn ?? null,
    ...splitTips(p.notes.map((n) => n.text)),
    waves: p.waves.map((w) => ({
      title: w.trigger.text ?? w.id,
      trigger: waveTrigger(w.trigger.on, w.trigger.text),
      spawns: w.spawns.map((s) => ({
        count: s.count,
        cls: s.class ?? null,
        names: s.names,
        ...spawnLook(e, s.names, s.class ?? null, gd),
        group: s.group ?? null,
        ewar: s.ewar.map((x) => x.kind),
        triggers: s.triggers ?? null,
        note: s.note ?? null,
        drop: s.drop ?? null,
        dropNotable: !!s.drop && isNotableDrop(s.drop),
      })),
    })),
    triggers: mergeTriggers(
      p.waves.flatMap((w) =>
        w.spawns.filter((s) => s.triggers).map((s) => ({ npc: s.names.join(' / '), text: s.triggers! })),
      ),
    ),
  }));
}

function lootOf(e: Encounter, gd: GameDataService | null): BriefLoot {
  const items = [...e.loot, ...e.pockets.flatMap((p) => p.loot)].map((l) => ({
    item: l.item,
    from: l.from ?? null,
    note: l.note ?? null,
  }));
  const drops = new Map<string, string>();
  const rare = new Map<string, { label: string; loot: string }>();
  for (const p of e.pockets)
    for (const w of p.waves)
      for (const s of w.spawns) {
        const npc = s.names.join(' / ');
        if (s.drop && !drops.has(npc)) drops.set(npc, s.drop);
        for (const display of s.names)
          for (const typeName of e.npcs[display]?.sdeTypes.length ? e.npcs[display]!.sdeTypes : [display]) {
            const t = gd?.typesByName(typeName, 11)[0];
            const r = t ? classifyRare(t.groupName) : null;
            if (r && !rare.has(display)) rare.set(display, { label: r.label, loot: r.loot });
          }
      }
  return {
    items,
    drops: [...drops].map(([npc, text]) => ({ npc, text })),
    rareNpcs: [...rare].map(([name, r]) => ({ name, ...r })),
    summary: e.lootNotes.map((n) => n.text),
  };
}

const NO_LOOT: BriefLoot = { items: [], drops: [], rareNpcs: [], summary: [] };

export function encounterSubtitle(
  e: Pick<Encounter, 'kind' | 'level' | 'dedRating' | 'anomalyClass' | 'enemyFaction'>,
): string {
  const kind =
    e.kind === 'mission'
      ? `Mission${e.level ? ` L${e.level}` : ''}`
      : e.dedRating
        ? `DED ${e.dedRating}/10`
        : e.kind === 'complex'
          ? 'Unrated complex'
          : e.kind === 'anomaly'
            ? `Combat anomaly${e.anomalyClass ? ` · Class ${e.anomalyClass}` : ''}`
            : e.kind === 'escalation'
              ? 'Escalation'
              : 'Site';
  return e.enemyFaction ? `${kind} · ${e.enemyFaction}` : kind;
}

const stripTags = (s: string) =>
  s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim();

function sdeGateRestriction(gd: GameDataService | null, dungeonIds: number[]): string[] {
  if (!gd) return [];
  const out: string[] = [];
  for (const id of dungeonIds) {
    const d = gd.dungeon(id);
    if (!d?.allowedShipGroups) continue;
    // Several linked sites (e.g. Class 1 and Class 2) have different gates: name the site.
    const label = dungeonIds.length > 1 ? `SDE, ${d.name}` : 'SDE';
    out.push(`Gates allow (${label}): ${d.allowedShipGroups.map((g) => g.name).join(', ')}`);
  }
  return [...new Set(out)];
}

/** Objective item from the SDE when all variants of the mission agree on it. */
function sdeObjective(gd: GameDataService | null, missionName: string): string | null {
  if (!gd) return null;
  const items = new Set(
    gd
      .missionVariants(missionName)
      .filter((v) => v.objectiveTypeName)
      .map(
        (v) =>
          `${v.objectiveTypeName}${v.objectiveQuantity && v.objectiveQuantity > 1 ? ` ×${v.objectiveQuantity}` : ''}${v.objectiveInContainer ? ' (in a container)' : ''}`,
      ),
  );
  return items.size === 1 ? `Bring back (SDE): ${[...items][0]}` : null;
}

export function buildKbBrief(e: Encounter, gd: GameDataService | null): Brief {
  const { damage, sdeEwar } = collectFromSpawns(e, gd);
  const objectives = e.objectives.map((o) => o.text);
  if (e.kind === 'mission') {
    const obj = sdeObjective(gd, e.name);
    if (obj) objectives.push(obj);
  }
  return {
    ref: { source: 'kb', id: e.id },
    title: e.name,
    subtitle: encounterSubtitle(e),
    hasKb: true,
    review: e.review,
    damage,
    ewar: mergeEwar(e, sdeEwar),
    restrictions: [...e.restrictions.map((r) => r.text), ...sdeGateRestriction(gd, e.sde.dungeonIds)],
    objectives,
    warnings: e.warnings.map((w) => ({ level: w.level, text: w.text })),
    ...splitTips(e.notes.map((n) => n.text)),
    pockets: pocketsOf(e, gd),
    loot: lootOf(e, gd),
    sources: [
      ...Object.values(e.sources).map((s) => ({ title: s.title, url: s.url ?? null, license: s.license ?? null })),
      ...(gd ? [{ title: `EVE SDE build ${gd.buildNumber ?? '?'}`, url: null, license: null }] : []),
    ],
  };
}

function sdeOnlyBrief(ref: EncounterRef, title: string, subtitle: string, gd: GameDataService): Brief {
  return {
    ref,
    title,
    subtitle,
    hasKb: false,
    review: 'none',
    damage: emptyDamage(),
    ewar: [],
    restrictions: [],
    objectives: [],
    warnings: [],
    tips: [],
    notes: [],
    pockets: [],
    loot: NO_LOOT,
    sources: [{ title: `EVE SDE build ${gd.buildNumber ?? '?'}`, url: null, license: null }],
  };
}

export function buildSdeMissionBrief(name: string, gd: GameDataService): Brief {
  const variants = gd.missionVariants(name);
  const brief = sdeOnlyBrief({ source: 'sdeMission', name }, variants[0]?.name ?? name, 'Mission · no KB data', gd);
  const obj = sdeObjective(gd, name);
  if (obj) brief.objectives.push(obj);
  brief.notes.push(
    `No encounter data in the knowledge base. The SDE has ${variants.length} variant(s) of this mission but does not say which level or enemy faction each one is.`,
  );
  return brief;
}

export function buildSdeDungeonBrief(id: number, gd: GameDataService): Brief | null {
  const d = gd.dungeon(id);
  if (!d) return null;
  const brief = sdeOnlyBrief(
    { source: 'sdeDungeon', id },
    d.name,
    [d.category ?? 'Site', d.factionName].filter(Boolean).join(' · '),
    gd,
  );
  brief.restrictions.push(...sdeGateRestriction(gd, [id]));
  if (d.description) brief.notes.push(stripTags(d.description));
  if (d.gameplayDescription) brief.notes.push(stripTags(d.gameplayDescription));
  brief.notes.push('No encounter data in the knowledge base.');
  return brief;
}
