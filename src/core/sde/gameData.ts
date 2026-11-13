/**
 * Read-only access to the local SDE index (task 013). All values come from the SDE; derived numbers
 * (nominal DPS, recommended damage) are documented in docs/sde.md and labelled as estimates by callers.
 */
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { SCHEMA_VERSION } from './schema';
import {
  CAPABILITY_STRENGTH_ATTRIBUTES,
  IGNORED_NPC_EFFECTS,
  LEGACY_CHANCE_ATTRIBUTES,
  capabilityForEffect,
  type NpcCapabilityKind,
} from './npcCapabilities';

import { DAMAGE_TYPES, type DamageType, type DamageVector } from './damage';

export { DAMAGE_TYPES, type DamageType, type DamageVector };

export interface TypeInfo {
  id: number;
  name: string;
  groupId: number;
  groupName: string;
  categoryId: number;
  published: boolean;
  factionId: number | null;
}

export interface NpcCapability {
  kind: NpcCapabilityKind;
  effect: string;
  /** Activation chance from the SDE when the effect has one (0–1, legacy values may use other scales). */
  chance: number | null;
  /** Optimal range in metres when the effect links a range attribute. */
  range: number | null;
  strength: number | null;
}

export interface NpcProfile {
  type: TypeInfo;
  factionName: string | null;
  hp: { shield: number; armor: number; hull: number };
  resonance: { shield: DamageVector; armor: DamageVector; hull: DamageVector };
  /** Damage types ordered from most to least effective against this NPC (lowest effective HP first). */
  recommendedDamage: { type: DamageType; ehp: number }[];
  /** Nominal DPS by damage type, turret + missile. Ignores application and AI; an estimate. */
  nominalDps: DamageVector & { total: number };
  turret: (DamageVector & { dps: number }) | null;
  missile: { typeId: number; name: string | null; dps: number; damage: DamageVector } | null;
  capabilities: NpcCapability[];
  /** Effects on this type that are neither mapped nor ignored (for diagnostics / mapping updates). */
  unmappedEffects: string[];
  bounty: number | null;
  signatureRadius: number | null;
  maxVelocity: number | null;
  /** Speed when it is not chasing (orbits often run at about this); null when the SDE has none. */
  cruiseVelocity: number | null;
  orbitRange: number | null;
  attackRange: number | null;
}

export interface SearchHit {
  kind: 'mission' | 'dungeon' | 'npc' | 'ship';
  name: string;
  refId: number;
}

export interface MissionVariant {
  id: number;
  name: string;
  kind: string;
  dungeonId: number | null;
  objectiveTypeId: number | null;
  objectiveTypeName: string | null;
  objectiveQuantity: number | null;
  objectiveInContainer: boolean;
  factionId: number | null;
  briefing: string | null;
}

export interface DungeonInfo {
  id: number;
  name: string;
  factionId: number | null;
  factionName: string | null;
  description: string | null;
  gameplayDescription: string | null;
  /** Ship groups and/or single ship types allowed through the gates, null when the SDE has no restriction. */
  allowedShipGroups: { id: number; name: string }[] | null;
  /** Site category from its archetype, e.g. "Combat site", "FW Small Complex"; null when unknown. */
  category: string | null;
}

/** Archetype title → a label for one site: "Combat Sites" → "Combat site", FW complexes get "FW". */
export function archetypeLabel(title: string | null, description: string | null): string | null {
  if (!title || /^none$/i.test(title)) return null;
  let label = title.replace(/ Sites$/, ' site');
  if (/^Factional Warfare/i.test(description ?? '') && !/Factional Warfare/i.test(label)) label = `FW ${label}`;
  return label;
}

/** A ship name in one of the SDE languages, with its English name. */
export interface ShipName {
  name: string;
  typeId: number;
  en: string;
  /** Ship class: the SDE group name, e.g. Interdictor. */
  group: string;
}

export interface SystemInfo {
  id: number;
  name: string;
  regionName: string | null;
  security: number | null;
}

