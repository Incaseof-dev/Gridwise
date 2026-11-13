/**
 * Replays a recorded Gamelog into a directory, line by line with the original timing (task 011).
 * Point the app's log directory (or `npm run inspect -- --watch`) at the output directory to exercise the real watcher.
 *
 *   npm run replay -- <logfile> [--out <dir>] [--speed 10] [--max-gap 5] [--from 20:15:00] [--to 20:20:00] [--now]
 *                     [--chat <Local chat log> [--chat-out <dir>]]
 *
 * --chat replays a Local chat log (UTF-16) on the same timeline, into <out>/../Chatlogs by default: the app reads
 * entering and leaving the Abyss from it (EVE-75).
 * --now moves the timestamps (and the session start) to the current time, so the app sees a live fight; at
 * speed 1 the DPS stays as recorded.
 */
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { numberFlag, parseArgs } from './args';

const ENTRY_TIME = /^\uFEFF?\[ (\d{4})\.(\d{2})\.(\d{2}) (\d{2}):(\d{2}):(\d{2}) \]/;

interface Chunk {
  timeMs: number;
  text: string;
  /** 1 = the chat log. */
  file?: 0 | 1;
}

function split(content: string): { header: string; chunks: Chunk[] } {
  const lines = content.split(/(?<=\n)/);
  let header = '';
  const chunks: Chunk[] = [];
  for (const line of lines) {
    const m = ENTRY_TIME.exec(line);
    if (m) {
      const [, y, mo, d, h, mi, s] = m.map(Number) as number[];
      chunks.push({ timeMs: Date.UTC(y!, mo! - 1, d!, h!, mi!, s!), text: line });
    } else if (chunks.length) chunks.at(-1)!.text += line;
    else header += line;
  }
  return { header, chunks };
}

async function main(): Promise<void> {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const src = positional[0];
  if (!src) {
    console.error(
      'usage: npm run replay -- <logfile> [--out <dir>] [--speed 10] [--max-gap 5] [--from HH:MM:SS] [--to HH:MM:SS] [--now]',
    );
    process.exit(2);
  }
  const outDir = typeof flags.get('out') === 'string' ? (flags.get('out') as string) : join(tmpdir(), 'eve-replay');
  const speed = numberFlag(flags, 'speed', 1);
  const maxGapMs = numberFlag(flags, 'max-gap', 10) * 1000;
  const from = flags.get('from');
  const to = flags.get('to');

  const { header, chunks } = split(readFileSync(src, 'utf8'));
  let startIdx = 0;
  if (typeof from === 'string') {
    startIdx = chunks.findIndex((c) => new Date(c.timeMs).toISOString().slice(11, 19) >= from);
    if (startIdx < 0) throw new Error(`no entries at or after ${from}`);
  }

  let endIdx = chunks.length;
  if (typeof to === 'string') {
    const i = chunks.findIndex((c) => new Date(c.timeMs).toISOString().slice(11, 19) > to);
    if (i >= 0) endIdx = i;
  }
  // With --now, entry times are shifted so that the first replayed entry happens now; the gaps cap moves them too.
  const live = flags.has('now');
  const t0 = Date.now();
  const stamp = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ').replace(/-/g, '.');
  const retime = (text: string, ms: number) =>
    live ? text.replace(/^(\uFEFF?)\[ [\d.]+ [\d:]+ \]/, `$1[ ${stamp(ms)} ]`) : text;
  const fileStamp = stamp(t0)
    .replace(/[.: ]/g, '')
    .replace(/^(\d{8})(\d{6})$/, '$1_$2');

  mkdirSync(outDir, { recursive: true });
  const out = join(outDir, live ? `${fileStamp}_${basename(src).split('_').at(-1)}` : basename(src));
  writeFileSync(out, live ? header.replace(/Session Started: [\d.]+ [\d:]+/, `Session Started: ${stamp(t0)}`) : header);

  // The Local chat log: UTF-16LE, merged into the game log's timeline.
  const chatSrc = flags.get('chat');
  let chatOut: string | null = null;
  if (typeof chatSrc === 'string') {
    // Only the system lines: what players wrote in Local has no place in a replay directory.
    const chat = split(readFileSync(chatSrc).toString('utf16le'));
    chat.chunks = chat.chunks.filter((c) => /\] EVE System > /.test(c.text));
    const chatDir =
      typeof flags.get('chat-out') === 'string' ? (flags.get('chat-out') as string) : join(dirname(outDir), 'Chatlogs');
    mkdirSync(chatDir, { recursive: true });
    const parts = basename(chatSrc).split('_');
    chatOut = join(chatDir, live ? `${parts[0]}_${fileStamp}_${parts.at(-1)}` : basename(chatSrc));
    writeFileSync(chatOut, Buffer.from(chat.header, 'utf16le'));
    const first = chunks[startIdx]?.timeMs ?? 0;
    const last = chunks[endIdx - 1]?.timeMs ?? Infinity;
    const lines = chat.chunks
      .filter((c) => c.timeMs >= first && c.timeMs <= last)
      .map((c) => ({ ...c, file: 1 as const }));
    // Lines from before the replayed span still tell where the character is: written right away.
    for (const c of chat.chunks.filter((x) => x.timeMs < first))
      appendFileSync(chatOut, Buffer.from(retime(c.text, t0), 'utf16le'));
    const merged = [...chunks.slice(startIdx, endIdx), ...lines].sort((a, b) => a.timeMs - b.timeMs);
    chunks.splice(startIdx, endIdx - startIdx, ...merged);
    endIdx = startIdx + merged.length;
    console.log(`chat: ${lines.length} Local lines → ${chatOut}`);
  }
  console.log(`replaying ${Math.max(0, endIdx - startIdx)} entries → ${out}`);
  console.log(`speed ×${speed}, gaps capped at ${maxGapMs / 1000}s. Ctrl+C to stop.`);

  let prev = chunks[startIdx]?.timeMs ?? 0;
  let at = t0;
  for (let i = startIdx; i < endIdx; i++) {
    const c = chunks[i]!;
    const wait = Math.min(c.timeMs - prev, maxGapMs) / speed;
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    prev = c.timeMs;
    at += wait;
    if (c.file === 1) appendFileSync(chatOut!, Buffer.from(retime(c.text, at), 'utf16le'));
    else appendFileSync(out, retime(c.text, at));
    if ((i - startIdx) % 500 === 0) process.stdout.write(`\r${i - startIdx}/${endIdx - startIdx}`);
  }
  console.log(`\rdone (${endIdx - startIdx} entries)`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
