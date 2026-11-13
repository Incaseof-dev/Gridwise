import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fillText, loadTextPool, TextPicker } from './texts';

const BUNDLED = join(__dirname, '../../../messages/messages.yaml');
const vars = { npcs: ['Dire Pithum Nullifier'], durationMs: 3 * 60_000, gj: 576 };

function file(content: string): string {
  const f = join(mkdtempSync(join(tmpdir(), 'eve-texts-')), 'messages.yaml');
  writeFileSync(f, content);
  return f;
}

describe('message texts', () => {
  it('bundled file is valid and has a plain text for every trigger/phase', () => {
    const { pool, issues } = loadTextPool([BUNDLED]);
    expect(issues).toEqual([]);
    for (const [key, levels] of pool) expect(levels[0]?.length, key).toBeGreaterThan(0);
    for (const key of ['neut/sustained', 'neut/ended', 'ecm/sustained', 'web/sustained', 'multiTrigger/event'])
      expect(pool.has(key), key).toBe(true);
  });

  it('fills placeholders', () => {
    expect(fillText('{Min} minutes, {gj} GJ. {npcs} {has} won.', vars)).toBe(
      'Three minutes, 576 GJ. Dire Pithum Nullifier has won.',
    );
    expect(fillText('{npcs} {has}', { ...vars, npcs: ['A', 'B'] })).toBe('A, B have');
  });

  it('falls back to a lower level and keeps the text of a message while it is shown', () => {
    const { pool } = loadTextPool([file('x:\n  sustained:\n    0: [plain]\n    2: [a, b, c]\n')]);
    const p = new TextPicker(pool, () => 0);
    expect(p.text('x/sustained', 1, 'm1', vars)).toBe('plain');
    expect(p.text('x/sustained', 3, 'm1', vars)).toBe('a');
    expect(p.text('x/sustained', 3, 'm1', vars)).toBe('a');
    expect(p.text('unknown/phase', 2, 'm1', vars)).toBe('unknown/phase');
  });

  it('does not repeat a text until the list is used up', () => {
    const { pool } = loadTextPool([file('x:\n  event:\n    1: [a, b, c]\n')]);
    const p = new TextPicker(pool);
    const seen = ['m1', 'm2', 'm3'].map((id) => p.text('x/event', 1, id, vars));
    expect(new Set(seen).size).toBe(3);
  });

  it('a user file replaces single lists and is validated', () => {
    const user = file('neut:\n  sustained:\n    3: [mine]\nweb:\n  sustained:\n    7: [x]\n    1: ["bad {foo}"]\n');
    const { pool, issues } = loadTextPool([BUNDLED, user]);
    expect(pool.get('neut/sustained')![3]).toEqual(['mine']);
    expect(pool.get('neut/sustained')![0]!.length).toBe(1); // other levels kept
    expect(issues.map((i) => [i.path, i.severity])).toEqual([
      ['web/sustained/1', 'warning'],
      ['web/sustained/7', 'error'],
    ]);
  });
});
