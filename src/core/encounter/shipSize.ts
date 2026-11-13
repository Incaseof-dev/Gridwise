/** Hull size of a spawn for its overview-style icon. Dependency-free. */
export type ShipSize =
  'frigate' | 'destroyer' | 'cruiser' | 'battlecruiser' | 'battleship' | 'capital' | 'structure' | 'sentry' | 'drone';

const RULES: [RegExp, ShipSize][] = [
  [/titan|dreadnought|carrier|supercarrier|capital|freighter|force auxiliary/i, 'capital'],
  [/battlecruiser/i, 'battlecruiser'],
  [/battleship/i, 'battleship'],
  [/destroyer/i, 'destroyer'],
  [/cruiser/i, 'cruiser'],
  [/frigate|shuttle|corvette/i, 'frigate'],
  [/sentry|tower|battery|turret/i, 'sentry'],
  [/drone|fighter/i, 'drone'],
  [/structure|hangar|bunker|silo|station|gate|accl|container|array|relay|beacon|post|pylon|wall/i, 'structure'],
];

/**
 * From the source's class text ("Elite Cruiser", "Battleship", "Structure") first; the SDE overview group
 * ("Frigate", "Cruiser", "Battleship" — it rarely says destroyer/battlecruiser) as fallback.
 */
export function shipSize(cls: string | null, overviewGroup: string | null): { size: ShipSize | null; elite: boolean } {
  const fromCls = cls ? RULES.find(([re]) => re.test(cls))?.[1] : undefined;
  const fromSde = overviewGroup ? RULES.find(([re]) => re.test(overviewGroup))?.[1] : undefined;
  return { size: fromCls ?? fromSde ?? null, elite: /elite|dire|commander|officer|overseer/i.test(cls ?? '') };
}
