/**
 * The hull size of a reported ship, for the overview-style icon on an intel row: Caracal, Stabber → cruiser. From
 * the SDE group (IntelShipView.cls), through the Ship fit tab's classes.
 */
import { SHIP_CLASSES } from '../fit/shipTree';

export type HullSize =
  'shuttle' | 'frigate' | 'destroyer' | 'cruiser' | 'battlecruiser' | 'battleship' | 'capital' | 'industrial';

const BY_CLASS: Record<string, HullSize> = {
  'Corvettes and shuttles': 'shuttle',
  Frigates: 'frigate',
  Destroyers: 'destroyer',
  Cruisers: 'cruiser',
  Battlecruisers: 'battlecruiser',
  Battleships: 'battleship',
  Capitals: 'capital',
  'Industrial and mining': 'industrial',
};

const SIZE = new Map<string, HullSize>();
for (const c of SHIP_CLASSES) {
  const size = BY_CLASS[c.name];
  if (size) for (const g of c.groups) SIZE.set(g, size);
}
export function hullSize(group: string | null): HullSize | null {
  return group ? (SIZE.get(group) ?? null) : null;
}

/** Biggest first: a battleship says more about a gang than its tackle does. */
export const HULL_ORDER: readonly HullSize[] = [
  'capital',
  'battleship',
  'battlecruiser',
  'cruiser',
  'destroyer',
  'frigate',
  'industrial',
  'shuttle',
];
