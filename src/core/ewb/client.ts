/**
 * EVE Workbench API (EVE-86, https://api.eveworkbench.com/swagger/v1/swagger.json) with the player's personal
 * access token in X-API-KEY. Only what the app uses: the account's characters, its fits, its Abyss Tracker runs,
 * Jita prices, and the telemetry upload. The API answers in camelCase or PascalCase depending on the route, so
 * fields are read case-insensitively. Network is injected.
 */
import { WEATHER_IDS, type EwbAbyssRun, type WeatherId } from '../abyss/types';
import { DEFAULT_EWB_API } from '../settings';
import type { Telemetry } from './telemetry';

/** Jita IV - Moon 4 - Caldari Navy Assembly Plant: the prices of the loot value. */
export const JITA_STATION = 60003760;
const TIER_NAMES = ['Tranquil', 'Calm', 'Agitated', 'Fierce', 'Raging', 'Chaotic', 'Cataclysmic'];
const PRICES_MS = 60 * 60_000;

export type EwbFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal },
) => Promise<{ status: number; json(): Promise<unknown> }>;

/** How long a call may take before it is given up (EVE-91); the upload and the price list get longer. */
export const EWB_TIMEOUT_MS = 30_000;
const UPLOAD_TIMEOUT_MS = 90_000;

/** One finished call, for the settings' recent calls list (EVE-91). */
export interface EwbCall {
  at: number;
  method: string;
  path: string;
  /** Null: no answer (timeout or network error). */
  status: number | null;
  ms: number;
  error: string | null;
}

export class EwbError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A field by name in any letter case. */
export function field(o: unknown, name: string): unknown {
  if (!isObj(o)) return undefined;
  if (name in o) return o[name];
  const lower = name.toLowerCase();
  for (const k of Object.keys(o)) if (k.toLowerCase() === lower) return o[k];
  return undefined;
}
const str = (v: unknown) => (typeof v === 'string' ? v : null);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const arr = (v: unknown) => (Array.isArray(v) ? v : []);

export interface EwbCharacter {
  id: number;
  name: string;
}

export interface EwbFit {
  id: string;
  name: string;
  shipTypeId: number | null;
  shipName: string | null;
  /** The fit's hashes joined: changes when the fit changes, so its EFT is fetched again only then. */
  hash: string;
}

export class EwbClient {
  private prices: { atMs: number; byType: Map<number, number> } | null = null;
  /** Told about every call when it ends, with its time (EVE-91). */
  onCall: (c: EwbCall) => void = () => {};

  constructor(
    private readonly key: () => string | null,
    private readonly fetch: EwbFetch,
    /** The API server: the live one, or one set in the settings (EVE-90). */
    private readonly base: () => string = () => DEFAULT_EWB_API,
    private readonly now: () => number = Date.now,
  ) {}

