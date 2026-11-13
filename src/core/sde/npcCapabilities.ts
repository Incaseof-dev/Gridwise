/**
 * NPC dogma effect → capability mapping (docs/sde.md "EWAR and other capabilities").
 * Matched by effect name. A capability exists only if the NPC type has the effect; attributes alone are not evidence.
 */

export type NpcCapabilityKind =
  | 'warpScramble'
  | 'warpDisruption'
  | 'web'
  | 'neut'
  | 'nos'
  | 'ecm'
  | 'sensorDamp'
  | 'trackingDisruption'
  | 'guidanceDisruption'
  | 'targetPaint'
  | 'remoteRepair'
  | 'rampingDamage'
  | 'smartbomb'
  | 'superWeapon';

export const NPC_CAPABILITY_EFFECTS: Record<NpcCapabilityKind, readonly string[]> = {
  warpScramble: [
    'warpScrambleForEntity',
    'behaviorWarpScramble',
    'warpScrambleTargetMWDBlockActivationForEntity',
    'concordWarpScramble',
  ],
  warpDisruption: ['behaviorWarpDisrupt', 'warpDisrupt'],
  web: ['npcBehaviorWebifier', 'modifyTargetSpeed2', 'concordModifyTargetSpeed'],
  neut: ['npcBehaviorEnergyNeutralizer', 'entityEnergyNeutralizerFalloff', 'energyNeutralizerFalloff'],
  nos: ['npcBehaviorEnergyNosferatu'],
  ecm: ['entityECMFalloff', 'behaviorECM', 'concordTargetJam', 'NPCRemoteECM', 'entityEwTestEffectJam'],
  sensorDamp: ['entitySensorDampen', 'behaviorSensorDampener'],
  trackingDisruption: ['npcEntityTrackingDisruptor', 'npcBehaviorTrackingDisruptor'],
  guidanceDisruption: ['npcBehaviorGuidanceDisruptor'],
  targetPaint: ['entityTargetPaint', 'behaviorTargetPainter'],
  remoteRepair: [
    'npcBehaviorRemoteArmorRepairer',
    'NPCRemoteArmorRepair',
    'behaviorNpcRemoteArmorRepair',
    'npcEntityRemoteArmorRepairer',
    'npcBehaviorRemoteShieldBooster',
    'NPCRemoteShieldBoost',
  ],
  rampingDamage: ['targetDisintegratorAttack'],
  smartbomb: ['npcBehaviorSmartBomb', 'EntityChainLightning'],
  superWeapon: ['entitySuperWeapon', 'entitySuperWeaponLanceAllRaces'],
};

/** Legacy effects whose activation chance attribute is not linked in the effect definition. */
export const LEGACY_CHANCE_ATTRIBUTES: Record<string, string> = {
  warpScrambleForEntity: 'entityWarpScrambleChance',
  modifyTargetSpeed2: 'modifyTargetSpeedChance',
};

/** Attribute that carries the strength/amount of a capability, when there is one. */
export const CAPABILITY_STRENGTH_ATTRIBUTES: Partial<Record<NpcCapabilityKind, readonly string[]>> = {
  warpScramble: ['behaviorWarpScrambleStrength', 'warpScrambleStrength'],
  warpDisruption: ['behaviorWarpDisruptStrength', 'warpScrambleStrength'],
  neut: ['energyNeutralizerAmount'],
  web: ['speedFactor'],
  ecm: ['scanStrengthBonus'],
};

const BY_EFFECT = new Map<string, NpcCapabilityKind>(
  (Object.entries(NPC_CAPABILITY_EFFECTS) as [NpcCapabilityKind, readonly string[]][]).flatMap(([kind, effects]) =>
    effects.map((e) => [e, kind] as const),
  ),
);

export function capabilityForEffect(effectName: string): NpcCapabilityKind | null {
  return BY_EFFECT.get(effectName) ?? null;
}

/** Effects every NPC has or that are not a threat by themselves; not reported as "unmapped". */
export const IGNORED_NPC_EFFECTS = new Set([
  'targetAttack',
  'missileLaunchingForEntity',
  'npcBehaviorShieldBooster',
  'npcBehaviorArmorRepairer',
  'entityArmorRepairingSmall',
  'entityArmorRepairingMedium',
  'entityArmorRepairingLarge',
  'entityArmorRepairing',
  'entityShieldBoostingSmall',
  'entityShieldBoostingMedium',
  'entityShieldBoostingLarge',
  'entityShieldBoosting',
  'shieldBoostingForEntities',
  'armorRepairForEntities',
  'npcBehaviorMicroWarpDrive',
  'npcBehaviorSiege',
]);
