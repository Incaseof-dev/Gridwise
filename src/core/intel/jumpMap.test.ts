import { describe, expect, it } from 'vitest';
import { JumpMap } from './jumpMap';

// A - B - C - D - E, plus B - F and an island G.
const names = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
const systems = names.map((name, i) => ({ id: i + 1, name, security: -0.5 }));
const edges: [number, number][] = [
  [1, 2],
  [2, 3],
  [3, 4],
  [4, 5],
  [2, 6],
];
const graph = new Map<number, number[]>();
for (const [a, b] of edges) {
  graph.set(a, [...(graph.get(a) ?? []), b]);
  graph.set(b, [...(graph.get(b) ?? []), a]);
}
const map = new JumpMap(systems, graph);

describe('JumpMap', () => {
  it('finds the shortest gate path, both ends included', () => {
    expect(map.path(6, 4)).toEqual([6, 2, 3, 4]);
    expect(map.path(3, 3)).toEqual([3]);
    expect(map.path(1, 7)).toBeNull();
  });

  it('counts jumps breadth first', () => {
    expect(map.distance(1, 1)).toBe(0);
    expect(map.distance(1, 5)).toBe(4);
    expect(map.distance(6, 4)).toBe(3);
  });

  it('stops at the limit and leaves unreachable systems out', () => {
    expect(map.distance(1, 5, 3)).toBeNull();
    expect(map.distance(1, 7)).toBeNull();
    expect([...map.from(1, 2).keys()].sort()).toEqual([1, 2, 3, 6]);
  });

  it('answers a smaller limit from the cached search', () => {
    map.from(1, 10);
    expect([...map.from(1, 1).entries()].sort()).toEqual([
      [1, 0],
      [2, 1],
    ]);
  });

  it('finds systems by name regardless of case', () => {
    expect(map.system('c')?.id).toBe(3);
    expect(map.system(6)?.name).toBe('F');
    expect(map.system('nope')).toBeNull();
  });
});
