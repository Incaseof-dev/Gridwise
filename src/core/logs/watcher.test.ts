import { appendFileSync, mkdirSync, mkdtempSync, rmSync, truncateSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { GameEvent, LogSessionHeader } from './events';
import { LogReader } from './reader';
import { LogWatcher, type RawLine, type WatcherStatus } from './watcher';

const FILE = '20261020_100000_90000001.txt';
const HEADER =
  '------------------------------------------------------------\r\n' +
  '  Gamelog\r\n' +
  '  Listener: Test Pilot\r\n' +
  '  Session Started: 2026.10.20 10:00:00\r\n' +
  '------------------------------------------------------------\r\n';
const line = (sec: number, body: string) => `[ 2026.10.20 10:00:${String(sec).padStart(2, '0')} ] ${body}\r\n`;

let dir: string;
let watcher: LogWatcher | null = null;
let reader: LogReader | null = null;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'eve-watch-'));
});

afterEach(() => {
  watcher?.stop();
  reader?.stop();
  watcher = reader = null;
  rmSync(dir, { recursive: true, force: true });
});

async function waitFor(cond: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 10));
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function collect(w: LogWatcher) {
  const lines: RawLine[] = [];
  const files: string[] = [];
  const resets: string[] = [];
  const statuses: WatcherStatus[] = [];
  w.on('lines', (_f, ls) => lines.push(...ls));
  w.on('file', (f) => files.push(f.file));
  w.on('reset', (f) => resets.push(f));
  w.on('status', (s) => statuses.push(s));
  return { lines, files, resets, statuses };
}

function newWatcher(opts: Partial<ConstructorParameters<typeof LogWatcher>[0]> = {}) {
  watcher = new LogWatcher({ dir, pollMs: 20, scanMs: 40, useFsWatch: false, ...opts });
  return watcher;
}

