/**
 * Fit stats from a pasted EFT fit (EVE-62), computed by eve-fit-engine (GPL-3.0-or-later, a Pyfa port).
 * The engine brings its own SDE extract; it does not use our SQLite index. Skills are All V unless a logged-in
 * character's skills and implants are given (EVE-38), and every result says which.
 */
import {
  buildAllVSkillProfile,
  computeFit,
  defaultStateForModule,
  isMissileLauncher,
  isTurretWeapon,
  loadBundledDataset,
  moduleAcceptsChargeType,
  parseEft,
  type Fit,
  type FittingDataset,
  type SdeType,
  type SkillProfile,
} from 'eve-fit-engine/node';
import type { Loadout } from '../settings';
import { DAMAGE_TYPES, type DamageVector } from '../sde/damage';
import {
  LAYERS,
  type FitResult,
  type FitStats,
  type Layer,
  type LayerStats,
  type FitLoadoutView,
  type MissileProfile,
  type Pilot,
  type WeaponProfile,
} from './types';

export * from './types';

/** Attribute ids read straight from the engine's SDE extract. */
const ATTR_SHIP_DRONE_BANDWIDTH = 1271;
const ATTR_DRONE_BANDWIDTH_USED = 1272;
const ATTR_DRF = 1353;
/** Implant slot (implantness). */
const ATTR_IMPLANT_SLOT = 331;
const DAMAGE_ATTRS = { em: 114, explosive: 116, kinetic: 117, thermal: 118 } as const;
const CATEGORY_CHARGE = 8;
/** The "Ship Modifiers" group: tactical destroyer modes, named "<Hull> <Name> Mode". */
const GROUP_SHIP_MODIFIERS = 1306;
const FOF = /Auto-Targeting/;
/** Charges whose name says they are not plain ammo (event, test or tutorial items). */
const ODD_CHARGE = /\b(Tournament|Blueprint|Test|Tutorial)\b/i;
/** Drones in space at once with Drones V; the engine does not decide which drones are out. */
const MAX_ACTIVE_DRONES = 5;

export class FitEngine {
  private constructor(
    private readonly dataset: FittingDataset,
    private readonly skills: SkillProfile,
  ) {}

  /** Loads the engine's bundled data (~8.5 MB JSON, ~70 ms). Do it once and reuse the engine. */
  static async load(): Promise<FitEngine> {
    const dataset = await loadBundledDataset();
    return new FitEngine(dataset, buildAllVSkillProfile(dataset));
  }

  private byName: Map<string, SdeType> | null = null;
  private readonly pilotProfiles = new WeakMap<Pilot, SkillProfile>();

  private typeByName(name: string): SdeType | null {
    if (!this.byName) {
      this.byName = new Map();
      for (const bucket of Object.values(this.dataset.typesByBucket))
        for (const t of bucket?.values() ?? []) if (t.name && !this.byName.has(t.name)) this.byName.set(t.name, t);
    }
    return this.byName.get(name) ?? null;
  }

  /** The skill profile for a pilot (cached per pilot object), or All V. */
  private profileFor(pilot: Pilot | null): SkillProfile {
    if (!pilot) return this.skills;
    let p = this.pilotProfiles.get(pilot);
    if (!p) {
      const skills: SkillProfile['skills'] = {};
      for (const [id, level] of pilot.skills) skills[id] = Math.max(0, Math.min(5, level)) as 0 | 1 | 2 | 3 | 4 | 5;
      p = { name: pilot.name, isDefault: false, source: 'esi', skills };
      this.pilotProfiles.set(pilot, p);
    }
    return p;
  }

