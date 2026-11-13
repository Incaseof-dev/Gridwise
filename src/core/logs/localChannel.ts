/**
 * Reads the system changes from the Local chat logs (EVE-75): `EVE System > Channel changed to Local : <system>`.
 * The game logs do not tell entering the Abyss, but Local switches to "Unknown" there and back to the start system
 * on the way out. Only these lines are read; what players write in Local is skipped.
 * The files are followed by ChatLogFollower.
 */
import { EventEmitter } from 'node:events';
import { ChatLogFollower } from './chatFollower';

export interface LocalChange {
  characterId: number | null;
  /** EVE time (UTC) of the line, epoch ms. */
  timeMs: number;
  system: string;
}

const LOCAL_FILE = /^Local_(\d{8})_(\d{6})(?:_(\d+))?\.txt$/;
const CHANGE =
  /^\[ (\d{4})\.(\d{2})\.(\d{2}) (\d{2}):(\d{2}):(\d{2}) \] EVE System > Channel changed to Local : (.+?)\s*$/;
/** The system name Local shows inside Abyssal Deadspace. */
export const ABYSS_SYSTEM = 'Unknown';

export function parseLocalLine(line: string, characterId: number | null): LocalChange | null {
  const m = CHANGE.exec(line.replace(/^\uFEFF+/, ''));
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1, 7).map(Number) as [number, number, number, number, number, number];
  return { characterId, timeMs: Date.UTC(y, mo - 1, d, h, mi, s), system: m[7]! };
}

export function isLocalFileName(name: string): boolean {
  return LOCAL_FILE.test(name);
}

export interface LocalChannelEvents {
  change: [LocalChange];
}

/**
 * Follows the newest Local log of each character in the chat log directory. A file found at start is read from
 * the beginning, so the current system (Abyss or not) is known right away.
 */
export class LocalChannelWatcher extends EventEmitter<LocalChannelEvents> {
  private readonly follower: ChatLogFollower;

  constructor(
    readonly dir: string,
    pollMs = 1000,
    scanMs = 5000,
    /** Files untouched for longer than this are ignored. */
    activeWindowMs = 12 * 3600_000,
  ) {
    super();
    this.follower = new ChatLogFollower(dir, {
      accept: (channel) => channel === 'Local',
      onLine: (line, file) => {
        const c = parseLocalLine(line, file.characterId);
        if (c) this.emit('change', c);
      },
      pollMs,
      scanMs,
      activeWindowMs,
    });
  }

  start(): Promise<void> {
    return this.follower.start();
  }

  stop(): void {
    this.follower.stop();
  }
}
