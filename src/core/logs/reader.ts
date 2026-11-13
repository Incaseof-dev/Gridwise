/**
 * Watcher + parser: turns a Gamelog directory into a stream of GameEvents per session.
 *
 * An entry is only complete when the next one starts (continuation lines), so the last entry of a file is
 * flushed after a short idle period.
 */
import { EventEmitter } from 'node:events';
import type { GameEvent, LogSessionHeader } from './events';
import { EntryAssembler, parseEntry } from './parser';
import { LogWatcher, type LogWatcherOptions, type WatcherStatus } from './watcher';

export interface LogReaderEvents {
  session: [LogSessionHeader];
  events: [header: LogSessionHeader, events: GameEvent[]];
  /** The session file was truncated or replaced; consumers should drop state derived from it. */
  sessionReset: [LogSessionHeader];
  sessionEnded: [LogSessionHeader];
  status: [WatcherStatus];
}

export interface LogReaderOptions extends LogWatcherOptions {
  /** Idle time after which a pending entry is emitted. Default 250 ms. */
  flushMs?: number;
}

interface FileState {
  header: LogSessionHeader;
  assembler: EntryAssembler;
  flushTimer: NodeJS.Timeout | null;
}

export class LogReader extends EventEmitter<LogReaderEvents> {
  readonly watcher: LogWatcher;
  private readonly files = new Map<string, FileState>();
  private readonly flushMs: number;

  constructor(options: LogReaderOptions) {
    super();
    this.flushMs = options.flushMs ?? 250;
    this.watcher = new LogWatcher(options);

    this.watcher.on('file', (f) => {
      this.files.set(f.file, { header: f.header, assembler: new EntryAssembler(f.file), flushTimer: null });
      this.emit('session', f.header);
    });

    this.watcher.on('lines', (file, lines) => {
      const st = this.files.get(file);
      if (!st) return;
      const entries = lines.flatMap((l) => st.assembler.push(l.text, l.offset, l.lineNo));
      this.publish(st, entries.map(parseEntry));
      this.scheduleFlush(st);
    });

    this.watcher.on('reset', (file) => {
      const st = this.files.get(file);
      if (!st) return;
      st.assembler = new EntryAssembler(file);
      this.emit('sessionReset', st.header);
    });

    this.watcher.on('removed', (file) => {
      const st = this.files.get(file);
      if (!st) return;
      this.flush(st);
      this.files.delete(file);
      this.emit('sessionEnded', st.header);
    });

    this.watcher.on('status', (s) => this.emit('status', s));
  }

  start(): Promise<void> {
    return this.watcher.start();
  }

  stop(): void {
    for (const st of this.files.values()) this.flush(st);
    this.files.clear();
    this.watcher.stop();
  }

  status(): WatcherStatus {
    return this.watcher.status();
  }

  private publish(st: FileState, events: GameEvent[]): void {
    if (events.length) this.emit('events', st.header, events);
  }

  private scheduleFlush(st: FileState): void {
    if (st.flushTimer) clearTimeout(st.flushTimer);
    st.flushTimer = setTimeout(() => this.flush(st), this.flushMs);
  }

  private flush(st: FileState): void {
    if (st.flushTimer) clearTimeout(st.flushTimer);
    st.flushTimer = null;
    this.publish(st, st.assembler.flush().map(parseEntry));
  }
}