const RESONANCE_ATTRS = {
  shield: {
    em: 'shieldEmDamageResonance',
    thermal: 'shieldThermalDamageResonance',
    kinetic: 'shieldKineticDamageResonance',
    explosive: 'shieldExplosiveDamageResonance',
  },
  armor: {
    em: 'armorEmDamageResonance',
    thermal: 'armorThermalDamageResonance',
    kinetic: 'armorKineticDamageResonance',
    explosive: 'armorExplosiveDamageResonance',
  },
  hull: {
    em: 'emDamageResonance',
    thermal: 'thermalDamageResonance',
    kinetic: 'kineticDamageResonance',
    explosive: 'explosiveDamageResonance',
  },
} as const;

const DAMAGE_ATTRS: Record<DamageType, string> = {
  em: 'emDamage',
  thermal: 'thermalDamage',
  kinetic: 'kineticDamage',
  explosive: 'explosiveDamage',
};

const zero = (): DamageVector => ({ em: 0, thermal: 0, kinetic: 0, explosive: 0 });

export class GameDataService {
  private readonly db: DatabaseSync;
  private readonly stmts = new Map<string, StatementSync>();
  private readonly attrIds = new Map<string, number>();
  private readonly attrNames = new Map<number, string>();
  private readonly profileCache = new Map<number, NpcProfile>();

  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath, { readOnly: true });
    const version = this.meta('schemaVersion');
    if (version !== String(SCHEMA_VERSION)) {
      this.db.close();
      throw new Error(`SDE index schema ${version ?? '?'} is outdated (need ${SCHEMA_VERSION}); re-import the SDE`);
    }
    for (const row of this.q('SELECT id, name FROM attributes').all() as { id: number; name: string }[]) {
      this.attrIds.set(row.name, row.id);
      this.attrNames.set(row.id, row.name);
    }
  }

  close(): void {
    this.db.close();
  }

  private q(sql: string): StatementSync {
    let s = this.stmts.get(sql);
    if (!s) this.stmts.set(sql, (s = this.db.prepare(sql)));
    return s;
  }

  private archetypes: Map<number, string | null> | null = null;

  /** Category label of an archetype; null when unknown or the index predates the archetypes table. */
  archetype(id: number | null): string | null {
    if (id === null) return null;
    if (!this.archetypes) {
      this.archetypes = new Map();
      try {
        const rows = this.q('SELECT id, title, description FROM archetypes').all() as {
          id: number;
          title: string | null;
          description: string | null;
        }[];
        for (const r of rows) this.archetypes.set(r.id, archetypeLabel(r.title, r.description));
      } catch {
        // An index built before the table existed: no categories until the next SDE import.
      }
    }
    return this.archetypes.get(id) ?? null;
  }

  meta(key: string): string | null {
    const row = this.q('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  get buildNumber(): number | null {
    const b = this.meta('buildNumber');
    return b === null ? null : Number(b);
  }

  private typeRow(row: Record<string, unknown> | undefined): TypeInfo | null {
    if (!row) return null;
    return {
      id: row.id as number,
      name: row.name as string,
      groupId: row.group_id as number,
      groupName: row.group_name as string,
      categoryId: row.category_id as number,
      published: row.published === 1,
      factionId: (row.faction_id as number | null) ?? null,
    };
  }

  private static readonly TYPE_SELECT = `
    SELECT t.id, t.name, t.group_id, g.name AS group_name, g.category_id, t.published, t.faction_id
    FROM types t JOIN groups g ON g.id = t.group_id`;

  typeById(id: number): TypeInfo | null {
    return this.typeRow(this.q(`${GameDataService.TYPE_SELECT} WHERE t.id = ?`).get(id) as Record<string, unknown>);
  }

  /** All types with exactly this name (case-insensitive). Several NPC types can share a name. */
  typesByName(name: string, categoryId?: number): TypeInfo[] {
    const rows = (
      categoryId === undefined
        ? this.q(`${GameDataService.TYPE_SELECT} WHERE t.name = ? COLLATE NOCASE ORDER BY t.id`).all(name)
        : this.q(
            `${GameDataService.TYPE_SELECT} WHERE t.name = ? COLLATE NOCASE AND g.category_id = ? ORDER BY t.id`,
          ).all(name, categoryId)
    ) as Record<string, unknown>[];
    return rows.map((r) => this.typeRow(r)!);
  }

  attributes(typeId: number): Map<string, number> {
    const rows = this.q('SELECT attribute_id, value FROM type_attributes WHERE type_id = ?').all(typeId) as {
      attribute_id: number;
      value: number;
    }[];
    return new Map(rows.map((r) => [this.attrNames.get(r.attribute_id) ?? String(r.attribute_id), r.value]));
  }

  effects(typeId: number): { id: number; name: string; rangeAttr: number | null; chanceAttr: number | null }[] {
    return (
      this.q(
        `SELECT e.id, e.name, e.range_attribute_id, e.npc_activation_chance_attribute_id
         FROM type_effects te JOIN effects e ON e.id = te.effect_id WHERE te.type_id = ? ORDER BY e.id`,
      ).all(typeId) as {
        id: number;
        name: string;
        range_attribute_id: number | null;
        npc_activation_chance_attribute_id: number | null;
      }[]
    ).map((r) => ({
      id: r.id,
      name: r.name,
      rangeAttr: r.range_attribute_id,
      chanceAttr: r.npc_activation_chance_attribute_id,
    }));
  }

  groupName(id: number | null): string | null {
    if (id === null) return null;
    return (this.q('SELECT name FROM groups WHERE id = ?').get(id) as { name: string } | undefined)?.name ?? null;
  }

  factionName(id: number | null): string | null {
    if (id === null) return null;
    return (this.q('SELECT name FROM factions WHERE id = ?').get(id) as { name: string } | undefined)?.name ?? null;
  }

  npcProfile(typeId: number): NpcProfile | null {
    const cached = this.profileCache.get(typeId);
    if (cached) return cached;
    const type = this.typeById(typeId);
    if (!type) return null;

    const a = this.attributes(typeId);
    const get = (name: string): number | null => a.get(name) ?? null;
    const effects = this.effects(typeId);
    const effectNames = new Set(effects.map((e) => e.name));

    const hp = { shield: get('shieldCapacity') ?? 0, armor: get('armorHP') ?? 0, hull: get('hp') ?? 0 };
    const resonance = {
      shield: zero(),
      armor: zero(),
      hull: zero(),
    };
    for (const layer of ['shield', 'armor', 'hull'] as const) {
      for (const d of DAMAGE_TYPES) resonance[layer][d] = get(RESONANCE_ATTRS[layer][d]) ?? 1;
    }
    const recommendedDamage = DAMAGE_TYPES.map((d) => ({
      type: d,
      ehp: (['shield', 'armor', 'hull'] as const).reduce(
        (sum, layer) => sum + hp[layer] / Math.max(resonance[layer][d], 0.0001),
        0,
      ),
    })).sort((x, y) => x.ehp - y.ehp);

    let turret: NpcProfile['turret'] = null;
    if (effectNames.has('targetAttack')) {
      const cycle = (get('speed') ?? 0) / 1000;
      const mult = get('damageMultiplier') ?? 1;
      const dmg = zero();
      for (const d of DAMAGE_TYPES) dmg[d] = cycle > 0 ? ((get(DAMAGE_ATTRS[d]) ?? 0) * mult) / cycle : 0;
      const dps = DAMAGE_TYPES.reduce((s, d) => s + dmg[d], 0);
      if (dps > 0) turret = { ...dmg, dps };
    }

    let missile: NpcProfile['missile'] = null;
    const missileTypeId = get('entityMissileTypeID');
    if (effectNames.has('missileLaunchingForEntity') && missileTypeId) {
      const m = this.attributes(missileTypeId);
      const cycle = (get('missileLaunchDuration') ?? 0) / 1000;
      const mult = get('missileDamageMultiplier') ?? 1;
      const dmg = zero();
      for (const d of DAMAGE_TYPES) dmg[d] = cycle > 0 ? ((m.get(DAMAGE_ATTRS[d]) ?? 0) * mult) / cycle : 0;
      const dps = DAMAGE_TYPES.reduce((s, d) => s + dmg[d], 0);
      missile = { typeId: missileTypeId, name: this.typeById(missileTypeId)?.name ?? null, dps, damage: dmg };
    }

    const nominal = zero();
    for (const d of DAMAGE_TYPES) nominal[d] = (turret?.[d] ?? 0) + (missile?.damage[d] ?? 0);

    const capabilities: NpcCapability[] = [];
    const unmapped: string[] = [];
    for (const e of effects) {
      const kind = capabilityForEffect(e.name);
      if (!kind) {
        if (!IGNORED_NPC_EFFECTS.has(e.name)) unmapped.push(e.name);
        continue;
      }
      const chanceAttr = e.chanceAttr !== null ? this.attrNames.get(e.chanceAttr) : LEGACY_CHANCE_ATTRIBUTES[e.name];
      const strengthAttr = CAPABILITY_STRENGTH_ATTRIBUTES[kind]?.find((n) => a.has(n));
      capabilities.push({
        kind,
        effect: e.name,
        chance: chanceAttr ? (get(chanceAttr) ?? null) : null,
        range: e.rangeAttr !== null ? (get(this.attrNames.get(e.rangeAttr) ?? '') ?? null) : null,
        strength: strengthAttr ? get(strengthAttr) : null,
      });
    }

    const profile: NpcProfile = {
      type,
      factionName: this.factionName(type.factionId),
      hp,
      resonance,
      recommendedDamage,
      nominalDps: { ...nominal, total: DAMAGE_TYPES.reduce((s, d) => s + nominal[d], 0) },
      turret,
      missile,
      capabilities,
      unmappedEffects: unmapped,
      bounty: get('entityKillBounty'),
      signatureRadius: get('signatureRadius'),
      maxVelocity: get('maxVelocity'),
      cruiseVelocity: get('entityCruiseSpeed'),
      orbitRange: get('entityFlyRange'),
      attackRange: get('entityAttackRange') ?? get('maxRange'),
    };
    this.profileCache.set(typeId, profile);
    return profile;
  }

  /** Fuzzy name search (substring, trigram index; queries shorter than 3 characters use a prefix scan). */
  search(query: string, opts: { kinds?: SearchHit['kind'][]; limit?: number } = {}): SearchHit[] {
    const limit = opts.limit ?? 20;
    const q = query.trim();
    if (!q) return [];
    let rows: { name: string; kind: SearchHit['kind']; ref_id: number }[];
    if (q.length >= 3) {
      const phrase = '"' + q.replace(/"/g, '""') + '"';
      rows = this.q(
        `SELECT name, kind, ref_id FROM search WHERE search MATCH ? ORDER BY (lower(name) = lower(?)) DESC,
         (lower(name) LIKE lower(?) || '%') DESC, length(name) LIMIT ?`,
      ).all(phrase, q, q, limit * 4) as typeof rows;
    } else {
      rows = this.q(`SELECT name, kind, ref_id FROM search WHERE name LIKE ? || '%' ORDER BY length(name) LIMIT ?`).all(
        q,
        limit * 4,
      ) as typeof rows;
    }
    const kinds = opts.kinds ? new Set(opts.kinds) : null;
    return rows
      .filter((r) => !kinds || kinds.has(r.kind))
      .slice(0, limit)
      .map((r) => ({ kind: r.kind, name: r.name, refId: r.ref_id }));
  }

  /** All SDE variants of a mission name. The SDE does not say which level/faction each variant belongs to. */
  missionVariants(name: string): MissionVariant[] {
    const rows = this.q(
      `SELECT m.*, t.name AS objective_type_name FROM missions m LEFT JOIN types t ON t.id = m.objective_type_id
       WHERE m.name = ? COLLATE NOCASE ORDER BY m.id`,
    ).all(name) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: r.id as number,
      name: r.name as string,
      kind: r.kind as string,
      dungeonId: (r.dungeon_id as number | null) ?? null,
      objectiveTypeId: (r.objective_type_id as number | null) ?? null,
      objectiveTypeName: (r.objective_type_name as string | null) ?? null,
      objectiveQuantity: (r.objective_quantity as number | null) ?? null,
      objectiveInContainer: Boolean(r.objective_in_container),
      factionId: (r.faction_id as number | null) ?? null,
      briefing: (r.briefing as string | null) ?? null,
    }));
  }

  dungeon(id: number): DungeonInfo | null {
    const r = this.q('SELECT * FROM dungeons WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!r) return null;
    const listIds = r.allowed_ships_lists ? (JSON.parse(r.allowed_ships_lists as string) as number[]) : [];
    let allowed: DungeonInfo['allowedShipGroups'] = null;
    if (listIds.length) {
      // A gate list names ship groups ("Frigate") and/or single ship types ("Rifter").
      const groupIds = new Set<number>();
      const typeIds = new Set<number>();
      for (const lid of listIds) {
        const l = this.q('SELECT included_group_ids, included_type_ids FROM type_lists WHERE id = ?').get(lid) as
          { included_group_ids: string | null; included_type_ids: string | null } | undefined;
        for (const g of l?.included_group_ids ? (JSON.parse(l.included_group_ids) as number[]) : []) groupIds.add(g);
        for (const t of l?.included_type_ids ? (JSON.parse(l.included_type_ids) as number[]) : []) typeIds.add(t);
      }
      const name = (sql: string, id: number, fallback: string) =>
        (this.q(sql).get(id) as { name: string } | undefined)?.name ?? fallback;
      allowed = [
        ...[...groupIds].map((g) => ({ id: g, name: name('SELECT name FROM groups WHERE id = ?', g, `group ${g}`) })),
        ...[...typeIds].map((t) => ({ id: t, name: name('SELECT name FROM types WHERE id = ?', t, `type ${t}`) })),
      ].sort((x, y) => x.name.localeCompare(y.name));
    }
    return {
      id: r.id as number,
      name: r.name as string,
      factionId: (r.faction_id as number | null) ?? null,
      factionName: this.factionName((r.faction_id as number | null) ?? null),
      description: (r.description as string | null) ?? null,
      gameplayDescription: (r.gameplay_description as string | null) ?? null,
      allowedShipGroups: allowed,
      category: this.archetype((r.archetype_id as number | null) ?? null),
    };
  }

  systemByName(name: string): SystemInfo | null {
    const r = this.q(
      `SELECT s.id, s.name, r.name AS region_name, s.security FROM systems s LEFT JOIN regions r ON r.id = s.region_id
       WHERE s.name = ? COLLATE NOCASE`,
    ).get(name) as Record<string, unknown> | undefined;
    return r
      ? {
          id: r.id as number,
          name: r.name as string,
          regionName: (r.region_name as string | null) ?? null,
          security: (r.security as number | null) ?? null,
        }
      : null;
  }

  /** Every solar system, by name (for the intel parser). */
  systemNames(): { id: number; name: string; security: number | null }[] {
    return this.q('SELECT id, name, security FROM systems ORDER BY name').all() as {
      id: number;
      name: string;
      security: number | null;
    }[];
  }

  /** Stargate links as an adjacency list (EVE-96). */
  jumpGraph(): Map<number, number[]> {
    const g = new Map<number, number[]>();
    for (const r of this.q('SELECT from_id, to_id FROM jumps').all() as { from_id: number; to_id: number }[]) {
      const list = g.get(r.from_id);
      if (list) list.push(r.to_id);
      else g.set(r.from_id, [r.to_id]);
    }
    return g;
  }

  /** Ship names in every SDE language (EVE-97). The same name may appear once per language. */
  shipNames(): ShipName[] {
    const rows = this.q(
      `SELECT DISTINCT n.name, n.type_id, t.name AS en, g.name AS grp FROM ship_names n
       JOIN types t ON t.id = n.type_id JOIN groups g ON g.id = t.group_id`,
    ).all() as { name: string; type_id: number; en: string; grp: string }[];
    return rows.map((r) => ({ name: r.name, typeId: r.type_id, en: r.en, group: r.grp }));
  }
}
