/** Damage types. Dependency-free so renderer code can import it. */
export type DamageType = 'em' | 'thermal' | 'kinetic' | 'explosive';
export const DAMAGE_TYPES: readonly DamageType[] = ['em', 'thermal', 'kinetic', 'explosive'];
export type DamageVector = Record<DamageType, number>;
