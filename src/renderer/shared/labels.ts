import type { DamageType } from '../../core/sde/damage';
import type { NpcCapabilityKind } from '../../core/sde/npcCapabilities';

export const DAMAGE_LABEL: Record<DamageType, string> = { em: 'EM', thermal: 'TH', kinetic: 'KI', explosive: 'EX' };
export const DAMAGE_NAME: Record<DamageType, string> = {
  em: 'EM',
  thermal: 'Thermal',
  kinetic: 'Kinetic',
  explosive: 'Explosive',
};

export const EWAR_LABEL: Record<NpcCapabilityKind, string> = {
  warpScramble: 'SCRAM',
  warpDisruption: 'POINT',
  web: 'WEB',
  neut: 'NEUT',
  nos: 'NOS',
  ecm: 'ECM',
  sensorDamp: 'DAMP',
  trackingDisruption: 'TD',
  guidanceDisruption: 'GD',
  targetPaint: 'PAINT',
  remoteRepair: 'LOGI',
  rampingDamage: 'RAMP',
  smartbomb: 'SMARTBOMB',
  superWeapon: 'DOOMSDAY',
};

export const EWAR_NAME: Record<NpcCapabilityKind, string> = {
  warpScramble: 'Warp scrambler (stops warp and MWD)',
  warpDisruption: 'Warp disruptor (stops warp)',
  web: 'Stasis webifier',
  neut: 'Energy neutralizer',
  nos: 'Energy nosferatu',
  ecm: 'ECM jammer',
  sensorDamp: 'Sensor dampener',
  trackingDisruption: 'Tracking disruptor',
  guidanceDisruption: 'Guidance disruptor',
  targetPaint: 'Target painter',
  remoteRepair: 'Remote repair (logistics)',
  rampingDamage: 'Ramping damage (Triglavian)',
  smartbomb: 'Smartbomb / area damage',
  superWeapon: 'Super weapon',
};

export const BASIS_LABEL = { kb: 'knowledge base', sde: 'SDE dogma', observed: 'observed' } as const;