  /**
   * Weapons pasted without a charge get one from the cargo (the first that fits), as the player would load it;
   * otherwise a fit copied with empty launchers shows 0 DPS.
   */
  private loadFromCargo(fit: Fit, loadout: Loadout | null = null): void {
    for (const m of fit.modules) {
      const t = this.dataset.getType(m.typeID);
      // The player's pick for this weapon type (EVE-83) wins over the paste.
      const picked = t?.name ? loadout?.charges[t.name] : undefined;
      const pickedType = picked ? this.typeByName(picked) : null;
      if (t && pickedType && moduleAcceptsChargeType(t, pickedType)) {
        m.chargeTypeID = pickedType.id;
        continue;
      }
      if (m.chargeTypeID) continue;
      if (!t || !(isMissileLauncher(t) || isTurretWeapon(t))) continue;
      // Of the cargo's charges that fit: not FOF missiles (they pick their own target), then the biggest stack.
      const c = fit.cargo
        .map((x) => ({ type: this.dataset.getType(x.typeID), count: x.count }))
        .filter((x) => x.type && moduleAcceptsChargeType(t, x.type))
        .sort(
          (a, b) => Number(FOF.test(a.type!.name ?? '')) - Number(FOF.test(b.type!.name ?? '')) || b.count - a.count,
        )[0];
      if (c) m.chargeTypeID = c.type!.id;
    }
  }

  /** The pilot's implants into the fit (EFT pastes carry none). */
  private plugIn(fit: Fit, pilot: Pilot | null): void {
    if (!pilot) return;
    fit.implants = pilot.implants.flatMap((typeID, i) => {
      const t = this.dataset.getType(typeID);
      const slot = t?.attributes.find((a) => a.id === ATTR_IMPLANT_SLOT)?.v;
      return t && slot ? [{ id: `implant-${i}`, typeID, slot }] : [];
    });
  }

  /**
   * The fit's parts for the fitting window list (EVE-83), with the loadout applied: racks in game order, the
   * charge each module holds and the ones it takes, drones with how many are in space, and the cargo.
   */
  loadoutView(eft: string, loadout: Loadout | null = null): FitLoadoutView | null {
    const fit = this.parsed(eft, null, loadout);
    if (!fit) return null;
    this.launchDrones(fit.drones, fit.shipTypeID, loadout);
    const cargo = new Set(fit.cargo.map((c) => c.typeID));
    const RACKS = [
      ['HI', 'high'],
      ['MED', 'mid'],
      ['LO', 'low'],
      ['RIG', 'rig'],
      ['SUBSYSTEM', 'subsystem'],
    ] as const;
    const options = new Map<number, FitLoadoutView['racks'][number]['modules'][number]['chargeOptions']>();
    const chargesFor = (t: SdeType) => {
      if (!options.has(t.id)) {
        const list: { name: string; inCargo: boolean }[] = [];
        for (const c of this.dataset.typesByBucket.charges?.values() ?? []) {
          if (!c.name || !c.marketGroupID || ODD_CHARGE.test(c.name) || !moduleAcceptsChargeType(t, c)) continue;
          list.push({ name: c.name, inCargo: cargo.has(c.id) });
        }
        list.sort((a, b) => Number(b.inCargo) - Number(a.inCargo) || a.name.localeCompare(b.name));
        options.set(t.id, list.length ? list : null);
      }
      return options.get(t.id)!;
    };
    const attr = (typeID: number, id: number) =>
      this.dataset.getType(typeID)?.attributes.find((a) => a.id === id)?.v ?? 0;
    const name = (id: number) => this.dataset.getType(id)?.name ?? String(id);
    return {
      racks: RACKS.map(([slot, rack]) => ({
        rack,
        modules: fit.modules
          .filter((m) => m.slotType === slot)
          .sort((a, b) => a.position - b.position)
          .map((m) => {
            const t = this.dataset.getType(m.typeID);
            return {
              name: name(m.typeID),
              typeId: m.typeID,
              charge: m.chargeTypeID ? name(m.chargeTypeID) : null,
              chargeOptions: t && (isMissileLauncher(t) || isTurretWeapon(t)) ? chargesFor(t) : null,
            };
          }),
      })).filter((r) => r.modules.length > 0),
      drones: fit.drones.map((d) => ({
        name: name(d.typeID),
        typeId: d.typeID,
        total: d.countTotal,
        active: d.countActive,
        bandwidth: attr(d.typeID, ATTR_DRONE_BANDWIDTH_USED),
      })),
      droneBandwidth: attr(fit.shipTypeID, ATTR_SHIP_DRONE_BANDWIDTH),
      modes: (() => {
        const modes = this.modesFor(fit.shipTypeID);
        return modes.length
          ? modes.map((m) => ({ name: m.name!, label: this.modeLabel(m.id), active: m.id === fit.modeTypeID }))
          : null;
      })(),
      cargo: fit.cargo.map((c) => ({ name: name(c.typeID), typeId: c.typeID, count: c.count })),
    };
  }

