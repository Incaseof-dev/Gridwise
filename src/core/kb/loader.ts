/**
 * Loads, validates and normalizes KB files (task 016, docs/knowledge-base.md).
 * Invalid files are skipped and reported; they never prevent the rest from loading.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { Ajv, type ErrorObject } from 'ajv';
import { LineCounter, parseDocument } from 'yaml';
import type { DamageType } from '../sde/damage';
import { anomalyClassOf } from './rating';
import { ENCOUNTER_SCHEMA } from './schema';
import type {
  Encounter,
  KbLayer,
  EwarFact,
  KbIssue,
  LootFact,
  NpcKnowledge,
  Pocket,
  Provenance,
  Spawn,
  TextFact,
  WarningFact,
  Wave,
} from './types';

type Raw = Record<string, unknown>;
type RawList = Raw[] | undefined;

const ajv = new Ajv({ allErrors: true, strict: false });
const validate = ajv.compile(ENCOUNTER_SCHEMA);

export interface KbLoadResult {
  encounters: Encounter[];
  issues: KbIssue[];
}

/** Applies encounter-level defaults to one fact and checks that its source exists. */
function prov(raw: Raw, defaults: Provenance, sources: Set<string>, onBadSource: (s: string) => void): Provenance {
  const source = raw.source === undefined ? defaults.source : (raw.source as string | null);
  if (source !== null && !sources.has(source)) onBadSource(source);
  return {
    confidence: (raw.confidence as Provenance['confidence']) ?? defaults.confidence,
    source,
    ...(raw.note ? { note: raw.note as string } : {}),
  };
}

