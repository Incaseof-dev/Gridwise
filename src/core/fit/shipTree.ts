/**
 * The Ship fit tab's tree (EVE-82), like EVE's fitting browser: ship class → faction → ship → the player's fits.
 * The class comes from the SDE group ("Assault Frigate" → Frigates), the faction from the hull's faction.
 * Dependency-free.
 */

/** Ship classes in the game's order, each with the SDE groups that belong to it. */
export const SHIP_CLASSES: readonly { name: string; groups: readonly string[] }[] = [
  { name: 'Corvettes and shuttles', groups: ['Corvette', 'Shuttle', 'Capsule'] },
  {
    name: 'Frigates',
    groups: [
      'Frigate',
      'Assault Frigate',
      'Interceptor',
      'Covert Ops',
      'Electronic Attack Ship',
      'Logistics Frigate',
      'Expedition Frigate',
      'Prototype Exploration Ship',
      'Stealth Bomber',
    ],
  },
  { name: 'Destroyers', groups: ['Destroyer', 'Interdictor', 'Tactical Destroyer', 'Command Destroyer'] },
  {
    name: 'Cruisers',
    groups: [
      'Cruiser',
      'Heavy Assault Cruiser',
      'Heavy Interdiction Cruiser',
      'Logistics',
      'Combat Recon Ship',
      'Force Recon Ship',
      'Strategic Cruiser',
      'Flag Cruiser',
      'Expedition Command Ship',
    ],
  },
  { name: 'Battlecruisers', groups: ['Combat Battlecruiser', 'Attack Battlecruiser', 'Command Ship'] },
  { name: 'Battleships', groups: ['Battleship', 'Black Ops', 'Marauder'] },
  {
    name: 'Capitals',
    groups: [
      'Carrier',
      'Command Carrier',
      'Dreadnought',
      'Lancer Dreadnought',
      'Force Auxiliary',
      'Supercarrier',
      'Titan',
    ],
  },
  {
    name: 'Industrial and mining',
    groups: [
      'Hauler',
      'Industrial',
      'Deep Space Transport',
      'Blockade Runner',
      'Freighter',
      'Jump Freighter',
      'Mining Barge',
      'Exhumer',
      'Industrial Command Ship',
      'Capital Industrial Ship',
    ],
  },
];
const OTHER = 'Other';

/** The class of an SDE ship group; unknown groups (new hull types, no SDE) go to "Other". */
export function shipClass(group: string | null): string {
  return SHIP_CLASSES.find((c) => group !== null && c.groups.includes(group))?.name ?? OTHER;
}

export interface TreeFit {
  id: string;
  name: string;
  shipName: string;
  shipTypeId: number | null;
  /** SDE group, e.g. "Assault Frigate"; null without the SDE. */
  shipGroup: string | null;
  /** The hull's faction, e.g. "Caldari State", "Guristas Pirates". */
  shipFaction: string | null;
}

export interface ShipNode<F extends TreeFit = TreeFit> {
  shipName: string;
  shipTypeId: number | null;
  shipGroup: string | null;
  fits: F[];
}
export interface FactionNode<F extends TreeFit = TreeFit> {
  faction: string;
  ships: ShipNode<F>[];
}
export interface ClassNode<F extends TreeFit = TreeFit> {
  name: string;
  factions: FactionNode<F>[];
}

const byName = (a: string, b: string) => a.localeCompare(b);

/** Groups fits into classes (game order), factions and ships (alphabetical); fits keep their given order. */
export function buildShipTree<F extends TreeFit>(fits: readonly F[]): ClassNode<F>[] {
  const classes = new Map<string, Map<string, Map<string, ShipNode<F>>>>();
  for (const f of fits) {
    const cls = shipClass(f.shipGroup);
    const faction = f.shipFaction ?? 'Unknown faction';
    let factions = classes.get(cls);
    if (!factions) classes.set(cls, (factions = new Map()));
    let ships = factions.get(faction);
    if (!ships) factions.set(faction, (ships = new Map()));
    let ship = ships.get(f.shipName);
    if (!ship)
      ships.set(
        f.shipName,
        (ship = { shipName: f.shipName, shipTypeId: f.shipTypeId, shipGroup: f.shipGroup, fits: [] }),
      );
    ship.fits.push(f);
  }
  const order = [...SHIP_CLASSES.map((c) => c.name), OTHER];
  return [...classes]
    .sort(([a], [b]) => order.indexOf(a) - order.indexOf(b))
    .map(([name, factions]) => ({
      name,
      factions: [...factions]
        .sort(([a], [b]) => byName(a, b))
        .map(([faction, ships]) => ({
          faction,
          ships: [...ships.values()].sort((a, b) => byName(a.shipName, b.shipName)),
        })),
    }));
}
