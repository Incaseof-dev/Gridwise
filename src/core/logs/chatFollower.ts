/**
 * Follows chat log files: the newest file of each channel and character, read from the start and then tailed.
 * Chat logs are UTF-16LE with a BOM (and a BOM before every line); one file per channel and login, named
 * `<channel>_<yyyymmdd>_<hhmmss>_<characterId>.txt`. Used by Local (EVE-75) and the intel channels (EVE-97).
 */
import { existsSync } from 'node:fs';
import { open, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

const CHAT_FILE = /^(.+)_(\d{8})_(\d{6})(?:_(\d+))?\.txt$/;

export interface ChatFile {
  channel: string;
  characterId: number | null;
}

/** `Local_20261112_090530_90000042.txt` → channel Local, character 90000042. */
export function parseChatFileName(name: string): ChatFile | null {
  const m = CHAT_FILE.exec(name);
  return m ? { channel: m[1]!, characterId: m[4] ? Number(m[4]) : null } : null;
}

interface Tracked extends ChatFile {
  path: string;
  position: number;
  /** An odd trailing byte and the text after the last newline, waiting for the rest. */
  pendingByte: Buffer;
  partial: string;
  reading: boolean;
}

export interface ChatFollowerOptions {
  /** Which channels to follow. */
  accept: (channel: string) => boolean;
  /** Every complete line, without the line break. */
  onLine: (line: string, file: ChatFile) => void;
  pollMs?: number;
  scanMs?: number;
  /** Files untouched for longer than this are ignored. */
  activeWindowMs?: number;
}

export class ChatLogFollower {
  private readonly files = new Map<string, Tracked>();
  private timers: NodeJS.Timeout[] = [];

  constructor(
    readonly dir: string,
    private readonly opts: ChatFollowerOptions,
  ) {}

  async start(): Promise<void> {
    await this.scan();
    this.timers.push(setInterval(() => void this.scan(), this.opts.scanMs ?? 5000));
    this.timers.push(setInterval(() => this.pollAll(), this.opts.pollMs ?? 1000));
  }

  /** Files being followed now. */
  get followed(): number {
    return this.files.size;
  }

  stop(): void {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    this.files.clear();
  }

  /** Looks for new files now (tests; the timer does it every scanMs). */
  async scan(): Promise<void> {
    if (!existsSync(this.dir)) return;
    let names: string[];
    try {
      names = await readdir(this.dir);
    } catch {
      return;
    }
    // Newest file per channel and character; the timestamp in the name sorts as text.
    const newest = new Map<string, { name: string; file: ChatFile }>();
    for (const name of names.sort()) {
      const file = parseChatFileName(name);
      if (file && this.opts.accept(file.channel))
        newest.set(`${file.channel}|${file.characterId ?? ''}`, { name, file });
    }
    for (const { name, file } of newest.values()) {
      const path = join(this.dir, name);
      const known = [...this.files.values()].find(
        (f) => f.channel === file.channel && f.characterId === file.characterId,
      );
      if (known?.path === path) continue;
      try {
        if (Date.now() - (await stat(path)).mtimeMs > (this.opts.activeWindowMs ?? 12 * 3600_000)) continue;
      } catch {
        continue;
      }
      if (known) this.files.delete(known.path);
      const t: Tracked = { ...file, path, position: 0, pendingByte: Buffer.alloc(0), partial: '', reading: false };
      this.files.set(path, t);
      await this.read(t);
    }
  }

  /** Reads what was added to every followed file (tests; the timer does it every pollMs). */
  async poll(): Promise<void> {
    await Promise.all([...this.files.values()].map((t) => this.read(t)));
  }

  private pollAll(): void {
    for (const t of this.files.values()) void this.read(t);
  }

  private async read(t: Tracked): Promise<void> {
    if (t.reading) return;
    t.reading = true;
    try {
      const size = (await stat(t.path)).size;
      if (size < t.position) {
        t.position = 0;
        t.pendingByte = Buffer.alloc(0);
        t.partial = '';
      }
      if (size === t.position) return;
      const fh = await open(t.path, 'r');
      try {
        const buf = Buffer.alloc(size - t.position);
        const { bytesRead } = await fh.read(buf, 0, buf.length, t.position);
        t.position += bytesRead;
        const bytes = Buffer.concat([t.pendingByte, buf.subarray(0, bytesRead)]);
        const even = bytes.length - (bytes.length % 2);
        t.pendingByte = bytes.subarray(even);
        const lines = (t.partial + bytes.subarray(0, even).toString('utf16le')).split('\n');
        t.partial = lines.pop() ?? '';
        const file = { channel: t.channel, characterId: t.characterId };
        for (const line of lines) this.opts.onLine(line.replace(/\r$/, ''), file);
      } finally {
        await fh.close();
      }
    } catch {
      // Gone or unreadable: the next scan picks up whatever replaced it.
    } finally {
      t.reading = false;
    }
  }
}
