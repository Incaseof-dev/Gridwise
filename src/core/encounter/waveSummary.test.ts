import { describe, expect, it } from 'vitest';
import type { BriefSpawn } from '../viewmodel';
import { sumCounts, summarizeWave } from './waveSummary';

const spawn = (p: Partial<BriefSpawn>): BriefSpawn => ({
  count: '1',
  cls: null,
  names: ['X'],
  typeId: null,
  size: null,
  elite: false,
  group: null,
  ewar: [],
  triggers: null,
  note: null,
  drop: null,
  dropNotable: false,
  ...p,
});

describe('ultra compact waves', () => {
  it('sums counts and ranges', () => {
    expect(sumCounts(['3', '4'])).toBe('7');
    expect(sumCounts(['2-3', '1'])).toBe('3-4');
    expect(sumCounts(['2', '?'])).toBe('?');
  });

  it('groups spawns by size and eliteness and keeps the markers', () => {
    const badges = summarizeWave([
      spawn({ count: '3', size: 'frigate', names: ['Pithi Arrogator'], ewar: ['web'] }),
      spawn({ count: '2', size: 'cruiser' }),
      spawn({ count: '2', size: 'frigate', ewar: ['warpScramble'], triggers: 'wave 2' }),
      spawn({ count: '1', size: 'frigate', elite: true, drop: 'faction module' }),
    ]);
    expect(badges.map((b) => [b.size, b.elite, b.count])).toEqual([
      ['frigate', false, '5'],
      ['cruiser', false, '2'],
      ['frigate', true, '1'],
    ]);
    expect(badges[0]).toMatchObject({ ewar: ['web', 'warpScramble'], trigger: true, loot: false, lootNotable: false });
    expect(badges[2]!.loot).toBe(true);
  });
});

describe('loot marks', () => {
  it('a badge is notable when one of its drops is, common when they are only T1 ammo and the like', () => {
    const [common] = summarizeWave([spawn({ drop: 'T1 ammo' }), spawn({ drop: 'trade goods' })]);
    expect(common).toMatchObject({ loot: true, lootNotable: false });
    const [rare] = summarizeWave([spawn({ drop: 'T1 ammo' }), spawn({ drop: 'faction modules', dropNotable: true })]);
    expect(rare).toMatchObject({ loot: true, lootNotable: true });
  });
});