describe('LogWatcher', () => {
  it('tails existing active files: only new lines, with correct line numbers and offsets', async () => {
    const existing = HEADER + line(1, '(notify) old');
    writeFileSync(join(dir, FILE), existing);
    const w = newWatcher();
    const c = collect(w);
    await w.start();
    expect(c.files).toEqual([FILE]);
    expect(w.status().files[0]!.header.character).toBe('Test Pilot');

    appendFileSync(join(dir, FILE), line(2, '(notify) new'));
    await waitFor(() => c.lines.length === 1);
    expect(c.lines[0]).toEqual({
      text: '[ 2026.10.20 10:00:02 ] (notify) new\r',
      offset: Buffer.byteLength(existing),
      lineNo: 7,
    });
  });

  it('can replay existing files from the start', async () => {
    writeFileSync(join(dir, FILE), HEADER + line(1, '(notify) old'));
    const w = newWatcher({ existingFiles: 'fromStart' });
    const c = collect(w);
    await w.start();
    await waitFor(() => c.lines.length === 6);
    expect(c.lines[5]!.text).toContain('old');
  });

  it('ignores files outside the active window and login-screen files', async () => {
    writeFileSync(join(dir, '20261001_100000_90000001.txt'), HEADER);
    const old = new Date(Date.now() - 48 * 3600_000);
    utimesSync(join(dir, '20261001_100000_90000001.txt'), old, old);
    writeFileSync(join(dir, '20261020_095900.txt'), '  Gamelog\r\n  Session Started: 2026.10.20 09:59:00\r\n');
    writeFileSync(join(dir, 'notes.txt'), 'x');
    const w = newWatcher();
    const c = collect(w);
    await w.start();
    await sleep(100);
    expect(c.files).toEqual([]);
  });

  it('reads a new file from the start, emitting only complete lines across partial writes', async () => {
    const w = newWatcher();
    const c = collect(w);
    await w.start();

    writeFileSync(join(dir, FILE), HEADER + '[ 2026.10.20 10:00:01 ] (notify) hal');
    await waitFor(() => c.files.length === 1);
    await waitFor(() => c.lines.length === 5);
    await sleep(60);
    expect(c.lines).toHaveLength(5);

    appendFileSync(join(dir, FILE), 'f a line\r\n');
    await waitFor(() => c.lines.length === 6);
    expect(c.lines[5]!.text).toBe('[ 2026.10.20 10:00:01 ] (notify) half a line\r');
    expect(c.lines[5]!.offset).toBe(Buffer.byteLength(HEADER));
  });

  it('does not split multi-byte characters across reads', async () => {
    const w = newWatcher();
    const c = collect(w);
    await w.start();
    const text = line(1, '(combat) Sansha’s Nation');
    const bytes = Buffer.from(HEADER + text);
    const cut = Buffer.byteLength(HEADER) + text.indexOf('’') + 1; // inside the 3-byte character
    writeFileSync(join(dir, FILE), bytes.subarray(0, cut));
    await waitFor(() => c.lines.length === 5);
    appendFileSync(join(dir, FILE), bytes.subarray(cut));
    await waitFor(() => c.lines.length === 6);
    expect(c.lines[5]!.text).toContain('Sansha’s Nation');
  });

  it('waits for the header of a character file that is still being written', async () => {
    const w = newWatcher();
    const c = collect(w);
    await w.start();
    writeFileSync(join(dir, FILE), '-----\r\n  Gamelog\r\n');
    await sleep(100);
    expect(c.files).toEqual([]);
    writeFileSync(join(dir, FILE), HEADER);
    await waitFor(() => c.files.length === 1);
  });

  it('re-reads a truncated file from the start', async () => {
    writeFileSync(join(dir, FILE), HEADER + line(1, '(notify) a') + line(2, '(notify) b'));
    const w = newWatcher();
    const c = collect(w);
    await w.start();
    truncateSync(join(dir, FILE), 0);
    writeFileSync(join(dir, FILE), HEADER);
    await waitFor(() => c.resets.length === 1 && c.lines.length === 5);
    expect(c.lines[0]!.lineNo).toBe(1);
  });

  it('reports a missing directory and picks it up once it exists', async () => {
    rmSync(dir, { recursive: true });
    const w = newWatcher();
    const c = collect(w);
    await w.start();
    expect(w.status().state).toBe('dirMissing');
    mkdirSync(dir);
    writeFileSync(join(dir, FILE), HEADER);
    await waitFor(() => c.files.length === 1);
    expect(w.status().state).toBe('watching');
    expect(c.statuses.map((s) => s.state)).toContain('dirMissing');
  });

  it('tracks a new file only once when fs.watch and polling race', async () => {
    const w = newWatcher({ useFsWatch: true, scanMs: 5 });
    const c = collect(w);
    await w.start();
    writeFileSync(join(dir, FILE), HEADER);
    for (let i = 1; i <= 5; i++) appendFileSync(join(dir, FILE), line(i, '(notify) x'));
    await waitFor(() => c.lines.length === 10);
    await sleep(100);
    expect(c.files).toEqual([FILE]);
    expect(c.lines).toHaveLength(10);
  });

  it('reacts via fs.watch as well', async () => {
    writeFileSync(join(dir, FILE), HEADER);
    const w = newWatcher({ useFsWatch: true, pollMs: 10_000, scanMs: 10_000 });
    const c = collect(w);
    await w.start();
    appendFileSync(join(dir, FILE), line(1, '(notify) via inotify'));
    await waitFor(() => c.lines.length === 1);
  });
});

describe('LogReader', () => {
  it('emits parsed events per session, merging continuation lines and flushing when idle', async () => {
    reader = new LogReader({ dir, pollMs: 20, scanMs: 40, useFsWatch: false, flushMs: 50 });
    const sessions: LogSessionHeader[] = [];
    const events: GameEvent[] = [];
    reader.on('session', (h) => sessions.push(h));
    reader.on('events', (_h, evs) => events.push(...evs));
    await reader.start();

    writeFileSync(
      join(dir, FILE),
      HEADER +
        line(1, '(None) Jumping from Maurasi to Perimeter') +
        line(2, '(notify) Calibrating.') +
        'Please wait\r\n',
    );
    await waitFor(() => events.length === 2);
    expect(sessions).toEqual([
      { file: FILE, character: 'Test Pilot', characterId: 90000001, startedAt: '2026-10-20T10:00:00.000Z' },
    ]);
    expect(events[0]).toMatchObject({ kind: 'systemJump', to: 'Perimeter' });
    expect(events[1]).toMatchObject({ kind: 'unknown', text: 'Calibrating.\nPlease wait' });
  });
});