  /** A type's id by its exact name, from the engine's data. */
  typeIdByName(name: string): number | null {
    return this.typeByName(name)?.id ?? null;
  }

  /** "Jackdaw Sharpshooter Mode" → "Sharpshooter". */
  private modeLabel(typeID: number): string {
    const t = this.dataset.getType(typeID);
    const ship = this.dataset.getType(t?.id ?? 0)?.name ?? '';
    return ship.replace(/^\S+(\s+Navy Issue)?\s+/, '').replace(/\s+Mode$/, '');
  }

  /** A hull's tactical destroyer modes (EVE-85), Defense first (the game's default); empty for other hulls. */
  modesFor(shipTypeID: number): SdeType[] {
    const ship = this.dataset.getType(shipTypeID)?.name;
    if (!ship) return [];
    const out: SdeType[] = [];
    for (const bucket of Object.values(this.dataset.typesByBucket))
      for (const t of bucket?.values() ?? [])
        if (t.groupID === GROUP_SHIP_MODIFIERS && t.name?.startsWith(`${ship} `) && !out.includes(t)) out.push(t);
    return out.sort((a, b) => a.id - b.id);
  }

  /**
   * The mode the numbers use: the player's pick, else a mode line in the paste (pyfa writes one), else Defense.
   * Returns the warnings without the mode line, which is not an unknown module.
   */
  private applyMode(fit: Fit, warnings: { text: string }[], loadout: Loadout | null): { text: string }[] {
    const modes = this.modesFor(fit.shipTypeID);
    if (!modes.length) return warnings;
    const named = (n: string | undefined) => modes.find((m) => m.name === n?.trim());
    const line = warnings.map((w) => named(w.text)).find(Boolean);
    fit.modeTypeID = (named(loadout?.mode) ?? line ?? modes[0]!).id;
    return warnings.filter((w) => !named(w.text));
  }

  /** Parse plus what every computation needs: modules running, ammo, implants, the T3D mode. */
  private prepare(
    eft: string,
    pilot: Pilot | null,
    loadout: Loadout | null,
  ): { fit: Fit; warnings: { text: string }[] } {
    const parsed = parseEft(eft, this.dataset);
    const { fit } = parsed;
    // parseEft leaves everything online; run what can be activated, as the fitting window does.
    for (const m of fit.modules) {
      const t = this.dataset.getType(m.typeID);
      if (t) m.state = defaultStateForModule(t, this.dataset.effects);
    }
    this.loadFromCargo(fit, loadout);
    this.plugIn(fit, pilot);
    return { fit, warnings: this.applyMode(fit, parsed.warnings, loadout) };
  }

  private parsed(eft: string, pilot: Pilot | null = null, loadout: Loadout | null = null): Fit | null {
    try {
      return this.prepare(eft, pilot, loadout).fit;
    } catch {
      return null;
    }
  }