function normalize(raw: Raw, file: string, layer: KbLayer, report: (path: string, msg: string) => void): Encounter {
  const sources = (raw.sources as Encounter['sources']) ?? {};
  const sourceKeys = new Set(Object.keys(sources));
  const rawDefaults = (raw.defaults as Raw | undefined) ?? {};
  const firstSource = Object.keys(sources)[0] ?? null;
  const defaults: Provenance = {
    confidence: (rawDefaults.confidence as Provenance['confidence']) ?? 'verified',
    source: rawDefaults.source === undefined ? firstSource : (rawDefaults.source as string | null),
  };
  if (defaults.source !== null && !sourceKeys.has(defaults.source)) {
    report('/defaults/source', `unknown source "${defaults.source}"`);
  }

  const p = (r: Raw, path: string): Provenance =>
    prov(r, defaults, sourceKeys, (s) => report(`${path}/source`, `unknown source "${s}"`));
  const texts = (l: RawList, path: string): TextFact[] =>
    (l ?? []).map((r, i) => ({ text: r.text as string, ...p(r, `${path}/${i}`) }));
  const warnings = (l: RawList, path: string): WarningFact[] =>
    (l ?? []).map((r, i) => ({
      text: r.text as string,
      level: r.level as WarningFact['level'],
      ...p(r, `${path}/${i}`),
    }));
  const loot = (l: RawList, path: string): LootFact[] =>
    (l ?? []).map((r, i) => ({
      item: r.item as string,
      ...(r.from ? { from: r.from as string } : {}),
      ...p(r, `${path}/${i}`),
    }));
  const ewar = (l: RawList, path: string): EwarFact[] =>
    (l ?? []).map((r, i) => ({ kind: r.kind as EwarFact['kind'], ...p(r, `${path}/${i}`) }));

  const npcs: Record<string, NpcKnowledge> = {};
  for (const [name, r] of Object.entries((raw.npcs as Record<string, Raw> | undefined) ?? {})) {
    const path = `/npcs/${name}`;
    npcs[name] = {
      ...(r.class ? { class: r.class as string } : {}),
      sdeTypes: (r.sdeTypes as string[] | undefined) ?? [],
      ewar: ewar(r.ewar as RawList, `${path}/ewar`),
      notes: texts(r.notes as RawList, `${path}/notes`),
    };
  }

  const pockets: Pocket[] = ((raw.pockets as RawList) ?? []).map((pr, pi) => {
    const path = `/pockets/${pi}`;
    const waves: Wave[] = ((pr.waves as RawList) ?? []).map((wr, wi) => {
      const wpath = `${path}/waves/${wi}`;
      const tr = (wr.trigger as Raw | undefined) ?? { on: 'other', confidence: 'unknown' };
      const spawns: Spawn[] = ((wr.spawns as RawList) ?? []).map((sr, si) => ({
        count: String(sr.count),
        ...(sr.class ? { class: sr.class as string } : {}),
        names: sr.names as string[],
        ...(sr.group ? { group: sr.group as string } : {}),
        ewar: ewar(sr.ewar as RawList, `${wpath}/spawns/${si}/ewar`),
        ...(sr.triggers ? { triggers: sr.triggers as string } : {}),
        ...(sr.drop ? { drop: sr.drop as string } : {}),
        ...p(sr, `${wpath}/spawns/${si}`),
      }));
      return {
        id: wr.id as string,
        trigger: {
          on: tr.on as Wave['trigger']['on'],
          ...(tr.npc ? { npc: tr.npc as string } : {}),
          ...(tr.text ? { text: tr.text as string } : {}),
          ...p(tr, `${wpath}/trigger`),
        },
        spawns,
        notes: texts(wr.notes as RawList, `${wpath}/notes`),
      };
    });

    const triggerNpcs = new Set<string>();
    for (const w of waves) {
      if (w.trigger.npc) triggerNpcs.add(w.trigger.npc);
      for (const s of w.spawns) if (s.triggers) s.names.forEach((n) => triggerNpcs.add(n));
    }

    const gate = pr.gate as Raw | undefined;
    return {
      name: pr.name as string,
      ...(pr.onWarpIn ? { onWarpIn: pr.onWarpIn as string } : {}),
      notes: texts(pr.notes as RawList, `${path}/notes`),
      ...(gate
        ? {
            gate: {
              text: gate.text as string,
              ...(gate.key ? { key: gate.key as string } : {}),
              ...p(gate, `${path}/gate`),
            },
          }
        : {}),
      waves,
      objectives: texts(pr.objectives as RawList, `${path}/objectives`),
      loot: loot(pr.loot as RawList, `${path}/loot`),
      warnings: warnings(pr.warnings as RawList, `${path}/warnings`),
      triggerNpcs: [...triggerNpcs],
    };
  });

  const damage = raw.damage as Raw | undefined;
  const sde = (raw.sde as Raw | undefined) ?? {};
  return {
    id: raw.id as string,
    kind: raw.kind as Encounter['kind'],
    name: raw.name as string,
    aliases: (raw.aliases as string[] | undefined) ?? [],
    level: (raw.level as number | null | undefined) ?? null,
    dedRating: (raw.dedRating as number | null | undefined) ?? null,
    // Wiki updates imported before the field existed keep the class only in a "Rating: Class N" note.
    anomalyClass:
      (raw.anomalyClass as number | null | undefined) ??
      anomalyClassOf(((raw.notes as Raw[] | undefined) ?? []).map((n) => String(n?.text ?? ''))),
    enemyFaction: (raw.enemyFaction as string | null | undefined) ?? null,
    sde: {
      dungeonIds: (sde.dungeonIds as number[] | undefined) ?? [],
      missionIds: (sde.missionIds as number[] | undefined) ?? [],
    },
    review: (raw.review as Encounter['review'] | undefined) ?? 'unreviewed',
    sources,
    damage: damage
      ? {
          deal: (damage.deal as DamageType[] | undefined) ?? [],
          resist: (damage.resist as DamageType[] | undefined) ?? [],
          ...p(damage, '/damage'),
        }
      : null,
    objectives: texts(raw.objectives as RawList, '/objectives'),
    loot: loot(raw.loot as RawList, '/loot'),
    warnings: warnings(raw.warnings as RawList, '/warnings'),
    restrictions: texts(raw.restrictions as RawList, '/restrictions'),
    notes: texts(raw.notes as RawList, '/notes'),
    lootNotes: texts(raw.lootNotes as RawList, '/lootNotes'),
    ewar: ewar(raw.ewar as RawList, '/ewar'),
    npcs,
    pockets,
    origin: { file, layer },
  };
}

