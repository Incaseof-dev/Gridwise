/**
 * Headless view of what the parser (and later the whole engine) makes of a log.
 *
 *   npm run inspect -- <logfile>                 one line per event
 *   npm run inspect -- <logfile> --stats         counts per event kind
 *   npm run inspect -- <logfile> --kinds ewar,damageTaken
 *   npm run inspect -- <logfile> --json          JSON lines (full events)
 *   npm run inspect -- <logfile> --threats       threat changes and fight summaries (needs the SDE index)
 *   npm run inspect -- --watch <dir>             live, through the real watcher (e.g. with npm run replay)
 */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { describeEvent } from '../core/logs/describe';
import type { GameEvent } from '../core/logs/events';
import { parseLogText } from '../core/logs/parser';
import { LogReader } from '../core/logs/reader';
import { existsSync } from 'node:fs';
import { sdeDbPath } from '../core/paths';
import { GameDataService } from '../core/sde/gameData';
import { CombatTracker } from '../core/session/combat';
import { buildThreatContext } from '../core/threats/context';
import { assessThreats } from '../core/threats/engine';
import { parseArgs } from './args';

/** Replays parsed events through the combat tracker and threat engine, printing only changes. */
function printThreats(events: GameEvent[]): void {
  const gd = existsSync(sdeDbPath()) ? new GameDataService(sdeDbPath()) : null;
  if (!gd) console.error('[threats] no SDE index: known capabilities are not available');
  const ctx = buildThreatContext(null, gd);
  const combat = new CombatTracker();
  let prev = '';
  let wasEngaged = false;
  const summary = (now: number) => {
    const s = combat.stats(now);
    if (s) {
      console.log(
        `         -- fight ${Math.round(s.durationMs / 1000)} s: dealt ${s.dealt}, taken ${s.taken}, avg out ${Math.round(s.avgDpsOut)} / in ${Math.round(s.avgDpsIn)} dps, bounty ${s.bounty} (${s.bountyCount})`,
      );
    }
  };
  for (const e of events) {
    const before = combat.engagement(e.timeMs);
    if (wasEngaged && !before) summary(e.timeMs);
    combat.apply(e);
    const g = combat.engagement(e.timeMs);
    wasEngaged = g !== null;
    const threats = assessThreats(g, e.timeMs, ctx);
    const key = threats.map((t) => `${t.severity}:${t.id}`).join(' ');
    if (key !== prev) {
      console.log(
        `${e.time.slice(11, 19)} ${threats.length ? threats.map((t) => `[${t.severity}] ${t.text}`).join(' | ') : '(no threats)'}`,
      );
      prev = key;
    }
  }
  gd?.close();
}

function printer(flags: Map<string, string | true>): (e: GameEvent) => void {
  const kinds = typeof flags.get('kinds') === 'string' ? new Set((flags.get('kinds') as string).split(',')) : null;
  const json = flags.has('json');
  return (e) => {
    if (kinds && !kinds.has(e.kind)) return;
    console.log(json ? JSON.stringify(e) : `${e.time.slice(11, 19)} ${e.kind.padEnd(17)} ${describeEvent(e)}`);
  };
}

async function main(): Promise<void> {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const watchDir = flags.get('watch');

  if (typeof watchDir === 'string') {
    const print = printer(flags);
    const reader = new LogReader({ dir: watchDir, existingFiles: 'fromStart' });
    reader.on('status', (s) => console.error(`[watcher] ${s.state} ${s.dir} (${s.files.length} files)`));
    reader.on('session', (h) => console.error(`[session] ${h.character} ${h.file}`));
    reader.on('events', (_h, evs) => evs.forEach(print));
    await reader.start();
    return;
  }

  const file = positional[0];
  if (!file) {
    console.error('usage: npm run inspect -- <logfile> [--stats] [--kinds a,b] [--json] | --watch <dir>');
    process.exit(2);
  }
  const { header, events } = parseLogText(basename(file), readFileSync(file, 'utf8'));
  console.error(`[session] ${header.character ?? '(no character)'} started ${header.startedAt ?? '?'}`);

  if (flags.has('threats')) {
    printThreats(events);
    return;
  }
  if (flags.has('stats')) {
    const counts = new Map<string, number>();
    for (const e of events) counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1);
    for (const [k, n] of [...counts].sort((a, b) => b[1] - a[1])) console.log(`${String(n).padStart(8)}  ${k}`);
    return;
  }
  events.forEach(printer(flags));
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