  /** The fit's launchers loaded with one charge: what a missile does. Null when no launcher takes it. */
  private missile(fit: Fit, charge: SdeType, skills: SkillProfile): MissileProfile | null {
    let launchers = 0;
    for (const m of fit.modules) {
      const t = this.dataset.getType(m.typeID);
      if (t && isMissileLauncher(t) && moduleAcceptsChargeType(t, charge)) {
        m.chargeTypeID = charge.id;
        launchers++;
      } else if (t && isMissileLauncher(t)) m.chargeTypeID = undefined;
    }
    if (!launchers) return null;
    const { derived } = computeFit(fit, this.dataset, { skillProfile: skills });
    const row = derived.offense.breakdown.find((w) => w.kind === 'MISSILE' && w.chargeTypeID === charge.id);
    if (!row || row.count <= 0) return null;
    return {
      charge: charge.name ?? String(charge.id),
      damage: row.alpha / row.count,
      explosionRadius: row.range.explosionRadius,
      explosionVelocity: row.range.explosionVelocity,
      drf: row.range.drf || (charge.attributes.find((a) => a.id === ATTR_DRF)?.v ?? 0),
      launchers,
    };
  }

  /** The strongest damage type of a charge, to offer alternatives that keep the player's damage choice. */
  private mainDamage(t: SdeType): string | null {
    let best: [string, number] | null = null;
    for (const [k, id] of Object.entries(DAMAGE_ATTRS)) {
      const v = t.attributes.find((a) => a.id === id)?.v ?? 0;
      if (v > 0 && (!best || v > best[1])) best = [k, v];
    }
    return best?.[0] ?? null;
  }

  /**
   * What the combat log's weapon name means for this fit (EVE-80): a missile charge with its paper damage and
   * explosion, plus the other charges of the same damage type its launchers take; or a turret.
   */
  weaponProfile(
    eft: string,
    weapon: string,
    pilot: Pilot | null = null,
    loadout: Loadout | null = null,
  ): WeaponProfile {
    const fit = this.parsed(eft, pilot, loadout);
    const skills = this.profileFor(pilot);
    const t = this.typeByName(weapon);
    if (!fit || !t) return { kind: 'other' };
    if (t.categoryID === CATEGORY_CHARGE) {
      const missile = this.missile(fit, t, skills);
      if (!missile) return { kind: 'other' };
      const damage = this.mainDamage(t);
      const launcher = fit.modules
        .map((m) => this.dataset.getType(m.typeID))
        .find((x) => x && isMissileLauncher(x) && moduleAcceptsChargeType(x, t))!;
      const alternatives: MissileProfile[] = [];
      for (const c of this.dataset.typesByBucket.charges?.values() ?? []) {
        if (c.id === t.id || !c.name || !c.marketGroupID || ODD_CHARGE.test(c.name)) continue;
        if (!moduleAcceptsChargeType(launcher, c) || this.mainDamage(c) !== damage) continue;
        const p = this.missile(fit, c, skills);
        if (p) alternatives.push(p);
      }
      return { kind: 'missile', missile, alternatives };
    }
    if (isTurretWeapon(t)) {
      const { derived } = computeFit(fit, this.dataset, { skillProfile: skills });
      const row = derived.offense.breakdown.find((w) => w.kind === 'TURRET' && w.typeID === t.id);
      if (!row) return { kind: 'other' };
      return {
        kind: 'turret',
        turret: { weapon, optimal: row.range.optimal, falloff: row.range.falloff, tracking: row.range.tracking },
      };
    }
    return { kind: 'other' };
  }

  /**
   * An ESI fitting (type ids and slot flags) as EFT text, so it is stored and computed like a pasted fit (EVE-65).
   * Null when the hull is unknown to the engine's data.
   */
  eftFromEsi(f: {
    name: string;
    ship_type_id: number;
    items: { type_id: number; flag: string; quantity: number }[];
  }): { eft: string; shipName: string } | null {
    const shipName = this.dataset.getType(f.ship_type_id)?.name;
    if (!shipName) return null;
    const name = (id: number) => this.dataset.getType(id)?.name ?? null;
    const rack = (prefix: string) =>
      f.items
        .filter((i) => i.flag.startsWith(prefix))
        .sort((a, b) => Number(a.flag.slice(prefix.length)) - Number(b.flag.slice(prefix.length)))
        .map((i) => name(i.type_id))
        .filter((n): n is string => !!n);
    const counted = (flags: string[]) => {
      const sum = new Map<string, number>();
      for (const i of f.items) {
        const n = flags.includes(i.flag) ? name(i.type_id) : null;
        if (n) sum.set(n, (sum.get(n) ?? 0) + i.quantity);
      }
      return [...sum].map(([n, q]) => `${n} x${q}`);
    };
    const blocks = [
      rack('LoSlot'),
      rack('MedSlot'),
      rack('HiSlot'),
      rack('RigSlot'),
      rack('SubSystemSlot'),
      counted(['DroneBay', 'FighterBay']),
      counted(['Cargo']),
    ];
    // EFT: one block per rack, an empty line between them; empty racks still take their place up to the subsystems.
    const eft = [`[${shipName}, ${f.name}]`, ...blocks.map((b) => b.join('\n'))].join('\n\n').replace(/\n{3,}$/, '\n');
    return { eft: eft.trimEnd() + '\n', shipName };
  }

