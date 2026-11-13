import { describe, expect, it } from 'vitest';
import { buildShipTree, shipClass } from './shipTree';

const fit = (id: string, shipName: string, shipGroup: string | null, shipFaction: string | null) => ({
  id,
  name: id,
  shipName,
  shipTypeId: null,
  shipGroup,
  shipFaction,
});

describe('ship tree', () => {
  it('maps SDE groups to the game classes', () => {
    expect(shipClass('Assault Frigate')).toBe('Frigates');
    expect(shipClass('Tactical Destroyer')).toBe('Destroyers');
    expect(shipClass('Marauder')).toBe('Battleships');
    expect(shipClass('Special Edition Yachts')).toBe('Other');
    expect(shipClass(null)).toBe('Other');
  });

  it('groups class (game order) → faction → ship (alphabetical), fits in their order', () => {
    const tree = buildShipTree([
      fit('praxis', 'Praxis', 'Battleship', 'The Society of Conscious Thought'),
      fit('hawk-b', 'Hawk', 'Assault Frigate', 'Caldari State'),
      fit('worm', 'Worm', 'Frigate', 'Guristas Pirates'),
      fit('hawk-a', 'Hawk', 'Assault Frigate', 'Caldari State'),
      fit('kestrel', 'Kestrel', 'Frigate', 'Caldari State'),
      fit('odd', 'Oddity', null, null),
    ]);
    expect(tree.map((c) => c.name)).toEqual(['Frigates', 'Battleships', 'Other']);
    const frigates = tree[0]!;
    expect(frigates.factions.map((f) => f.faction)).toEqual(['Caldari State', 'Guristas Pirates']);
    expect(frigates.factions[0]!.ships.map((s) => [s.shipName, s.fits.map((f) => f.id)])).toEqual([
      ['Hawk', ['hawk-b', 'hawk-a']],
      ['Kestrel', ['kestrel']],
    ]);
    expect(tree[2]!.factions[0]!.faction).toBe('Unknown faction');
  });
});
