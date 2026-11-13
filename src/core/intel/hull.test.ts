import { describe, expect, it } from 'vitest';
import { hullSize } from './hull';

describe('hullSize', () => {
  it('goes by the SDE group: a Caracal and a HAC are cruisers, a Sabre a destroyer', () => {
    expect(hullSize('Cruiser')).toBe('cruiser');
    expect(hullSize('Heavy Assault Cruiser')).toBe('cruiser');
    expect(hullSize('Interdictor')).toBe('destroyer');
    expect(hullSize('Black Ops')).toBe('battleship');
    expect(hullSize('Titan')).toBe('capital');
    expect(hullSize('Hauler')).toBe('industrial');
    expect(hullSize(null)).toBeNull();
    expect(hullSize('Something New')).toBeNull();
  });
});
