/**
 * Cuts a shareable fixture out of a real Gamelog (and Local chat log): a time window, only combat lines whose
 * every party is an SDE type (NPCs, structures), the listener renamed. No player names, no chat text: what players
 * wrote in Local is dropped, only the system change lines stay. Used for the e2e scenarios and screenshots.
 *
 *   npm run fixture -- <gamelog> --from HH:MM:SS --to HH:MM:SS --out test/fixtures/<name>.txt
 *                      [--chat <Local log> --chat-out test/fixtures/<name>.local.txt]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { parseLogText } from '../core/logs/parser';
import { sdeDbPath } from '../core/paths';
import { GameDataService } from '../core/sde/gameData';
import { parseArgs } from './args';

const ENTRY = /^\uFEFF?\[ [\d.]+ ([\d:]+) \] /;
const LISTENER = 'Docs Pilot';

function window(lines: string[], from: string, to: string): string[] {
  return lines.filter((l) => {
    const m = ENTRY.exec(l);
    return m && m[1]! >= from && m[1]! <= to;
  });
}

function header(content: string): string {
  const end = content.indexOf('\n[');
  return content.slice(0, end < 0 ? content.length : end + 1).replace(/Listener:\s*.*/, `Listener: ${LISTENER}`);
}

async function main(): Promise<void> {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const [src] = positional;
  const from = flags.get('from');
  const to = flags.get('to');
  const out = flags.get('out');
  if (!src || typeof from !== 'string' || typeof to !== 'string' || typeof out !== 'string') {
    console.error(
      'usage: npm run fixture -- <gamelog> --from HH:MM:SS --to HH:MM:SS --out <file> [--chat <Local log> --chat-out <file>]',
    );
    process.exit(2);
  }
  if (!existsSync(sdeDbPath())) throw new Error('needs the SDE index: npm run sde -- update');
  const gd = new GameDataService(sdeDbPath());
  const known = new Map<string, boolean>();
  const isType = (name: string) => {
    if (!known.has(name)) known.set(name, gd.typesByName(name).length > 0);
    return known.get(name)!;
  };

  const content = readFileSync(src, 'utf8');
  const head = header(content);
  let kept = 0;
  let dropped = 0;
  const body: string[] = [];
  for (const line of window(content.split('\n'), from, to)) {
    if (!line.includes('] (combat) ')) continue;
    const { events } = parseLogText('x.txt', `${head}${line}\n`);
    const e = events[0] as unknown as Record<string, unknown> | undefined;
    const parties = ['attacker', 'target'].map((k) => e?.[k]).filter((v): v is string => typeof v === 'string');
    if (e && e.kind !== 'unknown' && parties.length && parties.every(isType)) {
      body.push(line);
      kept++;
    } else dropped++;
  }
  gd.close();
  writeFileSync(out, head + body.join('\n') + '\n');
  console.log(`${kept} combat lines kept, ${dropped} dropped (not combat with SDE types only) → ${out}`);

  const chat = flags.get('chat');
  const chatOut = flags.get('chat-out');
  if (typeof chat === 'string' && typeof chatOut === 'string') {
    const text = readFileSync(chat).toString('utf16le');
    const lines = text.split('\n');
    const first = lines.findIndex((l) => ENTRY.test(l));
    const chatHead = lines
      .slice(0, first < 0 ? lines.length : first)
      .join('\n')
      .replace(/Listener:\s*.*/, `Listener:        ${LISTENER}`);
    // Every system line up to the end of the window: where the character was before it counts too.
    const system = lines.filter((l) => {
      const m = ENTRY.exec(l);
      return m && m[1]! <= to && /\] EVE System > Channel changed to Local : /.test(l);
    });
    writeFileSync(chatOut, Buffer.from(`${chatHead}\n${system.join('\n')}\n`, 'utf16le'));
    console.log(`${system.length} Local system lines → ${chatOut}`);
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
