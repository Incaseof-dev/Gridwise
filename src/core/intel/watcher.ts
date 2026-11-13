/**
 * Follows the configured intel channels (EVE-97) and keeps the IntelBoard up to date. Channel names are matched
 * without case; the file name carries the channel name as the game shows it (`Region.Intel_…`).
 */
import { EventEmitter } from 'node:events';
import { ChatLogFollower } from '../logs/chatFollower';
import { IntelBoard } from './board';
import type { JumpMap } from './jumpMap';
import { MAX_INTEL_RANGE } from './jumpMap';
import { type IntelLexicon, parseIntelLine, parseIntelText } from './parser';

export interface IntelWatcherEvents {
  change: [];
}

export class IntelWatcher extends EventEmitter<IntelWatcherEvents> {
  readonly board: IntelBoard;
  private readonly follower: ChatLogFollower;
  private readonly channels: Set<string>;
  /** Wall clock of the last line read from any intel log: shows the reading has not stalled. */
  lastReadMs: number | null = null;

  constructor(
    dir: string,
    channels: readonly string[],
    private readonly lex: IntelLexicon,
    private readonly jumps: JumpMap,
    /** The pilot's current system id, for short system names; null when unknown. */
    private readonly origin: () => number | null,
    opts: { expireMs?: number; pollMs?: number; scanMs?: number } = {},
  ) {
    super();
    this.board = new IntelBoard({ expireMs: opts.expireMs });
    this.channels = new Set(channels.map((c) => c.trim().toLowerCase()).filter(Boolean));
    this.follower = new ChatLogFollower(dir, {
      accept: (channel) => this.channels.has(channel.toLowerCase()),
      onLine: (raw, file) => this.onLine(raw, file.channel),
      pollMs: opts.pollMs,
      scanMs: opts.scanMs,
    });
  }

  start(): Promise<void> {
    return this.channels.size ? this.follower.start() : Promise.resolve();
  }

  stop(): void {
    this.follower.stop();
  }

  /** Chat log files followed now (one per channel and character with a log of the last 12 hours). */
  get files(): number {
    return this.follower.followed;
  }

  /** Test hooks: scan and read now instead of waiting for the timers. */
  async scan(): Promise<void> {
    await this.follower.scan();
  }
  async poll(): Promise<void> {
    await this.follower.poll();
  }

  private onLine(raw: string, channel: string): void {
    const line = parseIntelLine(raw);
    if (!line) return;
    this.lastReadMs = Date.now();
    const o = this.origin();
    const near = o === null ? null : this.jumps.from(o, MAX_INTEL_RANGE);
    const parsed = parseIntelText(line.text, this.lex, near, (id) => this.jumps.system(id));
    if (this.board.add(line, parsed, channel)) this.emit('change');
  }
}
