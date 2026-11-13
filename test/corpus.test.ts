/**
 * Runs the parser over the developer's real Game Logs (not committed) and reports what it does not understand.
 * Skipped when the directory does not exist. Override with EVE_GAMELOG_DIR.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isGamelogFileName, parseLogText } from '@core/logs/parser';

const dir =
  process.env.EVE_GAMELOG_DIR ??
  join(
    process.env.HOME ?? '',
    '.local/share/Steam/steamapps/compatdata/8500/pfx/drive_c/users/steamuser/Documents/EVE/logs/Gamelogs',
  );

describe.skipIf(!existsSync(dir))('corpus: real Game Logs', () => {
  it('parses every combat line', () => {
    const unknownByCategory = new Map<string, Map<string, number>>();
    const kinds = new Map<string, number>();
    let total = 0;
    for (const file of readdirSync(dir).filter(isGamelogFileName)) {
      const { events } = parseLogText(file, readFileSync(join(dir, file), 'utf8'));
      for (const e of events) {
        total++;
        kinds.set(e.kind, (kinds.get(e.kind) ?? 0) + 1);
        if (e.kind !== 'unknown') continue;
        const byShape = unknownByCategory.get(e.category) ?? new Map<string, number>();
        const shape = e.text.replace(/\d[\d,.]*/g, 'N').slice(0, 100);
        byShape.set(shape, (byShape.get(shape) ?? 0) + 1);
        unknownByCategory.set(e.category, byShape);
      }
    }
    const report = [...unknownByCategory].map(([cat, shapes]) => {
      const count = [...shapes.values()].reduce((a, b) => a + b, 0);
      const top = [...shapes].sort((a, b) => b[1] - a[1]).slice(0, 5);
      return `${cat}: ${count} unknown\n` + top.map(([s, n]) => `    ${n}× ${s}`).join('\n');
    });
    console.log(`events: ${total}\nkinds: ${JSON.stringify(Object.fromEntries(kinds))}\n${report.join('\n')}`);
    expect(unknownByCategory.get('combat')?.size ?? 0).toBe(0);
  });
});