  get dataVersion(): string {
    return this.dataset.version;
  }

  /** Parses an EFT paste (in-game Fitting window → Copy to clipboard) and computes its stats. */
  compute(eft: string, pilot: Pilot | null = null, loadout: Loadout | null = null): FitResult {
    let prepared: ReturnType<typeof this.prepare>;
    try {
      prepared = this.prepare(eft, pilot, loadout);
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
    const { fit, warnings } = prepared;
    const activeDrones = this.launchDrones(fit.drones, fit.shipTypeID, loadout);
    const { derived: d } = computeFit(fit, this.dataset, { skillProfile: this.profileFor(pilot) });

    const layer = (l: { hp: number; resistances: DamageVector }): LayerStats => ({
      hp: l.hp,
      resists: { ...l.resistances },
    });
    const slot = (s: { used: number; max: number } | undefined) => ({ used: s?.used ?? 0, max: s?.max ?? 0 });
    const layers = { shield: layer(d.defense.shield), armor: layer(d.defense.armor), hull: layer(d.defense.hull) };
    const stats: FitStats = {
      shipTypeID: fit.shipTypeID,
      shipName: this.dataset.getType(fit.shipTypeID)?.name ?? String(fit.shipTypeID),
      fitName: fit.name,
      skills: pilot ? { character: pilot.name, implants: fit.implants.length } : 'all-v',
      fitting: {
        cpuUsed: d.fitting.cpuUsed,
        cpuMax: d.fitting.cpuMax,
        powerUsed: d.fitting.powerUsed,
        powerMax: d.fitting.powerMax,
        calibrationUsed: d.fitting.calibrationUsed,
        calibrationMax: d.fitting.calibrationMax,
        slots: {
          high: slot(d.fitting.slots.HI),
          mid: slot(d.fitting.slots.MED),
          low: slot(d.fitting.slots.LO),
          rig: slot(d.fitting.slots.RIG),
        },
      },
      layers,
      ehpOmni: ehpAgainst(layers, { em: 1, thermal: 1, kinetic: 1, explosive: 1 }),
      tank: {
        shieldBoostPerSecond: d.tank.shieldRepairPerSecond,
        armorRepairPerSecond: d.tank.armorRepairPerSecond,
        hullRepairPerSecond: d.tank.hullRepairPerSecond,
        passiveShieldRegenPeak: d.tank.passiveShieldRegenPeak,
      },
      capacitor: {
        capacity: d.capacitor.capacity,
        rechargeSeconds: d.capacitor.rechargeMs / 1000,
        peakRechargePerSecond: d.capacitor.peakRechargeRate,
        usagePerSecond: d.capacitor.usagePerSecond,
        stable: d.capacitor.stable,
        stableFraction: d.capacitor.stablePercent,
        secondsToEmpty: d.capacitor.stable ? null : (d.capacitor.secondsToEmpty ?? null),
      },
      offense: {
        weaponDps: d.offense.weaponDps,
        droneDps: d.offense.droneDps,
        totalDps: d.offense.totalDps,
        sustainedDps: d.offense.totalSustainedDps,
        alpha: d.offense.alphaStrike,
        activeDrones,
      },
      navigation: {
        maxVelocity: d.navigation.maxVelocity,
        alignSeconds: d.navigation.alignTimeSeconds,
        signatureRadius: d.targeting.signatureRadius,
        mass: d.navigation.mass,
        agility: d.navigation.agility,
        warpSpeed: d.navigation.warpSpeed,
      },
      lockRange: d.targeting.maxTargetingRange,
      targeting: {
        maxLockedTargets: d.targeting.maxLockedTargets,
        scanResolution: d.targeting.scanResolution,
        sensorStrength: d.targeting.sensorStrength,
        sensorType: d.targeting.sensorType,
      },
      drones: {
        bandwidthUsed: d.drones.bandwidthUsed,
        bandwidthMax: d.drones.bandwidthMax,
        controlRange: d.drones.controlRange,
        active: d.drones.active,
      },
      mode: fit.modeTypeID ? this.modeLabel(fit.modeTypeID) : null,
      // Peak passive regen is 2.5 × capacity / recharge time (the shield's recharge curve), so it gives the time.
      shieldRechargeSeconds:
        d.tank.passiveShieldRegenPeak > 0 ? (2.5 * d.defense.shield.hp) / d.tank.passiveShieldRegenPeak : null,
    };
    // "Name xN" lines the engine does not know are cargo it has no data for (deployables, loot); they do not
    // change the stats. Anything else unknown is a module the stats are missing.
    const unknownLines = warnings.filter((w) => !/\sx\d+$/.test(w.text.trim())).map((w) => w.text);
    return { ok: true, stats, unknownLines };
  }

  /**
   * EFT lists drones in the bay only. Put the heaviest ones in space up to the ship's bandwidth and five drones,
   * which is what a PvE pilot launches, so drone DPS is not zero.
   */
  private launchDrones(
    drones: { typeID: number; countTotal: number; countActive: number }[],
    shipTypeID: number,
    loadout: Loadout | null = null,
  ): string[] {
    // The player's own choice (EVE-83): exactly those, also over bandwidth (the loadout view warns).
    if (loadout && Object.keys(loadout.drones).length) {
      const out: string[] = [];
      for (const d of drones) {
        const name = this.dataset.getType(d.typeID)?.name ?? String(d.typeID);
        d.countActive = Math.max(0, Math.min(d.countTotal, loadout.drones[name] ?? 0));
        if (d.countActive) out.push(`${d.countActive} × ${name}`);
      }
      return out;
    }
    const attr = (typeID: number, id: number) =>
      this.dataset.getType(typeID)?.attributes.find((a) => a.id === id)?.v ?? 0;
    const bandwidthOf = (typeID: number) => attr(typeID, ATTR_DRONE_BANDWIDTH_USED);
    let bandwidth = attr(shipTypeID, ATTR_SHIP_DRONE_BANDWIDTH);
    let slots = MAX_ACTIVE_DRONES;
    const out: string[] = [];
    for (const d of [...drones].sort((a, b) => bandwidthOf(b.typeID) - bandwidthOf(a.typeID))) {
      const each = bandwidthOf(d.typeID);
      const n = each > 0 ? Math.min(d.countTotal, slots, Math.floor(bandwidth / each)) : 0;
      d.countActive = n;
      if (n === 0) continue;
      bandwidth -= n * each;
      slots -= n;
      out.push(`${n} × ${this.dataset.getType(d.typeID)?.name ?? d.typeID}`);
    }
    return out;
  }
}

/** Total EHP against a damage mix (any scale; only the ratios count). Cheap, so a site check needs no recompute. */
export function ehpAgainst(layers: Record<Layer, LayerStats>, damage: DamageVector): number {
  const total = DAMAGE_TYPES.reduce((s, t) => s + damage[t], 0);
  if (total <= 0) return 0;
  return LAYERS.reduce((sum, l) => {
    const taken = DAMAGE_TYPES.reduce((s, t) => s + (damage[t] / total) * (1 - layers[l].resists[t]), 0);
    return sum + (taken > 0 ? layers[l].hp / taken : Infinity);
  }, 0);
}