  private async call(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    timeoutMs = EWB_TIMEOUT_MS,
  ): Promise<unknown> {
    const key = this.key();
    if (!key) throw new EwbError('No EVE Workbench key.', 401);
    const headers: Record<string, string> = { 'X-API-KEY': key, Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    // A test server may be much slower: EVE Workbench's staging answered every call after ~30 s (EVE-91).
    if (this.base() !== DEFAULT_EWB_API) timeoutMs *= 3;
    const started = this.now();
    const ended = (status: number | null, error: string | null) =>
      this.onCall({ at: started, method, path: path.replace(/\?.*$/, ''), status, ms: this.now() - started, error });
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), timeoutMs);
    let res: Awaited<ReturnType<EwbFetch>>;
    let data: unknown;
    try {
      res = await this.fetch(`${this.base()}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: abort.signal,
      });
      data = await res.json().catch(() => null);
    } catch (err) {
      const msg = abort.signal.aborted
        ? `EVE Workbench did not answer in ${Math.round(timeoutMs / 1000)} s.`
        : `EVE Workbench could not be reached: ${(err as Error).message}`;
      ended(null, msg);
      throw new EwbError(msg, 0);
    } finally {
      clearTimeout(timer);
    }
    const ok = res.status >= 200 && res.status < 300 && field(data, 'error') !== true;
    ended(res.status, ok ? null : (str(field(data, 'message')) ?? `HTTP ${res.status}`));
    if (res.status === 401 || res.status === 403)
      throw new EwbError('EVE Workbench refused the key. Check it, or make a new one on eveworkbench.com.', res.status);
    if (res.status === 429) throw new EwbError('EVE Workbench asked to wait (rate limit). Try again later.', 429);
    const message = str(field(data, 'message')) ?? str(field(data, 'title'));
    if (res.status < 200 || res.status >= 300)
      throw new EwbError(`EVE Workbench ${path}: ${res.status}${message ? ` ${message}` : ''}`, res.status);
    if (field(data, 'error') === true) throw new EwbError(message ?? `EVE Workbench ${path}: error`, res.status);
    return data;
  }

  /** The characters of the key's account (also the key check). */
  async characters(): Promise<EwbCharacter[]> {
    const data = await this.call('GET', '/v1/characters');
    return arr(data).flatMap((c) => {
      const id = num(field(c, 'id'));
      return id === null ? [] : [{ id, name: str(field(c, 'name')) ?? String(id) }];
    });
  }

  async fits(): Promise<EwbFit[]> {
    const data = await this.call('GET', '/v1/fits/list');
    return arr(field(data, 'fits')).flatMap((f) => {
      const id = str(field(f, 'id'));
      if (!id) return [];
      const ship = field(f, 'ship');
      return [
        {
          id,
          name: str(field(f, 'name')) ?? 'EVE Workbench fit',
          shipTypeId: num(field(ship, 'typeId')),
          shipName: str(field(ship, 'name')),
          hash: arr(field(f, 'hashes'))
            .map((h) => str(field(h, 'hash')) ?? '')
            .join('|'),
        },
      ];
    });
  }

  async fitEft(id: string): Promise<string> {
    const data = await this.call('GET', `/v1/fits/${encodeURIComponent(id)}/eft`);
    const eft = str(field(data, 'eft'));
    if (!eft) throw new EwbError(`EVE Workbench fit ${id}: no EFT`, 200);
    return eft;
  }

  /** The account's Abyss Tracker runs, newest first; `pages` pages of them. */
  async runs(page = 1): Promise<{ runs: EwbAbyssRun[]; pages: number }> {
    const data = await this.call('GET', `/v1/abyss-tracker/get-runs?page=${page}`);
    const runs = arr(field(data, 'runs')).flatMap((r): EwbAbyssRun[] => {
      const id = str(field(r, 'id'));
      if (!id) return [];
      const w = (str(field(r, 'abyssWeather')) ?? '').toLowerCase();
      const tier = TIER_NAMES.indexOf(str(field(r, 'abyssTier')) ?? '');
      return [
        {
          id,
          dateAdded: str(field(r, 'dateAdded')) ?? '',
          weather: WEATHER_IDS.includes(w as WeatherId) ? (w as WeatherId) : null,
          tier: tier >= 0 ? tier : null,
          hullType: str(field(r, 'hullType')),
          survived: field(r, 'survived') === true,
          seconds: num(field(r, 'timeSpend')) ?? num(field(r, 'timeSpendSeconds')),
          lootValue: num(field(r, 'lootValue')),
          loot: arr(field(r, 'loot')).map((l) => ({
            name: str(field(l, 'type')) ?? '?',
            typeId: num(field(l, 'typeId')) ?? 0,
            count: num(field(l, 'amount')) ?? 0,
            value: num(field(l, 'totalSellPrice')),
          })),
        },
      ];
    });
    return { runs, pages: num(field(data, 'numberOfPages')) ?? 1 };
  }

  /** Jita sell averages per type, read at most once an hour. */
  async price(): Promise<(typeId: number) => number | null> {
    if (!this.prices || this.now() - this.prices.atMs > PRICES_MS) {
      const data = await this.call('GET', `/v1/averageprices/${JITA_STATION}`);
      const byType = new Map<number, number>();
      for (const p of arr(field(data, 'prices'))) {
        const id = num(field(p, 'typeId'));
        const v = num(field(p, 'price'));
        if (id === null || v === null) continue;
        const sell = /sell/i.test(str(field(p, 'orderType')) ?? '');
        // A sell price wins over any other order type of the same item.
        if (sell || !byType.has(id)) byType.set(id, v);
      }
      this.prices = { atMs: this.now(), byType };
    }
    const byType = this.prices.byType;
    return (id) => byType.get(id) ?? null;
  }

  /** Uploads a run; returns the tracker's run id. */
  async upload(t: Telemetry): Promise<string | null> {
    const data = await this.call('POST', '/v1/abyss-tracker/telemetry', t, UPLOAD_TIMEOUT_MS);
    return str(field(data, 'runId'));
  }
}
