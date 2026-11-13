/**
 * EVE Workbench in the main process (EVE-86): the player's personal access token, encrypted with Electron
 * safeStorage like the ESI tokens; the account's fits and Abyss Tracker runs, read every 15 minutes; and the
 * upload of a run, only when the player presses Upload. The app works the same without a key.
 */
import { net, safeStorage } from 'electron';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { EwbAbyssRun } from '../core/abyss/types';
import { EwbClient, type EwbCall, type EwbCharacter, type EwbFetch } from '../core/ewb/client';
import type { Telemetry } from '../core/ewb/telemetry';
import { configDir } from '../core/paths';
import type { EwbView } from '../core/viewmodel';

const POLL_MS = 15 * 60_000;
/** Pages of Abyss Tracker runs read (the tracker pages them, newest first). */
const RUN_PAGES = 3;
/** Calls listed in the settings. */
const RECENT_CALLS = 8;

export interface EwbFitText {
  fitId: string;
  hash: string;
  name: string;
  shipName: string;
  eft: string;
}

export interface EwbEvents {
  changed(): void;
  /** The account's fits with their EFT. */
  fits(fits: EwbFitText[]): void;
  /** The account's Abyss Tracker runs were read again. */
  runs(): void;
}

const fetchViaNet: EwbFetch = (url, init) => net.fetch(url, init);

export class EwbService {
  private readonly path = join(configDir(), 'ewb-key.bin');
  private key: string | null = null;
  private readonly client = new EwbClient(
    () => this.key,
    fetchViaNet,
    () => this.apiBase(),
  );
  /** The last calls with their times, newest first (EVE-91): shows a slow or silent server. */
  private readonly calls: EwbCall[] = [];
  private timer: NodeJS.Timeout | null = null;
  private checking = false;
  private syncing = false;
  private error: string | null = null;
  private account: EwbCharacter[] = [];
  private fitCount: number | null = null;
  private runList: EwbAbyssRun[] = [];
  private updatedMs: number | null = null;

  constructor(
    private readonly events: EwbEvents,
    /** The EFT stored for an EVE Workbench fit with this hash, if any. */
    private readonly known: (fitId: string, hash: string) => string | null,
    /** The API server from the settings (EVE-90). */
    private readonly apiBase: () => string,
  ) {}

  start(): void {
    this.client.onCall = (c) => this.recordCall(c);
    this.key = this.load();
    if (this.key) void this.sync();
    this.timer = setInterval(() => void this.sync(), POLL_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private load(): string | null {
    if (!existsSync(this.path) || !safeStorage.isEncryptionAvailable()) return null;
    try {
      return safeStorage.decryptString(readFileSync(this.path)) || null;
    } catch (err) {
      console.error('ewb key:', err);
      return null;
    }
  }

  /** Checks a new key against the API and keeps it only when it works. */
  async setKey(raw: string): Promise<void> {
    const key = raw.trim();
    if (!key || this.checking) return;
    if (!safeStorage.isEncryptionAvailable()) {
      this.error = 'No secure storage for the key on this system, so it cannot be kept.';
      this.events.changed();
      return;
    }
    this.checking = true;
    this.error = null;
    this.events.changed();
    const old = this.key;
    this.key = key;
    try {
      this.account = await this.client.characters();
      mkdirSync(dirname(this.path), { recursive: true });
      writeFileSync(`${this.path}.tmp`, safeStorage.encryptString(key));
      renameSync(`${this.path}.tmp`, this.path);
    } catch (err) {
      this.key = old;
      this.error = (err as Error).message;
    } finally {
      this.checking = false;
      this.events.changed();
    }
    if (this.key === key) await this.sync();
  }

  clearKey(): void {
    this.key = null;
    rmSync(this.path, { force: true });
    this.account = [];
    this.fitCount = null;
    this.runList = [];
    this.updatedMs = null;
    this.error = null;
    this.events.fits([]);
    this.events.runs();
    this.events.changed();
  }

  /** Characters, fits (EFT only for new or changed ones) and the latest runs. */
  async sync(): Promise<void> {
    if (!this.key || this.syncing) return;
    this.syncing = true;
    this.events.changed();
    try {
      this.account = await this.client.characters();
      const fits = await this.client.fits();
      const texts: EwbFitText[] = [];
      for (const f of fits) {
        const eft = this.known(f.id, f.hash) ?? (await this.client.fitEft(f.id).catch(() => null));
        if (!eft) continue;
        const shipName = /^\s*\[([^,\]]+)/.exec(eft)?.[1]?.trim() ?? f.shipName;
        if (shipName) texts.push({ fitId: f.id, hash: f.hash, name: f.name, shipName, eft });
      }
      this.fitCount = texts.length;
      this.events.fits(texts);
      await this.readRuns();
      this.updatedMs = Date.now();
      this.error = null;
    } catch (err) {
      this.error = (err as Error).message;
    } finally {
      this.syncing = false;
      this.events.changed();
    }
  }

  private async readRuns(): Promise<void> {
    const runs: EwbAbyssRun[] = [];
    for (let page = 1; page <= RUN_PAGES; page++) {
      const r = await this.client.runs(page);
      runs.push(...r.runs);
      if (page >= r.pages || !r.runs.length) break;
    }
    this.runList = runs;
    this.events.runs();
  }

  runs(): EwbAbyssRun[] {
    return this.runList;
  }

  characters(): EwbCharacter[] {
    return this.account;
  }

  hasKey(): boolean {
    return this.key !== null;
  }

  /** Jita prices, or none when EVE Workbench does not answer (the loot is kept without a value then). */
  async price(): Promise<(typeId: number) => number | null> {
    if (!this.key) return () => null;
    return this.client.price().catch((err: unknown) => {
      console.error('ewb prices:', err);
      return () => null;
    });
  }

  /** Sends a run; the tracker's run id comes back. The run list is read again in the background to show it. */
  async upload(t: Telemetry): Promise<string | null> {
    const runId = await this.client.upload(t);
    void this.readRuns().catch((err: unknown) => console.error('ewb runs:', err));
    return runId;
  }

  private recordCall(c: EwbCall): void {
    this.calls.unshift(c);
    this.calls.length = Math.min(this.calls.length, RECENT_CALLS);
    console.info(
      `ewb ${c.method} ${c.path} → ${c.status ?? 'no answer'} in ${c.ms} ms${c.error ? `: ${c.error}` : ''}`,
    );
    this.events.changed();
  }

  view(): EwbView {
    return {
      apiBase: this.apiBase(),
      calls: this.calls.map((c) => ({ ...c, at: new Date(c.at).toISOString() })),
      hasKey: this.key !== null,
      canStore: safeStorage.isEncryptionAvailable(),
      checking: this.checking,
      syncing: this.syncing,
      error: this.error,
      characters: this.account,
      fits: this.fitCount,
      runs: this.key ? this.runList.length : null,
      updatedAt: this.updatedMs ? new Date(this.updatedMs).toISOString() : null,
    };
  }
}
