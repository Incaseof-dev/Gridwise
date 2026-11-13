/**
 * Game Log directory watcher (task 009).
 *
 * Tails every recently active Gamelog file from a stored byte offset and emits complete lines only.
 * fs.watch is used to react quickly; polling is the safety net (Proton prefixes, missed inotify events,
 * directory created later). The watcher never re-reads a file from the start, except after truncation.
 */
import { EventEmitter } from 'node:events';
import { existsSync, watch, type FSWatcher } from 'node:fs';
import { open, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { LogSessionHeader } from './events';
import { isGamelogFileName, parseHeader } from './parser';

export interface RawLine {
  text: string;
  /** Byte offset of the line start. */
  offset: number;
  /** 1-based line number. */
  lineNo: number;
}

export interface WatchedFile {
  file: string;
  header: LogSessionHeader;
  size: number;
  /** Wall-clock time (epoch ms) when new data was last read. */
  lastDataAt: number | null;
}

export type WatcherState = 'starting' | 'watching' | 'dirMissing' | 'error' | 'stopped';

export interface WatcherStatus {
  state: WatcherState;
  dir: string;
  files: WatchedFile[];
  error?: string;
}

export interface LogWatcherOptions {
  dir: string;
  /**
   * What to do with files that already exist at start:
   * `tail` = only new lines (default), `fromStart` = replay the whole file first.
   * Files that appear while running are always read from the start.
   */
  existingFiles?: 'tail' | 'fromStart';
  /** Existing files last modified longer ago than this are ignored. Default 12 h. */
  activeWindowMs?: number;
  /** Poll interval for active files. Default 500 ms. */
  pollMs?: number;
  /** Directory rescan interval for new files. Default 2000 ms. */
  scanMs?: number;
  /** Use fs.watch in addition to polling. Default true. */
  useFsWatch?: boolean;
}

export interface LogWatcherEvents {
  /** A file started being tracked. Emitted before any `lines` of that file. */
  file: [WatchedFile];
  /** New complete lines of a file, in order. */
  lines: [file: string, lines: RawLine[]];
  /** The file shrank and is read again from the start. */
  reset: [file: string];
  /** The file disappeared. */
  removed: [file: string];
  status: [WatcherStatus];
}

interface Tracked {
  info: WatchedFile;
  path: string;
  position: number;
  lineNo: number;
  /** Bytes after the last "\n", waiting for the rest of the line. */
  partial: Buffer;
  reading: boolean;
  again: boolean;
}

const HEADER_BYTES = 1024;
const decoder = new TextDecoder('utf-8');

export class LogWatcher extends EventEmitter<LogWatcherEvents> {
  private readonly opts: Required<LogWatcherOptions>;
  private readonly tracked = new Map<string, Tracked>();
  /** Files seen in the directory but deliberately ignored (inactive, or not a character log yet). */
  private readonly ignored = new Set<string>();
  /** Files currently being looked at by `consider`, so concurrent scans do not track a file twice. */
  private readonly considering = new Set<string>();
  private state: WatcherState = 'stopped';
  private error: string | undefined;
  private fsWatcher: FSWatcher | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private scanTimer: NodeJS.Timeout | null = null;
  private firstScan = true;

  constructor(options: LogWatcherOptions) {
    super();
    this.opts = {
      existingFiles: 'tail',
      activeWindowMs: 12 * 3600_000,
      pollMs: 500,
      scanMs: 2000,
      useFsWatch: true,
      ...options,
    };
  }

  get dir(): string {
    return this.opts.dir;
  }

  async start(): Promise<void> {
    if (this.state !== 'stopped') return;
    this.setState('starting');
    this.firstScan = true;
    await this.scan();
    this.pollTimer = setInterval(() => this.pollAll(), this.opts.pollMs);
    this.scanTimer = setInterval(() => void this.scan(), this.opts.scanMs);
  }

  stop(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.scanTimer) clearInterval(this.scanTimer);
    this.pollTimer = this.scanTimer = null;
    this.closeFsWatch();
    this.tracked.clear();
    this.ignored.clear();
    this.setState('stopped');
  }

  status(): WatcherStatus {
    return {
      state: this.state,
      dir: this.opts.dir,
      files: [...this.tracked.values()].map((t) => ({ ...t.info })),
      ...(this.error ? { error: this.error } : {}),
    };
  }

  private setState(state: WatcherState, error?: string): void {
    const changed = state !== this.state || error !== this.error;
    this.state = state;
    this.error = error;
    if (changed) this.emit('status', this.status());
  }

  private ensureFsWatch(): void {
    if (!this.opts.useFsWatch || this.fsWatcher) return;
    try {
      this.fsWatcher = watch(this.opts.dir, (_event, name) => {
        if (!name) return;
        const t = this.tracked.get(name);
        if (t) void this.read(t);
        else if (isGamelogFileName(name) && !this.ignored.has(name)) void this.scan();
      });
      this.fsWatcher.on('error', () => this.closeFsWatch());
    } catch {
      // Polling still works without it.
      this.fsWatcher = null;
    }
  }

  private closeFsWatch(): void {
    this.fsWatcher?.close();
    this.fsWatcher = null;
  }

  private async scan(): Promise<void> {
    if (this.state === 'stopped' && !this.firstScan) return;
    let names: string[];
    try {
      names = await readdir(this.opts.dir);
    } catch (err) {
      const missing = (err as NodeJS.ErrnoException).code === 'ENOENT' || !existsSync(this.opts.dir);
      this.closeFsWatch();
      if (missing) this.setState('dirMissing');
      else this.setState('error', String(err));
      this.firstScan = false;
      return;
    }
    this.ensureFsWatch();
    if (this.state !== 'watching') this.setState('watching');
    const initial = this.firstScan;
    this.firstScan = false;

    const present = new Set(names);
    for (const [name] of this.tracked) {
      if (!present.has(name)) {
        this.tracked.delete(name);
        this.emit('removed', name);
        this.emit('status', this.status());
      }
    }

    // Oldest first, so sessions are announced in chronological order (file names sort by time).
    for (const name of names.filter(isGamelogFileName).sort()) {
      if (this.tracked.has(name) || this.ignored.has(name) || this.considering.has(name)) continue;
      this.considering.add(name);
      try {
        await this.consider(name, initial);
      } finally {
        this.considering.delete(name);
      }
    }
  }

  private async consider(name: string, initial: boolean): Promise<void> {
    const path = join(this.opts.dir, name);
    let size: number;
    let mtimeMs: number;
    try {
      ({ size, mtimeMs } = await stat(path));
    } catch {
      return;
    }
    if (initial && Date.now() - mtimeMs > this.opts.activeWindowMs) {
      this.ignored.add(name);
      return;
    }
    const head = await readRange(path, 0, Math.min(size, HEADER_BYTES));
    const header = parseHeader(name, decoder.decode(head));
    if (!header.character) {
      // No character ID in the name: login-screen session, nothing useful will be written.
      // With an ID the header may still be incomplete; the next scan looks again.
      if (header.characterId === null) this.ignored.add(name);
      return;
    }

    const tailOnly = initial && this.opts.existingFiles === 'tail';
    const t: Tracked = {
      info: { file: name, header, size, lastDataAt: null },
      path,
      position: tailOnly ? size : 0,
      lineNo: tailOnly ? await countLines(path, size) : 0,
      partial: Buffer.alloc(0),
      reading: false,
      again: false,
    };
    this.tracked.set(name, t);
    this.emit('file', { ...t.info });
    this.emit('status', this.status());
    await this.read(t);
  }

  private pollAll(): void {
    for (const t of this.tracked.values()) void this.read(t);
  }

  /** Reads everything new in a file. Concurrent calls are coalesced. */
  private async read(t: Tracked): Promise<void> {
    if (t.reading) {
      t.again = true;
      return;
    }
    t.reading = true;
    try {
      do {
        t.again = false;
        await this.readOnce(t);
      } while (t.again);
    } finally {
      t.reading = false;
    }
  }

  private async readOnce(t: Tracked): Promise<void> {
    let size: number;
    try {
      size = (await stat(t.path)).size;
    } catch {
      return; // Removal is detected by the next scan.
    }
    if (size < t.position) {
      t.position = 0;
      t.lineNo = 0;
      t.partial = Buffer.alloc(0);
      this.emit('reset', t.info.file);
    }
    if (size === t.position) return;

    const chunk = await readRange(t.path, t.position, size - t.position);
    const lineStartOffset = t.position - t.partial.length;
    t.position += chunk.length;
    t.info.size = t.position;
    t.info.lastDataAt = Date.now();

    const data = t.partial.length ? Buffer.concat([t.partial, chunk]) : chunk;
    const lastNl = data.lastIndexOf(0x0a);
    if (lastNl < 0) {
      t.partial = data;
      return;
    }
    t.partial = Buffer.from(data.subarray(lastNl + 1));

    const lines: RawLine[] = [];
    let start = 0;
    while (start <= lastNl) {
      const end = data.indexOf(0x0a, start);
      lines.push({
        text: decoder.decode(data.subarray(start, end)),
        offset: lineStartOffset + start,
        lineNo: ++t.lineNo,
      });
      start = end + 1;
    }
    this.emit('lines', t.info.file, lines);
  }
}

async function readRange(path: string, position: number, length: number): Promise<Buffer> {
  if (length <= 0) return Buffer.alloc(0);
  const fh = await open(path, 'r');
  try {
    const buf = Buffer.alloc(length);
    const { bytesRead } = await fh.read(buf, 0, length, position);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

async function countLines(path: string, size: number): Promise<number> {
  const fh = await open(path, 'r');
  try {
    const buf = Buffer.alloc(64 * 1024);
    let count = 0;
    for (let pos = 0; pos < size;) {
      const { bytesRead } = await fh.read(buf, 0, Math.min(buf.length, size - pos), pos);
      if (bytesRead === 0) break;
      for (let i = 0; i < bytesRead; i++) if (buf[i] === 0x0a) count++;
      pos += bytesRead;
    }
    return count;
  } finally {
    await fh.close();
  }
}