/** Parses and validates one KB file's text. */
export function parseKbFile(
  file: string,
  text: string,
  layer: KbLayer = 'bundled',
): { encounter: Encounter | null; issues: KbIssue[] } {
  const issues: KbIssue[] = [];
  const lineCounter = new LineCounter();
  const doc = parseDocument(text, { lineCounter, prettyErrors: false });
  const lineOf = (path: string): number | null => {
    const keys = path
      .split('/')
      .filter(Boolean)
      .map((k) => (/^\d+$/.test(k) ? Number(k) : k));
    let node = doc.getIn(keys, true) as { range?: [number, number, number] } | undefined;
    while (!node?.range && keys.length) {
      keys.pop();
      node = doc.getIn(keys, true) as typeof node;
    }
    return node?.range ? lineCounter.linePos(node.range[0]).line : null;
  };
  const add = (path: string, message: string, severity: KbIssue['severity'] = 'error') =>
    issues.push({ file, line: lineOf(path), path: path || '/', message, severity });

  if (doc.errors.length) {
    for (const e of doc.errors) {
      issues.push({ file, line: e.linePos?.[0]?.line ?? null, path: '/', message: e.message, severity: 'error' });
    }
    return { encounter: null, issues };
  }
  const raw = doc.toJS() as unknown;
  if (!validate(raw)) {
    for (const e of validate.errors as ErrorObject[]) {
      const extra =
        e.keyword === 'additionalProperties'
          ? ` "${(e.params as { additionalProperty: string }).additionalProperty}"`
          : '';
      add(e.instancePath, `${e.message ?? 'invalid'}${extra}`);
    }
    return { encounter: null, issues };
  }
  const r = raw as unknown as Raw;
  if (basename(file, '.yaml') !== r.id) add('/id', `id "${String(r.id)}" does not match the file name`, 'warning');
  const encounter = normalize(r, file, layer, (path, msg) => add(path, msg));
  return { encounter: issues.some((i) => i.severity === 'error') ? null : encounter, issues };
}

function loadDir(dir: string, layer: KbLayer): KbLoadResult {
  const result: KbLoadResult = { encounters: [], issues: [] };
  if (!existsSync(dir)) return result;
  for (const name of readdirSync(dir)
    .filter((f) => f.endsWith('.yaml'))
    .sort()) {
    const { encounter, issues } = parseKbFile(name, readFileSync(join(dir, name), 'utf8'), layer);
    result.issues.push(...issues.map((i) => ({ ...i, file: join(dir, name) })));
    if (encounter) result.encounters.push({ ...encounter, origin: { file: join(dir, name), layer } });
  }
  return result;
}

/** Loads the bundled KB and the user KB; user entries replace bundled entries with the same id. */
/**
 * Loads the KB layers. Later layers replace entries with the same id: bundled < update < user.
 * An update never replaces a bundled entry that a human marked `review: reviewed`.
 */
export function loadKnowledgeBase(bundledDir: string, userDir?: string, updateDir?: string): KbLoadResult {
  const bundled = loadDir(bundledDir, 'bundled');
  const update = updateDir ? loadDir(updateDir, 'update') : { encounters: [], issues: [] };
  const user = userDir ? loadDir(userDir, 'user') : { encounters: [], issues: [] };
  const byId = new Map<string, Encounter>();
  const issues = [...bundled.issues, ...update.issues, ...user.issues];
  for (const e of bundled.encounters) {
    if (byId.has(e.id)) {
      issues.push({
        file: e.origin.file,
        line: null,
        path: '/id',
        message: `duplicate id "${e.id}"`,
        severity: 'error',
      });
      continue;
    }
    byId.set(e.id, e);
  }
  for (const e of update.encounters) if (byId.get(e.id)?.review !== 'reviewed') byId.set(e.id, e);
  for (const e of user.encounters) byId.set(e.id, e);
  const encounters = [...byId.values()];
  fillAnomalyClasses(encounters);
  return { encounters, issues };
}

/** The tier word of an anomaly name: "Angel Forsaken Hub" → "hub", "Blood Rally Point" → "rally point". */
function anomalyTier(name: string): string | null {
  return (
    /\b(hideaway|burrow|refuge|den|yard|rally point|port|hub|haven|sanctum)$/i.exec(name)?.[1]?.toLowerCase() ?? null
  );
}

/**
 * Pages without an infobox (EVE-69) carry no class. The wiki's class follows the tier word of the name, so such an
 * anomaly gets the class most of its siblings with the same tier have (Angel Hub → 8, like the other Hubs).
 */
export function fillAnomalyClasses(encounters: Encounter[]): void {
  const votes = new Map<string, Map<number, number>>();
  for (const e of encounters) {
    const tier = e.kind === 'anomaly' && e.anomalyClass ? anomalyTier(e.name) : null;
    if (!tier) continue;
    const v = votes.get(tier) ?? new Map<number, number>();
    v.set(e.anomalyClass!, (v.get(e.anomalyClass!) ?? 0) + 1);
    votes.set(tier, v);
  }
  for (const e of encounters) {
    if (e.kind !== 'anomaly' || e.anomalyClass) continue;
    const v = votes.get(anomalyTier(e.name) ?? '');
    if (v) e.anomalyClass = [...v].sort((a, b) => b[1] - a[1])[0]![0];
  }
}
