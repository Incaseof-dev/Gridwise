/** Fit stats types (EVE-62). Dependency-free: the view model and the renderers use them. */
import type { DamageVector } from '../sde/damage';

export type Layer = 'shield' | 'armor' | 'hull';
export const LAYERS: readonly Layer[] = ['shield', 'armor', 'hull'];

export interface LayerStats {
  hp: number;
  /** Resist per damage type, 0..1. */
  resists: DamageVector;
}

export interface FitStats {
  shipTypeID: number;
  shipName: string;
  fitName: string;
  /** Skill levels the numbers assume: All V, or a logged-in character's skills and implants (EVE-38). */
  skills: 'all-v' | { character: string; implants: number };
  fitting: {
    cpuUsed: number;
    cpuMax: number;
    powerUsed: number;
    powerMax: number;
    calibrationUsed: number;
    calibrationMax: number;
    /** Fitted / available per rack; more fitted than available means the paste does not fit the hull. */
    slots: Record<'high' | 'mid' | 'low' | 'rig', { used: number; max: number }>;
  };
  layers: Record<Layer, LayerStats>;
  /** EHP against even damage on all four types. */
  ehpOmni: number;
  tank: {
    shieldBoostPerSecond: number;
    armorRepairPerSecond: number;
    hullRepairPerSecond: number;
    passiveShieldRegenPeak: number;
  };
  capacitor: {
    capacity: number;
    rechargeSeconds: number;
    /** Highest recharge rate, reached at 25 % cap. */
    peakRechargePerSecond: number;
    /** Drain of the modules the engine runs (everything that can be activated). */
    usagePerSecond: number;
    stable: boolean;
    /** Cap level it settles at, 0..1, when stable. */
    stableFraction: number;
    /** From full to empty, when not stable. */
    secondsToEmpty: number | null;
  };
  offense: {
    weaponDps: number;
    droneDps: number;
    totalDps: number;
    /** DPS with the reloads counted in. */
    sustainedDps: number;
    alpha: number;
    /** Drones the numbers assume in space, e.g. "4 × Imperial Navy Praetor". */
    activeDrones: string[];
  };
  navigation: {
    maxVelocity: number;
    alignSeconds: number;
    signatureRadius: number;
    /** kg */
    mass: number;
    /** Inertia modifier. */
    agility: number;
    /** AU/s */
    warpSpeed: number;
  };
  lockRange: number;
  targeting: { maxLockedTargets: number; scanResolution: number; sensorStrength: number; sensorType: string };
  drones: { bandwidthUsed: number; bandwidthMax: number; controlRange: number; active: number };
  /** The tactical destroyer mode the numbers assume (EVE-85), e.g. "Sharpshooter"; null for other hulls. */
  mode: string | null;
  /** Time for the shield to recharge from empty to full (passive). */
  shieldRechargeSeconds: number | null;
}

/** A logged-in character's skills (type id → active level) and implant type ids, from ESI (EVE-38). */
export interface Pilot {
  name: string;
  skills: ReadonlyMap<number, number>;
  implants: readonly number[];
}

/** One missile of a charge from this fit's launchers, with the fit's skills and bonuses (EVE-80). */
export interface MissileProfile {
  charge: string;
  /** Paper damage of one missile, before the target's resists and the application. */
  damage: number;
  explosionRadius: number;
  explosionVelocity: number;
  /** Damage reduction factor: how hard a faster target cuts the damage. */
  drf: number;
  /** Launchers that fire it. */
  launchers: number;
}

/** A turret of this fit (EVE-80, experimental: the log has no ranges). */
export interface TurretProfile {
  weapon: string;
  optimal: number;
  falloff: number;
  tracking: number;
}

/** What the combat log names as the weapon: a missile charge, a turret, or something else (drones, smartbombs). */
export type WeaponProfile =
  | { kind: 'missile'; missile: MissileProfile; alternatives: MissileProfile[] }
  | { kind: 'turret'; turret: TurretProfile }
  | { kind: 'other' };

/** The fit's parts as in the game's fitting window (EVE-83): only charges and drones can be changed. */
export interface FitLoadoutView {
  racks: {
    rack: 'high' | 'mid' | 'low' | 'rig' | 'subsystem';
    modules: {
      name: string;
      typeId: number;
      /** The loaded charge, or null. */
      charge: string | null;
      /** Charges it takes, the ones in the cargo first; null for modules without charges. */
      chargeOptions: { name: string; inCargo: boolean }[] | null;
    }[];
  }[];
  drones: { name: string; typeId: number; total: number; active: number; bandwidth: number }[];
  droneBandwidth: number;
  /** Tactical destroyers' modes (EVE-85), e.g. Defense / Propulsion / Sharpshooter; null for other hulls. */
  modes: { name: string; label: string; active: boolean }[] | null;
  cargo: { name: string; typeId: number; count: number }[];
}

export type FitResult = { ok: true; stats: FitStats; unknownLines: string[] } | { ok: false; error: string };
